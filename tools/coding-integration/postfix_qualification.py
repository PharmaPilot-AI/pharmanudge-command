"""POSTFIX-QUALIFICATION-01 prerequisite harness; never activates the coding runtime.

A missing /opt fixture is an explicit stop boundary. No fixture image, executable,
mount, approval, broker, credential or runtime workaround is installed here.
"""
import argparse
import json
from pathlib import Path
import re
import tempfile
import time
import uuid
import control as c
import runtime

TARGET='271bdbbd89c21ec1ffe2f62526ef22f44eef7094'
ROOT=Path(__file__).resolve().parents[2]
GATES=('root_pid1_reviewed_capabilities','child_uid_gid_groups_capabilities',
 'completion_directory_0700_root_only','completion_write_read_traversal_denial',
 'pid1_signal_denial','failed_child_forged_old_marker_rejection',
 'success_exact_job_protected_record','wrong_job_rejection',
 'descendants_terminated_and_reaped_before_export','exporter_uid_65534',
 'readonly_network_host_secret_socket_limits','runtime_expiry','runtime_stop',
 'runtime_supervisor_death_cleanup')


def status() -> dict[str, object]:
    return {'native_executed':False,'live_enabled':False,'runtime_qualified':False,
      'provider_calls':0,'source_target':TARGET}


def assess(executables,verified) -> dict[str, object]:
    blockers=[]
    if not executables:blockers.append('cached_image_has_no_opt_executable_fixture')
    if not verified:blockers.append('current_verify_container_rejected_cached_image')
    return dict(status(),status='BLOCKED' if blockers else 'NOT QUALIFIED',blockers=blockers,
                runtime_test_gates={name:'NOT RUN' for name in GATES})


class Native:
    def __init__(self):
        self.command=c.b.Command({'HOME':'/nonexistent','PATH':'/usr/bin:/bin'})
        self.owned_ids=[]
    def docker(self,*args):
        return self.command.run(['/usr/bin/docker','--host=unix:///var/run/docker.sock','--config=/nonexistent',*args],timeout=15)
    def create(self,args,token):
        cid=self.docker(*args).decode().strip()
        c.require(re.fullmatch('[0-9a-f]{64}',cid),'qualification_container_id')
        self.owned_ids.append((cid,token))
        return cid
    def cleanup(self):
        for cid,token in reversed(self.owned_ids):
            obj=c.s.decode(self.docker('inspect',cid))[0]
            c.require(obj['Id']==cid and obj['Config']['Labels'].get('pharmanudge.job')==token,'qualification_cleanup_ownership')
            self.docker('rm','-f',cid)
        self.owned_ids.clear()
    def run(self,source_sha):
        c.b.SourceIdentity(ROOT).verify(source_sha)
        # SourceIdentity verifies the complete exact supplied revision, including
        # reviewed compatibility corrections. No qualification transfers from TARGET.
        image=c.b.IMAGE
        c.require(self.docker('image','inspect',image,'--format','{{.Id}}').decode().strip()==image,'cached_image_missing')
        names=self.docker('image','inspect',image,'--format','{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}').decode().split()
        c.require(len(names)<=64 and all(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*',n) for n in names),'image_environment_names')
        clear=['--env='+n+'=' for n in names]
        with tempfile.TemporaryDirectory(prefix='pharmanudge-postfix01-') as temp:
            vault=c.Vault(Path(temp));engine=runtime.Runtime(vault)
            try:
                token=uuid.uuid4().hex[:16]
                # Image-only file inventory. Alarm bounds this harmless interpreter;
                # it is not the revised warden, a coder or a provider-backed process.
                code="import signal,os,json;signal.alarm(5);print(json.dumps([os.path.join(p,n) for p,ds,fs in os.walk('/opt') for n in fs if os.access(os.path.join(p,n),os.X_OK)]))"
                args=['create','--name=pn-postfix01-probe-'+token,'--pull=never','--network=none','--read-only',
                  '--cap-drop=ALL','--security-opt=no-new-privileges=true','--user=65534:65534','--memory=64m',
                  '--memory-swap=64m','--pids-limit=16','--label=pharmanudge.job='+token,
                  '--label=pharmanudge.postfix01=preflight','--entrypoint=/usr/local/bin/python3',
                  *clear,image,'-I','-S','-B','-c',code]
                probe=self.create(args,token)
                executables=c.s.decode(self.docker('start','-a',probe))
                c.require(isinstance(executables,list) and all(isinstance(x,str) and x.startswith('/opt/') for x in executables),'image_inventory')
                token=uuid.uuid4().hex[:16];job=Path(temp)/token;job.mkdir(mode=0o700)
                (job/'inputs/source').mkdir(mode=0o755,parents=True)
                (job/'inputs/source/dummy.txt').write_text('SYNTHETIC qualification input only\n')
                # Representative stopped plan only: this path is NOT installed or run.
                p=c.proposal(source_sha,'0'*40,time.time(),time.time()+60)
                p['entrypoint']=['/opt/pharmanudge-qualification-fixture']
                (job/'inputs/entry.json').write_text(json.dumps(p['entrypoint']))
                args=runtime.plan(p,job,token,time.time()+30)
                args[1:1]=clear
                cid=self.create(args,token)
                obj=c.s.decode(self.docker('inspect',cid))[0]
                c.require(obj['State']['Running'] is False,'stopped_plan_unexpectedly_running')
                try:engine.verify_container(p,job,token);verified=True;rejection=None
                except c.Denied as exc:verified=False;rejection=str(exc)
                result=assess(executables,verified)
                result.update(native_executed=True,source_sha=source_sha,image_id=image,
                  runtime_source_sha=source_sha,existing_opt_fixture_present=bool(executables),
                  stopped_current_plan_created=True,current_verify_container_accepted=verified,
                  current_verify_container_rejection=rejection,
                  inherited_image_label_present=bool(set(obj['Config']['Labels'])-{'pharmanudge.handoff','pharmanudge.job'}),
                  coding_runtime_started=False,provider_calls=0)
            finally:self.cleanup()
        c.b.SourceIdentity(ROOT).verify(source_sha)
        result['created_containers_removed']=True
        return result


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('status','native'))
    parser.add_argument('--allow-harmless-preflight',action='store_true')
    parser.add_argument('--source-sha')
    args=parser.parse_args(argv)
    if args.action=='status':print(json.dumps(status(),sort_keys=True));return 2
    c.require(args.allow_harmless_preflight and c.s.hexdigest(args.source_sha,40),'native_permission_and_source_pin_required')
    result=Native().run(args.source_sha)
    print(json.dumps(result,sort_keys=True));return 2

if __name__=='__main__':raise SystemExit(main())

