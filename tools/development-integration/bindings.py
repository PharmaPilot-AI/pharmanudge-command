"""Concrete read-only control bindings. No inference or remote publisher implementation."""
import contextlib
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys

SPEC=importlib.util.spec_from_file_location('handoff03_safety',Path(__file__).parent.parent/'development-handoff/handoff.py')
assert SPEC and SPEC.loader
safety=importlib.util.module_from_spec(SPEC);sys.modules[SPEC.name]=safety;SPEC.loader.exec_module(safety)
Denied=safety.Denied
require=safety.require
REPO=safety.REPO


def digest(value):return safety.digest(value)


class Command:
    """Trusted operator CLI calls only; never a worker/model launcher."""
    def __init__(self,env=None):self.env=env
    def run(self,argv,*,timeout=10,cwd=None):
        try:
            proc=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                                  start_new_session=True,env=self.env,cwd=cwd)
        except OSError:raise Denied('command_unavailable') from None
        try:
            output,_=proc.communicate(timeout=timeout)
            require(proc.returncode==0 and len(output)<=4*1024*1024,'command_failed_or_oversized')
            return output
        except subprocess.TimeoutExpired:raise Denied('command_timeout') from None
        finally:
            with contextlib.suppress(ProcessLookupError):os.killpg(proc.pid,signal.SIGKILL)
            proc.wait(timeout=3)
            if proc.stdout:proc.stdout.close()


class GitHubIngress:
    def __init__(self,api=None):self.api=api or self._api
    @staticmethod
    def _api(endpoint):
        raw=Command().run(['gh','api','--hostname','github.com',endpoint])
        return safety.decode(raw)
    def comment(self,comment_id):
        require(safety.integer(comment_id,1,2**63-1),'invalid_comment_id')
        return self.api(f'repos/{REPO}/issues/comments/{comment_id}')
    def issue(self,issue):
        require(safety.integer(issue,1,2**63-1),'invalid_issue_id')
        return self.api(f'repos/{REPO}/issues/{issue}')
    def comments(self):
        rows=[]
        for page in range(1,11):
            batch=self.api(f'repos/{REPO}/issues/4/comments?per_page=25&page={page}')
            require(isinstance(batch,list) and len(batch)<=25,'invalid_page')
            rows.extend(batch)
            if len(batch)<25:
                ids=[x['id'] for x in rows]
                require(all(safety.integer(x,1,2**63-1) for x in ids) and len(ids)==len(set(ids)),'duplicate_comment')
                return rows
        raise Denied('incomplete_pagination')
    def authorize(self,config,comment_id):
        require(config.get('enabled') is True and config.get('dry_run') is False,'ingress_disabled')
        p=safety.validate_policy(config['policy']);raw=self.comment(comment_id)
        require(raw.get('issue_url')==f'https://api.github.com/repos/{REPO}/issues/4','wrong_thread')
        row=dict(id=raw['id'],repo=REPO,thread=4,action='created',user=raw['user'],
                 created_at=raw['created_at'],updated_at=raw['updated_at'],body=raw['body'])
        assignment=safety.parse_assignment(row,p);issue=self.issue(assignment['issue'])
        require('pull_request' not in issue and issue['state']=='open' and issue['number']==p['issue'],'task_state')
        require(issue['user']['id']==p['task_author_id'] and issue['user']['login']==p['task_author_login'],'task_author')
        require(isinstance(issue['body'],str) and len(issue['body'].encode())<=16384 and
                hashlib.sha256(issue['body'].encode()).hexdigest()==p['task_body_sha256'],'task_body')
        main=self.api(f'repos/{REPO}/git/ref/heads/main')
        require(main['object']['sha']==p['base_commit'],'remote_base_changed')
        return {'assignment':assignment,'record_sha256':digest(row),'task_body':issue['body']}


class SourceIdentity:
    def __init__(self,root):self.root=Path(root)
    def verify(self,expected):
        require(safety.hexdigest(expected,40),'invalid_source_pin')
        cmd=Command();base=['git','--no-optional-locks','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null']
        head=cmd.run(base+['rev-parse','HEAD'],cwd=self.root).decode().strip()
        require(head==expected,'source_pin')
        require(not cmd.run(base+['status','--porcelain','--untracked-files=normal'],cwd=self.root).strip(),'source_dirty')
        return head


class LegacyGuard:
    """Read-only predecessor fingerprint, no bootstrap/reconcile/write operation."""
    def __init__(self,config,state,expected_state):
        self.config=Path(config);self.state=Path(state);self.expected=Path(expected_state)
    @contextlib.contextmanager
    def exclusive(self):
        require(self.state.absolute()==self.expected.absolute() and self.state.resolve()==self.expected.absolute(),'legacy_identity')
        fd=os.open(str(self.state)+'.lock',os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            require(stat.S_ISREG(os.fstat(fd).st_mode),'legacy_lock_type')
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise Denied('legacy_busy') from None
            yield
        finally:os.close(fd)
    def inspect(self):
        require(self.state.absolute()==self.expected.absolute() and self.state.resolve()==self.expected.absolute(),'legacy_identity')
        require(not self.config.is_symlink() and not self.state.is_symlink(),'legacy_alias')
        cfg=safety.read_json(self.config);data=safety.read_json(self.state)
        require(cfg.get('enabled') is False and cfg.get('dry_run') is True,'legacy_enabled')
        require(not os.path.lexists(self.state.parent/'STOP'),'legacy_stop')
        require(set(data)=={'version','claims','days'} and type(data['version']) is int and data['version']==1,'legacy_schema')
        require(isinstance(data['claims'],dict) and isinstance(data['days'],dict),'legacy_schema')
        counted={}
        for key,c in data['claims'].items():
            require(isinstance(key,str) and re.fullmatch(r'[1-9][0-9]*:[0-9a-f]{64}',key) and isinstance(c,dict),'legacy_claim')
            require(c.get('status') in ('review-needed','failed','blocker','reconciled'),'legacy_unresolved')
            day=c['day'];require(datetime.date.fromisoformat(day).isoformat()==day,'legacy_day')
            counted[day]=counted.get(day,0)+1
        require(counted=={d:n for d,n in data['days'].items() if n} and all(type(n) is int and 0<=n<=4 for n in data['days'].values()),'legacy_budget')
        return {'sha256':digest({'config':cfg,'state':data}),'consumed_keys':tuple(data['claims']),'daily_charges':data['days']}


class CodexBudget:
    provider='openai-codex'
    model='gpt-6.1-sol'
    def reserve(self,provider,model,microusd):
        # OAuth/plan quotas are not an authenticated atomic USD reservation API.
        raise Denied('hard_spend_capability_unavailable')


def live_status():
    return {'live_enabled':False,'provider':'openai-codex','model':'gpt-6.1-sol',
            'hard_usd_reservation_available':False,'automatic_pickup_active':False,
            'worker_entrypoint_available':False,'publication_enabled':False}


import time
import uuid
from dataclasses import dataclass

IMAGE='sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038'
KINDS=('basic','produce','validate','cpu','memory','pids','guard-attack','wait')

@dataclass(frozen=True)
class Job:
    token:str
    root:Path
    kind:str
    expires_at:float


class DockerSandbox:
    """Zero-inference fixed-fixture adapter only. No arbitrary worker argv."""
    def __init__(self,root,command=None):
        self.root=Path(root).absolute()
        require(self.root.resolve()==self.root and self.root.is_dir(),'unsafe_scratch')
        self.command=command or Command({'HOME':str(self.root),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
        self.jobs={};self.environment_names=()
        (self.root/'docker-client').mkdir(mode=0o700,exist_ok=True)
    def docker(self,*args,timeout=10):
        return self.command.run(['/usr/bin/docker','--host=unix:///var/run/docker.sock',
             '--config',str(self.root/'docker-client'),*args],timeout=timeout)
    def prepare(self,kind,ttl):
        require(kind in KINDS and type(ttl) is int and 3<=ttl<=15,'qualification_scope')
        controls=self.root/'host-controls';controls.mkdir(mode=0o700,exist_ok=True)
        canary=controls/'credential-canary'
        if not canary.exists():canary.write_text('SYNTHETIC_NOT_A_SECRET');canary.chmod(0o600)
        token=uuid.uuid4().hex;root=self.root/token;root.mkdir(mode=0o700)
        for name in ('inputs','lease','status','out'):(root/name).mkdir(mode=0o755)
        (root/'inputs/readonly.txt').write_text('synthetic read-only input')
        (root/'inputs/readonly.txt').chmod(0o666)
        job=Job(token,root,kind,time.time()+ttl);self.jobs[token]=job
        (root/'lease/lease.json').write_text(json.dumps({'job':token,'kind':kind,'expires_at':job.expires_at,'forbidden_host_path':str(canary)}))
        (root/'lease/lease.json').chmod(0o444)
        return job
    def owned(self,job):require(type(job) is Job and self.jobs.get(job.token) is job,'foreign_job')
    @staticmethod
    def name(job):return 'pn-h3-'+job.token
    def argv(self,job):
        self.owned(job)
        args=['create','--name='+self.name(job),'--pull=never','--network=none','--read-only',
          '--cap-drop=ALL','--security-opt=no-new-privileges=true','--user=65534:65534','--cgroupns=private',
          '--memory=64m','--memory-swap=64m','--cpus=0.25','--pids-limit=16','--stop-timeout=1',
          '--label=pharmanudge.qualification=03','--label=pharmanudge.job='+job.token,
          '--entrypoint=/usr/local/bin/python3',
          '--tmpfs=/work:rw,noexec,nosuid,nodev,size=16m,mode=1777']
        mounts=[(Path(__file__).with_name('guest.py'),'/guard.py',True),
                (job.root/'inputs','/inputs',True),(job.root/'lease','/lease',True),
                (job.root/'status','/status',False),(job.root/'out','/out',False)]
        for src,dst,ro in mounts:
            args+=['--mount','type=bind,src='+str(src)+',dst='+dst+(',readonly' if ro else '')]
        for key in self.environment_names:
            require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}',key),'image_environment')
            args+=['--env',key+'=']
        args+=['--env','HOME=/work','--env','PATH=/usr/local/bin:/usr/bin:/bin','--env','LANG=C.UTF-8',
               IMAGE,'-I','-S','-B','/guard.py',job.kind]
        return args

    def start(self,job):
        self.owned(job);require(not os.path.lexists(job.root/'intent.json'),'start_already_attempted')
        require(time.time()<job.expires_at,'job_expired')
        sock=Path('/var/run/docker.sock').stat()
        require(stat.S_ISSOCK(sock.st_mode) and sock.st_uid==0,'docker_channel_untrusted')
        require(self.docker('image','inspect',IMAGE,'--format','{{.Id}}').decode().strip()==IMAGE,'image_missing')
        names=self.docker('image','inspect',IMAGE,'--format','{{range .Config.Env}}{{println (index (split . "=") 0)}}{{end}}').decode().split()
        require(len(names)<=64,'image_environment_limit');self.environment_names=tuple(names)
        for folder in ('out','status'):os.chown(job.root/folder,65534,65534);(job.root/folder).chmod(0o700)
        require(time.time()<job.expires_at,'job_expired')
        safety.atomic_json(job.root/'intent.json',{'phase':'create-attempted','job':job.token})
        container=self.docker(*self.argv(job)).decode().strip()
        require(re.fullmatch(r'[0-9a-f]{64}',container),'container_identity')
        safety.atomic_json(job.root/'intent.json',{'phase':'start-attempted','job':job.token,'container':container})
        self.docker('start',self.name(job));return container
    def metadata(self,job):
        self.owned(job)
        obj=json.loads(self.docker('inspect',self.name(job)))[0]
        require(obj['Config']['Labels'].get('pharmanudge.job')==job.token and
                obj['Config']['Labels'].get('pharmanudge.qualification')=='03','container_not_owned')
        return obj
    def inspect(self,job):
        obj=self.metadata(job)
        c=obj['HostConfig']
        require(obj['Image']==IMAGE and obj['Config']['User']=='65534:65534' and c['ReadonlyRootfs']
                and c['NetworkMode']=='none' and c['Memory']==67108864 and c['MemorySwap']==67108864
                and c['NanoCpus']==250000000 and c['PidsLimit']==16 and not c['Privileged']
                and c['CapDrop']==['ALL'] and not c.get('CapAdd') and c['PidMode'] in ('','private')
                and 'no-new-privileges=true' in c['SecurityOpt'],'sandbox_configuration')
        wanted={'/guard.py':(str(Path(__file__).with_name('guest.py')),False),
                '/inputs':(str(job.root/'inputs'),False),'/lease':(str(job.root/'lease'),False),
                '/status':(str(job.root/'status'),True),'/out':(str(job.root/'out'),True)}
        actual={m['Destination']:(m['Source'],m['RW']) for m in obj['Mounts']}
        require(actual==wanted,'unexpected_host_mount')
        return obj
    @staticmethod
    def status(path):
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            info=os.fstat(fd);require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=16384,'invalid_status')
            raw=os.read(fd,16385);require(len(raw)<=16384,'status_limit');return safety.decode(raw)
        finally:os.close(fd)
    def seal(self,job):
        self.owned(job)
        while time.time()<job.expires_at:
            self.inspect(job)
            try:state=self.status(job.root/'status/guard.json')
            except FileNotFoundError:state=None
            if state and state.get('phase')=='sealed':
                require(state.get('job')==job.token and state.get('kind')==job.kind,'seal_identity')
                code="import os,json; print(json.dumps(sorted(int(n) for n in os.listdir('/proc') if n.isdigit() and int(n)!=os.getpid())))"
                pids=json.loads(self.docker('exec',self.name(job),'/usr/local/bin/python3','-I','-S','-B','-c',code))
                require(pids==[1],'unsealed_workers_remain')
                self.inspect(job)
                return state
            time.sleep(.05)
        raise Denied('seal_deadline')
    def stop(self,job):
        self.owned(job);(job.root/'lease/STOP').touch(mode=0o444,exist_ok=False)
    def cleanup(self,job):
        self.owned(job)
        try:self.metadata(job)
        except Denied:
            # Refuse deleting a foreign object; only an absent exact job is clean.
            ids=self.docker('ps','-aq','--filter','name=^/'+self.name(job)+'$').strip()
            require(not ids,'cleanup_ownership_unverified');return
        self.docker('rm','-f',self.name(job))
    def run_fixture(self,kind,ttl=10):
        job=self.prepare(kind,ttl)
        try:
            self.start(job);return self.seal(job)['evidence']
        finally:self.cleanup(job)

    def wait_child_ready(self,job):
        self.owned(job)
        while time.time()<job.expires_at:
            try:return self.status(job.root/'status/child_ready.json')
            except FileNotFoundError:time.sleep(.05)
        raise Denied('child_not_ready')
    def host_pids(self,job):
        self.inspect(job)
        lines=self.docker('top',self.name(job),'-eo','pid').decode().splitlines()[1:]
        return [int(line.strip()) for line in lines if line.strip()]
    @staticmethod
    def executing(pid):
        try:return Path('/proc/'+str(pid)+'/stat').read_text().split(') ',1)[1].split()[0] not in ('Z','X')
        except FileNotFoundError:return False
    def wait_exited(self,job):
        self.owned(job)
        while time.time()<job.expires_at+3:
            info=self.metadata(job)
            if not info['State']['Running']:
                require(info['State']['Pid']==0,'container_init_unreaped');return info['State']['ExitCode']
            time.sleep(.05)
        raise Denied('independent_expiry_failed')

    def recover(self,token):
        require(isinstance(token,str) and re.fullmatch(r'[0-9a-f]{32}',token),'invalid_recovery')
        root=self.root/token;require(root.resolve()==root.absolute() and root.stat().st_uid==os.getuid(),'unsafe_recovery')
        path=root/'lease/lease.json';info=path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode & 0o022,'unsafe_lease')
        lease=self.status(path)
        require(set(lease)=={'job','kind','expires_at','forbidden_host_path'} and lease['job']==token and lease['kind'] in KINDS
                and safety.timestamp(lease['expires_at']),'lease_schema')
        job=Job(token,root,lease['kind'],lease['expires_at']);self.jobs[token]=job
        return job


import fcntl


def implementation_digest():
    here=Path(__file__).parent
    files=[here/'bindings.py',here/'guest.py',here.parent/'development-handoff/handoff.py']
    return digest({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files})


class SyntheticInbox:
    """Explicitly synthetic transport; never impersonates a GitHub-issued task."""
    def assignment(self,base):
        body='Produce the fixed harmless qualification output; do not interpret repository prose.'
        return {'realm':'synthetic-zero-call','assignment_id':str(uuid.uuid4()),'body_sha256':hashlib.sha256(body.encode()).hexdigest(),
                'source_tree_sha256':implementation_digest(),'base_commit':base,'max_starts':1,'provider_calls_allowed':0}


class PublisherTranslation:
    def prepare(self,manifest,review,assignment,producer,validator):
        require(producer!=validator and review.get('reviewer_role')=='isolated-fixture-validator'
                and review.get('approved') is True and review.get('manifest_sha256')==digest(manifest),'independent_validation_required')
        require(assignment['realm']=='synthetic-zero-call' and assignment['source_tree_sha256']==implementation_digest(),'source_changed')
        return {'phase':'publication-prepared','starts':1,'provider_calls':0,'publication_enabled':False,
                'qualification_only':True,'remote_target':None,'assignment':assignment,'manifest':manifest,
                'manifest_sha256':digest(manifest),'evidence_sha256':digest(review),
                'producer_job':producer,'validator_job':validator,
                'historical_publisher_invoked':False}


class QualificationPipeline:
    """One disposable, zero-inference assignment lifecycle; no live dispatch route."""
    def __init__(self,root,inbox=None,sandbox_factory=DockerSandbox):
        self.root=Path(root).absolute();require(self.root.resolve()==self.root and self.root.is_dir(),'unsafe_pipeline_root')
        self.inbox=inbox or SyntheticInbox();self.sandbox_factory=sandbox_factory
        self.state=self.root/'qualification.json'
    def run(self):
        fd=os.open(self.root/'qualification.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise Denied('qualification_busy') from None
            require(not os.path.lexists(self.state),'qualification_consumed_or_unknown')
            return self._run()
        finally:os.close(fd)
    def _run(self):
        repo=self.root/'operator-result';repo.mkdir(mode=0o700)
        env={'HOME':str(self.root),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
        command=Command(env)
        def git(*args):return command.run(['/usr/bin/git','-c','core.hooksPath=/dev/null',*args],cwd=repo).decode().strip()
        git('init','-q');initial=repo/'src/routes/login.tsx';initial.parent.mkdir(parents=True);initial.write_text('synthetic baseline')
        git('add','--','src/routes/login.tsx')
        git('-c','user.name=Qualification','-c','user.email=qualification@example.invalid','-c','commit.gpgsign=false','commit','-q','-m','synthetic local baseline')
        assignment=self.inbox.assignment(git('rev-parse','HEAD'))
        require(set(assignment)=={'realm','assignment_id','body_sha256','source_tree_sha256','base_commit','max_starts','provider_calls_allowed'}
                and assignment['realm']=='synthetic-zero-call' and safety.uid(assignment['assignment_id'])
                and assignment['max_starts']==1 and type(assignment['max_starts']) is int
                and assignment['provider_calls_allowed']==0 and type(assignment['provider_calls_allowed']) is int
                and assignment['source_tree_sha256']==implementation_digest() and safety.hexdigest(assignment['body_sha256'],64),'synthetic_assignment')
        record={'phase':'claimed','starts':1,'assignment':assignment,'provider_calls':0}
        safety.atomic_json(self.state,record,exclusive=True)
        runtime=self.root/'sandboxes';runtime.mkdir(mode=0o700);sandbox=self.sandbox_factory(runtime);jobs=[]
        try:
            producer=sandbox.prepare('produce',10);jobs.append(producer)
            record.update(phase='start-attempted',producer_job=producer.token);safety.atomic_json(self.state,record)
            sandbox.start(producer);sealed=sandbox.seal(producer)
            require(sealed['kind']=='produce' and sealed['job']==producer.token,'producer_seal')
            # Real descriptor/alias/UTF-8/size checks, then captured bytes only.
            data=safety.payloads(producer.root/'out',safety.PATHS)
            quarantine=self.root/'quarantine';quarantine.mkdir(mode=0o700)
            for name,raw in data.items():
                for directory in (quarantine,repo):
                    target=directory/name;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                    with target.open('wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
                    target.chmod(0o600)
            sandbox.cleanup(producer);jobs.remove(producer)
            git('add','--',*safety.PATHS)
            status=command.run(['/usr/bin/git','diff','--cached','--no-ext-diff','--no-textconv','--no-renames','--name-status','-z',assignment['base_commit']],cwd=repo).decode().split('\0')
            changes=dict(zip(status[1::2],status[::2]));require(set(changes)==set(safety.PATHS) and all(v in ('A','M') for v in changes.values()),'translation_changes')
            manifest=[{'path':name,'sha256':hashlib.sha256(raw).hexdigest(),'size':len(raw),'mode':'100644','change':changes[name]} for name,raw in data.items()]
            record.update(phase='sealed',manifest_sha256=digest(manifest));safety.atomic_json(self.state,record)
            validator=sandbox.prepare('validate',10);jobs.append(validator)
            for name,raw in data.items():
                target=validator.root/'inputs'/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw);target.chmod(0o444)
            (validator.root/'inputs/manifest.json').write_text(json.dumps({'files':manifest}))
            sandbox.start(validator);validated=sandbox.seal(validator)
            require(validated['kind']=='validate' and validated['job']==validator.token,'reviewer_seal')
            review=validated['evidence'];record.update(phase='independently-validated',evidence_sha256=digest(review));safety.atomic_json(self.state,record)
            result=PublisherTranslation().prepare(manifest,review,assignment,producer.token,validator.token)
            safety.atomic_json(self.state,result)
            return result
        except BaseException:
            record['phase']='unknown';safety.atomic_json(self.state,record)
            raise Denied('qualification_held_no_retry') from None
        finally:
            for job in jobs:sandbox.cleanup(job)


class PaidAdmission:
    """Compose concrete identity/legacy/ingress checks, then hard-deny unfunded inference."""
    def __init__(self,source,legacy,ingress=None):
        self.source=source;self.legacy=legacy;self.ingress=ingress or GitHubIngress()
    def check(self,config,comment_id):
        require(config.get('enabled') is True and config.get('dry_run') is False,'paid_dispatch_disabled')
        self.source.verify(config['policy']['control_source_sha'])
        with self.legacy.exclusive():
            predecessor=self.legacy.inspect()
            require(predecessor['sha256']==config['legacy_sha256'],'legacy_changed')
            ticket=self.ingress.authorize(config,comment_id);a=ticket['assignment']
            require(str(a['issue'])+':'+a['task_body_sha256'] not in predecessor['consumed_keys'],'legacy_task_consumed')
            CodexBudget().reserve('openai-codex','gpt-6.1-sol',1000000)
            raise Denied('paid_dispatch_not_implemented_without_verified_budget')
