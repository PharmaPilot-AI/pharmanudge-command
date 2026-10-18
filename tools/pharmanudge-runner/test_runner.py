"""Hermetic safety tests. TDD transcript is recorded in the parent session tool output."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

MODULE = Path(__file__).with_name('runner.py')
if MODULE.exists():
    spec = importlib.util.spec_from_file_location('runner', MODULE)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
else:
    runner = None


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = self.root / 'config.json'
        self.state = self.root / 'state.json'
        self.cfg = {'enabled': False, 'dry_run': True, 'tasks': [],
                    'repo_dir': str(self.root / 'repo')}
        self.write_config()
        if runner is not None:
            canonical = patch.object(runner, 'STATE_PATH', self.state, create=True)
            canonical.start()
            self.addCleanup(canonical.stop)
            popen = runner.subprocess.Popen
            def local_only(argv, *args, **kwargs):
                if argv[0] in ('gh', runner.CLI, 'systemctl'):
                    raise AssertionError('test attempted external command: ' + argv[0])
                return popen(argv, *args, **kwargs)
            guard = patch.object(runner.subprocess, 'Popen', side_effect=local_only)
            guard.start()
            self.addCleanup(guard.stop)

    def write_config(self):
        self.config.write_text(json.dumps(self.cfg))

    def make_runner(self):
        self.assertIsNotNone(runner, 'bounded runner implementation is missing')
        return runner.Runner(self.config, self.state)

    def test_canonical_state_identity_cannot_be_forked(self):
        with self.assertRaises(runner.SafetyError):
            runner.Runner(self.config, self.root / 'other.json')
        alias = self.root / 'alias.json'
        alias.symlink_to(self.state)
        r = runner.Runner(self.config, alias)
        self.assertEqual(r.state_path, self.state)
        r.state_path = self.root / 'other.json'
        with self.assertRaises(runner.SafetyError):
            r.init_state()
        self.assertFalse(r.state_path.exists())

    def test_disabled_and_empty_queue_never_infer_or_touch_state(self):
        r = self.make_runner()
        with patch.object(r, 'command', side_effect=AssertionError('no subprocess expected')):
            self.assertEqual(r.poll(), 'disabled')
            self.cfg['enabled'] = True
            self.write_config()
            self.assertEqual(r.poll(), 'empty')
        self.assertFalse(self.state.exists())

    def prepare_repo(self):
        repo = self.root / 'repo'
        repo.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repo), *args], stderr=subprocess.DEVNULL).decode().strip()
        git('init', '-b', 'main')
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base')
        self.base = git('rev-parse', 'HEAD')
        git('remote', 'add', 'origin', 'https://github.com/PharmaPilot-AI/pharmanudge-command.git')
        git('update-ref', 'refs/remotes/origin/main', self.base)
        self.body = 'Implement a bounded local change.\n'
        self.task = {'issue': 3, 'author': 'approved-user',
                     'body_sha256': hashlib.sha256(self.body.encode()).hexdigest(), 'base_commit': self.base}
        self.cfg.update(enabled=True, dry_run=True, tasks=[self.task])
        self.write_config()
        self.remote_issue = {'number': 3, 'state': 'open', 'user': {'login': 'approved-user'}, 'body': self.body}
        self.calls = []
        return repo

    def fake_remote(self, real):
        def call(argv, **kwargs):
            self.calls.append(argv)
            if argv[0] == 'gh':
                endpoint = argv[-1]
                if endpoint.endswith('/issues/3'):
                    return json.dumps(self.remote_issue)
                if endpoint.endswith('/commits/main'):
                    return json.dumps({'sha': self.base})
                return json.dumps({'full_name': runner.REPO, 'default_branch': 'main'})
            return real(argv, **kwargs)
        return call

    def test_dry_run_verifies_local_and_remote_authorization_without_writes(self):
        self.prepare_repo()
        r = self.make_runner()
        with patch.object(r, 'command', side_effect=self.fake_remote(r.command)):
            self.assertEqual(r.poll(), 'dry-run')
        self.assertFalse(self.state.exists())
        self.assertFalse(any(a[0] == runner.CLI for a in self.calls))

    def test_author_hash_closed_and_base_mismatch_fail_before_worker(self):
        self.prepare_repo()
        for change in ({'user': {'login': 'attacker'}}, {'body': self.body + 'edited'},
                       {'state': 'closed'}, {'pull_request': {}}, {'number': 4}):
            with self.subTest(change=change):
                saved = self.remote_issue.copy()
                self.remote_issue.update(change)
                r = self.make_runner()
                with patch.object(r, 'command', side_effect=self.fake_remote(r.command)):
                    with self.assertRaisesRegex(runner.SafetyError, 'authorization rejected'):
                        r.poll()
                self.remote_issue = saved
        self.task['base_commit'] = 'a' * 40
        self.write_config()
        r = self.make_runner()
        with patch.object(r, 'command', side_effect=self.fake_remote(r.command)):
            with self.assertRaises(runner.SafetyError):
                r.poll()
        self.assertFalse(any(a[0] == runner.CLI for a in self.calls))

    def test_missing_corrupt_or_unsafe_config_fails_closed(self):
        r = self.make_runner()
        for text in ('{', '{}', '{"enabled": "yes"}', 'null'):
            self.config.write_text(text)
            with self.assertRaises(runner.SafetyError):
                r.poll()
        self.config.unlink()
        with self.assertRaises(runner.SafetyError):
            r.poll()

    def test_lock_is_nonblocking_and_shared_across_runner_instances(self):
        r = self.make_runner()
        with r.lock():
            other = self.make_runner()
            with self.assertRaisesRegex(runner.SafetyError, 'runner busy'):
                other.poll()
        self.assertEqual(r.poll(), 'disabled')

    def test_state_initialization_corruption_and_terminal_reconciliation(self):
        self.prepare_repo()
        self.cfg['dry_run'] = False
        self.write_config()
        r = self.make_runner()
        alerts = patch.object(r, 'notify_if_enabled')
        alerts.start()
        self.addCleanup(alerts.stop)
        with self.assertRaisesRegex(runner.SafetyError, 'invalid state'):
            r.poll()
        r.init_state()
        with self.assertRaises(runner.SafetyError):
            r.init_state()
        self.assertEqual(r.load_state(), {'version': 1, 'claims': {}, 'days': {}})
        key = str(self.task['issue']) + ':' + self.task['body_sha256']
        state = {'version': 1, 'claims': {key: {'status': 'claimed', 'day': '2026-10-17'}},
                 'days': {'2026-10-17': 1}}
        r.save_state(state)
        with patch.object(r, 'command', side_effect=AssertionError('interrupted claim must not launch')):
            self.assertEqual(r.poll(), 'reconciliation-required')
        r.reconcile(key)
        self.assertEqual(r.load_state()['claims'][key]['status'], 'reconciled')
        with patch.object(r, 'command', side_effect=AssertionError('terminal claim must not launch')):
            self.assertEqual(self.make_runner().poll(), 'already-claimed')
        for broken in ('{', '{}', '{"version":1,"claims":{},"days":{"2026-10-17":-1}}'):
            self.state.write_text(broken)
            with self.assertRaisesRegex(runner.SafetyError, 'invalid state'):
                r.poll()

    def active_runner(self):
        self.cfg['dry_run'] = False
        self.write_config()
        r = self.make_runner()
        r.init_state()
        return r

    def test_malformed_state_version_and_claim_metadata_fail_closed(self):
        r = self.make_runner()
        key = '3:' + 'a' * 64
        for bad in (
                {'version': True, 'claims': {}, 'days': {}},
                {'version': 1.0, 'claims': {}, 'days': {}},
                *({'version': 1, 'claims': {key: claim}, 'days': {'2026-10-17': 1}}
                  for claim in ({'status': 'unknown', 'day': '2026-10-17', 'worktree': []},
                                {'status': 'claimed', 'day': '2026-10-17', 'branch': False},
                                {'status': 'failed', 'day': '2026-10-17', 'extra': 'bad'}))):
            with self.subTest(state=bad):
                self.state.write_text(json.dumps(bad))
                with self.assertRaisesRegex(runner.SafetyError, 'invalid state'):
                    r.load_state()

    def test_notification_has_independent_budget_and_restores_poll_deadline(self):
        r = self.make_runner()
        expired = time.monotonic() - 1
        r.deadline = expired
        def send(argv, **kwargs):
            self.assertTrue(r.deadline is None or r.deadline > time.monotonic())
            self.assertEqual(kwargs['timeout'], 5)
            self.assertFalse(kwargs['capture'])
            self.assertEqual(argv[-1], 'PharmaNudge runner: blocker; manual review needed.')
            raise runner.SafetyError('fixture notification failure')
        with patch.object(r, 'command', side_effect=send) as command:
            r.notify('blocker')
        command.assert_called_once()
        self.assertEqual(r.deadline, expired)

    def test_worker_claim_is_durable_before_launch_and_notification_failure_never_retries(self):
        repo = self.prepare_repo()
        r = self.active_runner()
        calls = []
        real = self.fake_remote(r.command)
        def fake(argv, **kwargs):
            if argv[0] == runner.CLI:
                calls.append((argv, kwargs))
                if argv[1] == 'send':
                    raise runner.SafetyError('notification failed')
                state = self.make_runner().load_state()
                self.assertEqual(state['days'][runner.utc_day()], 1)
                self.assertEqual(state['claims'][r.key(self.task)]['status'], 'claimed')
                path = Path(argv[argv.index('--in') + 1])
                self.assertNotEqual(path, repo)
                self.assertEqual(subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD']).decode().strip(), self.base)
                self.assertEqual(kwargs['timeout'], 1200)
                self.assertEqual(kwargs['grace'], 30)
                self.assertFalse(kwargs['capture'])
                return ''
            return real(argv, **kwargs)
        with patch.object(r, 'verify_identity', create=True), patch.object(r, 'command', side_effect=fake):
            self.assertEqual(r.poll(), 'review-needed')
        worker = calls[0][0]
        self.assertEqual(worker[worker.index('--provider') + 1], 'openai-codex')
        self.assertEqual(worker[worker.index('--model') + 1], 'gpt-6.1-sol')
        self.assertEqual(worker[worker.index('--max-turns') + 1], '30')
        self.assertFalse(set(worker) & {'--yolo', '--oneshot', '-z', '--accept-hooks'})
        self.assertEqual(calls[1][0], [runner.CLI, 'send', '--to', 'telegram', '--quiet',
                                     'PharmaNudge runner: review needed.'])
        self.assertEqual(self.make_runner().poll(), 'already-claimed')

    def test_four_attempt_budget_persists_across_restarts(self):
        self.prepare_repo()
        self.active_runner()
        launches = []
        for revision in range(5):
            self.remote_issue['body'] = self.body + str(revision)
            self.task['body_sha256'] = hashlib.sha256(self.remote_issue['body'].encode()).hexdigest()
            self.write_config()
            r = self.make_runner()
            remote = self.fake_remote(r.command)
            def fake(argv, **kwargs):
                if argv[0] == runner.CLI:
                    if argv[1] == 'chat':
                        launches.append(argv)
                        raise runner.SafetyError('command failed')
                    return ''
                return remote(argv, **kwargs)
            with patch.object(r, 'verify_identity', create=True), patch.object(r, 'command', side_effect=fake):
                self.assertEqual(r.poll(), 'failed' if revision < 4 else 'budget-exhausted')
        self.assertEqual(len(launches), 4)
        self.assertEqual(self.make_runner().load_state()['days'][runner.utc_day()], 4)

    def test_stop_and_revoked_authorization_rechecked_after_worktree_creation(self):
        self.prepare_repo()
        r = self.active_runner()
        remote = self.fake_remote(r.command)
        def fake(argv, **kwargs):
            if argv[0] == runner.CLI and argv[1] == 'send':
                self.calls.append(argv)
                return ''
            result = remote(argv, **kwargs)
            if 'worktree' in argv and 'add' in argv:
                (self.state.parent / 'STOP').write_text('stop')
            return result
        with patch.object(r, 'verify_identity', create=True), patch.object(r, 'command', side_effect=fake):
            self.assertEqual(r.poll(), 'blocker')
        self.assertFalse(any(a[0] == runner.CLI and a[1] == 'chat' for a in self.calls))
        self.assertEqual(self.make_runner().load_state()['claims'][r.key(self.task)]['status'], 'blocker')

    def test_identity_checks_only_named_service_properties_and_profile_home(self):
        r = self.make_runner()
        calls = []
        metadata = ('Id=' + runner.SERVICE + '\nActiveState=active\nSubState=running\nMainPID=123\n'
                    'ExecStart={ path=/usr/local/bin/hermes ; argv[]=/usr/local/bin/hermes '
                    '--profile pharmanudge gateway run ; ignore_errors=no ; }\n'
                    'WorkingDirectory=' + runner.PROFILE_HOME + '\n')
        wrapper = '#!/bin/sh\nexec /usr/local/bin/hermes -p pharmanudge "$@"\n'
        def fake(argv, **kwargs):
            calls.append(argv)
            return metadata
        with patch.object(r, 'command', side_effect=fake), \
                patch.object(Path, 'read_text', return_value=wrapper) as read, \
                patch.object(runner.os, 'access', return_value=True):
            self.assertTrue(r.verify_identity()['verified'])
            read.assert_called_once_with()
            for bad in (metadata.replace(runner.PROFILE_HOME, '/wrong'),
                        metadata.replace('--profile pharmanudge', '--profile other'),
                        metadata.replace('gateway run', 'gateway run --unsafe'),
                        metadata + 'Id=other.service\n', metadata.replace('MainPID=123', 'MainPID=0')):
                with patch.object(r, 'command', return_value=bad):
                    with self.assertRaisesRegex(runner.SafetyError, 'identity rejected'):
                        r.verify_identity()
            with patch.object(Path, 'read_text', return_value=wrapper + '# changed\n'):
                with self.assertRaisesRegex(runner.SafetyError, 'identity rejected'):
                    r.verify_identity()
        self.assertEqual(calls[0], ['systemctl', '--user', 'show', runner.SERVICE,
                                    '--property=Id,ActiveState,SubState,MainPID,ExecStart,WorkingDirectory'])
        self.assertFalse(any('Environment' in arg for arg in calls[0]))
        self.assertFalse(hasattr(runner, 'process_home'))

    def test_pin_prints_candidate_without_authorizing_or_writing(self):
        self.prepare_repo()
        self.cfg.update(enabled=False, tasks=[])
        self.write_config()
        r = self.make_runner()
        before = self.config.read_bytes()
        with patch.object(r, 'command', side_effect=self.fake_remote(r.command)):
            result = r.pin(3)
        self.assertEqual(result, {'authorized': False, 'candidate': self.task})
        self.assertEqual(self.config.read_bytes(), before)
        self.assertFalse(self.state.exists())
        self.assertFalse(any(a[0] == runner.CLI for a in self.calls))

    def test_cli_failures_are_static_and_disabled_default_is_safe(self):
        handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)}
        self.assertEqual(runner.main(['--config', str(self.config), '--state', str(self.state), 'poll']), 0)
        self.assertEqual({sig: signal.getsignal(sig) for sig in handlers}, handlers)
        self.config.write_text('SECRET malformed config')
        import io
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertEqual(runner.main(['--config', str(self.config), '--state', str(self.state), 'poll']), 2)
        self.assertNotIn('SECRET', output.getvalue())
        self.assertIn('blocked', output.getvalue())
        self.assertEqual({sig: signal.getsignal(sig) for sig in handlers}, handlers)

    def assert_process_dead(self, pid):
        until = time.monotonic() + 1
        while time.monotonic() < until:
            try:
                if (Path('/proc') / str(pid) / 'stat').read_text().split()[2] == 'Z':
                    return
            except (FileNotFoundError, ProcessLookupError):
                return
            time.sleep(.01)
        self.fail('descendant remained alive after process-group cleanup')

    def test_crossing_utc_day_before_launch_is_blocked(self):
        self.prepare_repo()
        r = self.active_runner()
        remote = self.fake_remote(r.command)
        def fake(argv, **kwargs):
            if argv[0] == runner.CLI:
                if argv[1] == 'chat':
                    self.fail('day rollover must not launch against previous day reservation')
                return ''
            return remote(argv, **kwargs)
        with patch.object(r, 'verify_identity'), patch.object(r, 'command', side_effect=fake), \
                patch.object(runner, 'utc_day', side_effect=['2026-10-17', '2026-10-18']):
            self.assertEqual(r.poll(), 'blocker')

    def test_command_environment_is_profile_only_and_stdin_is_closed(self):
        r = self.make_runner()
        script = ('import os,sys,json; print(json.dumps({'
                  '"home":os.environ.get("HERMES_HOME"),'
                  '"bypass":os.environ.get("HERMES_YOLO"),'
                  '"stdin":sys.stdin.read(),'
                  '"bus":os.environ.get("DBUS_SESSION_BUS_ADDRESS")}))')
        with patch.dict(os.environ, {'HERMES_YOLO': '1', 'HERMES_HOME': '/wrong'}):
            data = json.loads(r.command([sys.executable, '-c', script]))
        self.assertEqual(data['home'], runner.PROFILE_HOME)
        self.assertIsNone(data['bypass'])
        self.assertEqual(data['stdin'], '')
        self.assertEqual(data['bus'], 'unix:path=/run/user/0/bus')

    def test_bounded_command_and_timeout_kill_orphan_group(self):
        r = self.make_runner()
        self.assertEqual(r.command([sys.executable, '-c', 'print("ok")']), 'ok\n')
        pidfile = self.root / 'child.pid'
        script = ('import os,time,signal,pathlib; p=os.fork(); '
                  '\nif p == 0:\n signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(10)'
                  '\nelse:\n pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(p)); time.sleep(10)')
        with self.assertRaises(runner.SafetyError):
            r.command([sys.executable, '-c', script], timeout=.2, grace=.1)
        pid = int(pidfile.read_text())
        # Killed descendants can remain zombies until the container init reaps them.
        self.assert_process_dead(pid)

    def test_child_is_killed_even_when_parent_exits_successfully(self):
        r = self.make_runner()
        pidfile = self.root / 'orphan.pid'
        script = ('import os,time,pathlib; p=os.fork(); '
                  '\nif p == 0:\n os.close(1); time.sleep(10)'
                  '\nelse:\n pathlib.Path(' + repr(str(pidfile)) + ').write_text(str(p))')
        r.command([sys.executable, '-c', script], timeout=.3)
        pid = int(pidfile.read_text())
        self.assert_process_dead(pid)


if __name__ == '__main__':
    unittest.main()
