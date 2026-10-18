"""Operator-only deterministic publication. No worker approval or sandbox is implied.

Secret screening is deliberately conservative, not a confidentiality guarantee:
UTF-8 text only, 64 files / 512 KiB total, common private-key/token/assignment
patterns. Encoded, novel, split or contextual secrets and personal data may evade
it. Operators must review the complete manifest and diff before provisioning
approval. Trusted control files and repository configuration require OS protection.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
import time
from urllib.parse import quote

REPO = 'PharmaPilot-AI/pharmanudge-command'
CLI = '/root/.local/bin/pharmanudge'


class PublicationError(ValueError):
    """Static local failure; never includes source or subprocess output."""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


class Publisher:
    def __init__(self, runner_instance):
        self.r = runner_instance
        self.r.check_state_path()
        self.home = self.r.state_path.parent
        if self.home != self.home.resolve():
            raise PublicationError('publication control path rejected')
        self.approval_path = self.home / 'publication-approval.json'
        self.journal_path = self.home / 'publication-state.json'

    @contextlib.contextmanager
    def guarded(self):
        previous = getattr(self.r, 'deadline', None)
        self.r.deadline = time.monotonic() + 120
        try:
            with self.r.lock():
                yield
        except PublicationError:
            raise
        except Exception:
            raise PublicationError('publication blocked') from None
        finally:
            self.r.deadline = previous

    def git(self, worktree, *args):
        return self.r.command(['git', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
                               '-c', 'core.untrackedCache=false', '-C', str(worktree), *args])

    def context(self, key):
        c = self.r.load_config()
        s = self.r.load_state()
        if any(v['status'] in ('unknown', 'claimed') for v in s['claims'].values()):
            raise PublicationError('coding reconciliation required')
        tasks = [t for t in c['tasks'] if str(t['issue']) + ':' + t['body_sha256'] == key]
        if len(tasks) != 1 or key not in s['claims'] or s['claims'][key]['status'] != 'review-needed':
            raise PublicationError('publication claim rejected')
        task, claim = tasks[0], s['claims'][key]
        token = Path(claim.get('worktree', '')).name
        worktree = self.home / 'worktrees' / token
        branch = 'runner/issue-' + str(task['issue']) + '-' + token
        if (not re.fullmatch('[0-9a-f]{32}', token) or claim.get('worktree') != str(worktree)
                or worktree.resolve() != worktree or claim.get('branch') != branch
                or self.git(worktree, 'symbolic-ref', '--short', 'HEAD').strip() != branch):
            raise PublicationError('publication worktree rejected')
        repo = Path(c['repo_dir'])
        common = self.git(worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir').strip()
        original = self.git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir').strip()
        if common != original or Path(common).resolve() != (repo / '.git').resolve():
            raise PublicationError('publication repository rejected')
        registrations = self.git(repo, 'worktree', 'list', '--porcelain', '-z').split('\0\0')
        matches = []
        for record in registrations:
            fields = record.strip('\0').split('\0')
            if fields and fields[0] == 'worktree ' + str(worktree):
                matches.append(fields)
        head = self.git(worktree, 'rev-parse', 'HEAD').strip()
        if (len(matches) != 1 or matches[0] != ['worktree ' + str(worktree), 'HEAD ' + head, 'branch refs/heads/' + branch]):
            raise PublicationError('publication worktree registration rejected')
        self.r.authorize(c, task)
        # Worktree-local remote configuration must not redirect publication.
        allowed = {'https://github.com/' + REPO, 'https://github.com/' + REPO + '.git', 'git@github.com:' + REPO + '.git'}
        if (self.git(worktree, 'remote', 'get-url', '--all', 'origin').strip() not in allowed
                or self.git(worktree, 'remote', 'get-url', '--push', '--all', 'origin').strip() not in allowed):
            raise PublicationError('publication origin rejected')
        for setting in ('remote.origin.receivepack', 'remote.origin.uploadpack', 'remote.origin.proxy',
                        'remote.origin.vcs', 'core.sshCommand', 'core.gitProxy'):
            if self.git(worktree, 'config', '--default', '', '--get', setting).strip():
                raise PublicationError('publication transport override rejected')
        if self.git(worktree, 'config', '--default', 'false', '--get', 'remote.origin.mirror').strip() != 'false':
            raise PublicationError('publication transport override rejected')
        return c, task, claim, worktree

    @staticmethod
    def read_regular(path, limit):
        """Bound reads on the opened inode; refuse aliases and nonregular files."""
        if type(limit) is not int or not 0 <= limit <= 1024 * 1024:
            raise PublicationError('publication read limit rejected')
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
            with os.fdopen(fd, 'rb') as stream:
                before = os.fstat(stream.fileno())
                if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                        or before.st_size > limit):
                    raise PublicationError('publication regular file rejected')
                raw = stream.read(limit + 1)
                after = os.fstat(stream.fileno())
                if (len(raw) > limit or before.st_size != len(raw)
                        or (before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_mode, before.st_nlink)
                        != (after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_mode, after.st_nlink)):
                    raise PublicationError('publication file changed during read')
                return raw
        except OSError:
            raise PublicationError('publication file read rejected') from None

    @staticmethod
    def path_allowed(path):
        parts = PurePosixPath(path).parts
        if (not parts or str(PurePosixPath(path)) != path or path.startswith('/')
                or not re.fullmatch(r'[A-Za-z0-9_./-]+', path)
                or any(p in ('..', '.') or p.startswith('.') for p in parts)):
            return False
        forbidden = re.compile(r'(?:^|[-_])(?:env(?:ironment)?|secret|credential|token|password|control|workflow)(?:s|$|[-_.])|(?:^id_(?:rsa|dsa|ecdsa|ed25519)$)|\.(?:pem|key|p12|pfx|keystore)$', re.I)
        if any(forbidden.search(p) for p in parts):
            return False
        return path == 'README.md' or len(parts) > 1 and parts[0] in ('src', 'docs')

    def snapshot(self, worktree, base):
        visible = self.git(worktree, 'ls-files', '-v', '-z')
        if any(entry and not entry.startswith('H ') for entry in visible.split('\0')):
            raise PublicationError('publication hidden index entries rejected')
        # Status and diff may invoke clean filters, even before staging. Screen
        # attributes for EVERY tracked/untracked file before either command.
        candidates = self.git(worktree, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')
        candidates = sorted(set(p for p in candidates if p))
        if candidates:
            attrs = self.git(worktree, 'check-attr', '-z', 'filter', '--', *candidates).split('\0')
            if attrs[-1] != '' or len(attrs) != len(candidates) * 3 + 1:
                raise PublicationError('publication filter rejected')
            for i, path in enumerate(candidates):
                if attrs[i*3:i*3+2] != [path, 'filter'] or attrs[i*3+2] not in ('unspecified', 'unset'):
                    raise PublicationError('publication filter rejected')
        # Enumerate ignored files separately: they are not silently excluded.
        if self.git(worktree, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z'):
            raise PublicationError('ignored files rejected')
        status = self.git(worktree, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching')
        for entry in status.split('\0'):
            if entry and (len(entry) < 4 or entry[:2] not in (' M', 'M ', 'MM', 'A ', 'AM', '??')):
                raise PublicationError('publication status rejected')
        changes = self.git(worktree, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', base, '--').split('\0')
        changed = {}
        for i in range(0, len(changes) - 1, 2):
            kind, path = changes[i:i+2]
            if kind not in ('A', 'M') or path in changed:
                raise PublicationError('publication changes rejected')
            changed[path] = kind
        for path in self.git(worktree, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'):
            if path:
                if path in changed:
                    raise PublicationError('publication changes rejected')
                changed[path] = 'A'
        if not 1 <= len(changed) <= 64:
            raise PublicationError('publication file limit rejected')
        manifest, total = [], 0
        for path, kind in sorted(changed.items()):
            if not self.path_allowed(path):
                raise PublicationError('publication path rejected')
            file = worktree / path
            if any(p.is_symlink() for p in [file, *file.parents] if p != worktree.parent):
                raise PublicationError('publication file type rejected')
            info = file.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 128 * 1024:
                raise PublicationError('publication file type rejected')
            raw = self.read_regular(file, 128 * 1024)
            total += len(raw)
            if total > 512 * 1024:
                raise PublicationError('publication byte limit rejected')
            text = raw.decode('utf-8')
            if '\0' in text or any(ord(ch) < 32 and ch not in '\n\r\t' for ch in text):
                raise PublicationError('publication binary rejected')
            if re.search(r'-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{12,}|AKIA[A-Z0-9]{16}|(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["\']?[^\s"\']{6,}', text, re.I):
                raise PublicationError('publication secret screening rejected')
            attrs = self.git(worktree, 'check-attr', '-z', 'filter', '--', path).split('\0')
            if len(attrs) != 4 or attrs[2] not in ('unspecified', 'unset'):
                raise PublicationError('publication filter rejected')
            manifest.append({'path': path, 'sha256': hashlib.sha256(raw).hexdigest(),
                             'mode': '100755' if info.st_mode & 0o111 else '100644', 'size': len(raw), 'change': kind})
        return manifest

    def preview(self, claim_key):
        with self.guarded():
            c, task, claim, worktree = self.context(claim_key)
            if self.git(worktree, 'rev-parse', 'HEAD').strip() != task['base_commit']:
                raise PublicationError('publication HEAD rejected')
            manifest = self.snapshot(worktree, task['base_commit'])
            diff = self.git(worktree, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', task['base_commit'], '--')
            # git diff omits new files; include a bounded operator-only representation.
            untracked = set(self.git(worktree, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
            for item in manifest:
                if item['path'] in untracked:
                    raw = self.read_regular(worktree / item['path'], 128 * 1024)
                    if hashlib.sha256(raw).hexdigest() != item['sha256']:
                        raise PublicationError('publication preview changed')
                    text = raw.decode('utf-8')
                    diff += '\n--- /dev/null\n+++ b/' + item['path'] + '\n' + ''.join('+' + line + '\n' for line in text.splitlines())
            return {'authorized': False, 'claim_key': claim_key, 'base_commit': task['base_commit'],
                    'branch': claim['branch'], 'worktree_token': worktree.name,
                    'manifest': manifest, 'manifest_sha256': digest(manifest), 'diff': diff}

    def read_control(self, path, absent=None):
        if path.is_symlink() or path.resolve() != path:
            raise PublicationError('publication control file rejected')
        if not path.exists():
            return absent
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1024 * 1024:
            raise PublicationError('publication control file rejected')
        # Duplicate object keys are ambiguous authorization, never last-key-wins.
        def pairs(items):
            result = {}
            for key, value in items:
                if key in result:
                    raise PublicationError('publication duplicate key rejected')
                result[key] = value
            return result
        return json.loads(self.read_regular(path, 1024 * 1024).decode('utf-8'), object_pairs_hook=pairs)

    def approval(self, key):
        data = self.read_control(self.approval_path)
        if (type(data) is not dict or set(data) != {'enabled', 'dry_run', 'approvals'}
                or type(data['enabled']) is not bool or type(data['dry_run']) is not bool
                or type(data['approvals']) is not list or len(data['approvals']) > 64):
            raise PublicationError('publication approval rejected')
        seen = set()
        for a in data['approvals']:
            if (type(a) is not dict or set(a) != {'claim_key', 'base_commit', 'branch', 'worktree_token', 'manifest_sha256', 'paths', 'validation'}
                    or any(type(a[k]) is not str for k in ('claim_key', 'base_commit', 'branch', 'worktree_token', 'manifest_sha256'))
                    or not re.fullmatch(r'[1-9][0-9]*:[0-9a-f]{64}', a['claim_key'])
                    or not re.fullmatch('[0-9a-f]{40}', a['base_commit'])
                    or not re.fullmatch('[0-9a-f]{32}', a['worktree_token'])
                    or a['branch'] != 'runner/issue-' + a['claim_key'].split(':')[0] + '-' + a['worktree_token']
                    or not re.fullmatch('[0-9a-f]{64}', a['manifest_sha256'])
                    or type(a['paths']) is not list or not 1 <= len(a['paths']) <= 64
                    or any(type(p) is not str or not self.path_allowed(p) for p in a['paths'])
                    or a['paths'] != sorted(set(a['paths'])) or a['claim_key'] in seen):
                raise PublicationError('publication approval rejected')
            v = a['validation']
            if (type(v) is not dict or set(v) != {'status', 'evidence_sha256'}
                    or v['status'] not in ('unverified', 'coordinator-reviewed')
                    or (v['status'] == 'unverified' and v['evidence_sha256'] is not None)
                    or (v['status'] == 'coordinator-reviewed' and (type(v['evidence_sha256']) is not str
                        or not re.fullmatch('[0-9a-f]{64}', v['evidence_sha256'])))):
                raise PublicationError('publication validation rejected')
            seen.add(a['claim_key'])
        matches = [a for a in data['approvals'] if a['claim_key'] == key]
        if not data['enabled'] or data['dry_run'] or len(matches) != 1:
            raise PublicationError('publication disabled or unapproved')
        return data, matches[0]

    def journal(self):
        data = self.read_control(self.journal_path, {'version': 1, 'publications': {}})
        if (type(data) is not dict or set(data) != {'version', 'publications'}
                or type(data['version']) is not int or data['version'] != 1
                or type(data['publications']) is not dict or len(data['publications']) > 256):
            raise PublicationError('publication journal rejected')
        for key, item in data['publications'].items():
            if (not re.fullmatch(r'[1-9][0-9]*:[0-9a-f]{64}', key) or type(item) is not dict
                    or set(item) != {'approval_digest', 'pins_digest', 'stage', 'tree', 'commit', 'url', 'notification'}
                    or item['stage'] not in ('staging', 'committing', 'committed', 'pushing', 'pushed', 'creating-pr', 'complete')
                    or item['notification'] not in ('not-attempted', 'attempted', 'sent', 'failed')
                    or any(type(item[k]) is not str for k in item)
                    or any(not re.fullmatch('[0-9a-f]{64}', item[k]) for k in ('approval_digest', 'pins_digest'))
                    or any(item[k] and not re.fullmatch('[0-9a-f]{40}', item[k]) for k in ('tree', 'commit'))
                    or item['url'] and not self.valid_url(item['url'])
                    or item['stage'] != 'staging' and not item['tree']
                    or item['stage'] not in ('staging', 'committing') and not item['commit']
                    or (item['stage'] == 'complete') != bool(item['url'])
                    or item['stage'] != 'complete' and item['notification'] != 'not-attempted'):
                raise PublicationError('publication journal rejected')
        return data

    def save(self, journal):
        self.journal()  # Refuse unsafe destination, including replacement aliases.
        name = None
        try:
            fd, name = tempfile.mkstemp(prefix='.publication-', dir=self.home)
            with os.fdopen(fd, 'w') as stream:
                json.dump(journal, stream, sort_keys=True)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.journal_path)
            directory = os.open(self.home, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            if name and os.path.exists(name):
                os.unlink(name)

    @staticmethod
    def valid_url(url):
        return type(url) is str and re.fullmatch(r'https://github\.com/PharmaPilot-AI/pharmanudge-command/pull/[1-9][0-9]*', url) is not None

    def checked_manifest(self, worktree, task, a):
        manifest = self.snapshot(worktree, task['base_commit'])
        if (digest(manifest) != a['manifest_sha256'] or [m['path'] for m in manifest] != a['paths']):
            raise PublicationError('publication manifest mismatch')
        return manifest

    def checked_index(self, worktree, task, manifest):
        raw = self.git(worktree, 'diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', task['base_commit'], '--')
        if sorted(p for p in raw.split('\0') if p) != [m['path'] for m in manifest]:
            raise PublicationError('publication index rejected')
        for m in manifest:
            entry = self.git(worktree, 'ls-files', '--stage', '-z', '--', m['path'])
            if not re.fullmatch(m['mode'] + r' [0-9a-f]{40} 0\t' + re.escape(m['path']) + '\0', entry):
                raise PublicationError('publication index rejected')
            blob = self.git(worktree, 'show', ':' + m['path']).encode('utf-8')
            if len(blob) != m['size'] or hashlib.sha256(blob).hexdigest() != m['sha256']:
                raise PublicationError('publication staged content mismatch')
        return self.git(worktree, 'write-tree').strip()

    def validate_commit(self, worktree, task, item, message):
        head = self.git(worktree, 'rev-parse', 'HEAD').strip()
        metadata = self.git(worktree, 'show', '-s', '--format=%P%n%T%n%B', 'HEAD')
        if (metadata != task['base_commit'] + '\n' + item['tree'] + '\n' + message + '\n\n'
                or item['commit'] and item['commit'] != head
                or self.git(worktree, 'status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching')):
            raise PublicationError('publication commit reconciliation rejected')
        return head

    def remote_ref(self, branch, sha):
        result = self.r.api('/git/matching-refs/heads/' + quote(branch, safe='/'))
        if type(result) is not list or len(result) > 1:
            raise PublicationError('publication remote ref rejected')
        if not result:
            return False
        if result[0] != {'ref': 'refs/heads/' + branch, 'object': {'sha': sha, 'type': 'commit'}}:
            # GitHub includes additional metadata; validate only identity fields.
            ref = result[0]
            if (type(ref) is not dict or ref.get('ref') != 'refs/heads/' + branch
                    or type(ref.get('object')) is not dict or ref['object'].get('sha') != sha
                    or ref['object'].get('type') != 'commit'):
                raise PublicationError('publication remote ref rejected')
        return True

    @staticmethod
    def public_text(task, sha, validation):
        title = 'PharmaNudge reviewed result for issue ' + str(task['issue'])
        status = 'Validation: ' + validation['status']
        if validation['evidence_sha256']:
            status += '; evidence SHA-256: ' + validation['evidence_sha256']
        body = ('Operator-approved bounded result.\nBase: ' + task['base_commit']
                + '\nCommit: ' + sha + '\n' + status
                + '\nCoordinator review requires a separately configured reviewer trigger.')
        return title, body

    def find_pr(self, branch, task, sha, validation):
        prs = self.r.api('/pulls?state=all&head=' + quote('PharmaPilot-AI:' + branch, safe='') + '&base=main&per_page=100')
        if type(prs) is not list or len(prs) > 1:
            raise PublicationError('publication PR reconciliation rejected')
        return self.validate_pr(prs[0], branch, task, sha, validation) if prs else None

    def validate_pr(self, pr, branch, task, sha, validation):
        try:
            title, body = self.public_text(task, sha, validation)
            if (pr.get('title') != title or pr.get('body') != body
                    or type(pr['number']) is not int or pr['number'] <= 0 or not self.valid_url(pr['html_url'])
                    or pr['html_url'].split('/')[-1] != str(pr['number']) or pr['draft'] is not True
                    or pr['state'] != 'open' or pr['head']['ref'] != branch or pr['head']['sha'] != sha
                    or pr['head']['repo']['full_name'] != REPO or pr['base']['ref'] != 'main'
                    or pr['base']['sha'] != task['base_commit'] or pr['base']['repo']['full_name'] != REPO):
                raise ValueError()
            return pr['html_url']
        except (KeyError, TypeError, ValueError):
            raise PublicationError('publication PR rejected') from None

    def publish(self, claim_key):
        with self.guarded():
            approval_data, a = self.approval(claim_key)
            c, task, claim, worktree = self.context(claim_key)
            if (a['base_commit'] != task['base_commit'] or a['branch'] != claim['branch']
                    or a['worktree_token'] != worktree.name):
                raise PublicationError('publication approval identity mismatch')
            pins = digest([c, task, claim])
            approval_digest = digest(approval_data)
            journal = self.journal()
            item = journal['publications'].get(claim_key)
            message = 'PharmaNudge reviewed result for issue ' + str(task['issue'])

            def revalidate():
                fresh_data, fresh_a = self.approval(claim_key)
                fc, ft, fl, fw = self.context(claim_key)
                if (digest([fc, ft, fl]) != pins or digest(fresh_data) != approval_digest
                        or fresh_a != a or (self.home / 'STOP').exists() or (self.home / 'STOP').is_symlink()):
                    raise PublicationError('publication authorization revoked')
                self.r.verify_identity()
                self.checked_manifest(worktree, task, a)
                # Authorization calls may themselves take time; check gates again.
                if (self.r.load_config() != c or digest(self.approval(claim_key)[0]) != approval_digest
                        or self.r.load_state()['claims'].get(claim_key) != claim
                        or (self.home / 'STOP').exists() or (self.home / 'STOP').is_symlink()):
                    raise PublicationError('publication authorization revoked')
                if item and item['commit']:
                    self.validate_commit(worktree, task, item, message)

            if item:
                if item['approval_digest'] != approval_digest or item['pins_digest'] != pins:
                    raise PublicationError('publication approval snapshot changed')
            else:
                if self.git(worktree, 'rev-parse', 'HEAD').strip() != task['base_commit']:
                    raise PublicationError('publication HEAD rejected')
                revalidate()
                item = {'approval_digest': approval_digest, 'pins_digest': pins, 'stage': 'staging',
                        'tree': '', 'commit': '', 'url': '', 'notification': 'not-attempted'}
                journal['publications'][claim_key] = item
                self.save(journal)

            revalidate()
            if item['stage'] in ('staging', 'committing'):
                head = self.git(worktree, 'rev-parse', 'HEAD').strip()
                if head == task['base_commit']:
                    revalidate()
                    self.git(worktree, '-c', 'core.autocrlf=false', 'add', '--', *a['paths'])
                    manifest = self.checked_manifest(worktree, task, a)
                    tree = self.checked_index(worktree, task, manifest)
                    if item['tree'] and item['tree'] != tree:
                        raise PublicationError('publication tree mismatch')
                    item.update(stage='committing', tree=tree)
                    self.save(journal)
                    revalidate()
                    if self.checked_index(worktree, task, manifest) != tree:
                        raise PublicationError('publication tree mismatch')
                    self.git(worktree, '-c', 'user.name=PharmaNudge', '-c', 'user.email=pharmanudge@users.noreply.github.com',
                             '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', message)
                elif item['stage'] != 'committing':
                    raise PublicationError('publication HEAD rejected')
                item['commit'] = self.validate_commit(worktree, task, item, message)
                item['stage'] = 'committed'
                self.save(journal)

            if item['stage'] in ('committed', 'pushing'):
                revalidate()
                if not self.remote_ref(claim['branch'], item['commit']):
                    item['stage'] = 'pushing'
                    self.save(journal)
                    revalidate()
                    self.git(worktree, '-c', 'push.followTags=false', '-c', 'push.recurseSubmodules=no', 'push', '--no-verify', 'origin',
                             'refs/heads/' + claim['branch'] + ':refs/heads/' + claim['branch'])
                    if not self.remote_ref(claim['branch'], item['commit']):
                        raise PublicationError('publication push unresolved')
                item['stage'] = 'pushed'
                self.save(journal)

            if item['stage'] in ('pushed', 'creating-pr'):
                revalidate()
                if not self.remote_ref(claim['branch'], item['commit']):
                    raise PublicationError('publication remote ref missing')
                url = self.find_pr(claim['branch'], task, item['commit'], a['validation'])
                if not url:
                    if item['stage'] == 'creating-pr':
                        raise PublicationError('publication PR outcome unknown; manual review required')
                    item['stage'] = 'creating-pr'
                    self.save(journal)
                    revalidate()
                    title, body = self.public_text(task, item['commit'], a['validation'])
                    response = self.r.command(['gh', 'api', '--hostname', 'github.com', 'repos/' + REPO + '/pulls',
                                               '-X', 'POST', '-f', 'title=' + title,
                                               '-f', 'head=' + claim['branch'], '-f', 'base=main', '-F', 'draft=true', '-f', 'body=' + body])
                    url = self.validate_pr(json.loads(response), claim['branch'], task, item['commit'], a['validation'])
                item.update(stage='complete', url=url)
                self.save(journal)

            if item['stage'] != 'complete' or not self.valid_url(item['url']):
                raise PublicationError('publication incomplete')
            revalidate()
            if item['notification'] == 'not-attempted':
                if (not self.remote_ref(claim['branch'], item['commit'])
                        or self.find_pr(claim['branch'], task, item['commit'], a['validation']) != item['url']):
                    raise PublicationError('publication remote result changed')
                item['notification'] = 'attempted'
                self.save(journal)
                revalidate()
                try:
                    self.r.command([CLI, 'send', '--to', 'telegram', '--quiet',
                                    'PharmaNudge runner: draft PR ready. ' + item['url']], timeout=5, capture=False)
                    item['notification'] = 'sent'
                except Exception:
                    item['notification'] = 'failed'
                self.save(journal)
            return {'status': 'complete', 'url': item['url'], 'commit': item['commit'],
                    'base_commit': task['base_commit'], 'validation': a['validation']['status'], 'notification': item['notification']}
