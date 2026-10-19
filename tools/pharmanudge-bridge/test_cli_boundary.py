"""Portable CLI refusal tests: external tools are local sentinels, not real APIs."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class CLIBoundaryTests(unittest.TestCase):
    def test_commands_do_not_inherit_profile_overrides_or_unrelated_secrets(self):
        from test_bridge import bridge
        from unittest.mock import patch
        names = ['HERMES_HOME', 'HERMES_PROFILE', 'GH_TOKEN', 'GITHUB_TOKEN', 'SYNTHETIC_OTHER_SECRET']
        code = 'import os,json;print(json.dumps([os.environ.get(k) for k in ' + repr(names) + ']))'
        with patch.dict(os.environ, {name: 'SYNTHETIC-NOT-FORWARDABLE' for name in names}):
            output = bridge.Command(lambda: None).run([sys.executable, '-c', code], timeout=1)
        self.assertEqual(json.loads(output), [None] * len(names))

    def test_handled_signal_during_spawn_return_preserves_ownership_and_handlers(self):
        import signal
        from unittest.mock import patch
        from test_bridge import bridge
        real_spawn = subprocess.Popen
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            with self.subTest(signum=signum):
                created = []
                before = {s: signal.getsignal(s) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
                def spawn(*args, **kwargs):
                    process = real_spawn(*args, **kwargs)
                    created.append(process)
                    os.kill(os.getpid(), signum)
                    return process
                try:
                    with patch.object(bridge.subprocess, 'Popen', side_effect=spawn):
                        with self.assertRaises(bridge.BridgeError):
                            bridge.Command(lambda: None).run([sys.executable, '-c', 'import time;time.sleep(5)'], timeout=1)
                    self.assertEqual(len(created), 1)
                    self.assertIsNotNone(created[0].returncode, 'spawn-return interruption leaked ownership before assignment')
                    for s, handler in before.items():
                        self.assertIs(signal.getsignal(s), handler)
                finally:
                    for process in created:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        process.wait(timeout=2)
                        if process.stdout is not None:
                            process.stdout.close()

    def test_command_preserves_callers_mask_and_handlers_on_success_and_spawn_error(self):
        import signal
        from unittest.mock import patch
        from test_bridge import bridge
        signals = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
        handlers = {s: signal.getsignal(s) for s in signals}
        original = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR1})
        expected = signal.pthread_sigmask(signal.SIG_BLOCK, set())
        try:
            code = 'import json,signal;print(json.dumps(sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK,set()))))'
            output = bridge.Command(lambda: None).run([sys.executable, '-c', code], timeout=1)
            self.assertEqual(json.loads(output), sorted(int(s) for s in expected))
            with patch.object(bridge.subprocess, 'Popen', side_effect=OSError('synthetic startup failure')):
                with self.assertRaises(bridge.BridgeError):
                    bridge.Command(lambda: None).run([sys.executable, '-c', 'pass'], timeout=1)
            self.assertEqual(signal.pthread_sigmask(signal.SIG_BLOCK, set()), expected)
            for s, handler in handlers.items():
                self.assertIs(signal.getsignal(s), handler)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, original)

    def test_supervisor_sigterm_reaps_owned_command(self):
        import signal
        import time
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pidfile, marker = root / 'pid', root / 'orphan-marker'
            child_code = ('import os,time;from pathlib import Path;'
                + 'Path(' + repr(str(pidfile)) + ').write_text(str(os.getpid()));'
                + 'time.sleep(0.8);Path(' + repr(str(marker)) + ').write_text("orphan")')
            folder = str(Path(__file__).parent)
            code = ('import sys;sys.path.insert(0,' + repr(folder) + ');from test_bridge import bridge;'
                + 'bridge.Command(lambda:None).run(' + repr([sys.executable, '-c', child_code]) + ',timeout=2)')
            supervisor = subprocess.Popen([sys.executable, '-c', code], stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            owned = None
            try:
                deadline = time.monotonic() + 3
                while not pidfile.exists() and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertTrue(pidfile.exists(), 'synthetic command failed to start')
                owned = int(pidfile.read_text())
                supervisor.terminate()
                supervisor.wait(timeout=2)
                deadline = time.monotonic() + 1.1
                while time.monotonic() < deadline and not marker.exists():
                    time.sleep(.01)
                self.assertFalse(marker.exists(), 'owned command survived catchable supervisor termination')
            finally:
                if supervisor.poll() is None:
                    supervisor.kill()
                    supervisor.wait(timeout=2)
                if owned is not None:
                    try:
                        os.killpg(owned, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_disabled_cli_cannot_fetch_or_notify_and_does_not_initialize_state(self):
        source = Path(__file__).with_name('bridge.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bindir = root / 'bin'
            bindir.mkdir()
            marker = root / 'external-invocation'
            for name in ('gh', 'pharmanudge', 'git'):
                tool = bindir / name
                tool.write_text('#!/bin/sh\n: > "$HOME/external-invocation"\nexit 99\n')
                tool.chmod(0o700)
            config = root / 'config.json'
            config.write_text(json.dumps(dict(enabled=False, dry_run=True,
                approval_comment_id=None, source_sha=None, window_id=None)))
            env = dict(os.environ, HOME=str(root), PATH=str(bindir), PYTHONDONTWRITEBYTECODE='1')
            for action in ('init', 'run'):
                with self.subTest(action=action):
                    result = subprocess.run([sys.executable, str(source), '--config', str(config), action],
                        env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(marker.exists(), 'disabled CLI invoked an external command')
                    self.assertFalse((root / '.local' / 'state' / 'pharmanudge-coordination-windows').exists())
            cfg = json.loads(config.read_text())
            cfg['unexpected_private_value'] = 'SYNTHETIC-PRIVATE-CONTENT'
            config.write_text(json.dumps(cfg))
            result = subprocess.run([sys.executable, str(source), '--config', str(config), 'run'],
                env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn(b'SYNTHETIC-PRIVATE-CONTENT', result.stdout + result.stderr)
            self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
