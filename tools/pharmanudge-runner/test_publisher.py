"""Real temporary worktrees; network, publication and notification are fake only."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from test_runner import runner

try:
    from publisher import Publisher, PublicationError
except ImportError:
    Publisher = None
    PublicationError = ValueError


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git(self.repo, 'init', '-b', 'main')
        (self.repo / 'README.md').write_text('base\n')
        self.git(self.repo, 'add', 'README.md')
        self.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base')
        self.base = self.git(self.repo, 'rev-parse', 'HEAD').strip()
        self.git(self.repo, 'remote', 'add', 'origin', 'https://github.com/PharmaPilot-AI/pharmanudge-command.git')
        self.git(self.repo, 'update-ref', 'refs/remotes/origin/main', self.base)
        self.control = self.root / 'control'
        self.control.mkdir()
        self.state = self.control / 'state.json'
        self.config = self.control / 'config.json'
        self.cfg = {'enabled': False, 'dry_run': True, 'repo_dir': str(self.repo), 'tasks': []}
        self.body = 'Bounded source change'
        self.task = {'issue': 3, 'author': 'approved-user', 'body_sha256': hashlib.sha256(self.body.encode()).hexdigest(), 'base_commit': self.base}
        self.cfg['tasks'] = [self.task]
        self.config.write_text(json.dumps(self.cfg))
        self.key = '3:' + self.task['body_sha256']
        self.token = 'a' * 32
        self.worktree = self.control / 'worktrees' / self.token
        self.worktree.parent.mkdir()
        self.branch = 'runner/issue-3-' + self.token
        self.git(self.repo, 'worktree', 'add', '-b', self.branch, str(self.worktree), self.base)
        self.claim = {'status': 'review-needed', 'day': '2026-10-18', 'branch': self.branch, 'worktree': str(self.worktree)}
        self.ledger = {'version': 1, 'claims': {self.key: self.claim}, 'days': {'2026-10-18': 1}}
        self.state.write_text(json.dumps(self.ledger))
        (self.worktree / 'README.md').write_text('reviewed source\n')
        canonical = patch.object(runner, 'STATE_PATH', self.state)
        canonical.start()
        self.addCleanup(canonical.stop)
        self.r = runner.Runner(self.config, self.state)
        self.calls = []
        self.remote = None
        self.prs = []
        self.fail_push = self.fail_pr = self.fail_notify = self.fail_commit = False
        self.pr_absent = False
        self.before_mutation = None
        self.issue = {'number': 3, 'state': 'open', 'user': {'login': 'approved-user'}, 'body': self.body}
        real = self.r.command
        def command(argv, **kwargs):
            self.calls.append(argv)
            if argv[0] == 'gh':
                endpoint = argv[argv.index('--hostname') + 2] if '--hostname' in argv else argv[2]
                if '-X' in argv:
                    self.assertIn('/pulls', endpoint)
                    journal = json.loads((self.control / 'publication-state.json').read_text())['publications'][self.key]
                    self.assertEqual(journal['stage'], 'creating-pr')
                    self.prs = [] if self.pr_absent else [self.pr()]
                    if self.fail_pr:
                        raise runner.SafetyError('uncertain')
                    return json.dumps(self.prs[0])
                if '/git/matching-refs/' in endpoint:
                    return json.dumps([] if self.remote is None else [{'ref': 'refs/heads/' + self.branch, 'object': {'sha': self.remote, 'type': 'commit'}}])
                if '/pulls?' in endpoint:
                    return json.dumps(self.prs)
                if endpoint.endswith('/issues/3'):
                    return json.dumps(self.issue)
                if endpoint.endswith('/commits/main'):
                    return json.dumps({'sha': self.base})
                return json.dumps({'full_name': runner.REPO, 'default_branch': 'main'})
            if argv[0] == runner.CLI:
                self.assertEqual(argv[1:6], ['send', '--to', 'telegram', '--quiet', 'PharmaNudge runner: draft PR ready. https://github.com/PharmaPilot-AI/pharmanudge-command/pull/7'])
                if self.fail_notify:
                    raise runner.SafetyError('notification failed')
                return ''
            if argv[0] == 'git' and 'push' in argv:
                journal = json.loads((self.control / 'publication-state.json').read_text())['publications'][self.key]
                self.assertEqual(journal['stage'], 'pushing')
                self.assertTrue(journal['commit'])
                self.remote = self.git(self.worktree, 'rev-parse', 'HEAD').strip()
                if self.fail_push:
                    raise runner.SafetyError('uncertain')
                return ''
            if argv[0] == 'git' and 'commit' in argv:
                journal = json.loads((self.control / 'publication-state.json').read_text())['publications'][self.key]
                self.assertEqual(journal['stage'], 'committing')
                self.assertTrue(journal['tree'])
                output = real(argv, **kwargs)
                if self.fail_commit:
                    raise runner.SafetyError('uncertain')
                return output
            if argv[0] not in ('git',):
                raise AssertionError('external process forbidden')
            return real(argv, **kwargs)
        commands = patch.object(self.r, 'command', side_effect=command)
        commands.start()
        self.addCleanup(commands.stop)
        identity = patch.object(self.r, 'verify_identity', return_value={'verified': True})
        identity.start()
        self.addCleanup(identity.stop)

    @staticmethod
    def git(path, *args):
        return subprocess.check_output(['git', '-C', str(path), *args], stderr=subprocess.DEVNULL).decode()

    def publisher(self):
        self.assertIsNotNone(Publisher, 'publisher implementation missing')
        return Publisher(self.r)

    def pr(self):
        sha = self.git(self.worktree, 'rev-parse', 'HEAD').strip()
        validation = getattr(self, 'approval', {}).get('validation', {'status': 'unverified', 'evidence_sha256': None})
        status = 'Validation: ' + validation['status']
        if validation['evidence_sha256']:
            status += '; evidence SHA-256: ' + validation['evidence_sha256']
        title = 'PharmaNudge reviewed result for issue 3'
        body = ('Operator-approved bounded result.\nBase: ' + self.task['base_commit'] + '\nCommit: ' + sha + '\n' + status
                + '\nCoordinator review requires a separately configured reviewer trigger.')
        return {'title': title, 'body': body, 'number': 7, 'html_url': 'https://github.com/PharmaPilot-AI/pharmanudge-command/pull/7', 'draft': True, 'state': 'open', 'head': {'ref': self.branch, 'sha': sha, 'repo': {'full_name': runner.REPO}}, 'base': {'ref': 'main', 'sha': self.base, 'repo': {'full_name': runner.REPO}}}

    def approve(self):
        result = self.publisher().preview(self.key)
        self.approval = {k: result[k] for k in ('claim_key', 'base_commit', 'branch', 'worktree_token', 'manifest_sha256')}
        self.approval.update(paths=[m['path'] for m in result['manifest']], validation={'status': 'unverified', 'evidence_sha256': None})
        self.approval_config = {'enabled': True, 'dry_run': False, 'approvals': [self.approval]}
        self.save_approval()

    def save_approval(self):
        (self.control / 'publication-approval.json').write_text(json.dumps(self.approval_config))

    def test_publish_once_with_durable_result_and_static_draft(self):
        self.approve()
        ledger = self.state.read_bytes()
        result = self.publisher().publish(self.key)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['url'], self.pr()['html_url'])
        self.assertEqual(self.publisher().publish(self.key), result)
        self.assertEqual(self.state.read_bytes(), ledger)
        self.assertEqual(sum('push' in a for a in self.calls), 1)
        self.assertEqual(sum('-X' in a for a in self.calls), 1)
        self.assertEqual(sum(a[0] == runner.CLI for a in self.calls), 1)
        post = next(a for a in self.calls if '-X' in a)
        body = next(a for a in post if a.startswith('body='))
        self.assertIn('Validation: unverified', body)
        self.assertIn(self.base, body)
        self.assertNotIn('reviewed source', body)
        self.assertEqual(self.git(self.worktree, 'status', '--porcelain'), '')
        add = next(a for a in self.calls if 'add' in a)
        self.assertEqual(add[add.index('add'):], ['add', '--', 'README.md'])

    def test_missing_disabled_or_dry_approval_never_writes(self):
        for config in (None, {'enabled': False, 'dry_run': True, 'approvals': []}, {'enabled': True, 'dry_run': True, 'approvals': []}):
            if config is not None:
                (self.control / 'publication-approval.json').write_text(json.dumps(config))
            with self.assertRaises(PublicationError):
                self.publisher().publish(self.key)
            self.assertFalse((self.control / 'publication-state.json').exists())
        self.assertFalse(any('add' in a or 'push' in a or '-X' in a or a[0] == runner.CLI for a in self.calls))

    def test_new_source_file_preview_and_publication(self):
        (self.worktree / 'src').mkdir()
        (self.worktree / 'src' / 'hello.py').write_text('print("hello")\n')
        result = self.publisher().preview(self.key)
        self.assertIn('+print("hello")', result['diff'])
        self.approve()
        self.assertEqual(self.publisher().publish(self.key)['status'], 'complete')

    def test_staged_only_extra_file_rejected_in_preview(self):
        # An index-only addition with a removed worktree file must not disappear.
        (self.worktree / 'docs').mkdir()
        file = self.worktree / 'docs' / 'extra.md'
        file.write_text('extra\n')
        self.git(self.worktree, 'add', 'docs/extra.md')
        file.unlink()
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)

    def test_commit_push_and_pr_uncertainty_reconcile_without_duplicates(self):
        self.approve()
        for flag, stage in (('fail_commit', 'committing'), ('fail_push', 'pushing'), ('fail_pr', 'creating-pr')):
            setattr(self, flag, True)
            with self.assertRaises(PublicationError):
                self.publisher().publish(self.key)
            record = json.loads((self.control / 'publication-state.json').read_text())['publications'][self.key]
            self.assertEqual(record['stage'], stage)
            setattr(self, flag, False)
            # Next iteration continues through the previous uncertain step.
            if flag == 'fail_commit':
                self.fail_push = True
            if flag == 'fail_push':
                self.fail_pr = True
        result = self.publisher().publish(self.key)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(sum('commit' in a for a in self.calls), 1)
        self.assertEqual(sum('push' in a for a in self.calls), 1)
        self.assertEqual(sum('-X' in a for a in self.calls), 1)

    def test_unknown_pr_creation_without_remote_result_never_reposts(self):
        self.approve()
        self.fail_pr = self.pr_absent = True
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.fail_pr = False
        with self.assertRaisesRegex(PublicationError, 'manual review'):
            self.publisher().publish(self.key)
        self.assertEqual(sum('-X' in a for a in self.calls), 1)
        self.assertEqual(sum('commit' in a for a in self.calls), 1)

    def test_notification_failure_is_terminal_and_never_republishes(self):
        self.approve()
        self.fail_notify = True
        result = self.publisher().publish(self.key)
        self.assertEqual(result['notification'], 'failed')
        self.fail_notify = False
        self.assertEqual(self.publisher().publish(self.key), result)
        self.assertEqual(sum(a[0] == runner.CLI for a in self.calls), 1)
        self.assertEqual(sum('-X' in a for a in self.calls), 1)

    def test_manifest_content_mode_and_extra_files_bind_approval(self):
        self.approve()
        file = self.worktree / 'README.md'
        file.write_text('edited after approval\n')
        with self.assertRaisesRegex(PublicationError, 'manifest mismatch'):
            self.publisher().publish(self.key)
        file.write_text('reviewed source\n')
        file.chmod(0o755)
        with self.assertRaisesRegex(PublicationError, 'manifest mismatch'):
            self.publisher().publish(self.key)
        file.chmod(0o644)
        (self.worktree / 'src').mkdir()
        (self.worktree / 'src' / 'extra.py').write_text('extra\n')
        with self.assertRaisesRegex(PublicationError, 'manifest mismatch'):
            self.publisher().publish(self.key)
        self.assertFalse((self.control / 'publication-state.json').exists())

    def test_forbidden_nested_dot_control_credential_and_workflow_paths(self):
        for path in ('.env', '.github/workflows/run.yml', 'src/.hidden.py', 'src/credentials.json', 'docs/control.json', 'package.json', 'src/token.txt', 'docs/secret.md', 'src/environment.ts', 'docs/id_rsa', 'src/certificate.pem'):
            with self.subTest(path=path):
                file = self.worktree / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('not public\n')
                with self.assertRaises(PublicationError):
                    self.publisher().preview(self.key)
                file.unlink()

    def test_ignored_symlink_hardlink_binary_deletion_and_rename_rejected(self):
        (self.repo / '.git/info/exclude').write_text('ignored.txt\n')
        file = self.worktree / 'ignored.txt'
        file.write_text('ignored\n')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        file.unlink()
        file = self.worktree / 'README.md'
        file.unlink()
        file.symlink_to(self.repo / 'README.md')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        file.unlink()
        os.link(self.repo / 'README.md', file)
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        file.unlink()
        file.write_bytes(b'bad\0binary')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        file.unlink()
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        (self.worktree / 'docs').mkdir()
        (self.worktree / 'docs/renamed.md').write_text('base\n')
        self.git(self.worktree, 'add', '--', 'README.md', 'docs/renamed.md')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)

    def test_secret_screen_and_size_limits_are_fail_closed(self):
        file = self.worktree / 'README.md'
        for content in ('password = "not-a-real-secret"\n', '-----BEGIN PRIVATE KEY-----\n', 'x' * (128 * 1024 + 1)):
            file.write_text(content)
            with self.assertRaises(PublicationError):
                self.publisher().preview(self.key)

    def test_pins_author_body_and_three_base_references_revalidated(self):
        self.approve()
        for field, bad in (('body', self.body + 'edited'), ('user', {'login': 'attacker'})):
            saved = self.issue[field]
            self.issue[field] = bad
            with self.assertRaises(PublicationError):
                self.publisher().publish(self.key)
            self.issue[field] = saved
        original = self.base
        self.base = 'b' * 40
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.base = original
        self.git(self.repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.git(self.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'main moved')
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertFalse((self.control / 'publication-state.json').exists())

    def test_stale_unknown_claim_stop_and_shared_lock_reject_without_mutation(self):
        self.approve()
        for status in ('unknown', 'claimed', 'reconciled', 'failed', 'blocker'):
            self.claim['status'] = status
            self.state.write_text(json.dumps(self.ledger))
            with self.assertRaises(PublicationError):
                self.publisher().publish(self.key)
        self.claim['status'] = 'review-needed'
        self.state.write_text(json.dumps(self.ledger))
        (self.control / 'STOP').write_text('retain')
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertEqual((self.control / 'STOP').read_text(), 'retain')
        (self.control / 'STOP').unlink()
        with self.r.lock():
            with self.assertRaises(PublicationError):
                self.publisher().publish(self.key)
        self.assertFalse((self.control / 'publication-state.json').exists())

    def test_claim_branch_worktree_and_remote_pushurl_are_exact(self):
        self.approve()
        self.claim['branch'] = 'main'
        self.state.write_text(json.dumps(self.ledger))
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.claim['branch'] = self.branch
        self.claim['worktree'] = str(self.worktree.parent / '.' / self.token) + '/'
        self.state.write_text(json.dumps(self.ledger))
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.claim['worktree'] = str(self.worktree)
        self.state.write_text(json.dumps(self.ledger))
        self.git(self.repo, 'remote', 'set-url', '--push', 'origin', 'https://github.com/other/repo.git')
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertFalse((self.control / 'publication-state.json').exists())

    def test_approval_schema_exact_paths_validation_and_journal_aliases(self):
        self.approve()
        for field, value in (('paths', ['README.md', 'src/unseen.py']), ('validation', {'status': 'passed', 'evidence_sha256': None}), ('worktree_token', 'b' * 32), ('base_commit', 'c' * 40), ('extra', True)):
            saved = dict(self.approval)
            self.approval[field] = value
            self.save_approval()
            with self.assertRaises(PublicationError):
                self.publisher().publish(self.key)
            self.approval.clear()
            self.approval.update(saved)
        self.save_approval()
        journal = self.control / 'publication-state.json'
        journal.symlink_to(self.state)
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        journal.unlink()
        os.link(self.state, journal)
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        journal.unlink()
        journal.write_text('{"version":99,"publications":{}}')
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)

    def test_approval_revoked_after_commit_prevents_push_and_resume(self):
        self.approve()
        self.fail_commit = True
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.fail_commit = False
        self.approval_config['enabled'] = False
        self.save_approval()
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertFalse(any('push' in a for a in self.calls))
        self.approval_config['enabled'] = True
        self.approval['validation'] = {'status': 'coordinator-reviewed', 'evidence_sha256': 'd' * 64}
        self.save_approval()
        with self.assertRaisesRegex(PublicationError, 'snapshot changed'):
            self.publisher().publish(self.key)

    def test_unexpected_remote_ref_or_duplicate_pr_never_mutates(self):
        self.approve()
        self.fail_commit = True
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.fail_commit = False
        self.remote = 'c' * 40
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertFalse(any('push' in a for a in self.calls))
        self.remote = self.git(self.worktree, 'rev-parse', 'HEAD').strip()
        self.prs = [self.pr(), self.pr()]
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertFalse(any('-X' in a for a in self.calls))

    def test_pr_url_and_identity_must_be_validated_before_notification(self):
        self.approve()
        self.fail_push = True
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.fail_push = False
        pr = self.pr()
        pr['html_url'] = 'https://attacker.invalid/pull/7'
        self.prs = [pr]
        with self.assertRaises(PublicationError):
            self.publisher().publish(self.key)
        self.assertFalse(any(a[0] == runner.CLI or '-X' in a for a in self.calls))

    def test_index_visibility_flags_cannot_hide_extra_files(self):
        # A tracked file marked assume-unchanged is otherwise invisible to status.
        (self.worktree / 'docs').mkdir()
        (self.worktree / 'docs/visible.md').write_text('visible\n')
        self.git(self.worktree, 'update-index', '--assume-unchanged', 'README.md')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        self.git(self.worktree, 'update-index', '--no-assume-unchanged', 'README.md')
        self.git(self.worktree, 'update-index', '--skip-worktree', 'README.md')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)

    def test_worktree_git_pointer_cannot_impersonate_another_registration(self):
        # Move a legitimate worktree without updating Git's registered location.
        moved = self.control / 'worktrees' / ('b' * 32)
        self.worktree.rename(moved)
        self.worktree.mkdir()
        for file in moved.iterdir():
            file.rename(self.worktree / file.name)
        # The gitdir's back pointer must also agree with the retained worktree.
        gitdir = Path((self.worktree / '.git').read_text().strip().split(': ', 1)[1])
        (gitdir / 'gitdir').write_text(str(moved / '.git') + '\n')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)

    def test_explicit_review_evidence_is_static_and_not_a_test_pass_claim(self):
        self.approve()
        self.approval['validation'] = {'status': 'coordinator-reviewed', 'evidence_sha256': 'd' * 64}
        self.save_approval()
        result = self.publisher().publish(self.key)
        self.assertEqual(result['validation'], 'coordinator-reviewed')
        body = next(a for call in self.calls if '-X' in call for a in call if a.startswith('body='))
        self.assertIn('evidence SHA-256: ' + 'd' * 64, body)
        self.assertNotIn('tests passed', body)

    def test_filters_submodules_and_more_than_64_files_rejected(self):
        (self.repo / '.git/info/attributes').write_text('README.md filter=not-executed\n')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        (self.repo / '.git/info/attributes').unlink()
        self.git(self.worktree, 'update-index', '--add', '--cacheinfo', '160000,' + self.base + ',src/submodule')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)
        self.git(self.worktree, 'update-index', '--force-remove', 'src/submodule')
        (self.worktree / 'docs').mkdir()
        for i in range(64):
            (self.worktree / 'docs' / (str(i) + '.md')).write_text('small\n')
        with self.assertRaises(PublicationError):
            self.publisher().preview(self.key)

    def test_regular_file_reader_is_bounded_and_refuses_aliases(self):
        p = self.publisher()
        file = self.root / 'bounded.txt'
        file.write_bytes(b'x' * 17)
        with self.assertRaises(PublicationError):
            p.read_regular(file, 16)
        self.assertEqual(p.read_regular(file, 17), b'x' * 17)
        alias = self.root / 'bounded-alias.txt'
        alias.symlink_to(file)
        with self.assertRaises(PublicationError):
            p.read_regular(alias, 17)
        alias.unlink()
        os.link(file, alias)
        with self.assertRaises(PublicationError):
            p.read_regular(alias, 17)

    def test_preview_manifest_and_diff_is_read_only_even_coding_disabled(self):
        p = self.publisher()
        before = self.state.read_bytes(), self.config.read_bytes()
        result = p.preview(self.key)
        content = (self.worktree / 'README.md').read_bytes()
        self.assertFalse(result['authorized'])
        self.assertEqual(result['manifest'], [{'path': 'README.md', 'sha256': hashlib.sha256(content).hexdigest(), 'mode': '100644', 'size': len(content), 'change': 'M'}])
        self.assertIn('+reviewed source', result['diff'])
        self.assertEqual(before, (self.state.read_bytes(), self.config.read_bytes()))
        self.assertFalse((self.control / 'publication-state.json').exists())
        self.assertFalse(any('push' in a or '-X' in a or a[0] == runner.CLI for a in self.calls))


if __name__ == '__main__':
    unittest.main()
