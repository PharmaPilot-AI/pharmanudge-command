"""Independent adversarial local-fixture checks for publisher boundaries."""
from pathlib import Path
import os
import sys
import unittest
from unittest.mock import patch

import test_publisher as fixtures
from publisher import PublicationError


class PublicationAdversarialTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.PublisherTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_clean_filter_is_rejected_before_git_status_can_execute_it(self):
        f = self.fixture
        marker = f.root / 'filter-executed'
        script = f.root / 'clean-filter'
        script.write_text('#!' + sys.executable + '\nimport pathlib,sys\n'
                          + 'pathlib.Path(' + repr(str(marker)) + ').write_text("fixture")\n'
                          + 'sys.stdout.write(sys.stdin.read())\n')
        script.chmod(0o700)
        attributes = f.root / 'attributes'
        attributes.write_text('README.md filter=fixture\n')
        f.git(f.repo, 'config', 'core.attributesFile', str(attributes))
        f.git(f.repo, 'config', 'filter.fixture.clean', str(script))
        with self.assertRaises(PublicationError):
            f.publisher().preview(f.key)
        self.assertFalse(marker.exists(), 'git status/diff executed a rejected clean filter before screening')

    def test_completed_uncertain_notification_revalidates_remote_before_send(self):
        f = self.fixture
        f.approve()
        p = f.publisher()
        original = p.save
        stopped = False
        def stop_after_complete(journal):
            nonlocal stopped
            original(journal)
            item = journal['publications'][f.key]
            if item['stage'] == 'complete' and item['notification'] == 'not-attempted' and not stopped:
                stopped = True
                raise RuntimeError('fixture interruption after durable result')
        with patch.object(p, 'save', side_effect=stop_after_complete):
            with self.assertRaises(PublicationError):
                p.publish(f.key)
        self.assertTrue(stopped)
        f.remote = 'b' * 40
        with self.assertRaises(PublicationError):
            f.publisher().publish(f.key)
        self.assertFalse(any(a[0] == '/root/.local/bin/pharmanudge' for a in f.calls))

    def test_preview_does_not_refresh_index_metadata(self):
        f = self.fixture
        f.git(f.worktree, 'add', 'README.md')
        index = Path(f.git(f.worktree, 'rev-parse', '--git-path', 'index').strip())
        before_bytes, before_mtime = index.read_bytes(), index.stat().st_mtime_ns
        file = f.worktree / 'README.md'
        st = file.stat()
        os.utime(file, ns=(st.st_atime_ns, st.st_mtime_ns + 1000000000))
        f.publisher().preview(f.key)
        self.assertEqual(index.read_bytes(), before_bytes)
        self.assertEqual(index.stat().st_mtime_ns, before_mtime)

    def test_matching_pr_with_unreviewed_body_cannot_be_adopted(self):
        f = self.fixture
        f.approve()
        original_pr = f.pr
        def tampered_pr():
            result = original_pr()
            result.update(title='Unreviewed fixture', body='FIXTURE_SENSITIVE_OUTPUT: tests passed')
            return result
        with patch.object(f, 'pr', side_effect=tampered_pr):
            with self.assertRaises(PublicationError):
                f.publisher().publish(f.key)
        self.assertFalse(any(a[0] == '/root/.local/bin/pharmanudge' for a in f.calls))
        journal = (f.control / 'publication-state.json').read_text()
        self.assertNotIn('FIXTURE_SENSITIVE_OUTPUT', journal)

    def test_unreviewed_transport_override_blocks_before_push(self):
        f = self.fixture
        f.approve()
        f.git(f.repo, 'config', 'remote.origin.receivepack', 'unreviewed-fixture-command')
        with self.assertRaises(PublicationError):
            f.publisher().publish(f.key)
        self.assertFalse(any('push' in a or '-X' in a for a in f.calls))


if __name__ == '__main__':
    unittest.main()
