"""Operator Docker adapter; real configurable argv, blocked by NoProvider by default."""
import json
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import time
import uuid
import control as c


def checkout(repo,base,out,limit):
    c.require(c.s.hexdigest(base,40),'base_pin')
    env={'HOME':'/nonexistent','PATH':'/usr/bin:/bin','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
    cmd=c.b.Command(env)
    def git(*args):return cmd.run(['/usr/bin/git','--no-optional-locks','-c','core.hooksPath=/dev/null',*args],cwd=repo)
    entries=git('ls-tree','-rlz',base).split(b'\0');files=[];size=0
    for entry in entries:
        if not entry:continue
        meta,raw=entry.split(b'\t',1);mode,kind,oid,n=meta.split()
        name=raw.decode('utf-8');path=PurePosixPath(name)
        c.require(kind==b'blob' and mode in (b'100644',b'100755') and not path.is_absolute()
                  and all(x not in ('','.','..','.git') for x in path.parts),'checkout_type')
        size+=int(n);c.require(size<=limit and len(files)<10000,'checkout_limit')
        files.append((name,oid.decode(),int(n)))
    c.require(not any(out.iterdir()),'checkout_not_empty')
    for name,oid,n in files:
        raw=git('cat-file','blob',oid);c.require(len(raw)==n,'checkout_blob')
        target=out/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(raw);target.chmod(0o444)
    return size


def plan(p,job,token,expiry):
    c.require(re.fullmatch(r'[0-9a-f]{16}',token) and job.resolve()==job.absolute(),'runtime_identity')
    argv=p['entrypoint']
    c.require(isinstance(argv,list) and 1<=len(argv)<=32 and all(isinstance(x,str) and 0<len(x)<=1024 and '\0' not in x for x in argv)
              and argv[0].startswith('/opt/'),'unqualified_entrypoint')
    return ['create','--name=pn-h4-'+token,'--pull=never','--network=none','--read-only','--cap-drop=ALL','--cap-add=SETUID','--cap-add=SETGID','--cap-add=KILL','--cap-add=CHOWN',
      '--security-opt=no-new-privileges=true','--user=0:0','--cgroupns=private','--memory=512m',
      '--memory-swap=512m','--cpus=1','--pids-limit=64','--stop-timeout=1','--label=pharmanudge.handoff=04',
      '--label=pharmanudge.job='+token,'--entrypoint=/usr/local/bin/python3',
      '--tmpfs=/work:rw,nosuid,nodev,size=128m,mode=1777','--tmpfs=/out:rw,noexec,nosuid,nodev,size=1m,mode=1777',
      '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=8m,mode=1777',
      '--tmpfs=/run/warden:rw,noexec,nosuid,nodev,size=64k,mode=0700',
      '--mount=type=bind,src='+str(job/'inputs')+',dst=/inputs,readonly',
      '--mount=type=bind,src='+str(c.HERE/'warden.py')+',dst=/warden.py,readonly',
      '--mount=type=bind,src='+str(c.HERE.parent/'development-handoff/handoff.py')+',dst=/export.py,readonly',
      '--env=HOME=/work','--env=PATH=/usr/local/bin:/usr/bin:/bin','--env=LANG=C.UTF-8',
      p['image'],'-I','-S','-B','/warden.py',str(expiry),token]


class Runtime:
    def __init__(self,vault,command=None,clock=time.time):
        self.v=vault;self.clock=clock;self.command=command or c.b.Command({'HOME':'/nonexistent','PATH':'/usr/bin:/bin'})
    def docker(self,*argv):
        return self.command.run(['/usr/bin/docker','--host=unix:///var/run/docker.sock','--config=/nonexistent',*argv],timeout=15)
    def owned(self,token):
        c.require(re.fullmatch(r'[0-9a-f]{16}',token),'job_identity')
        obj=c.s.decode(self.docker('inspect','pn-h4-'+token))[0]
        c.require(obj['Config']['Labels']=={'pharmanudge.handoff':'04','pharmanudge.job':token},'foreign_container')
        return obj
    def verify_container(self,p,job,token):
        try:
            obj=self.owned(token);host=obj['HostConfig'];cfg=obj['Config']
            c.require(obj['Image']==p['image'] and cfg['User']=='0:0' and cfg['Entrypoint']==['/usr/local/bin/python3']
              and host['ReadonlyRootfs'] is True and host['NetworkMode']=='none' and host['Memory']==536870912
              and host['MemorySwap']==536870912 and host['NanoCpus']==1000000000 and host['PidsLimit']==64
              and host['CapDrop']==['ALL'] and sorted(host.get('CapAdd',[]))==['CHOWN','KILL','SETGID','SETUID'] and not host['Privileged']
              and host['PidMode'] in ('','private') and not host.get('Devices') and not host.get('DeviceRequests')
              and 'no-new-privileges=true' in host['SecurityOpt'],'runtime_configuration')
            mounts={m['Destination']:(m['Source'],m['RW']) for m in obj['Mounts']}
            c.require(mounts=={'/inputs':(str(job/'inputs'),False),'/warden.py':(str(c.HERE/'warden.py'),False),
              '/export.py':(str(c.HERE.parent/'development-handoff/handoff.py'),False)},'runtime_configuration')
            c.require(host['Tmpfs']=={'/work':'rw,nosuid,nodev,size=128m,mode=1777',
              '/out':'rw,noexec,nosuid,nodev,size=1m,mode=1777','/tmp':'rw,noexec,nosuid,nodev,size=8m,mode=1777',
              '/run/warden':'rw,noexec,nosuid,nodev,size=64k,mode=0700'},'runtime_configuration')
        except (KeyError,TypeError):raise c.Denied('runtime_configuration') from None
    def stop(self,token):
        self.owned(token);self.docker('rm','-f','pn-h4-'+token)
    def run(self,p,repo,task,revalidate,broker=None):
        # Lock spans admission, creation, collection and sealing: at most one native job.
        with self.v.locked():
            now=self.clock();self.v.guard(p,now,revalidate)
            (broker or c.NoProvider()).admit(p)
            state=self.v.read();c.require(state['phase'] in ('queued','resume-ready','correction-ready'),'outcome_hold')
            c.require(state['starts']<p['max_starts'],'start_budget')
            token=uuid.uuid4().hex[:16];job=self.v.root/token;job.mkdir(mode=0o700)
            inputs=job/'inputs';inputs.mkdir(mode=0o755)
            source=inputs/'source';source.mkdir()
            checkout(repo,p['base_sha'],source,32*1024*1024)
            if state['phase']=='resume-ready':restore(self.v,state['checkpoint'],source)
            if state['phase']=='correction-ready':restore_result(self.v,state,source)
            (inputs/'task.txt').write_text(task);(inputs/'task.txt').chmod(0o444)
            (inputs/'entry.json').write_text(json.dumps(p['entrypoint']));(inputs/'entry.json').chmod(0o444)
            expiry=min(p['not_after'],self.clock()+p['runtime_seconds'])
            args=plan(p,job,token,expiry)
            # Clear every inherited image environment variable without reading its value.
            c.require(self.docker('image','inspect',p['image'],'--format','{{.Id}}').decode().strip()==p['image'],'image_missing')
            names=self.docker('image','inspect',p['image'],'--format','{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}').decode().split()
            c.require(len(names)<=64 and all(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',n) for n in names),'image_env')
            args[1:1]=['--env='+n+'=' for n in names if n not in ('HOME','PATH','LANG')]
            state=self.v.guard(p,self.clock(),revalidate)
            state.update(phase='start-intent',starts=state['starts']+1,job=token);self.v.save(state)
            try:
                self.docker(*args)
                self.verify_container(p,job,token)
                self.v.guard(p,self.clock(),revalidate)
                self.docker('start','pn-h4-'+token)
                while self.clock()<expiry:
                    self.v.guard(p,self.clock(),revalidate)
                    code="from pathlib import Path; p=Path('/run/warden/completion.json'); print(p.read_text() if p.is_file() and not p.is_symlink() else 'null')"
                    if sealed(self.docker('exec','--user=0:0','pn-h4-'+token,'/usr/local/bin/python3','-I','-S','-B','-c',code),token):break
                    time.sleep(.25)
                else:raise c.Denied('worker_deadline')
                self.verify_container(p,job,token)
                # Frozen namespace: only immutable non-dumpable PID 1 may remain.
                code="import os; print(sorted(int(n) for n in os.listdir('/proc') if n.isdigit() and int(n)!=os.getpid()))"
                c.require(self.docker('exec','pn-h4-'+token,'/usr/local/bin/python3','-I','-S','-B','-c',code).strip()==b'[1]','unsealed_output')
                # Export uses the identical audited descriptor traversal in the container.
                code="import sys,json,base64,importlib.util,pathlib;spec=importlib.util.spec_from_file_location('export','/export.py');export=importlib.util.module_from_spec(spec);sys.modules['export']=export;spec.loader.exec_module(export);print(json.dumps({k:base64.b64encode(v).decode() for k,v in export.payloads(pathlib.Path('/out'),export.PATHS).items()}))"
                import base64
                data={k:base64.b64decode(v,validate=True) for k,v in c.s.decode(self.docker('exec','--user=65534:65534','pn-h4-'+token,'/usr/local/bin/python3','-I','-S','-B','-c',code)).items()}
                self.v.guard(p,self.clock(),revalidate)
                return capture(self.v,p,data,state)
            except BaseException:
                state=self.v.read();state['phase']='unknown';self.v.save(state)
                raise c.Denied('runtime_outcome_hold') from None
            finally:
                # A create/start ambiguity stays held even when owned cleanup succeeds.
                try:self.stop(token)
                except c.Denied:pass


def sealed(raw,token):
    """Only root PID 1 writes this record after successful exit and descendant reaping."""
    return c.s.decode(raw)=={'version':1,'job':token,'exit_code':0,'quiesced':True}


def blob_manifest(data):
    c.require(set(data)==set(c.s.PATHS),'checkpoint_paths')
    result=[]
    for name,raw in sorted(data.items()):
        c.require(isinstance(raw,bytes) and len(raw)<=65536 and b'\0' not in raw,'checkpoint_limit')
        raw.decode('utf-8')
        result.append({'path':name,'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw)})
    return result


def checkpoint(v,data):
    manifest=blob_manifest(data);pin=c.digest(manifest)
    folder=v.root/'checkpoints'/pin
    c.require(not folder.exists(),'checkpoint_consumed')
    folder.mkdir(mode=0o700,parents=True)
    for name,raw in data.items():
        path=folder/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        with path.open('xb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        path.chmod(0o600)
    c.s.atomic_json(folder/'manifest.json',manifest)
    return pin


def restore(v,pin,destination):
    c.require(c.s.hexdigest(pin,64),'checkpoint_pin')
    folder=v.root/'checkpoints'/pin
    data=c.s.payloads(folder,c.s.PATHS,allow_manifest=True)
    c.require(c.digest(blob_manifest(data))==pin,'checkpoint_drift')
    for name,raw in data.items():
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(raw);target.chmod(0o444)


def restore_result(v,state,destination):
    folder=v.root/'quarantine'/str(state['starts'])
    data=c.s.payloads(folder,c.s.PATHS,allow_manifest=True)
    c.require(c.digest(blob_manifest(data))==state['manifest'],'result_drift')
    for name,raw in data.items():
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(raw);target.chmod(0o444)


def capture(v,p,data,state):
    latest=v.read()
    c.require(all(latest.get(k)==state.get(k) for k in ('policy','task','starts','job','phase')),'capture_state_drift')
    state=latest
    c.require(set(data)==set(p['paths']),'export_paths')
    manifest=[];folder=v.root/'quarantine'/str(state['starts']);folder.mkdir(mode=0o700,parents=True)
    for name,raw in sorted(data.items()):
        c.require(isinstance(raw,bytes) and len(raw)<=65536 and b'\0' not in raw,'export_limit')
        raw.decode('utf-8')
        c.require(not any(x in raw.lower() for x in (b'private key',b'bearer ',b'sk-proj-',b'supabase.co')),'secret_like_output')
        path=folder/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);path.chmod(0o600)
        manifest.append({'path':name,'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw)})
    state.update(phase='review-needed',manifest=c.digest(manifest));v.save(state)
    c.s.atomic_json(folder/'manifest.json',manifest)
    return manifest
