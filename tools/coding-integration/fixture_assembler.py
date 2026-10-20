"""Offline-only stopped-container fixture assembly. No worker, builder or registry.

Each journal is one attempt: any uncertain effect requires manual inspection.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import uuid
import control as c

BASE=c.b.IMAGE
MEMBER='opt/pharmanudge-qualification-fixture'
HERE=Path(__file__).resolve().parent

def fixture():
    raw=(HERE/'fixture-image/fixture.py').read_bytes()
    c.require(0<len(raw)<16384 and raw.startswith(b'#!/usr/local/bin/python3 -I\n'),'fixture_bytes')
    return raw

def archive():
    buf=io.BytesIO();raw=fixture()
    with tarfile.open(fileobj=buf,mode='w',format=tarfile.USTAR_FORMAT) as t:
        x=tarfile.TarInfo(MEMBER);x.uid=x.gid=x.mtime=0;x.mode=0o555;x.size=len(raw)
        t.addfile(x,io.BytesIO(raw))
    data=buf.getvalue();validate_archive(data);return data

def validate_archive(data):
    c.require(type(data) is bytes and len(data)<=32768,'fixture_tar')
    try:
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as t:
            members=t.getmembers();c.require(len(members)==1,'fixture_tar')
            m=members[0]
            c.require(m.name==MEMBER and m.isfile() and not m.linkname and m.uid==m.gid==m.mtime==0
              and m.mode==0o555 and m.size==len(fixture()) and not m.pax_headers,'fixture_tar')
            c.require(t.extractfile(m).read()==fixture(),'fixture_changed')
    except (tarfile.TarError,ValueError,OSError):raise c.Denied('fixture_tar') from None

def validate_base(obj):
    cfg=obj.get('Config',{})
    c.require(obj.get('Id')==BASE and isinstance(cfg,dict) and
      not any(cfg.get(k) for k in ('Volumes','OnBuild','Healthcheck')),'unsafe_base')
    layers=obj.get('RootFS',{}).get('Layers')
    c.require(isinstance(layers,list) and 0<len(layers)<=64 and
      all(re.fullmatch('sha256:[0-9a-f]{64}',x) for x in layers),'base_layers')
    names=[x.split('=',1)[0] for x in cfg.get('Env',[])]
    c.require(len(names)<=64 and len(set(names))==len(names) and all(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',x) for x in names),'base_env')
    return names

def validate_owned(obj,cid,token):
    c.require(obj.get('Id')==cid and obj.get('Image')==BASE and
      obj.get('Config',{}).get('Labels',{}).get('org.pharmanudge.fixture.assembly')==token and
      obj.get('State',{}).get('Status')=='created' and obj['State'].get('Running') is False and
      obj['State'].get('StartedAt')=='0001-01-01T00:00:00Z' and not obj.get('Mounts'),'foreign_or_started_container')

def validate_diff(raw):
    lines=raw.strip().splitlines()
    c.require(len(lines)==len(set(lines)) and set(lines) in
      ({'A /'+MEMBER},{'C /opt','A /'+MEMBER}),'unexpected_fixture_diff')

def validate_config(actual,before):
    allowed={'Env','Cmd','Labels','Shell','User','Entrypoint','WorkingDir','StopSignal','ArgsEscaped','ExposedPorts','Volumes','OnBuild','Healthcheck'}
    c.require(isinstance(actual,dict) and set(actual)<=allowed and
      all(actual.get(k)==before.get(k) for k in set(actual)|{'Env','User','Entrypoint','Labels'}) and
      not any(actual.get(k) for k in ('Volumes','OnBuild','Healthcheck')),'fixture_image_configuration')

def docker(*args,data=None):
    try:
        r=subprocess.run(['/usr/bin/docker','--host=unix:///var/run/docker.sock','--config=/nonexistent',*args],
          input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,
          env={'HOME':'/nonexistent','PATH':'/usr/bin:/bin'})
    except (OSError,subprocess.TimeoutExpired):raise c.Denied('docker_uncertain') from None
    c.require(r.returncode==0 and len(r.stdout)<=4*1024*1024,'docker_failed_or_oversize')
    return r.stdout

def assemble(journal,run=docker):
    c.require(not journal.exists() and not journal.is_symlink(),'attempt_exists_manual_reconciliation')
    base=c.s.decode(run('image','inspect',BASE))[0];names=validate_base(base)
    token=uuid.uuid4().hex[:16];name='pn-assembler-'+token
    state={'phase':'create-intent','name':name,'token':token,'base':BASE,'fixture_sha256':hashlib.sha256(fixture()).hexdigest()}
    c.s.atomic_json(journal,state);cid=None
    def owned():
        obj=c.s.decode(run('inspect',cid))[0];validate_owned(obj,cid,token)
        h=obj['HostConfig'];cfg=obj['Config']
        c.require(h['NetworkMode']=='none' and not h['Privileged'] and h['CapDrop']==['ALL'] and
          not h.get('CapAdd') and cfg['Entrypoint']==['/bin/false'] and cfg['User']=='65534:65534' and
          h['Memory']==67108864 and h['PidsLimit']==16 and 'no-new-privileges=true' in h['SecurityOpt'],'assembly_configuration')
        return obj
    try:
        args=['create','--name='+name,'--pull=never','--network=none','--cap-drop=ALL',
          '--security-opt=no-new-privileges=true','--user=65534:65534','--memory=64m','--memory-swap=64m','--pids-limit=16',
          '--entrypoint=/bin/false','--label=org.pharmanudge.fixture.assembly='+token]
        args+=['--env='+n+'=' for n in names]
        cid=run(*args,BASE).decode().strip();c.require(re.fullmatch('[0-9a-f]{64}',cid),'create_identity')
        state.update(phase='copy-intent',container=cid);c.s.atomic_json(journal,state)
        owned();raw=archive();validate_archive(raw);run('cp','-',cid+':/',data=raw)
        owned();validate_diff(run('diff',cid).decode())
        # Copy-out verification reads the regular archive member without extracting it.
        data=run('cp',cid+':/'+MEMBER,'-')
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as t:
            ms=t.getmembers();c.require(len(ms)==1,'fixture_copy_out')
            m=ms[0];c.require(m.isfile() and not m.linkname and m.uid==m.gid==0 and m.mode==0o555 and
              m.name==Path(MEMBER).name and m.size==len(fixture()) and t.extractfile(m).read()==fixture(),'fixture_copy_out')
        before=owned();state['phase']='commit-intent';c.s.atomic_json(journal,state)
        image=run('commit','--pause=false',cid).decode().strip();c.require(re.fullmatch('sha256:[0-9a-f]{64}',image),'commit_identity')
        state.update(phase='verify-image',image=image);c.s.atomic_json(journal,state)
        output=c.s.decode(run('image','inspect',image))[0]
        c.require(output['Id']==image and output['RootFS']['Layers'][:-1]==base['RootFS']['Layers'] and
          len(output['RootFS']['Layers'])==len(base['RootFS']['Layers'])+1 and
          output.get('Os')==base.get('Os') and output.get('Architecture')==base.get('Architecture'),'fixture_image_configuration')
        validate_config(output['Config'],before['Config'])
        owned();state.update(phase='complete',fixture_archive_sha256=hashlib.sha256(raw).hexdigest(),never_started=True)
        c.s.atomic_json(journal,state)
        return state
    except BaseException:
        state['phase']='unknown';c.s.atomic_json(journal,state)
        raise c.Denied('assembly_hold_manual_reconciliation') from None
    finally:
        if cid:
            # Do not delete by guessed name after ambiguous create, nor a foreign object.
            owned();run('rm',cid)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--allow-stopped-local-assembly',action='store_true')
    p.add_argument('--source-sha',required=True);p.add_argument('--journal',type=Path,required=True);a=p.parse_args()
    c.require(a.allow_stopped_local_assembly,'assembly_permission')
    c.b.SourceIdentity(HERE.parents[1]).verify(a.source_sha)
    result=assemble(a.journal);c.b.SourceIdentity(HERE.parents[1]).verify(a.source_sha)
    print(json.dumps(dict(result,source_sha=a.source_sha),sort_keys=True))

if __name__=='__main__':main()
