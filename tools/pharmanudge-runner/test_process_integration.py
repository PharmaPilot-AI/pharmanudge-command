"""Exercise real argument-array gh subprocesses against local fixture processes."""
import contextlib
import hashlib
import io
import json
import os
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

import test_runner


class ProcessIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_runner.RunnerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.prepare_repo()
        self.root = self.fixture.root
        self.bin_dir = self.root / 'bin'
        self.bin_dir.mkdir()
        self.log = self.root / 'gh-calls.jsonl'
        self.runner = self.fixture.make_runner()

    @contextlib.contextmanager
    def fake_gh(self, code):
        executable = self.bin_dir / 'gh'
        executable.write_text('#!' + sys.executable + '\n' + code)
        executable.chmod(0o700)
        guarded_popen = test_runner.runner.subprocess.Popen

        def local_fixture(argv, *args, **kwargs):
            if argv[0] == 'gh':
                argv = [str(executable), *argv[1:]]
            return guarded_popen(argv, *args, **kwargs)

        with patch.object(test_runner.runner.subprocess, 'Popen', side_effect=local_fixture):
            yield

    def test_real_gh_process_preserves_issue_as_data_and_uses_fixed_repository(self):
        marker = self.root / 'must-not-exist'
        body = 'Untrusted fixture: $(touch ' + str(marker) + '); `false`\n'
        self.fixture.remote_issue['body'] = body
        self.fixture.task['body_sha256'] = hashlib.sha256(body.encode()).hexdigest()
        self.fixture.write_config()
        responses = {
            'repos/' + test_runner.runner.REPO: {
                'full_name': test_runner.runner.REPO, 'default_branch': 'main'},
            'repos/' + test_runner.runner.REPO + '/issues/3': self.fixture.remote_issue,
            'repos/' + test_runner.runner.REPO + '/commits/main': {'sha': self.fixture.base},
        }
        code = ('import json,sys,pathlib\n'
                'responses = ' + repr(responses) + '\n'
                'with pathlib.Path(' + repr(str(self.log)) + ').open("a") as f:\n'
                ' f.write(json.dumps(sys.argv[1:]) + "\\n")\n'
                'print(json.dumps(responses[sys.argv[-1]]))\n')
        before = self.fixture.config.read_bytes()
        with self.fake_gh(code):
            self.assertEqual(self.runner.poll(), 'dry-run')
        self.assertFalse(marker.exists())
        self.assertFalse(self.fixture.state.exists())
        self.assertEqual(self.fixture.config.read_bytes(), before)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertGreaterEqual(len(calls), 3)
        for args in calls:
            self.assertEqual(args[:3], ['api', '--hostname', 'github.com'])
            self.assertTrue(args[-1].startswith('repos/' + test_runner.runner.REPO))
            self.assertNotIn(body, args)

    def test_auth_failure_does_not_expose_raw_output_or_launch_worker(self):
        secret = 'FIXTURE_PRIVATE_OUTPUT_DO_NOT_FORWARD'
        code = ('import sys\nprint(' + repr(secret) + ')\n'
                'print(' + repr(secret) + ', file=sys.stderr)\nsys.exit(1)\n')
        with self.fake_gh(code):
            with self.assertRaises(test_runner.runner.SafetyError) as raised:
                self.runner.poll()
        self.assertNotIn(secret, str(raised.exception))
        self.assertFalse(self.fixture.state.exists())

    def test_cli_cannot_select_an_alternate_ledger_to_bypass_budget(self):
        alternate = self.root / 'alternate-state.json'
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            result = test_runner.runner.main(['--state', str(alternate), 'init-state'])
        self.assertEqual(result, 2)
        self.assertFalse(alternate.exists())
        self.assertFalse(alternate.with_suffix('.json.lock').exists())

    def test_unknown_prior_revision_blocks_all_new_work_until_reconciliation(self):
        active = self.fixture.active_runner()
        alert_guard = patch.object(active, 'notify_if_enabled')
        alert_guard.start()
        self.addCleanup(alert_guard.stop)
        for status in ('claimed', 'unknown'):
            with self.subTest(status=status):
                old_key = '99:' + 'a' * 64
                state = {'version': 1, 'claims': {
                    old_key: {'status': status, 'day': test_runner.runner.utc_day(),
                              'branch': 'runner/prior', 'worktree': str(self.root / 'prior')}},
                         'days': {test_runner.runner.utc_day(): 1}}
                with active.lock():
                    active.save_state(state)
                with patch.object(active, 'command', side_effect=AssertionError('unreconciled run must gate polling')):
                    self.assertEqual(active.poll(), 'reconciliation-required')
        active.reconcile(old_key)
        with self.fake_gh('import sys; sys.exit(1)\n'):
            with self.assertRaises(test_runner.runner.SafetyError):
                active.poll()

    def test_cli_termination_persists_unknown_and_cleans_worker_group(self):
        for sig in (signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signal=sig):
                self.fixture.cfg['dry_run'] = False
                self.fixture.write_config()
                if self.fixture.state.exists():
                    self.fixture.state.unlink()
                self.runner.init_state()
                pidfile = self.root / ('worker-' + str(sig) + '.json')
                notice = self.root / ('notice-' + str(sig))
                worker = ('import os,signal,time,json,pathlib\n'
                          'signal.signal(signal.SIGTERM, signal.SIG_IGN)\n'
                          'child=os.fork()\n'
                          'if child == 0: time.sleep(20)\n'
                          'else:\n'
                          ' ready=pathlib.Path(' + repr(str(pidfile) + '.tmp') + ')\n'
                          ' ready.write_text(json.dumps([os.getpid(),child]))\n'
                          ' os.replace(ready,' + repr(str(pidfile)) + ')\n'
                          ' time.sleep(20)\n')
                harness = ('import runner,sys,pathlib\n'
                           'runner.STATE_PATH=pathlib.Path(' + repr(str(self.fixture.state)) + ')\n'
                           'runner.Runner.authorize=lambda *a: "fixture"\n'
                           'runner.Runner.verify_identity=lambda *a: None\n'
                           'runner.Runner.git=lambda *a: ""\n'
                           'runner.Runner.notify=lambda self,status: pathlib.Path(' + repr(str(notice)) + ').write_text(status)\n'
                           'original=runner.Runner.command\n'
                           'def command(self,argv,**kw):\n'
                           ' if argv[0] == runner.CLI:\n'
                           '  return original(self,[sys.executable,"-c",' + repr(worker) + '],timeout=10,grace=.1,capture=False)\n'
                           ' return ' + repr(self.fixture.base) + '\n'
                           'runner.Runner.command=command\n'
                           'sys.exit(runner.main(["--config",' + repr(str(self.fixture.config)) + ',"poll"]))\n')
                proc = subprocess.Popen([sys.executable, '-c', harness],
                                        cwd=str(test_runner.MODULE.parent),
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                pids = []
                try:
                    until = time.monotonic() + 3
                    while not pidfile.exists() and proc.poll() is None and time.monotonic() < until:
                        time.sleep(.01)
                    self.assertTrue(pidfile.exists(), 'fixture worker did not start')
                    pids = json.loads(pidfile.read_text())
                    proc.send_signal(sig)
                    out, err = proc.communicate(timeout=4)
                    self.assertEqual(proc.returncode, 130, err.decode())
                    self.assertEqual(out, b'')
                    self.assertIn(b'manual reconciliation required', err)
                    state = self.runner.load_state()
                    self.assertEqual(state['claims'][self.runner.key(self.fixture.task)]['status'], 'unknown')
                    self.assertEqual(state['days'][test_runner.runner.utc_day()], 1)
                    self.assertEqual(notice.read_text(), 'unknown')
                    for pid in pids:
                        self.fixture.assert_process_dead(pid)
                finally:
                    if proc.poll() is None:
                        proc.kill()
                    proc.communicate(timeout=3)
                    if pids:
                        try:
                            os.killpg(pids[0], signal.SIGKILL)
                        except ProcessLookupError:
                            pass

    def test_unexpected_remote_json_fails_closed(self):
        with self.fake_gh('print("[]")\n'):
            with self.assertRaises(test_runner.runner.SafetyError):
                self.runner.poll()
        self.assertFalse(self.fixture.state.exists())


if __name__ == '__main__':
    unittest.main()
