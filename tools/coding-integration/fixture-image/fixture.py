#!/usr/local/bin/python3 -I
"""Harmless fixed namespace probe; no model, network, credentials or app data."""
import json
import os
from pathlib import Path
import signal
import sys
import time

def main():
    if os.getpid()==1 or os.getuid()!=65534 or os.getgid()!=65534 or os.getgroups():
        return 2
    mode=sys.argv[1] if len(sys.argv)==2 else 'success'
    if mode not in ('success','failure','sleep','descendant'):
        return 2
    denied=[]
    for action in (lambda:os.listdir('/run/warden'),
                   lambda:Path('/run/warden/completion.json').read_bytes(),
                   lambda:Path('/run/warden/forged').write_bytes(b'dummy'),
                   lambda:os.kill(1,signal.SIGTERM)):
        try:action()
        except PermissionError:denied.append(True)
        else:return 3
    status=Path('/proc/self/status').read_text()
    caps={line.split(':',1)[0]:line.split(':',1)[1].strip()
          for line in status.splitlines() if line.startswith(('CapEff:','CapPrm:'))}
    if set(caps)!={'CapEff','CapPrm'} or any(int(v,16) for v in caps.values()):
        return 4
    Path('/out/probe.json').write_text(json.dumps({'uid':os.getuid(),'gid':os.getgid(),
      'groups':os.getgroups(),'denials':len(denied),'mode':mode,'zero_caps':True}))
    if mode=='failure':
        Path('/tmp/warden-sealed').write_text('forged old marker')
        return 1
    if mode=='descendant' and os.fork()==0:
        os.setsid()
        while True:time.sleep(1)
    if mode=='sleep':
        while True:time.sleep(1)
    return 0

if __name__=='__main__':raise SystemExit(main())
