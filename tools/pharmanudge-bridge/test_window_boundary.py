"""Independent offline lifecycle checks; no real network or account state."""
import copy
from pathlib import Path
from typing import Any
import unittest
import test_bridge as f


class WindowBoundaryTests(unittest.TestCase):
    root: Any
    io: Any
    now: Any
    tmp: Any
    setUp = f.WindowTests.setUp
    make = f.WindowTests.make

    def test_unverifiable_source_halts_durable_window_before_remote_access(self):
        b = self.make()
        b.init()
        before = list(self.io.calls)
        b.identity = lambda: 'b' * 40
        self.now = 1300
        with self.assertRaises(f.bridge.BridgeError):
            b.step()
        self.assertEqual(self.io.calls, before)
        self.assertTrue((b.directory / 'STOP').exists())
        state = b.read_state()
        self.assertFalse(state['enabled'])
        self.assertTrue(state['dry_run'])

    def test_changed_approval_halts_without_publication_or_notification(self):
        b = self.make()
        b.init()
        self.io.auth['body'] += ' '
        self.now = 1300
        with self.assertRaises(f.bridge.BridgeError):
            b.step()
        self.assertTrue((b.directory / 'STOP').exists())
        self.assertFalse(self.io.sent)
        self.assertFalse(self.io.receipts)
        self.assertFalse(b.read_state()['enabled'])

    def test_legacy_trial_and_stop_remain_byte_identical(self):
        legacy = self.root.parent / 'legacy-consumed-trial'
        legacy.mkdir()
        (legacy / 'state.json').write_text('{"polls":5,"consumed":true}')
        (legacy / 'STOP').write_text('retained')
        before = {p.name: p.read_bytes() for p in legacy.iterdir()}
        b = self.make()
        b.init()
        self.now = 87400
        b.step()
        after = {p.name: p.read_bytes() for p in legacy.iterdir()}
        self.assertEqual(before, after)
        self.assertFalse(b.read_state()['enabled'])

    def test_deeply_nested_malformed_event_is_rejected_without_traceback(self):
        row = f.event()
        row['body'] = f.bridge.EVENT_MARKER + '\n' + '[' * 1100 + '0' + ']' * 1100
        self.assertIsNone(f.bridge.parse_event(row, f.WINDOW))

    def test_configured_window_cannot_create_or_replenish_on_run(self):
        cfg = f.config()
        b = self.make(cfg)
        b.init()
        manifest = (b.directory / 'window.json').read_bytes()
        self.now = 1300
        b.step()
        used = b.read_state()['polls']
        with self.assertRaises(f.bridge.BridgeError):
            self.make(cfg).init()
        self.assertEqual((b.directory / 'window.json').read_bytes(), manifest)
        self.assertEqual(self.make(cfg).read_state()['polls'], used)


if __name__ == '__main__':
    unittest.main()
