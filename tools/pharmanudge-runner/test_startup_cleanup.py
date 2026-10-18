"""Deterministic local-process regressions for command startup ownership."""
import contextlib
import io
import json
import os
import signal
import subprocess
import sys
import textwrap
import unittest

import test_runner


class StartupCleanupTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_runner.RunnerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.prepare_repo()
        self.active = self.fixture.active_runner()

    def startup_interrupt(self, stage, sig=signal.SIGINT):
        root = self.fixture.root
        pidfile = root / 'worker.json'
        worker = textwrap.dedent('''\
            import json, os, pathlib, signal, time
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            child = os.fork()
            if child == 0:
                time.sleep(20)
            else:
                mask = sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK, []))
                ready = pathlib.Path(PIDFILE + '.tmp')
                ready.write_text(json.dumps({'pids': [os.getpid(), child], 'mask': mask}))
                os.replace(ready, PIDFILE)
                time.sleep(20)
            ''').replace('PIDFILE', repr(str(pidfile)))
        harness = textwrap.dedent('''\
            import os, pathlib, signal, sys, time
            import runner
            runner.STATE_PATH = pathlib.Path(STATE)
            runner.Runner.authorize = lambda *a: 'fixture'
            runner.Runner.verify_identity = lambda *a: None
            runner.Runner.git = lambda *a: ''
            runner.Runner.notify = lambda *a: None
            real_command = runner.Runner.command
            real_popen = runner.subprocess.Popen
            real_monotonic = time.monotonic
            real_register = runner.selectors.DefaultSelector.register
            spawned = []
            original_handlers = {sig: signal.getsignal(sig)
                                 for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)}
            armed = False
            def popen(*a, **kw):
                global armed
                p = real_popen(*a, **kw)
                spawned.append(p)
                until = real_monotonic() + 3
                while not pathlib.Path(PIDFILE).exists():
                    if real_monotonic() > until:
                        raise RuntimeError('fixture did not become ready')
                    time.sleep(.005)
                if STAGE == 'spawn':
                    os.kill(os.getpid(), SIGNUM)
                armed = True
                return p
            def monotonic():
                global armed
                if armed and STAGE == 'clock':
                    armed = False
                    raise KeyboardInterrupt()
                return real_monotonic()
            def register(self, *a, **kw):
                result = real_register(self, *a, **kw)
                if STAGE == 'register':
                    os.kill(os.getpid(), SIGNUM)
                return result
            def command(self, argv, **kw):
                if argv[0] == runner.CLI:
                    return real_command(self, [sys.executable, '-c', WORKER],
                                        timeout=5, grace=.02, capture=True)
                return BASE
            runner.subprocess.Popen = popen
            runner.time.monotonic = monotonic
            runner.selectors.DefaultSelector.register = register
            runner.Runner.command = command
            result = runner.main(['--config', CONFIG, 'poll'])
            assert spawned and all(p.returncode is not None for p in spawned), 'direct child was not reaped'
            assert {sig: signal.getsignal(sig) for sig in original_handlers} == original_handlers
            sys.exit(result)
            ''')
        values = {'STATE': str(self.fixture.state), 'PIDFILE': str(pidfile),
                  'STAGE': stage, 'SIGNUM': int(sig), 'WORKER': worker,
                  'BASE': self.fixture.base, 'CONFIG': str(self.fixture.config)}
        # Prefix constants instead of interpolating executable fixture source.
        harness = '\n'.join(f'{k} = {v!r}' for k, v in values.items()) + '\n' + harness
        proc = subprocess.Popen([sys.executable, '-c', harness],
                                cwd=str(test_runner.MODULE.parent),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        pids = []
        try:
            out, err = proc.communicate(timeout=7)
            self.assertTrue(pidfile.exists(), err.decode())
            record = json.loads(pidfile.read_text())
            pids = record['pids']
            self.assertEqual(proc.returncode, 130, err.decode())
            self.assertEqual(out, b'')
            self.assertIn(b'manual reconciliation required', err)
            self.assertFalse(set(record['mask']) & {int(signal.SIGTERM), int(signal.SIGHUP), int(signal.SIGINT)},
                             'worker inherited blocked termination signals')
            state = self.active.load_state()
            self.assertEqual(state['claims'][self.active.key(self.fixture.task)]['status'], 'unknown')
            self.assertEqual(state['days'][test_runner.runner.utc_day()], 1)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                with unittest.mock.patch.object(self.active, 'notify_if_enabled'):
                    with unittest.mock.patch.object(self.active, 'command', side_effect=AssertionError('unknown must gate')):
                        self.assertEqual(self.active.poll(), 'reconciliation-required')
            for pid in pids:
                self.fixture.assert_process_dead(pid)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.communicate(timeout=3)
            if pidfile.exists():
                pids = json.loads(pidfile.read_text())['pids']
            if pids:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(pids[0], signal.SIGKILL)

    def test_parent_handlers_and_preexisting_mask_survive_success(self):
        signals = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)
        before = {sig: signal.getsignal(sig) for sig in signals}
        old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGHUP})
        try:
            expected = signal.pthread_sigmask(signal.SIG_BLOCK, [])
            output = self.active.command([
                sys.executable, '-c',
                'import json,signal; print(json.dumps(sorted(int(s) for s in '
                'signal.pthread_sigmask(signal.SIG_BLOCK, []))))'])
            self.assertEqual(set(json.loads(output)), {int(s) for s in expected})
            self.assertEqual(signal.pthread_sigmask(signal.SIG_BLOCK, []), expected)
            self.assertEqual({sig: signal.getsignal(sig) for sig in signals}, before)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)

    def test_parent_handlers_and_mask_survive_popen_failure(self):
        module = test_runner.runner
        signals = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)
        before = {sig: signal.getsignal(sig) for sig in signals}
        mask = signal.pthread_sigmask(signal.SIG_BLOCK, [])
        with unittest.mock.patch.object(module.subprocess, 'Popen', side_effect=OSError):
            with self.assertRaisesRegex(module.SafetyError, 'command unavailable'):
                self.active.command([sys.executable, '-c', 'pass'])
        self.assertEqual({sig: signal.getsignal(sig) for sig in signals}, before)
        self.assertEqual(signal.pthread_sigmask(signal.SIG_BLOCK, []), mask)

    def test_sigterm_before_popen_returns_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('spawn', signal.SIGTERM)

    def test_sighup_before_popen_returns_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('spawn', signal.SIGHUP)

    def test_sigint_before_popen_returns_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('spawn', signal.SIGINT)

    def test_sigterm_during_registration_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('register', signal.SIGTERM)

    def test_sighup_during_registration_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('register', signal.SIGHUP)

    def test_sigint_during_registration_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('register', signal.SIGINT)

    def test_first_clock_after_spawn_cleans_group_and_gates_unknown(self):
        self.startup_interrupt('clock')


if __name__ == '__main__':
    unittest.main()
