"""Trusted namespace PID 1 + fixed harmless fixture. Never a model/coding worker."""
import ctypes
import errno
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import time


def read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_size>16384:raise ValueError('unsafe_state')
        raw=os.read(fd,16385)
        if len(raw)>16384:raise ValueError('state_limit')
        return json.loads(raw)
    finally:os.close(fd)


def save(path,value):
    target=Path(path);tmp=target.with_name('.guard-'+str(os.getpid()))
    with tmp.open('w') as stream:
        json.dump(value,stream);stream.flush();os.fsync(stream.fileno())
    os.replace(tmp,target)


def denied_open(path):
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);os.close(fd);return False
    except OSError as exc:return exc.errno in (errno.EACCES,errno.ENOENT,errno.EPERM)


def basic():
    lease=read('/lease/lease.json')
    status=dict(line.split(':',1) for line in Path('/proc/self/status').read_text().splitlines())
    readonly=False
    try:
        with open('/inputs/readonly.txt','w') as stream:stream.write('must_not_write')
    except OSError as exc:readonly=exc.errno==errno.EROFS
    s=socket.socket();s.settimeout(.2)
    try:outbound=s.connect_ex(('198.18.0.1',9)) in (errno.ENETUNREACH,errno.EHOSTUNREACH,errno.EACCES,errno.EPERM)
    finally:s.close()
    return {'uid':os.getuid(),'cap_eff':int(status['CapEff'],16),'no_new_privs':status['NoNewPrivs'].strip()=='1',
      'readonly_root':bool(os.statvfs('/').f_flag & os.ST_RDONLY),'readonly_input_denied':readonly,
      'host_paths_denied':all(denied_open(p) for p in ('/root/.hermes/config.yaml','/root/projects/pharmanudge-command/AGENTS.md','/var/run/docker.sock',lease['forbidden_host_path'])),
      'credential_env_absent':set(os.environ)<= {'HOME','PATH','LANG','LC_CTYPE'},
      'outbound_denied':outbound,'memory_max':int(Path('/sys/fs/cgroup/memory.max').read_text()),
      'pids_max':int(Path('/sys/fs/cgroup/pids.max').read_text()),
      'cpu_max':[int(x) for x in Path('/sys/fs/cgroup/cpu.max').read_text().split()]}


def worker(kind):
    if os.getuid()!=65534 or os.getpid()==1 or os.getppid()!=1:raise SystemExit(2)
    if kind=='wait':
        code="import time; from pathlib import Path; time.sleep(10); Path('/out/late.txt').write_text('must-not-survive')"
        detached=subprocess.Popen([sys.executable,'-I','-S','-B','-c',code],start_new_session=True,
                    stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        save('/status/child_ready.json',{'detached':detached.pid})
        time.sleep(100)
    elif kind=='guard-attack':
        for sig in (signal.SIGSTOP,signal.SIGKILL):
            try:os.kill(1,sig)
            except PermissionError:pass
        state=Path('/proc/1/status').read_text().split('State:',1)[1].splitlines()[0]
        save('/status/worker.json',{'warden_not_stopped':'T' not in state,'warden_memory_denied':denied_open('/proc/1/mem')})
    elif kind=='produce':
        paths=('src/lib/auth/login-native-fallback.test.cjs','src/routes/login.tsx')
        for name in paths:
            target=Path('/out')/name;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_text('synthetic approved output\\n');target.chmod(0o600)
        save('/status/worker.json',{'synthetic_output':True})
    elif kind=='validate':
        import hashlib
        manifest=read('/inputs/manifest.json')['files']
        assert len(manifest)==2 and [m['path'] for m in manifest]==['src/lib/auth/login-native-fallback.test.cjs','src/routes/login.tsx']
        for record in manifest:
            raw=(Path('/inputs')/record['path']).read_bytes()
            assert raw==b'synthetic approved output\\n' and len(raw)==record['size']
            assert hashlib.sha256(raw).hexdigest()==record['sha256'] and record['mode']=='100644'
            assert record['change'] in ('A','M')
        sha=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()).hexdigest()
        save('/status/worker.json',{'approved':True,'manifest_sha256':sha,'reviewer_role':'isolated-fixture-validator'})
    elif kind=='pids':
        children=[];denied=False
        try:
            for _ in range(32):
                try:children.append(subprocess.Popen([sys.executable,'-I','-S','-B','-c','import time; time.sleep(100)'],
                             stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
                except OSError as exc:
                    denied=exc.errno==errno.EAGAIN;break
            save('/status/worker.json',{'fork_denied':denied,'children_started':len(children)})
        finally:
            for child in children:child.kill()
            for child in children:child.wait(timeout=1)
    elif kind=='memory':
        data=bytearray(128*1024*1024)
        save('/status/worker.json',{'unexpected_allocation':len(data)})
    elif kind=='cpu':
        stats=lambda:dict(line.split() for line in Path('/sys/fs/cgroup/cpu.stat').read_text().splitlines())
        before=int(stats()['nr_throttled']);until=time.monotonic()+1.2
        while time.monotonic()<until:pass
        save('/status/worker.json',{'cpu_throttled':int(stats()['nr_throttled'])-before})
    elif kind=='basic':save('/status/worker.json',basic())
    else:raise ValueError('unsupported_fixed_fixture')


def expired(deadline,absolute,mono,wall):return mono>=deadline or wall>=absolute


def guard(kind):
    if os.getpid()!=1 or os.getuid()!=65534:raise SystemExit(2)
    if ctypes.CDLL(None).prctl(4,0,0,0,0)!=0:raise SystemExit(2)  # Child cannot ptrace PID 1.
    lease=read('/lease/lease.json');assert lease['kind']==kind
    remaining=min(15,lease['expires_at']-time.time());assert remaining>0
    deadline=time.monotonic()+remaining
    stopped=False
    def stop(*_):
        nonlocal stopped
        stopped=True
    def expire(*_):raise SystemExit(124)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    signal.signal(signal.SIGALRM,expire);signal.setitimer(signal.ITIMER_REAL,remaining)
    process=None
    try:
        process=subprocess.Popen([sys.executable,'-I','-S','-B','/guard.py','child',kind],
                    stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                    env={'HOME':'/work','PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C.UTF-8'})
        while process.poll() is None:
            if stopped or Path('/lease/STOP').exists() or expired(deadline,lease['expires_at'],time.monotonic(),time.time()):return
            time.sleep(.02)
        # PID 1 kills/reaps adopted descendants too, including setsid children.
        try:os.kill(-1,signal.SIGKILL)
        except ProcessLookupError:pass
        until=time.monotonic()+.5
        while time.monotonic()<until:
            try:
                pid,_=os.waitpid(-1,os.WNOHANG)
                if not pid:time.sleep(.01)
            except ChildProcessError:break
        evidence=read('/status/worker.json') if process.returncode==0 else {'worker_exit':process.returncode}
        if kind=='memory':
            events=dict(line.split() for line in Path('/sys/fs/cgroup/memory.events').read_text().splitlines())
            evidence['oom_kill']=int(events['oom_kill'])
        save('/status/guard.json',{'phase':'sealed','job':lease['job'],'kind':kind,'evidence':evidence})
        while not stopped and not Path('/lease/STOP').exists() and not expired(deadline,lease['expires_at'],time.monotonic(),time.time()):time.sleep(.02)
    finally:
        try:os.kill(-1,signal.SIGKILL)
        except ProcessLookupError:pass
        if process:
            try:process.wait(timeout=.5)
            except subprocess.TimeoutExpired:pass


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='child':worker(sys.argv[2])
    elif len(sys.argv)==2:guard(sys.argv[1])
    else:raise SystemExit(2)
