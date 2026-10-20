"""Immutable namespace PID 1: no inference, no credentials, bounded coding child."""
import ctypes
import json
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


def expired(end,mono_end,wall,mono):return wall>=end or mono>=mono_end


def main(end,job):
    # Must precede every namespace-wide signal. Python -O cannot remove these guards.
    if os.getpid()!=1 or os.getuid()!=0:raise SystemExit(2)
    if ctypes.CDLL(None).prctl(4,0,0,0,0)!=0:raise SystemExit(2)
    if not re.fullmatch(r'[0-9a-f]{16}',job):raise SystemExit(2)
    last_wall=time.time()
    remaining=min(900,end-last_wall)
    if not 0<remaining<=900:raise SystemExit(2)
    mono_end=time.monotonic()+remaining
    def fence():
        nonlocal last_wall
        wall=time.time()
        if wall<last_wall or expired(end,mono_end,wall,time.monotonic()):raise SystemExit(2)
        last_wall=wall
    child=None
    try:
        shutil.copytree('/inputs/source','/work/source')
        fence()
        for folder,dirs,files in os.walk('/work/source',topdown=False):
            for name in files:
                os.chmod(Path(folder)/name,0o600)
                os.chown(Path(folder)/name,65534,65534)
            os.chmod(folder,0o700)
            os.chown(folder,65534,65534)
        argv=json.loads(Path('/inputs/entry.json').read_text())
        if not isinstance(argv,list) or not argv or not argv[0].startswith('/opt/'):raise SystemExit(2)
        # Never inherit credentials; repository hooks/profile loading are not authorized.
        fence()
        child=subprocess.Popen(argv,cwd='/work/source',env={'HOME':'/work','PATH':'/usr/local/bin:/usr/bin:/bin',
          'LANG':'C.UTF-8','TMPDIR':'/tmp'},user=65534,group=65534,extra_groups=[],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        while not expired(end,mono_end,time.time(),time.monotonic()):
            if child.poll() is not None:
                # Kill all remaining namespace children before indicating immutable output.
                os.kill(-1,signal.SIGKILL)
                while True:
                    try:os.waitpid(-1,os.WNOHANG)
                    except ChildProcessError:break
                    time.sleep(.01)
                fence()
                if child.returncode==0:
                    # Root-only tmpfs is inaccessible to the unprivileged child.
                    record={'version':1,'job':job,'exit_code':0,'quiesced':True}
                    fd=os.open('/run/warden/pending.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                    with os.fdopen(fd,'w') as stream:
                        json.dump(record,stream);stream.flush();os.fsync(stream.fileno())
                    os.replace('/run/warden/pending.json','/run/warden/completion.json')
                while not expired(end,mono_end,time.time(),time.monotonic()):time.sleep(.05)
                return
            time.sleep(.05)
    finally:
        os.kill(-1,signal.SIGKILL)
        if child is not None:child.wait(timeout=2)

if __name__=='__main__':main(float(sys.argv[1]),sys.argv[2])
