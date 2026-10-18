"""CLI dispatch stays separate from coding poll and uses canonical Runner state."""
import contextlib
import io
import json
import sys
import types
import unittest
from unittest.mock import patch

import test_runner


class PublicationCLIIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_runner.RunnerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.calls = []
        calls = self.calls
        class FixturePublisher:
            def __init__(self, runner):
                if runner.state_path != self_expected_state:
                    raise AssertionError('noncanonical dispatch')
            def publish(self, key):
                calls.append(('publish', key))
                return {'status': 'disabled', 'fixture': 'no-publication'}
            def preview(self, key):
                calls.append(('preview', key))
                return {'authorized': False, 'fixture': 'read-only-preview'}
        self_expected_state = self.fixture.state
        self.module = types.ModuleType('publisher')
        self.module.Publisher = FixturePublisher

    def invoke(self, action):
        output = io.StringIO()
        with patch.dict(sys.modules, {'publisher': self.module}), \
                patch.object(test_runner.runner.Runner, 'poll', side_effect=AssertionError('never coding poll')), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            code = test_runner.runner.main(['--config', str(self.fixture.config), action, '5:' + 'a' * 64])
        return code, json.loads(output.getvalue())

    def test_preview_is_explicit_read_only_dispatch_not_coding_poll(self):
        code, result = self.invoke('publication-preview')
        self.assertEqual(code, 0)
        self.assertEqual(result, {'authorized': False, 'fixture': 'read-only-preview'})
        self.assertEqual(self.calls, [('preview', '5:' + 'a' * 64)])

    def test_publish_is_explicit_dispatch_not_coding_poll(self):
        code, result = self.invoke('publish')
        self.assertEqual(code, 0)
        self.assertEqual(result, {'status': 'disabled', 'fixture': 'no-publication'})
        self.assertEqual(self.calls, [('publish', '5:' + 'a' * 64)])

    def test_publication_error_is_static_without_coding_fallback(self):
        output, errors = io.StringIO(), io.StringIO()
        with patch.dict(sys.modules, {'publisher': self.module}), \
                patch.object(self.module.Publisher, 'publish', side_effect=ValueError('UNTRUSTED_FIXTURE_OUTPUT')), \
                patch.object(test_runner.runner.Runner, 'poll', side_effect=AssertionError('never retry coding')), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            code = test_runner.runner.main(['--config', str(self.fixture.config), 'publish', '5:' + 'a' * 64])
        self.assertEqual(code, 2)
        self.assertEqual(output.getvalue(), '')
        self.assertNotIn('UNTRUSTED_FIXTURE_OUTPUT', errors.getvalue())
        self.assertIn('blocked', errors.getvalue())

    def test_publication_cannot_override_canonical_state_identity(self):
        alternate = self.fixture.root / 'alternate.json'
        with patch.dict(sys.modules, {'publisher': self.module}), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = test_runner.runner.main(['--state', str(alternate), 'publish', '5:' + 'a' * 64])
        self.assertEqual(code, 2)
        self.assertFalse(alternate.exists())
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
