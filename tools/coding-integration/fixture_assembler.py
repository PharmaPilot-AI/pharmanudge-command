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
from typing import NoReturn
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

class ArchiveFailure(c.Denied):
    def __init__(self,field,category,stage,byte_count,elapsed_ms):
        self.evidence={'stage':stage,'category':category,'field':field,'archive_bytes':byte_count,'elapsed_ms':elapsed_ms}
        super().__init__('archive_'+field)

def verify_archive(data,*,copy_out):
    import time
    start=time.monotonic();stage='archive_output_verify' if copy_out else 'archive_input_verify'
    size=len(data) if isinstance(data,bytes) else 0
    def deny(field,category='archive_metadata') -> NoReturn:
        raise ArchiveFailure(field,category,stage,size,round((time.monotonic()-start)*1000,3)) from None
    if (not isinstance(data,bytes)) or (not copy_out and type(data) is not bytes):deny('input_type')
    if size>(4*1024*1024 if copy_out else 32768):deny('output_limit','output_limit')
    if size%512:deny('truncated','archive_parse')
    expected=fixture()
    try:
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:') as t:
            m=t.next()
            if m is None:deny('member_count')
            if m.offset_data+m.size>size:deny('truncated','archive_parse')
            if len(t.getmembers())!=1:deny('member_count')
            if not m.isfile():deny('type')
            if m.linkname:deny('linkname')
            if m.name!=(Path(MEMBER).name if copy_out else MEMBER):deny('name')
            if m.uid!=0:deny('uid')
            if m.gid!=0:deny('gid')
            if m.mode!=0o555:deny('mode')
            if m.size!=len(expected):deny('size')
            if not copy_out and m.mtime!=0:deny('mtime')
            if not copy_out and m.pax_headers:deny('pax_headers')
            stream=t.extractfile(m)
            if stream is None:deny('type')
            if stream.read(len(expected)+1)!=expected:deny('content','archive_content')
    except ArchiveFailure:raise
    except (tarfile.TarError,ValueError,OSError,EOFError):deny('parse','archive_parse')
    return {'stage':stage,'category':'ok','archive_bytes':size,'elapsed_ms':round((time.monotonic()-start)*1000,3)}

def validate_archive(data):return verify_archive(data,copy_out=False)

def verify_copy_out(data):return verify_archive(data,copy_out=True)

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

DOCKER='/usr/bin/docker'

def docker(*args,data=None,timeout: float=30,stdout_limit=4*1024*1024,stderr_limit=65536):
    from bounded_process import capture
    if args and args[0]=='cp':stage='docker_cp_in' if len(args)>1 and args[1]=='-' else 'docker_cp_out'
    elif args[:2]==('image','inspect'):stage='docker_image_inspect'
    elif args and args[0] in ('create','inspect','diff','commit','rm'):stage='docker_'+args[0]
    else:stage='docker'
    return capture([DOCKER,'--host=unix:///var/run/docker.sock','--config=/nonexistent',*args],
      data=data,stage=stage,timeout=timeout,stdout_limit=stdout_limit,stderr_limit=stderr_limit)

class AssemblyHold(c.Denied):
    def __init__(self,state,code='assembly_hold_manual_reconciliation'):
        self.evidence=state
        super().__init__(code)

def failure_record(exc,stage):
    from bounded_process import Failure
    if isinstance(exc,(Failure,ArchiveFailure)):record=dict(exc.evidence)
    else:
        codes={'unsafe_base','base_layers','base_env','foreign_or_started_container','unexpected_fixture_diff',
          'fixture_image_configuration','assembly_configuration','create_identity','commit_identity','invalid_json','input_limit'}
        record={'category':'metadata' if isinstance(exc,c.Denied) and str(exc) in codes else 'adapter_exception'}
        if isinstance(exc,c.Denied) and str(exc) in codes:record['code']=str(exc)
    record['operation_stage']=stage
    return record

def assemble(journal,run=docker):
    c.require(not journal.exists() and not journal.is_symlink(),'attempt_exists_manual_reconciliation')
    base=c.s.decode(run('image','inspect',BASE))[0];names=validate_base(base)
    token=uuid.uuid4().hex[:16];name='pn-assembler-'+token
    state={'phase':'create-intent','name':name,'token':token,'base':BASE,'fixture_sha256':hashlib.sha256(fixture()).hexdigest()}
    state['diagnostics']=[]
    c.s.atomic_json(journal,state);cid=None;primary=False
    def invoke(stage,*args,data=None):
        import time
        from bounded_process import Output
        state['operation_stage']=stage;c.s.atomic_json(journal,state)
        started=time.monotonic()
        result=run(*args,data=data) if data is not None else run(*args)
        record=dict(result.evidence) if isinstance(result,Output) else {
          'category':'adapter_return','process_evidence':False,'stdout_bytes':len(result),
          'elapsed_ms':round((time.monotonic()-started)*1000,3),'exit_code':None}
        record['operation_stage']=stage;state['diagnostics'].append(record);c.s.atomic_json(journal,state)
        return result
    def owned(stage='owned-inspect'):
        obj=c.s.decode(invoke(stage,'inspect',cid))[0];validate_owned(obj,cid,token)
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
        cid=invoke('create',*args,BASE).decode().strip();c.require(re.fullmatch('[0-9a-f]{64}',cid),'create_identity')
        state.update(phase='copy-intent',container=cid);c.s.atomic_json(journal,state)
        owned('pre-copy-inspect');state['operation_stage']='copy-in-verify';raw=archive();state['diagnostics'].append(validate_archive(raw));invoke('copy-in','cp','-',cid+':/',data=raw)
        owned('post-copy-inspect');state['phase']='diff-read';c.s.atomic_json(journal,state)
        validate_diff(invoke('diff-read','diff',cid).decode())
        # Copy-out verification reads the regular archive member without extracting it.
        state['phase']='copy-out-read';c.s.atomic_json(journal,state)
        data=invoke('copy-out-read','cp',cid+':/'+MEMBER,'-')
        state['operation_stage']='copy-out-verify'
        state['diagnostics'].append(verify_copy_out(data));c.s.atomic_json(journal,state)
        before=owned('precommit-inspect');state['phase']='commit-intent';c.s.atomic_json(journal,state)
        image=invoke('commit','commit','--pause=false',cid).decode().strip();c.require(re.fullmatch('sha256:[0-9a-f]{64}',image),'commit_identity')
        state.update(phase='verify-image',image=image);c.s.atomic_json(journal,state)
        output=c.s.decode(invoke('image-verify','image','inspect',image))[0]
        c.require(output['Id']==image and output['RootFS']['Layers'][:-1]==base['RootFS']['Layers'] and
          len(output['RootFS']['Layers'])==len(base['RootFS']['Layers'])+1 and
          output.get('Os')==base.get('Os') and output.get('Architecture')==base.get('Architecture'),'fixture_image_configuration')
        validate_config(output['Config'],before['Config'])
        owned('final-inspect');state.update(phase='complete',fixture_archive_sha256=hashlib.sha256(raw).hexdigest(),never_started=True)
        c.s.atomic_json(journal,state)
        return state
    except BaseException as exc:
        primary=True
        failure=failure_record(exc,state.get('operation_stage','assembly'))
        state.update(failure_stage=state['phase'],failure_code=failure.get('code',failure['category']),
          primary_failure=failure,phase='unknown')
        try:c.s.atomic_json(journal,state)
        except OSError:state['primary_journal_error']=True
        raise AssemblyHold(state) from None
    finally:
        if cid:
            # Cleanup has its own evidence, never replaces a primary failure.
            try:
                owned('cleanup-inspect');invoke('cleanup-rm','rm',cid)
                state['cleanup_complete']=True;c.s.atomic_json(journal,state)
            except BaseException as exc:
                state['cleanup_failure']=failure_record(exc,state.get('operation_stage','cleanup'))
                state['phase']='unknown'
                try:c.s.atomic_json(journal,state)
                except OSError:state['cleanup_journal_error']=True
                if not primary:raise AssemblyHold(state,'assembly_cleanup_hold_manual_reconciliation') from None

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--allow-stopped-local-assembly',action='store_true')
    p.add_argument('--source-sha',required=True);p.add_argument('--journal',type=Path,required=True);a=p.parse_args()
    c.require(a.allow_stopped_local_assembly,'assembly_permission')
    c.b.SourceIdentity(HERE.parents[1]).verify(a.source_sha)
    result=assemble(a.journal);c.b.SourceIdentity(HERE.parents[1]).verify(a.source_sha)
    print(json.dumps(dict(result,source_sha=a.source_sha),sort_keys=True))

if __name__=='__main__':main()
