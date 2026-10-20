"""Immutable namespace PID 1: no inference, no credentials, bounded coding child."""
import ctypes
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


def expired(end,mono_end,wall,mono):return wall>=end or mono>=mono_end


def main(end):
    # Must precede every namespace-wide signal. Python -O cannot remove these guards.
    if os.getpid()!=1 or os.getuid()!=65534:raise SystemExit(2)
    if ctypes.CDLL(None).prctl(4,0,0,0,0)!=0:raise SystemExit(2)
    remaining=min(900,end-time.time())
    if not 0<remaining<=900:raise SystemExit(2)
    mono_end=time.monotonic()+remaining
    child=None
    try:
        shutil.copytree('/inputs/source','/work/source')
        for folder,dirs,files in os.walk('/work/source'):
            os.chmod(folder,0o700)
            for name in files:os.chmod(Path(folder)/name,0o600)
        argv=json.loads(Path('/inputs/entry.json').read_text())
        if not isinstance(argv,list) or not argv or not argv[0].startswith('/opt/'):raise SystemExit(2)
        # Never inherit credentials; repository hooks/profile loading are not authorized.
        child=subprocess.Popen(argv,cwd='/work/source',env={'HOME':'/work','PATH':'/usr/local/bin:/usr/bin:/bin',
          'LANG':'C.UTF-8','TMPDIR':'/tmp'},stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        while not expired(end,mono_end,time.time(),time.monotonic()):
            if child.poll() is not None:
                # Kill all remaining namespace children before indicating immutable output.
                os.kill(-1,signal.SIGKILL)
                while True:
                    try:os.waitpid(-1,os.WNOHANG)
                    except ChildProcessError:break
                    time.sleep(.01)
                if child.returncode==0:Path('/tmp/warden-sealed').touch(mode=0o600)
                while not expired(end,mono_end,time.time(),time.monotonic()):time.sleep(.05)
                return
            time.sleep(.05)
    finally:
        os.kill(-1,signal.SIGKILL)
        if child is not None:child.wait(timeout=2)

if __name__=='__main__':main(float(sys.argv[1]))
