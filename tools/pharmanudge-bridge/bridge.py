#!/usr/bin/env python3
"""Fixed coordination protocol. No task execution or relay of user-provided text."""
import json
import re
import uuid

REPO = 'PharmaPilot-AI/pharmanudge-command'
THREADS = (4, 8)
AUTHOR = {'login': 'PharmaPilot-AI', 'id': 319955168}
EVENT_MARKER = 'PHARMANUDGE-COORDINATION-V2'
AUTH_MARKER = 'PHARMANUDGE-WINDOW-AUTH-V2'
RECEIPT_MARKER = 'PHARMANUDGE-COORDINATION-RECEIPT-V2'
NOTIFICATIONS = {
    'result_ready': 'Coordination: result ready. Owner review available.',
    'blocked': 'Coordination: blocked. Owner review required.',
    'owner_decision_needed': 'Coordination: owner decision needed.',
}


class BridgeError(Exception):
    """Sanitized, operator-safe failure."""


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BridgeError('duplicate JSON key')
        result[key] = value
    return result


def decode(text):
    try:
        return json.loads(text, object_pairs_hook=unique_object,
                          parse_constant=lambda _: (_ for _ in ()).throw(BridgeError('invalid JSON')))
    except (ValueError, TypeError, RecursionError):
        raise BridgeError('invalid JSON') from None


def is_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except ValueError:
        return False


def authoritative(comment):
    user = comment.get('user', {})
    return (comment.get('thread') in THREADS and type(comment.get('thread')) is int
            and isinstance(user, dict) and user.get('login') == AUTHOR['login']
            and type(user.get('id')) is int and user['id'] == AUTHOR['id'])


def marked(comment, marker):
    body = comment.get('body')
    if not authoritative(comment) or not isinstance(body, str) or len(body) > 8192:
        raise BridgeError('invalid authority or body')
    prefix = marker + '\n'
    if not body.startswith(prefix):
        raise BridgeError('invalid marker')
    value = decode(body[len(prefix):])
    if not isinstance(value, dict):
        raise BridgeError('invalid schema')
    return value


def parse_event(comment, window_id):
    try:
        value = marked(comment, EVENT_MARKER)
        if set(value) != {'window_id', 'event_id', 'task_id', 'action', 'category'}:
            return None
        if not all(is_uuid(value[key]) for key in ('window_id', 'event_id', 'task_id')):
            return None
        if value['window_id'] != window_id or value['action'] not in ('ping', 'status'):
            return None
        if value['category'] not in ('task_received', *NOTIFICATIONS):
            return None
        if value['action'] == 'ping' and value['category'] != 'task_received':
            return None
        return value
    except (BridgeError, TypeError, AttributeError):
        return None


import contextlib
import fcntl
import hashlib
import math
import os
from pathlib import Path
import tempfile
import time

STATE_ROOT = Path.home() / '.local' / 'state' / 'pharmanudge-coordination-windows'
CONFIG_KEYS = {'enabled', 'dry_run', 'approval_comment_id', 'source_sha', 'window_id'}
CAPS = dict(duration_seconds=86400, max_polls=288, poll_seconds=300,
            max_notifications=12, max_receipts=12)


def require(condition, message='invalid durable state'):
    if not condition:
        raise BridgeError(message)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def timestamp(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def secure_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not path.is_symlink() and path.is_dir(), 'unsafe state directory')
    path.chmod(0o700)


def atomic_json(path, value, *, exclusive=False):
    """Same-directory atomic durable write; exclusive hard-link publishes once."""
    raw = (json.dumps(value, sort_keys=True, allow_nan=False) + '\n').encode()
    fd, name = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if exclusive:
            os.link(name, path)
        else:
            os.replace(name, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def read_json(path):
    try:
        require(not path.is_symlink(), 'unsafe state file')
        with path.open('rb') as stream:
            raw = stream.read(8 * 1024 * 1024 + 1)
        require(len(raw) <= 8 * 1024 * 1024, 'state size limit')
        return decode(raw)
    except (OSError, UnicodeError):
        raise BridgeError('state missing or unreadable') from None


def config_valid(config, *, active=True):
    require(isinstance(config, dict) and set(config) == CONFIG_KEYS, 'invalid config schema')
    require(type(config['enabled']) is bool and type(config['dry_run']) is bool, 'invalid config flags')
    if active:
        require(config['enabled'] and not config['dry_run'], 'disabled or dry-run; no external access')
        require(integer(config['approval_comment_id'], 1, 2**63 - 1), 'invalid approval identifier')
        require(is_uuid(config['window_id']), 'invalid window identifier')
        require(isinstance(config['source_sha'], str) and re.fullmatch('[0-9a-f]{40}', config['source_sha']),
                'invalid source identity')


def parse_approval(comment, config):
    value = marked(comment, AUTH_MARKER)
    require(comment.get('thread') == 4 and comment.get('id') == config['approval_comment_id'],
            'approval must belong to fixed authority thread')
    require(set(value) == {'window_id', 'source_sha', 'threads', *CAPS}, 'invalid approval schema')
    require(value['window_id'] == config['window_id'] and value['source_sha'] == config['source_sha'],
            'approval identity mismatch')
    require(value['threads'] == [4, 8] and all(type(x) is int for x in value['threads']),
            'invalid approval threads')
    # Exact reviewed caps: no operator overrides and no silent cap widening.
    require(all(type(value[k]) is int and value[k] == v for k, v in CAPS.items()), 'invalid approval caps')
    return value


def fingerprint(comment):
    return hashlib.sha256(comment['body'].encode('utf-8')).hexdigest()


class Bridge:
    """Trusted constructor injection is for offline tests, never CLI configuration."""
    def __init__(self, config, io, *, state_root=None, clock=time.time, sleep=time.sleep, identity=None):
        config_valid(config)
        self.config = dict(config)
        self.io = io
        self.root = Path(state_root) if state_root is not None else STATE_ROOT
        self.directory = self.root / config['window_id']
        self.clock, self.sleep = clock, sleep
        self.external_guard = self.initial_guard
        self.identity = identity or (lambda: source_identity(self.external_guard))

    def initial_guard(self):
        require(not (self.root / 'STOP').exists(), 'STOP requested')

    @contextlib.contextmanager
    def lock(self):
        secure_directory(self.root)
        handles = []
        try:
            for path in [self.root / 'registry.lock'] + ([self.directory / 'window.lock'] if self.directory.exists() else []):
                fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
                handles.append(fd)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise BridgeError('another coordination process holds the lock') from None
            yield
        finally:
            for fd in reversed(handles):
                os.close(fd)

    def registry(self):
        value = read_json(self.root / 'registry.json')
        require(isinstance(value, dict) and set(value) == {'version', 'active', 'windows', 'approvals'})
        require(value['version'] == 2 and isinstance(value['windows'], list)
                and len(set(value['windows'])) == len(value['windows'])
                and all(is_uuid(x) for x in value['windows']))
        require(value['active'] is None or value['active'] in value['windows'])
        require(isinstance(value['approvals'], list) and len(value['approvals']) == len(value['windows'])
                and all(integer(x, 1, 2**63 - 1) for x in value['approvals'])
                and len(set(value['approvals'])) == len(value['approvals']))
        return value

    def init(self):
        with self.lock():
            require(not (self.root / 'STOP').exists(), 'STOP requested')
            require(not self.directory.exists(), 'window already exists; cannot renew')
            registry = (self.registry() if (self.root / 'registry.json').exists()
                        else dict(version=2, active=None, windows=[], approvals=[]))
            require(registry['active'] is None, 'another window is active')
            require(self.config['window_id'] not in registry['windows']
                    and self.config['approval_comment_id'] not in registry['approvals'], 'approval already consumed')
            if hasattr(self.io, 'set_guard'):
                self.io.set_guard(self.initial_guard)
            require(self.identity() == self.config['source_sha'], 'source identity mismatch or dirty worktree')
            auth = self.io.approval(self.config['approval_comment_id'])
            caps = parse_approval(auth, self.config)
            cursors = {}
            for thread in THREADS:
                comments = self.io.comments(thread)
                cursors[str(thread)] = max([0] + [self.comment_id(c, thread) for c in comments])
            require(not (self.root / 'STOP').exists(), 'STOP requested')
            now = self.clock()
            require(timestamp(now), 'invalid clock')
            secure_directory(self.directory)
            manifest = dict(version=2, config=self.config, approval=caps,
                            approval_fingerprint=fingerprint(auth), armed_at=now,
                            expires_at=now + caps['duration_seconds'])
            atomic_json(self.directory / 'window.json', manifest, exclusive=True)
            state = dict(version=2, enabled=True, dry_run=False, armed_at=now,
                         expires_at=manifest['expires_at'], next_poll_at=now + caps['poll_seconds'],
                         last_clock=now, polls=0, notifications=0, receipts=0,
                         cursors=cursors, events=[], milestones=[], pending=[])
            atomic_json(self.directory / 'state.json', state, exclusive=True)
            registry['windows'].append(self.config['window_id'])
            registry['approvals'].append(self.config['approval_comment_id'])
            registry['active'] = self.config['window_id']
            atomic_json(self.root / 'registry.json', registry)
            return self.summary(state)

    @staticmethod
    def comment_id(comment, thread):
        require(isinstance(comment, dict) and comment.get('thread') == thread
                and integer(comment.get('id'), 1, 2**63 - 1), 'invalid comments response')
        return comment['id']

    def manifest(self):
        value = read_json(self.directory / 'window.json')
        require(isinstance(value, dict) and set(value) == {'version', 'config', 'approval',
                'approval_fingerprint', 'armed_at', 'expires_at'})
        require(value['version'] == 2 and value['config'] == self.config, 'immutable config mismatch')
        require(timestamp(value['armed_at']) and timestamp(value['expires_at'])
                and value['expires_at'] == value['armed_at'] + CAPS['duration_seconds'])
        require(isinstance(value['approval_fingerprint'], str)
                and re.fullmatch('[0-9a-f]{64}', value['approval_fingerprint']))
        expected = dict(window_id=self.config['window_id'], source_sha=self.config['source_sha'], threads=[4, 8], **CAPS)
        require(value['approval'] == expected, 'immutable approval mismatch')
        return value

    def read_state(self):
        return self.validate_state(read_json(self.directory / 'state.json'))

    def validate_state(self, state):
        manifest = self.manifest()
        require(isinstance(state, dict) and set(state) == {'version', 'enabled', 'dry_run', 'armed_at',
                'expires_at', 'next_poll_at', 'last_clock', 'polls', 'notifications', 'receipts',
                'cursors', 'events', 'milestones', 'pending'})
        require(state['version'] == 2 and type(state['enabled']) is bool and type(state['dry_run']) is bool)
        require(state['armed_at'] == manifest['armed_at'] and state['expires_at'] == manifest['expires_at'])
        require(all(timestamp(state[x]) for x in ('next_poll_at', 'last_clock')))
        require(integer(state['polls'], 0, CAPS['max_polls'])
                and integer(state['notifications'], 0, CAPS['max_notifications'])
                and integer(state['receipts'], 0, CAPS['max_receipts']))
        require(isinstance(state['cursors'], dict) and set(state['cursors']) == {'4', '8'}
                and all(integer(x, 0, 2**63 - 1) for x in state['cursors'].values()))
        require(all(isinstance(state[x], list) and len(state[x]) <= 20000
                    for x in ('events', 'milestones', 'pending')))
        require(all(is_uuid(x) for x in state['events']) and len(set(state['events'])) == len(state['events']))
        require(all(isinstance(x, str) and re.fullmatch(
            r'(4|8):[0-9a-f-]{36}:(result_ready|blocked|owner_decision_needed)', x)
            and is_uuid(x.split(':')[1]) for x in state['milestones']))
        require(len(set(state['milestones'])) == len(state['milestones']))
        pending_ids = []
        attempted = {'notify': 0, 'receipt': 0}
        for item in state['pending']:
            require(isinstance(item, dict) and set(item) ==
                    {'event_id', 'task_id', 'thread', 'category', 'kind', 'attempt'})
            require(is_uuid(item['event_id']) and item['event_id'] in state['events']
                    and is_uuid(item['task_id']) and type(item['thread']) is int and item['thread'] in THREADS)
            require(item['kind'] in ('notify', 'receipt') and
                    (item['attempt'] is None or item['attempt'] in ('attempted', 'done')))
            require((item['kind'] == 'receipt' and item['category'] == 'task_received')
                    or (item['kind'] == 'notify' and item['category'] in NOTIFICATIONS
                        and f"{item['thread']}:{item['task_id']}:{item['category']}" in state['milestones']))
            pending_ids.append(item['event_id'])
            if item['attempt'] is not None:
                attempted[item['kind']] += 1
        require(len(set(pending_ids)) == len(pending_ids))
        require(attempted['notify'] == state['notifications'] and attempted['receipt'] == state['receipts'])
        require(state['last_clock'] >= state['armed_at']
                and state['next_poll_at'] >= state['armed_at'] + CAPS['poll_seconds'])
        return state

    def save(self, state):
        self.validate_state(state)
        atomic_json(self.directory / 'state.json', state)

    def halt(self, state, reason):
        if not (self.directory / 'STOP').exists():
            atomic_json(self.directory / 'STOP', {'reason': reason}, exclusive=True)
        state['enabled'], state['dry_run'] = False, True
        self.save(state)
        registry = self.registry()
        if registry['active'] == self.config['window_id']:
            registry['active'] = None
            atomic_json(self.root / 'registry.json', registry)
        return self.summary(state)

    def stop(self):
        secure_directory(self.root)
        if not (self.root / 'STOP').exists():
            atomic_json(self.root / 'STOP', {'reason': 'operator stop'}, exclusive=True)
        try:
            with self.lock():
                if self.directory.exists():
                    return self.halt(self.read_state(), 'operator stop')
        except BridgeError:
            # The running holder sees the durable root STOP on its next guard.
            return {'status': 'STOP requested'}
        return {'status': 'STOP requested'}

    def guard(self, state):
        now = self.clock()
        if ((self.root / 'STOP').exists() or (self.directory / 'STOP').exists()
                or not state['enabled'] or state['dry_run']):
            self.halt(state, 'STOP requested')
            raise BridgeError('STOP requested')
        if not timestamp(now) or now < state['last_clock']:
            self.halt(state, 'clock moved backwards')
            raise BridgeError('clock moved backwards')
        if now >= state['expires_at']:
            self.halt(state, 'expired')
            raise BridgeError('window expired')
        state['last_clock'] = now

    @staticmethod
    def summary(state):
        return {key: state[key] for key in ('enabled', 'dry_run', 'polls', 'notifications', 'receipts', 'expires_at')}

    def step(self):
        with self.lock():
            return self._step_locked()

    def _step_locked(self):
        state = self.read_state()
        registry = self.registry()
        require(registry['active'] == self.config['window_id'], 'window not active')
        if any(item['attempt'] == 'attempted' for item in state['pending']):
            self.halt(state, 'uncertain external attempt; no retry')
            raise BridgeError('uncertain external attempt; no retry')
        try:
            self.guard(state)
        except BridgeError:
            return self.summary(state)
        self.external_guard = lambda: self.guard(state)
        if hasattr(self.io, 'set_guard'):
            self.io.set_guard(self.external_guard)
        try:
            require(self.identity() == self.config['source_sha'], 'source identity mismatch or dirty worktree')
        except Exception:
            self.halt(state, 'source identity unverifiable; review required')
            raise BridgeError('source identity unverifiable; review required') from None
        due = self.clock() >= state['next_poll_at']
        pending = any(item['attempt'] is None for item in state['pending'])
        if not due and not pending:
            self.save(state)
            return self.summary(state)
        if state['polls'] >= CAPS['max_polls']:
            return self.halt(state, 'poll cap consumed')
        if due:
            # Charge before any remote read. Slow or failed reads never cause bursts.
            state['polls'] += 1
            state['next_poll_at'] = self.clock() + CAPS['poll_seconds']
            self.save(state)
        self.guard(state)
        try:
            auth = self.io.approval(self.config['approval_comment_id'])
            parse_approval(auth, self.config)
            require(fingerprint(auth) == self.manifest()['approval_fingerprint'], 'approval content changed')
        except Exception:
            self.halt(state, 'approval unverifiable or changed; review required')
            raise BridgeError('approval unverifiable or changed; review required') from None
        if due:
            for thread in THREADS:
                self.guard(state)
                comments = self.io.comments(thread)
                ids = [self.comment_id(c, thread) for c in comments]
                require(len(ids) == len(set(ids)), 'duplicate comment response')
                cursor = state['cursors'][str(thread)]
                for comment in sorted(comments, key=lambda c: c['id']):
                    if comment['id'] <= cursor:
                        continue
                    value = parse_event(comment, self.config['window_id'])
                    if value is None or value['event_id'] in state['events']:
                        continue
                    state['events'].append(value['event_id'])
                    key = f"{thread}:{value['task_id']}:{value['category']}"
                    kind = None
                    if value['action'] == 'ping':
                        kind = 'receipt'
                    elif value['category'] in NOTIFICATIONS and key not in state['milestones']:
                        state['milestones'].append(key)
                        kind = 'notify'
                    if kind is not None:
                        state['pending'].append(dict(event_id=value['event_id'], task_id=value['task_id'],
                            thread=thread, category=value['category'], kind=kind, attempt=None))
                # Admission must survive a crash before the cursor can move.
                self.save(state)
                state['cursors'][str(thread)] = max([cursor] + ids)
                self.save(state)
        for item in state['pending']:
            if item['attempt'] == 'done':
                continue
            try:
                self.guard(state)
            except BridgeError:
                return self.summary(state)
            counter = 'receipts' if item['kind'] == 'receipt' else 'notifications'
            limit = CAPS['max_receipts' if counter == 'receipts' else 'max_notifications']
            if state[counter] >= limit:
                return self.halt(state, 'external attempt cap consumed')
            item['attempt'] = 'attempted'
            state[counter] += 1
            self.save(state)
            try:
                # Recheck after durable attempt and immediately before the external write.
                self.guard(state)
                if item['kind'] == 'receipt':
                    self.io.receipt(item['thread'])
                else:
                    self.io.notify(item['category'])
            except Exception:
                self.halt(state, 'uncertain external attempt; no retry')
                raise BridgeError('uncertain external attempt; no retry') from None
            item['attempt'] = 'done'
            self.save(state)
            if state[counter] >= limit:
                return self.halt(state, 'external attempt cap consumed')
        if state['polls'] >= CAPS['max_polls']:
            return self.halt(state, 'poll cap consumed')
        return self.summary(state)


    def run(self):
        """One foreground process, one held lock, finite absolute and monotonic lifetime."""
        with self.lock():
            state = self.read_state()
            end = time.monotonic() + min(CAPS['duration_seconds'], max(0, state['expires_at'] - self.clock()))
            while True:
                state = self.read_state()
                if not state['enabled'] or state['dry_run']:
                    return self.summary(state)
                if time.monotonic() >= end:
                    return self.halt(state, 'finite process deadline reached')
                try:
                    self.guard(state)
                except BridgeError:
                    return self.summary(state)
                if self.clock() >= state['next_poll_at'] or any(x['attempt'] is None for x in state['pending']):
                    try:
                        self._step_locked()
                    except BridgeError:
                        # Read failures consume the already persisted poll and stop this process.
                        # Unknown writes have already latched STOP and are never retried.
                        current = self.read_state()
                        if not current['enabled']:
                            return self.summary(current)
                        try:
                            self.guard(current)
                        except BridgeError:
                            return self.summary(current)
                        if current['polls'] >= CAPS['max_polls']:
                            return self.halt(current, 'poll cap consumed')
                        raise
                else:
                    self.sleep(min(0.25, state['next_poll_at'] - self.clock(),
                                   max(0, state['expires_at'] - self.clock())))


import argparse
import selectors
import shutil
import signal
import subprocess

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Command:
    """Bounded local subprocess group. Arguments come only from fixed adapters."""
    OUTPUT_LIMIT = 1024 * 1024

    def __init__(self, guard):
        self.guard = guard

    def run(self, argv, *, timeout=30):
        require(type(timeout) in (int, float) and 0 < timeout <= 60, 'invalid command timeout')
        self.guard()
        end = time.monotonic() + timeout
        process = None
        # Use on-disk gh auth, without inheriting tokens or Hermes profile selectors.
        environment = dict(HOME=str(Path.home()), PATH=os.environ.get('PATH', os.defpath),
                           LANG=os.environ.get('LANG', 'C'), GH_HOST='github.com',
                           GH_PROMPT_DISABLED='1', GH_PAGER='cat', PAGER='cat')
        if 'GH_CONFIG_DIR' in os.environ:
            environment['GH_CONFIG_DIR'] = os.environ['GH_CONFIG_DIR']
        previous_handlers = {}
        stopping = False
        spawning = False
        deferred_signal = None

        def terminate(signum, frame):
            nonlocal stopping, deferred_signal
            if spawning:
                # Defer Python-level delivery until the returned child is owned.
                # Do not block OS signals over exec or alter the child's mask.
                deferred_signal = signum
                return
            if not stopping:
                stopping = True
                raise BridgeError('command interrupted; outcome may be uncertain')

        try:
            # Commands run on the main thread; install before starting owned work.
            for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                previous_handlers[signum] = signal.getsignal(signum)
                signal.signal(signum, terminate)
            spawning = True
            try:
                process = subprocess.Popen(argv, shell=False, stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True,
                    cwd=PROJECT_ROOT, env=environment)
            finally:
                spawning = False
            if deferred_signal is not None:
                terminate(deferred_signal, None)
            output = bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map() or process.poll() is None:
                    self.guard()
                    remaining = end - time.monotonic()
                    require(remaining > 0, 'command deadline exceeded')
                    for key, _ in selector.select(min(0.1, remaining)):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            require(len(output) + len(chunk) <= self.OUTPUT_LIMIT, 'command output limit exceeded')
                            output.extend(chunk)
            require(process.returncode == 0, 'command failed; outcome may be uncertain')
            return bytes(output)
        except OSError:
            raise BridgeError('command unavailable or failed') from None
        finally:
            # Repeated termination must not interrupt group kill/reap or restoration.
            stopping = True
            try:
                if process is not None:
                    # Always kill our group, even if its direct parent already exited.
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                    process.stdout.close()
            finally:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)


def executable(name, which=shutil.which):
    value = which(name)
    require(value is not None, 'required operator executable unavailable')
    return value


def source_identity(guard=lambda: None):
    command = Command(guard)
    git = executable('git')
    sha = command.run([git, '-C', str(PROJECT_ROOT), 'rev-parse', 'HEAD']).decode('ascii').strip()
    require(re.fullmatch('[0-9a-f]{40}', sha), 'invalid source identity')
    dirty = command.run([git, '-C', str(PROJECT_ROOT), 'status', '--porcelain=v1', '--untracked-files=normal'])
    require(not dirty, 'source worktree must be clean')
    return sha


class Adapters:
    MAX_PAGES = 20

    def __init__(self, command=None, *, which=shutil.which):
        self.command = command or Command(lambda: None)
        self.gh = executable('gh', which)
        self.notifier = executable('pharmanudge', which)

    def set_guard(self, guard):
        self.command.guard = guard

    @staticmethod
    def thread(thread):
        require(type(thread) is int and thread in THREADS, 'unsupported thread')

    def comments(self, thread):
        self.thread(thread)
        result = []
        seen = set()
        for page in range(1, self.MAX_PAGES + 1):
            endpoint = f'repos/{REPO}/issues/{thread}/comments?per_page=100&page={page}'
            raw = self.command.run([self.gh, 'api', '--hostname', 'github.com', '--method', 'GET', endpoint])
            values = decode(raw)
            require(isinstance(values, list) and len(values) <= 100, 'invalid comments page')
            for value in values:
                require(isinstance(value, dict) and integer(value.get('id'), 1, 2**63 - 1)
                        and value['id'] not in seen, 'invalid or overlapping comments pages')
                seen.add(value['id'])
                result.append(dict(value, thread=thread))
            if len(values) < 100:
                return result
        raise BridgeError('pagination bound reached; no partial response admitted')

    def approval(self, cid):
        require(integer(cid, 1, 2**63 - 1), 'invalid approval identifier')
        matches = [item for item in self.comments(4) if item['id'] == cid]
        require(len(matches) == 1, 'approval absent from fixed thread')
        return matches[0]

    def receipt(self, thread):
        self.thread(thread)
        self.command.run([self.gh, 'api', '--hostname', 'github.com', '--method', 'POST',
            f'repos/{REPO}/issues/{thread}/comments', '--raw-field', 'body=' + RECEIPT_MARKER + '\npong'])

    def notify(self, category):
        require(isinstance(category, str) and category in NOTIFICATIONS, 'unsupported notification')
        self.command.run([self.notifier, 'send', '--to', 'telegram', '--quiet', NOTIFICATIONS[category]], timeout=60)


def offline_stop():
    secure_directory(STATE_ROOT)
    if not (STATE_ROOT / 'STOP').exists():
        atomic_json(STATE_ROOT / 'STOP', {'reason': 'operator stop'}, exclusive=True)
    registry_path = STATE_ROOT / 'registry.json'
    if registry_path.exists():
        registry = read_json(registry_path)
        active = registry.get('active') if isinstance(registry, dict) else None
        if is_uuid(active):
            manifest = read_json(STATE_ROOT / active / 'window.json')
            return Bridge(manifest['config'], None).stop()
    return {'status': 'STOP requested'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('init', 'run', 'stop'))
    parser.add_argument('--config', type=Path)
    args = parser.parse_args(argv)
    try:
        if args.action == 'stop':
            result = offline_stop()
        else:
            require(args.config is not None, 'explicit config required')
            config = read_json(args.config)
            config_valid(config)
            instance = Bridge(config, Adapters())
            result = instance.init() if args.action == 'init' else instance.run()
        print(json.dumps(result, sort_keys=True))
        return 0
    except (BridgeError, OSError, ValueError, TypeError, KeyError):
        print('Coordination refused or stopped; inspect reviewed configuration and durable state.')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
