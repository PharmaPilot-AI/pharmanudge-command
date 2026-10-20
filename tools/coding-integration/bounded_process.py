"""Binary-safe, live-bounded subprocess I/O. Never retains stderr or raw errors.

The caller supplies a fixed argv, not a shell command. The direct child is reaped;
its process group is killed on return, including descendants retaining pipes.
This is cleanup, not a hostile-process sandbox or arbitrary-grandchild reaper.
"""
import os
import selectors
import signal
import subprocess
import time
from typing import BinaryIO, cast
import control as c

class Failure(c.Denied):
    def __init__(self,evidence):
        self.evidence=dict(evidence)
        super().__init__(evidence['category'])

class Output(bytes):
    evidence: dict
    def __new__(cls,raw,evidence):
        obj=super().__new__(cls,raw);obj.evidence=dict(evidence);return obj

def capture(argv,*,data=None,stage='docker',timeout=30,stdout_limit=4*1024*1024,stderr_limit=65536):
    c.require(isinstance(argv,list) and argv and all(type(x) is str and '\0' not in x for x in argv),'transport_argv')
    c.require(data is None or type(data) is bytes and len(data)<=32768,'transport_input')
    c.require(type(timeout) in (int,float) and 0<timeout<=30 and
      type(stdout_limit) is int and 0<stdout_limit<=4*1024*1024 and
      type(stderr_limit) is int and 0<stderr_limit<=65536,'transport_limits')
    c.require(stage in {'docker','docker_image_inspect','docker_create','docker_inspect','docker_cp_in',
      'docker_cp_out','docker_diff','docker_commit','docker_rm'},'transport_stage')
    start=time.monotonic();end=start+timeout
    e={'stage':stage,'category':'ok','elapsed_ms':0,'exit_code':None,'stdin_bytes':0,'stdout_bytes':0,
       'stderr_bytes':0,'stdout_complete':False,'stderr_complete':False,'direct_child_reaped':False,'cleanup_category':'ok'}
    proc=None;sel=selectors.DefaultSelector();out=bytearray();problem=None
    try:
        proc=subprocess.Popen(argv,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,
          stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,bufsize=0,
          env={'HOME':'/nonexistent','PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
        for stream,kind in ((proc.stdout,'stdout'),(proc.stderr,'stderr')):
            if stream is None:raise OSError('pipe_missing')
            os.set_blocking(stream.fileno(),False);sel.register(stream,selectors.EVENT_READ,kind)
        if proc.stdin:
            if data:
                os.set_blocking(proc.stdin.fileno(),False);sel.register(proc.stdin,selectors.EVENT_WRITE,'stdin')
            else:proc.stdin.close()
        while sel.get_map() or proc.poll() is None:
            remaining=end-time.monotonic()
            if remaining<=0:problem='timeout';break
            for key,_ in sel.select(min(.05,remaining)):
                stream=cast(BinaryIO,key.fileobj);kind=key.data
                if kind=='stdin':
                    try:n=os.write(stream.fileno(),memoryview(data or b'')[e['stdin_bytes']:e['stdin_bytes']+8192])
                    except BrokenPipeError:
                        sel.unregister(stream);stream.close();continue
                    except BlockingIOError:continue
                    e['stdin_bytes']+=n
                    if e['stdin_bytes']==len(data or b''):sel.unregister(stream);stream.close()
                    continue
                limit=stdout_limit if kind=='stdout' else stderr_limit
                try:raw=os.read(stream.fileno(),min(8192,limit-e[kind+'_bytes']+1))
                except BlockingIOError:continue
                if not raw:
                    e[kind+'_complete']=True;sel.unregister(stream);stream.close();continue
                e[kind+'_bytes']+=len(raw)
                if e[kind+'_bytes']>limit:problem=kind+'_limit';break
                if kind=='stdout':out.extend(raw)
            if problem:break
        if not problem and proc.wait(timeout=max(.001,end-time.monotonic()))!=0:problem='nonzero_exit'
        if not problem and data is not None and e['stdin_bytes']!=len(data):problem='stdin_incomplete'
    except subprocess.TimeoutExpired:problem='timeout'
    except OSError:problem='os_error'
    finally:
        # Preserve a primary timeout/nonzero/etc even when cleanup itself fails.
        if proc is not None:
            try:os.killpg(proc.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            except OSError:e['cleanup_category']='kill_error'
            try:proc.wait(timeout=2);e['direct_child_reaped']=True
            except (OSError,subprocess.TimeoutExpired):e['cleanup_category']='reap_error'
            e['exit_code']=proc.returncode
            for stream in (proc.stdin,proc.stdout,proc.stderr):
                if stream:
                    try:stream.close()
                    except OSError:e['cleanup_category']='close_error'
        try:sel.close()
        except OSError:e['cleanup_category']='selector_close_error'
        e['elapsed_ms']=round((time.monotonic()-start)*1000,3)
    e['category']=problem or ('cleanup_error' if e['cleanup_category']!='ok' else 'ok')
    if e['category']!='ok':raise Failure(e) from None
    return Output(bytes(out),e)
