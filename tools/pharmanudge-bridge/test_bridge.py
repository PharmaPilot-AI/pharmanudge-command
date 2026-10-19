import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import uuid

SPEC = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('bridge.py'))
bridge = importlib.util.module_from_spec(SPEC)
if SPEC.loader and Path(SPEC.origin).exists():
    SPEC.loader.exec_module(bridge)

WINDOW = '11111111-1111-4111-8111-111111111111'
TASK = '22222222-2222-4222-8222-222222222222'
SHA = 'a' * 40


def event(cid=1, thread=4, action='status', category='result_ready', **changes):
    payload = dict(window_id=WINDOW, event_id=str(uuid.uuid4()), task_id=TASK,
                   action=action, category=category)
    payload.update(changes)
    return dict(id=cid, thread=thread, user=dict(login='PharmaPilot-AI', id=319955168),
                body='PHARMANUDGE-COORDINATION-V2\n' + json.dumps(payload))


class ProtocolTests(unittest.TestCase):
    def test_strict_authority_schema_and_noncommand_protocol(self):
        parse = getattr(bridge, 'parse_event', None)
        self.assertTrue(callable(parse), 'strict event parser not implemented')
        good = event()
        self.assertEqual(parse(good, WINDOW)['category'], 'result_ready')
        for mutation in [dict(thread=9), dict(user=dict(login='someone', id=319955168)),
                         dict(user=dict(login='PharmaPilot-AI', id=1)),
                         dict(body=good['body'] + '\nrun command'),
                         dict(body='prefix\n' + good['body']),
                         dict(body='PHARMANUDGE-COORDINATION-RECEIPT-V2\npong')]:
            bad = dict(good, **mutation)
            self.assertIsNone(parse(bad, WINDOW))
        for changes in [dict(action='execute'), dict(category='unknown'), dict(window_id=str(uuid.uuid4())),
                        dict(task_id='not-a-uuid'), dict(event_id=None), dict(command='touch bad')]:
            self.assertIsNone(parse(event(**changes), WINDOW))
        duplicate = good['body'].replace('"action": "status"', '"action":"ping","action":"status"')
        self.assertIsNone(parse(dict(good, body=duplicate), WINDOW))
        self.assertIsNone(parse(event(action='ping', category='blocked'), WINDOW))
        self.assertIsNotNone(parse(event(action='ping', category='task_received'), WINDOW))


def config():
    return dict(enabled=True, dry_run=False, approval_comment_id=101,
                source_sha=SHA, window_id=WINDOW)


def approval():
    payload = dict(window_id=WINDOW, source_sha=SHA, threads=[4, 8],
                   duration_seconds=86400, max_polls=288, poll_seconds=300,
                   max_notifications=12, max_receipts=12)
    return dict(id=101, thread=4, user=dict(bridge.AUTHOR),
                body=bridge.AUTH_MARKER + '\n' + json.dumps(payload))


class FakeIO:
    def __init__(self):
        self.auth = approval()
        self.items = {4: [], 8: []}
        self.calls = []
        self.sent = []
        self.receipts = []

    def approval(self, cid):
        self.calls.append(('approval', cid))
        return copy.deepcopy(self.auth)

    def comments(self, thread):
        self.calls.append(('comments', thread))
        return copy.deepcopy(self.items[thread])

    def notify(self, category):
        self.sent.append(category)

    def receipt(self, thread):
        self.receipts.append(thread)


class WindowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'state'
        self.io = FakeIO()
        self.now = 1000.0

    def make(self, cfg=None, identity=None):
        return bridge.Bridge(cfg or config(), self.io, state_root=self.root,
                             clock=lambda: self.now, identity=identity or (lambda: SHA))

    def test_window_activation_freezes_approval_both_baselines_and_identity(self):
        cls = getattr(bridge, 'Bridge', None)
        self.assertTrue(callable(cls), 'immutable window lifecycle not implemented')
        self.io.items = {4: [event(10)], 8: [event(20, thread=8)]}
        b = self.make()
        b.init()
        state = b.read_state()
        self.assertEqual(state['cursors'], {'4': 10, '8': 20})
        self.assertEqual(state['armed_at'], 1000)
        self.assertEqual(state['expires_at'], 87400)
        self.assertEqual(state['next_poll_at'], 1300)
        manifest = (b.directory / 'window.json').read_bytes()
        with self.assertRaises(bridge.BridgeError):
            b.init()
        self.assertEqual((b.directory / 'window.json').read_bytes(), manifest)
        self.assertEqual((self.root.stat().st_mode & 0o777), 0o700)
        self.assertEqual((b.directory / 'window.json').stat().st_mode & 0o777, 0o600)
        for key, value in [('source_sha', 'b' * 40), ('approval_comment_id', 102),
                           ('window_id', str(uuid.uuid4()))]:
            with self.assertRaises(bridge.BridgeError):
                self.make(dict(config(), **{key: value})).step()
        with self.assertRaises(bridge.BridgeError):
            self.make(identity=lambda: 'b' * 40).step()
        self.io.auth['body'] += ' '
        self.now = 1300
        with self.assertRaises(bridge.BridgeError):
            b.step()
        self.assertFalse(self.io.sent)

    def test_disabled_dryrun_uninitialized_and_mismatched_approval_refuse(self):
        self.assertTrue(hasattr(bridge, 'Bridge'), 'window lifecycle not implemented')
        for cfg in [dict(config(), enabled=False), dict(config(), dry_run=True),
                    dict(config(), state_root='elsewhere'), dict(config(), approval_comment_id=True)]:
            with self.assertRaises(bridge.BridgeError):
                self.make(cfg).init()
        self.assertEqual(self.io.calls, [])
        with self.assertRaises(bridge.BridgeError):
            self.make().step()
        self.assertEqual(self.io.calls, [])
        self.io.auth['thread'] = 8
        with self.assertRaises(bridge.BridgeError):
            self.make().init()
        self.assertFalse((self.root / 'registry.json').exists())
        self.io.auth = approval()
        self.make().init()
        self.now = 999999
        self.make().stop()
        self.assertTrue((self.root / 'STOP').exists())
        self.assertTrue((self.make().directory / 'STOP').exists())
        self.assertFalse(self.make().read_state()['enabled'])


    def test_final_poll_charge_survives_failed_read_and_stops_at_288(self):
        b = self.make()
        b.init()
        state = b.read_state()
        state['polls'] = 287
        b.save(state)
        self.now = 1300
        def failure(thread):
            raise bridge.BridgeError('bounded read failed')
        self.io.comments = failure
        summary = b.run()
        self.assertEqual(summary['polls'], 288)
        self.assertFalse(summary['enabled'])
        before = len(self.io.calls)
        with self.assertRaises(bridge.BridgeError):
            self.make().step()
        self.assertEqual(len(self.io.calls), before)

    def test_invalid_mutation_cannot_be_written_and_clock_regression_latches_stop(self):
        b = self.make()
        b.init()
        before = (b.directory / 'state.json').read_bytes()
        state = b.read_state()
        state['polls'] = 289
        with self.assertRaises(bridge.BridgeError):
            b.save(state)
        self.assertEqual((b.directory / 'state.json').read_bytes(), before)
        self.now = 1200
        b.step()
        self.now = 1100
        summary = b.step()
        self.assertFalse(summary['enabled'])
        self.assertTrue((b.directory / 'STOP').exists())

    def test_new_approved_window_baselines_existing_events_and_cannot_reuse_approval(self):
        b = self.make()
        b.init()
        self.io.items[4] = [event(1)]
        self.now = 1300
        b.step()
        old_state = b.read_state()
        self.now = old_state['expires_at']
        b.step()
        retained = (b.directory / 'state.json').read_bytes()
        cfg = dict(config(), window_id=str(uuid.uuid4()))
        with self.assertRaises(bridge.BridgeError):
            self.make(cfg).init()
        payload = json.loads(approval()['body'].split('\n', 1)[1])
        payload['window_id'] = cfg['window_id']
        self.io.auth = dict(approval(), id=102,
            body=bridge.AUTH_MARKER + '\n' + json.dumps(payload))
        cfg['approval_comment_id'] = 102
        new = self.make(cfg)
        new.init()
        self.assertEqual(new.read_state()['cursors']['4'], 1)
        self.assertEqual(new.read_state()['polls'], 0)
        self.now += 300
        new.step()
        self.assertEqual(self.io.sent, ['result_ready'])
        self.assertEqual((b.directory / 'state.json').read_bytes(), retained)
        self.assertTrue((b.directory / 'STOP').exists())

    def test_uncertain_receipt_and_persisted_attempt_hold_without_remote_retry(self):
        b = self.make()
        b.init()
        self.io.items[4] = [event(1, action='ping', category='task_received')]
        self.now = 1300
        def failure(thread):
            self.io.receipts.append(thread)
            raise OSError('uncertain receipt')
        self.io.receipt = failure
        with self.assertRaises(bridge.BridgeError):
            b.step()
        self.assertEqual(b.read_state()['receipts'], 1)
        before = len(self.io.calls)
        with self.assertRaises(bridge.BridgeError):
            self.make().step()
        self.assertEqual(len(self.io.calls), before)
        self.assertEqual(self.io.receipts, [4])

    def test_external_read_expiry_returns_safe_run_summary(self):
        b = self.make()
        b.init()
        self.now = 1300
        original = self.io.comments
        def expire(thread):
            self.now = 87400
            raise bridge.BridgeError('window expired')
        self.io.comments = expire
        summary = b.run()
        self.assertFalse(summary['enabled'])
        self.assertTrue((b.directory / 'STOP').exists())

    def test_finite_run_holds_lock_and_observes_stop_while_sleeping(self):
        self.assertTrue(hasattr(bridge.Bridge, 'run'), 'finite guarded run not implemented')
        b = self.make()
        b.init()
        def sleep(seconds):
            with self.assertRaises(bridge.BridgeError):
                self.make().step()
            self.now += seconds
            bridge.atomic_json(self.root / 'STOP', {'reason': 'test'})
        b.sleep = sleep
        summary = b.run()
        self.assertFalse(summary['enabled'])
        self.assertEqual(summary['polls'], 0)

    def test_admission_restart_dedup_ack_ping_and_idle(self):
        b = self.make()
        b.init()
        baseline = self.io.calls[:]
        b.step()
        self.assertEqual(self.io.calls, baseline)
        self.io.items[4] = [event(1, action='ping', category='task_received'),
                            event(2, category='task_received'), event(3)]
        self.io.items[8] = [event(4, thread=8, category='blocked')]
        self.now = 1300
        b.step()
        self.assertEqual(self.io.receipts, [4])
        self.assertEqual(self.io.sent, ['result_ready', 'blocked'])
        self.assertEqual(b.read_state()['polls'], 1)
        self.io.items[4].append(event(5))  # New event ID, same milestone.
        self.io.items[4].append(dict(event(6), body=bridge.RECEIPT_MARKER + '\npong'))
        self.now = 1600
        self.make().step()
        self.assertEqual(self.io.sent, ['result_ready', 'blocked'])
        self.assertEqual(self.make().read_state()['cursors'], {'4': 6, '8': 4})
        self.assertEqual(self.make().read_state()['next_poll_at'], 1900)

    def test_crash_before_attempt_resumes_but_uncertain_attempt_never_retries(self):
        b = self.make()
        b.init()
        self.io.items[4] = [event(1)]
        self.now = 1300
        original = b.save
        def interrupted(state):
            if state['pending'] and state['pending'][0]['attempt'] is None:
                original(state)
                raise RuntimeError('simulated crash after durable admission')
            original(state)
        b.save = interrupted
        with self.assertRaises(RuntimeError):
            b.step()
        self.assertEqual(self.io.sent, [])
        self.assertEqual(self.make().read_state()['cursors']['4'], 0)
        self.make().step()
        self.assertEqual(self.io.sent, ['result_ready'])
        self.io.items[4].append(event(2, category='blocked'))
        self.now = 1600
        def uncertain(category):
            self.io.sent.append(category)
            raise RuntimeError('private tool output must not leak')
        self.io.notify = uncertain
        with self.assertRaises(bridge.BridgeError):
            self.make().step()
        calls = len(self.io.calls)
        with self.assertRaises(bridge.BridgeError):
            self.make().step()
        self.assertEqual(len(self.io.calls), calls)
        self.assertEqual(self.io.sent, ['result_ready', 'blocked'])
        self.assertTrue((b.directory / 'STOP').exists())
        self.assertEqual(b.read_state()['pending'][-1]['attempt'], 'attempted')

    def test_caps_interval_expiry_overlap_and_corrupt_state_fail_closed(self):
        b = self.make()
        b.init()
        with b.lock(), self.assertRaises(bridge.BridgeError):
            self.make().step()
        for invalid in [-1, True, 289, '1']:
            state = b.read_state()
            original = copy.deepcopy(state)
            state['polls'] = invalid
            bridge.atomic_json(b.directory / 'state.json', state)
            calls = len(self.io.calls)
            with self.assertRaises(bridge.BridgeError):
                b.step()
            self.assertEqual(len(self.io.calls), calls)
            bridge.atomic_json(b.directory / 'state.json', original)
        # Every charged poll uses a new persisted deadline, never catch-up bursts.
        for index in range(288):
            self.now = 1300 + index * 300
            b.step()
        state = b.read_state()
        self.assertEqual(state['polls'], 287)  # Absolute expiry wins over last scheduled poll.
        self.assertFalse(state['enabled'])
        self.assertTrue(state['dry_run'])
        self.assertTrue((b.directory / 'STOP').exists())
        self.assertEqual(self.io.sent, [])

    def test_separate_notification_and_receipt_caps_stop_without_replenishment(self):
        for kind in ['notify', 'receipt']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as root:
                self.root = Path(root)
                self.io = FakeIO()
                self.now = 1000
                b = self.make()
                b.init()
                self.io.items[4] = [event(i + 1, task_id=str(uuid.uuid4()),
                    action='ping' if kind == 'receipt' else 'status',
                    category='task_received' if kind == 'receipt' else 'result_ready') for i in range(15)]
                self.now = 1300
                b.step()
                state = b.read_state()
                self.assertEqual(len(self.io.receipts if kind == 'receipt' else self.io.sent), 12)
                self.assertEqual(state['receipts' if kind == 'receipt' else 'notifications'], 12)
                self.assertFalse(state['enabled'])
                with self.assertRaises(bridge.BridgeError):
                    self.make().init()
                before = len(self.io.calls)
                with self.assertRaises(bridge.BridgeError):
                    self.make().step()
                self.assertEqual(len(self.io.calls), before)

    def test_stop_between_receipt_and_notification_gates_next_write(self):
        b = self.make()
        b.init()
        self.io.items[4] = [event(1, action='ping', category='task_received'), event(2)]
        def stopped(thread):
            self.io.receipts.append(thread)
            bridge.atomic_json(self.root / 'STOP', {'reason': 'test'})
        self.io.receipt = stopped
        self.now = 1300
        b.step()
        self.assertEqual(self.io.receipts, [4])
        self.assertEqual(self.io.sent, [])
        self.assertFalse(b.read_state()['enabled'])


class AdapterTests(unittest.TestCase):
    def test_bounded_subprocess_timeout_output_stop_and_descendant_cleanup(self):
        self.assertTrue(hasattr(bridge, 'Command'), 'bounded portable command runner not implemented')
        import sys
        import time
        runner = bridge.Command(lambda: None)
        self.assertEqual(runner.run([sys.executable, '-c', 'print("ok")'], timeout=1), b'ok\n')
        for code in ['import time; time.sleep(5)', 'print("x" * 2000000)',
                     'import sys; print("private error",file=sys.stderr); sys.exit(1)']:
            start = time.monotonic()
            with self.assertRaises(bridge.BridgeError) as caught:
                runner.run([sys.executable, '-c', code], timeout=.2)
            self.assertLess(time.monotonic() - start, 2)
            self.assertNotIn('private error', str(caught.exception))
        with tempfile.TemporaryDirectory() as root:
            pidfile = Path(root) / 'child'
            code = ('import os,time; pid=os.fork(); '
                    f'open({str(pidfile)!r},"w").write(str(pid)) if pid else time.sleep(5)')
            with self.assertRaises(bridge.BridgeError):
                runner.run([sys.executable, '-c', code], timeout=.2)
            pid = int(pidfile.read_text())
            proc = Path('/proc') / str(pid) / 'stat'
            until = time.monotonic() + 1
            while proc.exists() and proc.read_text().split()[2] != 'Z' and time.monotonic() < until:
                time.sleep(.01)
            self.assertTrue(not proc.exists() or proc.read_text().split()[2] == 'Z')
        count = [0]
        def stop():
            count[0] += 1
            if count[0] > 2:
                raise bridge.BridgeError('STOP requested')
        with self.assertRaises(bridge.BridgeError):
            bridge.Command(stop).run([sys.executable, '-c', 'import time;time.sleep(5)'], timeout=1)

    def test_fixed_portable_argv_and_failclosed_pagination(self):
        self.assertTrue(hasattr(bridge, 'Adapters'), 'fixed adapters not implemented')
        class Runner:
            def __init__(self):
                self.calls = []
                self.pages = [json.dumps([event()]).encode()]
            def run(self, argv, **kwargs):
                self.calls.append(argv)
                return self.pages.pop(0) if self.pages else b'[]'
        r = Runner()
        io = bridge.Adapters(r, which=lambda name: '/trusted/bin/' + name)
        self.assertEqual(io.comments(8)[0]['thread'], 8)
        io.notify('blocked')
        io.receipt(4)
        self.assertEqual(r.calls[1], ['/trusted/bin/pharmanudge', 'send', '--to', 'telegram', '--quiet',
                                     bridge.NOTIFICATIONS['blocked']])
        self.assertIn('repos/' + bridge.REPO + '/issues/4/comments', r.calls[2])
        self.assertIn('body=' + bridge.RECEIPT_MARKER + '\npong', r.calls[2])
        for invalid in [9, '4', True]:
            with self.assertRaises(bridge.BridgeError):
                io.comments(invalid)
        with self.assertRaises(bridge.BridgeError):
            io.notify('arbitrary text')
        r.pages = [json.dumps([dict(event(i+1), body='') for i in range(100)]).encode()] * io.MAX_PAGES
        with self.assertRaises(bridge.BridgeError):
            io.comments(4)
        r.pages = [b'{}']
        with self.assertRaises(bridge.BridgeError):
            io.comments(4)

    def test_cli_disabled_example_and_offline_stop(self):
        self.assertTrue(hasattr(bridge, 'main'), 'safe CLI not implemented')
        from unittest.mock import patch
        example = json.loads(Path(__file__).with_name('bridge.example.json').read_text())
        self.assertEqual(example, dict(enabled=False, dry_run=True, approval_comment_id=None,
                                      source_sha=None, window_id=None))
        with patch.object(bridge, 'Adapters', side_effect=AssertionError('no external adapter')):
            self.assertEqual(bridge.main(['init', '--config', str(Path(__file__).with_name('bridge.example.json'))]), 2)
        with tempfile.TemporaryDirectory() as root, patch.object(bridge, 'STATE_ROOT', Path(root)):
            with patch.object(bridge, 'Adapters', side_effect=AssertionError('no external adapter')):
                self.assertEqual(bridge.main(['stop']), 0)
            self.assertTrue((Path(root) / 'STOP').exists())


if __name__ == '__main__':
    unittest.main()
