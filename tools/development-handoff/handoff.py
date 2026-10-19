"""Offline development handoff controls. Live capabilities are deliberately unavailable."""
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import uuid

REPO='PharmaPilot-AI/pharmanudge-command'
AUTHOR_ID=319955168
AUTHOR_LOGIN='PharmaPilot-AI'
ASSIGNMENT_MARKER='PHARMANUDGE-TASK-AUTH-V1'
RUNNER_REFERENCE='3babd020119b87f0079df6706f02062cb72c7b9e'
PATHS=('src/lib/auth/login-native-fallback.test.cjs','src/routes/login.tsx')
CAPS=dict(max_polls=12,poll_seconds=300,max_starts=1,worker_seconds=1200,
          grace_seconds=30,max_turns=30,max_cost_microusd=1000000)
POLICY_KEYS={'version','approved','window_id','control_source_sha','runner_reference_sha',
 'base_commit','issue','task_author_id','task_author_login','task_body_sha256','paths',
 'not_before','not_after','provider','model',*CAPS}
ASSIGNMENT_KEYS={'execution_window_id','assignment_id','repo','issue','author_id','author_login',
 'task_body_sha256','base_commit','runner_source_sha','executor_source_sha','policy_sha256'}

class Denied(ValueError):
    """Static sanitized reason, never raw input or adapter output."""

def require(ok,code='invalid_control'):
    if not ok:raise Denied(code)

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()).hexdigest()

def unique(pairs):
    out={}
    for key,value in pairs:
        require(key not in out,'duplicate_json_key');out[key]=value
    return out

def decode(raw):
    try:
        require(isinstance(raw,(str,bytes)) and len(raw)<=1024*1024,'input_limit')
        return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:require(False,'invalid_json'))
    except (ValueError,TypeError,RecursionError,UnicodeError):raise Denied('invalid_json') from None

def uid(value):
    try:return isinstance(value,str) and str(uuid.UUID(value))==value
    except ValueError:return False

def hexdigest(value,size):
    return isinstance(value,str) and re.fullmatch('[0-9a-f]{'+str(size)+'}',value) is not None

def integer(value,low,high):return type(value) is int and low<=value<=high

def timestamp(value):return type(value) in (int,float) and math.isfinite(value) and value>=0

def validate_policy(p):
    require(isinstance(p,dict) and set(p)==POLICY_KEYS,'policy_schema')
    require(type(p['approved']) is bool and p['approved'],'execution_not_approved')
    require(type(p['version']) is int and p['version']==1)
    require(uid(p['window_id']) and hexdigest(p['control_source_sha'],40) and hexdigest(p['base_commit'],40))
    require(p['runner_reference_sha']==RUNNER_REFERENCE)
    require(integer(p['issue'],1,2**63-1) and type(p['task_author_id']) is int and p['task_author_id']==AUTHOR_ID
            and p['task_author_login']==AUTHOR_LOGIN)
    require(hexdigest(p['task_body_sha256'],64))
    require(p['paths']==list(PATHS),'path_scope')
    require(timestamp(p['not_before']) and timestamp(p['not_after'])
            and 0<p['not_after']-p['not_before']<=3600,'window_bounds')
    require(all(type(p[k]) is int and p[k]==v for k,v in CAPS.items()),'unsupported_caps')
    require(p['provider']=='openai-codex' and p['model']=='gpt-6.1-sol','model_pin')
    return p

def parse_assignment(comment,p):
    validate_policy(p)
    require(isinstance(comment,dict),'comment_schema')
    require(comment.get('repo')==REPO and type(comment.get('thread')) is int and comment['thread']==4
            and comment.get('action')=='created','origin_pin')
    user=comment.get('user')
    require(isinstance(user,dict) and type(user.get('id')) is int and user['id']==AUTHOR_ID
            and user.get('login')==AUTHOR_LOGIN,'coordinator_pin')
    require(integer(comment.get('id'),1,2**63-1),'comment_identifier')
    created=comment.get('created_at')
    require(isinstance(created,str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ',created)
            and comment.get('updated_at')==created,'edited_record')
    from datetime import datetime,timezone
    try:created_seconds=datetime.strptime(created,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()
    except ValueError:raise Denied('invalid_creation_time') from None
    require(p['not_before']<=created_seconds<p['not_after'],'stale_assignment')
    body=comment.get('body')
    try:require(isinstance(body,str) and len(body.encode('utf-8'))<=16384,'body_limit')
    except UnicodeError:raise Denied('invalid_unicode') from None
    prefix=ASSIGNMENT_MARKER+'\n';require(body.startswith(prefix),'unsupported_marker')
    obj=decode(body[len(prefix):]);require(isinstance(obj,dict) and set(obj)==ASSIGNMENT_KEYS,'assignment_schema')
    expected=dict(execution_window_id=p['window_id'],repo=REPO,issue=p['issue'],author_id=p['task_author_id'],
       author_login=p['task_author_login'],task_body_sha256=p['task_body_sha256'],base_commit=p['base_commit'],
       runner_source_sha=p['runner_reference_sha'],executor_source_sha=p['control_source_sha'],policy_sha256=digest(p))
    require(uid(obj['assignment_id']),'assignment_identifier')
    require(type(obj['issue']) is int and type(obj['author_id']) is int)
    require(all(obj[k]==v for k,v in expected.items()),'assignment_pin')
    return obj


import contextlib
import fcntl
import os
import tempfile

STATE_ROOT=Path.home()/'.local/state/pharmanudge-development-handoff'
PHASES=('ready','admitted','claimed','starting','output-pending','exporting','review-needed','reviewing','reviewed','unknown','blocked','stopped','expired')

def read_json(path):
    try:
        require(not path.is_symlink(),'unsafe_control_file')
        with path.open('rb') as stream:raw=stream.read(1024*1024+1)
        return decode(raw)
    except OSError:raise Denied('control_unreadable') from None

def atomic_json(path,value,exclusive=False):
    raw=(json.dumps(value,sort_keys=True,allow_nan=False)+'\n').encode()
    require(len(raw)<=1024*1024,'control_limit')
    fd,name=tempfile.mkstemp(prefix='.pending-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:
            os.fchmod(stream.fileno(),0o600);stream.write(raw);stream.flush();os.fsync(stream.fileno())
        if exclusive:os.link(name,path)
        else:os.replace(name,path)
        dfd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(dfd)
        finally:os.close(dfd)
    finally:
        if os.path.lexists(name):os.unlink(name)

class Store:
    """One canonical one-task trial vault. No reset, alternate-root CLI or renewal."""
    def __init__(self,root=None):
        self.root=Path(root) if root is not None else STATE_ROOT
        self.path=self.root/'state.json'

    @contextlib.contextmanager
    def locked(self):
        require(self.root.resolve()==self.root.absolute(),'unsafe_control_root')
        self.root.mkdir(mode=0o700,parents=True,exist_ok=True);self.root.chmod(0o700)
        fd=os.open(self.root/'lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        try:
            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise Denied('overlap') from None
            yield
        finally:os.close(fd)

    def validate(self,s):
        keys={'version','policy','policy_sha256','armed_at','expires_at','last_clock','next_poll_at',
              'polls','starts','cursor','phase','enabled','dry_run','claim','legacy_sha256'}
        require(isinstance(s,dict) and set(s)==keys,'state_schema')
        require(s['legacy_sha256'] is None or hexdigest(s['legacy_sha256'],64))
        p=validate_policy(s['policy'])
        require(type(s['version']) is int and s['version']==1 and s['policy_sha256']==digest(p))
        require(all(timestamp(s[k]) for k in ['armed_at','expires_at','last_clock','next_poll_at']))
        require(p['not_before']<=s['armed_at']<s['expires_at']<=p['not_after']
                and s['expires_at']-s['armed_at']<=3600 and s['last_clock']>=s['armed_at'])
        require(integer(s['polls'],0,12) and integer(s['starts'],0,1) and integer(s['cursor'],0,2**63-1))
        require(type(s['enabled']) is bool and type(s['dry_run']) is bool)
        require(s['phase'] in PHASES)
        c=s['claim']
        if c is None:require(s['starts']==0 and s['phase'] in ('ready','blocked','stopped','expired'))
        else:
            fields={'key','assignment_id','comment_id','comment_sha256','charged','budget_state','process_state','grant_id','output_id','manifest_sha256','evidence_sha256'}
            require(isinstance(c,dict) and set(c)==fields,'claim_schema')
            require(c['key']==str(p['issue'])+':'+p['task_body_sha256'] and uid(c['assignment_id']))
            require(integer(c['comment_id'],1,2**63-1) and hexdigest(c['comment_sha256'],64))
            require(type(c['charged']) is bool and s['starts']==int(c['charged']))
            require(c['budget_state'] in ('not-attempted','attempted','acquired')
                    and c['process_state'] in ('not-attempted','attempted','finished'))
            require(c['grant_id'] is None or uid(c['grant_id']))
            require(c['output_id'] is None or uid(c['output_id']))
            require(all(c[k] is None or hexdigest(c[k],64) for k in ['manifest_sha256','evidence_sha256']))
            require(c['budget_state']=='not-attempted' or c['charged'])
            require(c['process_state']=='not-attempted' or c['budget_state']=='acquired')
            require(c['budget_state']!='acquired' or c['grant_id'] is not None)
            require(c['process_state']!='finished' or c['output_id'] is not None)
        return s

    def read(self):return self.validate(read_json(self.path))
    def save(self,s):atomic_json(self.path,self.validate(s))

    def arm(self,p,now,baseline,legacy_sha256=None):
        validate_policy(p)
        require(not os.path.lexists(self.path) and not os.path.lexists(self.root/'STOP'),'already_initialized_or_stopped')
        require(timestamp(now) and p['not_before']<=now<p['not_after'],'outside_window')
        s=dict(version=1,policy=p,policy_sha256=digest(p),armed_at=now,expires_at=min(p['not_after'],now+3600),
          last_clock=now,next_poll_at=now,polls=0,starts=0,cursor=baseline,phase='ready',enabled=True,dry_run=False,claim=None,legacy_sha256=legacy_sha256)
        self.validate(s);atomic_json(self.path,s,exclusive=True)

    def guard(self,p,now):
        validate_policy(p);s=self.read()
        require(digest(p)==s['policy_sha256'],'immutable_policy_mismatch')
        require(not os.path.lexists(self.root/'STOP') and s['enabled'] and not s['dry_run'],'stopped')
        require(timestamp(now) and s['last_clock']<=now<s['expires_at'],'expired_or_clock_rollback')
        require(s['phase'] not in ('stopped','expired'),'terminal_window')
        s['last_clock']=now
        return s

    def tick(self,p,now):
        s=self.guard(p,now)
        if now<s['next_poll_at']:return False
        require(s['polls']<p['max_polls'],'poll_cap')
        s['polls']+=1;s['next_poll_at']=now+p['poll_seconds'];self.save(s)
        return True

    def stop(self,reason,phase='stopped'):
        require(phase in PHASES)
        s=self.read();s['enabled']=False;s['dry_run']=True;s['phase']=phase;self.save(s)
        if not os.path.lexists(self.root/'STOP'):atomic_json(self.root/'STOP',{'stopped':True},exclusive=True)


from dataclasses import dataclass
from types import MappingProxyType
import time

@dataclass(frozen=True)
class Capability:
    kind:str
    window_id:str
    policy_sha256:str
    expires_at:float
    max_cost_microusd:int

@dataclass(frozen=True)
class LegacySnapshot:
    sha256:str
    claimed_keys:tuple
    unreconciled:bool
    today_starts:int
    execution_disabled:bool
    stop_requested:bool

@dataclass(frozen=True)
class Grant:
    token:str
    window_id:str
    policy_sha256:str
    claim_key:str
    expires_at:float
    max_cost_microusd:int

@dataclass(frozen=True)
class JobPlan:
    argv:tuple
    env:object
    uid:int
    host_mounts:tuple
    network:str
    cpu:int
    memory_bytes:int
    pids:int
    working_directory:str
    run_deadline:float
    kill_deadline:float
    assignment_id:str
    policy_sha256:str
    read_only_root:bool=True
    no_new_privileges:bool=True
    linux_capabilities:tuple=()

@dataclass(frozen=True)
class Outcome:
    status:str
    output_id:str

class UnavailableHost:
    """No live transport, process, isolation, inference or publication implementation."""
    def __getattr__(self,name):
        raise Denied('live_capability_unavailable')

class Controller:
    """Trusted adapter injection only; adapters are never accepted from task/config JSON."""
    def __init__(self,policy,host=None,*,root=None,clock=time.time):
        validate_policy(policy)
        self.policy=decode(json.dumps(policy));self.host=host if host is not None else UnavailableHost()
        self.store=Store(root);self.clock=clock

    def key(self):return str(self.policy['issue'])+':'+self.policy['task_body_sha256']

    def legacy(self):
        x=self.host.legacy()
        require(type(x) is LegacySnapshot and hexdigest(x.sha256,64),'legacy_attestation')
        require(type(x.claimed_keys) is tuple and all(isinstance(k,str) and re.fullmatch(r'[1-9][0-9]*:[0-9a-f]{64}',k) for k in x.claimed_keys))
        require(type(x.unreconciled) is bool and type(x.execution_disabled) is bool
                and integer(x.today_starts,0,4),'legacy_schema')
        require(type(x.stop_requested) is bool and not x.stop_requested and self.host.verify_legacy(x) is True
                and not x.unreconciled and x.execution_disabled,'legacy_hold')
        require(self.key() not in x.claimed_keys and x.today_starts<4,'legacy_duplicate_or_cap')
        return x

    def capabilities(self):
        p=self.policy;now=self.clock();require(self.host.identity()==p['control_source_sha'],'source_pin')
        self.legacy();caps={}
        for kind in ('isolation','budget'):
            c=self.host.attest(kind,p)
            require(type(c) is Capability and c.kind==kind and c.window_id==p['window_id']
                    and c.policy_sha256==digest(p) and timestamp(c.expires_at)
                    and c.expires_at>=p['not_after'] and type(c.max_cost_microusd) is int
                    and c.max_cost_microusd==p['max_cost_microusd'],'capability_binding')
            require(self.host.verify_capability(c,p,now) is True,'unverified_external_enforcement')
            caps[kind]=c
        return caps

    def rows(self):
        result=self.host.comments(REPO,4)
        require(isinstance(result,dict) and set(result)=={'complete','records'}
                and result['complete'] is True and isinstance(result['records'],list)
                and len(result['records'])<=1000,'incomplete_inbox')
        rows=result['records'];ids=[]
        for r in rows:
            require(isinstance(r,dict) and integer(r.get('id'),1,2**63-1),'inbox_record')
            ids.append(r['id'])
        require(len(ids)==len(set(ids)),'duplicate_inbox_identifier')
        return sorted(rows,key=lambda r:r['id'])

    def initialize(self):
        # Attest without creating a vault or consuming a budget. Missing live paths deny.
        self.capabilities()
        with self.store.locked():
            require(not os.path.lexists(self.store.path),'already_initialized')
            rows=self.rows()
            self.store.arm(self.policy,self.clock(),max([0]+[r['id'] for r in rows]),self.legacy().sha256)

    def guard(self):
        s=self.store.guard(self.policy,self.clock());self.capabilities()
        require(s['legacy_sha256']==self.legacy().sha256,'legacy_snapshot_changed')
        self.store.save(s)
        return s

    def verify_task(self):
        p=self.policy;t=self.host.task(REPO,p['issue'])
        require(isinstance(t,dict) and t.get('repo')==REPO and type(t.get('issue')) is int
                and t['issue']==p['issue'] and t.get('state')=='open' and t.get('is_pr') is False,'task_origin')
        require(type(t.get('author_id')) is int and t['author_id']==p['task_author_id']
                and t.get('author_login')==p['task_author_login'],'task_author')
        body=t.get('body')
        try:require(isinstance(body,str) and len(body.encode())<=16384
                    and hashlib.sha256(body.encode()).hexdigest()==p['task_body_sha256'],'task_body_pin')
        except UnicodeError:raise Denied('task_unicode') from None
        require(t.get('main_refs')==[p['base_commit']]*3,'stale_base')
        return body

    def hold(self):
        try:
            s=self.store.read();self.store.stop('hold','unknown' if s['starts'] else 'blocked')
        except (Denied,OSError,TypeError,ValueError):
            if self.store.root.is_dir() and not os.path.lexists(self.store.root/'STOP'):
                atomic_json(self.store.root/'STOP',{'stopped':True},exclusive=True)

    def poll(self):
        with self.store.locked():
            try:
                s=self.store.read()
                if s['phase'] in ('output-pending','review-needed','reviewed'):
                    self.store.guard(self.policy,self.clock());return s['phase']
                require(s['phase'] in ('ready','admitted'),'unknown_or_terminal')
                self.guard()
                if not self.store.tick(self.policy,self.clock()):return 'not-due'
                for row in self.rows():
                    s=self.store.read()
                    if row['id']<=s['cursor']:continue
                    body=row.get('body')
                    if not isinstance(body,str) or not body.startswith(ASSIGNMENT_MARKER+'\n'):
                        s['cursor']=row['id'];self.store.save(s);continue
                    obj=parse_assignment(row,self.policy)
                    self.dispatch(row,obj)
                    return self.store.read()['phase']
                if self.store.read()['polls']>=self.policy['max_polls']:
                    self.store.stop('poll_cap');return 'poll-cap'
                return 'idle'
            except BaseException:
                self.hold();raise Denied('handoff_refused_or_held') from None

    def admit(self,row,obj):
        require(obj==parse_assignment(row,self.policy),'admission_pin')
        self.guard();s=self.store.read()
        # Recover only an admitted but definitely unattempted exact record.
        rh=digest(row)
        if s['claim'] is None:
            s['claim']=dict(key=self.key(),assignment_id=obj['assignment_id'],comment_id=row['id'],
                comment_sha256=rh,charged=False,budget_state='not-attempted',process_state='not-attempted',
                grant_id=None,output_id=None,manifest_sha256=None,evidence_sha256=None)
            s['phase']='admitted';self.store.save(s)
        return s

    def verify_assignment(self,row,obj):
        current=self.host.assignment(REPO,4,row['id'])
        require(parse_assignment(current,self.policy)==obj and digest(current)==digest(row),'assignment_changed')

    def dispatch(self,row,obj):
        self.guard();body=self.verify_task();s=self.admit(row,obj);rh=digest(row)
        c=s['claim']
        require(not c['charged'] and c['assignment_id']==obj['assignment_id']
                and c['comment_id']==row['id'] and c['comment_sha256']==rh,'duplicate_or_uncertain_claim')
        p=self.policy;now=self.clock()
        require(now+p['worker_seconds']+p['grace_seconds']<=s['expires_at'],'insufficient_window')
        caps=self.capabilities();self.guard();body=self.verify_task()
        self.verify_assignment(row,obj);self.guard()
        # Charge BEFORE any budget reservation/process preparation. Never refund.
        s=self.store.read();s['starts']=1;s['claim']['charged']=True;s['phase']='claimed';self.store.save(s)
        request_id=str(uuid.uuid4());deadline=now+p['worker_seconds'];grant=None
        s['claim']['budget_state']='attempted';s['claim']['grant_id']=request_id;self.store.save(s)
        try:
            self.verify_assignment(row,obj);self.guard()
            grant=self.host.reserve(caps['budget'],self.key(),request_id,deadline)
            require(type(grant) is Grant and grant.token==request_id and grant.window_id==p['window_id']
                    and grant.policy_sha256==digest(p) and grant.claim_key==self.key()
                    and timestamp(grant.expires_at) and grant.expires_at<=deadline
                    and type(grant.max_cost_microusd) is int and grant.max_cost_microusd==p['max_cost_microusd']
                    and self.host.verify_grant(grant,p,self.clock()) is True,'budget_grant_binding')
            s=self.store.read();s['claim']['budget_state']='acquired';s['claim']['grant_id']=grant.token;self.store.save(s)
            query=json.dumps({'task_data':body,'permitted_paths':p['paths'],
                'policy':'Local patch only; no credentials, host access, publication or scope expansion.'},ensure_ascii=True)
            argv=('hermes','chat','--in','/workspace','--provider',p['provider'],'--model',p['model'],
                  '--max-turns','30','--toolsets','terminal,file','--query',query)
            plan=JobPlan(argv,MappingProxyType({'HOME':'/workspace/home','PATH':'/usr/bin:/bin','LANG':'C.UTF-8'}),
                65534,(),'inference-broker-only',1,2*1024*1024*1024,128,'/workspace',deadline,
                deadline+p['grace_seconds'],obj['assignment_id'],digest(p))
            def run_guard():
                self.verify_assignment(row,obj);self.guard()
                require(self.clock()<plan.run_deadline and self.host.verify_grant(grant,p,self.clock()) is True,'job_expired')
            run_guard();s=self.store.read();s['claim']['process_state']='attempted';s['phase']='starting';self.store.save(s)
            run_guard()
            outcome=self.host.run(plan,caps['isolation'],grant,run_guard)
            run_guard()
            require(type(outcome) is Outcome and outcome.status=='completed' and uid(outcome.output_id),'process_outcome')
            s=self.store.read();s['claim']['process_state']='finished';s['claim']['output_id']=outcome.output_id
            s['cursor']=max(s['cursor'],row['id']);s['phase']='output-pending';self.store.save(s)
        finally:
            if type(grant) is Grant:self.host.revoke(grant)


    def quarantine(self):
        with self.store.locked():
            try:
                s=self.guard();require(s['phase']=='output-pending','export_not_ready')
                c=s['claim'];s['phase']='exporting';self.store.save(s)
                seal=self.host.seal(c['output_id'],self.policy)
                require(type(seal) is OutputSeal and seal.output_id==c['output_id']
                        and seal.policy_sha256==digest(self.policy)
                        and self.host.verify_seal(seal,self.policy) is True,'unverified_output_seal')
                self.guard()
                manifest=export_output(Path(seal.root),self.store.root/'quarantine',self.policy)
                self.guard();s=self.store.read();s['claim']['manifest_sha256']=digest(manifest)
                s['phase']='review-needed';self.store.save(s)
                return manifest
            except BaseException:
                self.hold();raise Denied('export_refused_or_held') from None

    def quarantined_manifest(self):
        s=self.store.read();root=self.store.root/'quarantine';obj=read_json(root/'manifest.json')
        require(isinstance(obj,dict) and set(obj)=={'version','files','sha256'} and type(obj['version']) is int
                and obj['version']==1,'manifest_schema')
        data=payloads(root,self.policy['paths'],allow_manifest=True)
        actual=[dict(path=path,sha256=hashlib.sha256(raw).hexdigest(),size=len(raw),mode='100644') for path,raw in data.items()]
        require(obj['files']==actual and obj['sha256']==digest(actual)==s['claim']['manifest_sha256'],'quarantine_changed')
        return actual

    def review(self):
        with self.store.locked():
            s=self.guard();require(s['phase']=='review-needed','review_not_ready')
            try:
                manifest=self.quarantined_manifest();s['phase']='reviewing';self.store.save(s)
                stamp=self.host.review(manifest,self.key(),self.policy)
                require(type(stamp) is ReviewStamp and stamp.principal=='independent-reviewer'
                        and stamp.window_id==self.policy['window_id'] and stamp.claim_key==self.key()
                        and stamp.policy_sha256==digest(self.policy) and stamp.manifest_sha256==digest(manifest)
                        and hexdigest(stamp.evidence_sha256,64) and stamp.decision=='approve-draft'
                        and self.host.verify_review(stamp,self.policy) is True,'independent_review_required')
                self.guard();self.quarantined_manifest()
                atomic_json(self.store.root/'review.json',stamp.__dict__,exclusive=True)
                s=self.store.read();s['claim']['evidence_sha256']=stamp.evidence_sha256;s['phase']='reviewed';self.store.save(s)
            except BaseException:
                self.hold();raise Denied('review_refused_or_held') from None

    def publication_plan(self):
        with self.store.locked():
            s=self.guard();require(s['phase']=='reviewed' and hexdigest(s['claim']['evidence_sha256'],64),'unreviewed_output')
            manifest=self.quarantined_manifest();stamp=read_json(self.store.root/'review.json')
            require(stamp['manifest_sha256']==digest(manifest) and stamp['evidence_sha256']==s['claim']['evidence_sha256']
                    and stamp['policy_sha256']==digest(self.policy),'review_binding')
            return dict(status='ready-for-publication-review',ledger_kind='offline-handoff-v1',claim_key=self.key(),
                source_sha=self.policy['control_source_sha'],base_commit=self.policy['base_commit'],paths=list(PATHS),
                quarantine_manifest_sha256=digest(manifest),evidence_sha256=s['claim']['evidence_sha256'],
                publication_enabled=False,draft_only=True)

@dataclass(frozen=True)
class OutputSeal:
    output_id:str
    policy_sha256:str
    root:str

@dataclass(frozen=True)
class ReviewStamp:
    principal:str
    window_id:str
    claim_key:str
    policy_sha256:str
    manifest_sha256:str
    evidence_sha256:str
    decision:str


import stat


def payloads(root,paths,allow_manifest=False):
    root=Path(root)
    require(root.is_dir() and not root.is_symlink() and root.resolve()==root.absolute(),'unsafe_output_root')
    paths=tuple(paths);require(paths==PATHS,'export_scope')
    expected=set(paths);allowed_dirs={str(x) for path in paths for x in PurePosixPath(path).parents if str(x)!='.'}
    found=set()
    for parent,dirs,files in os.walk(root,followlinks=False):
        for name in dirs+files:
            full=Path(parent)/name;rel=full.relative_to(root).as_posix()
            require(not full.is_symlink(),'output_alias')
            if name in dirs:require(rel in allowed_dirs,'unexpected_directory')
            elif allow_manifest and rel=='manifest.json':pass
            else:require(rel in expected,'unexpected_file');found.add(rel)
    require(found==expected,'incomplete_output')
    out={};total=0;rootfd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for path in paths:
            fds=[];current=rootfd
            try:
                for part in PurePosixPath(path).parts[:-1]:
                    fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current);fds.append(fd);current=fd
                fd=os.open(PurePosixPath(path).name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=current);fds.append(fd)
                before=os.fstat(fd)
                require(stat.S_ISREG(before.st_mode) and before.st_nlink==1
                        and before.st_size<=128*1024 and not before.st_mode & 0o111,'output_file_type_or_limit')
                data=bytearray()
                while len(data)<=128*1024:
                    chunk=os.read(fd,min(65536,128*1024+1-len(data)))
                    if not chunk:break
                    data.extend(chunk)
                after=os.fstat(fd)
                require(len(data)<=128*1024 and (before.st_size,before.st_mtime_ns,before.st_ctime_ns)==
                        (after.st_size,after.st_mtime_ns,after.st_ctime_ns),'unstable_output')
                try:data.decode('utf-8')
                except UnicodeError:raise Denied('output_not_utf8') from None
                require(not any(x<32 and x not in (9,10,13) or x==127 for x in data),'output_control_bytes')
                total+=len(data);require(total<=512*1024,'output_total_limit');out[path]=bytes(data)
            finally:
                for fd in reversed(fds):os.close(fd)
    except OSError:raise Denied('output_unreadable') from None
    finally:os.close(rootfd)
    return out


def export_output(source,destination,p):
    """Import bytes into private quarantine, NEVER a result-publisher approval/worktree."""
    validate_policy(p);source=Path(source);destination=Path(destination)
    require(not os.path.lexists(destination),'quarantine_already_exists')
    require(destination.parent.resolve()==destination.parent.absolute(),'unsafe_quarantine_parent')
    require(source.resolve()!=destination.resolve() and source.resolve() not in destination.resolve().parents
            and destination.resolve() not in source.resolve().parents,'overlapping_roots')
    data=payloads(source,p['paths']);manifest=[]
    try:
        os.mkdir(destination,0o700)
        for path,raw in data.items():
            target=destination/path;target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
            manifest.append(dict(path=path,sha256=hashlib.sha256(raw).hexdigest(),size=len(raw),mode='100644'))
        atomic_json(destination/'manifest.json',dict(version=1,files=manifest,sha256=digest(manifest)),exclusive=True)
    except OSError:raise Denied('quarantine_import_failed') from None
    return manifest


@dataclass(frozen=True)
class CallPermit:
    grant_token:str
    request_id:str
    policy_sha256:str
    max_charge_microusd:int
    expires_at:float

@dataclass(frozen=True)
class BilledResult:
    payload:str
    charged_microusd:int

class InferenceGate:
    """Integration with a trusted externally bounded broker, NOT a token-price estimate.

    A real broker MUST atomically reserve a provider-enforced maximum and refuse
    execution beyond that authorization even if this controller disappears.
    The shipped default has no such implementation and cannot make live calls.
    """
    def __init__(self,policy,grant,broker=None,*,root=None,clock=time.time):
        validate_policy(policy);self.policy=decode(json.dumps(policy));self.grant=grant
        require(type(grant) is Grant and uid(grant.token) and grant.window_id==policy['window_id']
                and grant.policy_sha256==digest(policy) and grant.claim_key==str(policy['issue'])+':'+policy['task_body_sha256']
                and type(grant.max_cost_microusd) is int and grant.max_cost_microusd==policy['max_cost_microusd']
                and timestamp(grant.expires_at) and grant.expires_at<=policy['not_after'],'grant_schema')
        self.broker=broker if broker is not None else UnavailableHost();self.clock=clock
        self.store=Store(root if root is not None else STATE_ROOT/'budget'/grant.token)
        self.path=self.store.root/'budget.json'

    def guard(self):
        now=self.clock()
        require(timestamp(now) and self.policy['not_before']<=now<self.grant.expires_at
                and not os.path.lexists(self.store.root/'STOP'),'inference_expired_or_stopped')
        require(self.broker.verify_grant(self.grant,self.policy,self.clock()) is True,'external_budget_unverified')

    def validate(self,s):
        require(isinstance(s,dict) and set(s)=={'version','grant_sha256','reserved_microusd','held','requests'},'budget_state_schema')
        require(type(s['version']) is int and s['version']==1 and s['grant_sha256']==digest(self.grant.__dict__))
        require(type(s['held']) is bool and integer(s['reserved_microusd'],0,self.grant.max_cost_microusd))
        require(isinstance(s['requests'],dict) and len(s['requests'])<=256,'request_limit')
        total=0
        for key,value in s['requests'].items():
            require(uid(key) and isinstance(value,dict) and set(value)=={'phase','reservation','response_sha256'})
            require(value['phase'] in ('authorizing','attempted','complete')
                    and integer(value['reservation'],0,self.grant.max_cost_microusd))
            require(value['response_sha256'] is None or hexdigest(value['response_sha256'],64))
            require(value['phase']!='authorizing' or value['reservation']==0)
            require(value['phase']!='complete' or value['response_sha256'] is not None)
            total+=value['reservation']
        require(total==s['reserved_microusd'],'budget_cross_field')
        return s

    def save(self,s):atomic_json(self.path,self.validate(s))

    def invoke(self,request):
        require(isinstance(request,dict) and set(request)=={'request_id','payload'} and uid(request['request_id']),'inference_schema')
        payload=request['payload']
        try:require(isinstance(payload,str) and len(payload.encode())<=65536,'inference_payload_limit')
        except UnicodeError:raise Denied('inference_unicode') from None
        self.guard()
        with self.store.locked():
            if self.path.exists():s=self.validate(read_json(self.path))
            else:
                s=dict(version=1,grant_sha256=digest(self.grant.__dict__),reserved_microusd=0,held=False,requests={})
                atomic_json(self.path,s,exclusive=True)
            require(not s['held'] and not any(x['phase']!='complete' for x in s['requests'].values()),'uncertain_inference_hold')
            rid=request['request_id'];require(rid not in s['requests'] and len(s['requests'])<256,'duplicate_inference')
            s['requests'][rid]=dict(phase='authorizing',reservation=0,response_sha256=None)
            self.save(s)  # Persist even the remote reservation attempt before invoking it.
            try:
                self.guard();permit=self.broker.authorize_call(self.grant,rid,self.policy)
                require(type(permit) is CallPermit and permit.grant_token==self.grant.token and permit.request_id==rid
                        and permit.policy_sha256==digest(self.policy) and timestamp(permit.expires_at)
                        and self.clock()<permit.expires_at<=self.grant.expires_at
                        and integer(permit.max_charge_microusd,1,self.grant.max_cost_microusd)
                        and self.broker.verify_permit(permit,self.grant,self.policy,self.clock()) is True,'unverified_call_permit')
                require(s['reserved_microusd']+permit.max_charge_microusd<=self.grant.max_cost_microusd,'inference_cap')
                s['reserved_microusd']+=permit.max_charge_microusd
                s['requests'][rid]['reservation']=permit.max_charge_microusd;s['requests'][rid]['phase']='attempted';self.save(s)
                self.guard();require(self.clock()<permit.expires_at,'call_permit_expired')
                result=self.broker.execute_bounded(permit,payload)
                self.guard();require(self.clock()<permit.expires_at,'late_inference_result')
                require(type(result) is BilledResult and integer(result.charged_microusd,0,permit.max_charge_microusd)
                        and isinstance(result.payload,str),'bounded_result_contract')
                raw=result.payload.encode();require(len(raw)<=1024*1024,'model_response_limit')
                s['requests'][rid]['response_sha256']=hashlib.sha256(raw).hexdigest()
                s['requests'][rid]['phase']='complete';self.save(s)
                return result.payload
            except BaseException:
                s['held']=True;self.save(s)
                raise Denied('inference_unknown_or_refused_no_retry') from None


def inspect_draft(draft):
    require(isinstance(draft,dict) and set(draft)=={'enabled','dry_run','policy','assignment'},'draft_schema')
    require(draft['enabled'] is False and draft['dry_run'] is True,'draft_must_remain_disabled')
    p=draft['policy'];a=draft['assignment']
    require(isinstance(p,dict) and set(p)==POLICY_KEYS and p['approved'] is False,'draft_policy')
    require(isinstance(a,dict) and set(a)==ASSIGNMENT_KEYS,'draft_assignment')
    # Validate all known proposal fields without inventing or authorizing missing pins.
    candidate=dict(p,approved=True)
    replacements={'window_id':str(uuid.UUID(int=0)),'control_source_sha':'0'*40,'issue':1,
                  'task_body_sha256':'0'*64,'not_before':0,'not_after':3600}
    for key,value in replacements.items():
        if candidate[key] is None:candidate[key]=value
    validate_policy(candidate)
    require(a['repo']==REPO and a['base_commit']==p['base_commit'] and a['runner_source_sha']==RUNNER_REFERENCE
            and a['author_id']==AUTHOR_ID and type(a['author_id']) is int and a['author_login']==AUTHOR_LOGIN,'draft_authority')
    require(all(a[k] is None for k in ['execution_window_id','assignment_id','issue','task_body_sha256','executor_source_sha','policy_sha256']),
            'draft_execution_pins_must_be_unset')
    require(all(p[k] is None for k in replacements),'draft_live_fields_must_be_unset')
    return dict(valid_disabled_draft=True,live_ready=False,policy_template_sha256=digest(p),assignment_template_sha256=digest(a),
                missing_policy_fields=sorted(replacements),missing_live_bindings=['authenticated-ingress','legacy-exclusive-guard',
                'verified-source-identity','isolated-executor-with-independent-expiry','externally-bounded-budget-broker',
                'sealed-output-attestation','independent-validator','trusted-publication-translation'])

def main(argv=None):
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='action',required=True)
    inspect=sub.add_parser('inspect-draft');inspect.add_argument('path',type=Path)
    sub.add_parser('check-live')
    args=parser.parse_args(argv)
    try:
        if args.action=='check-live':raise Denied('live_capability_unavailable')
        result=inspect_draft(read_json(args.path));print(json.dumps(result,sort_keys=True));return 0
    except (Denied,OSError,ValueError,TypeError,KeyError):
        print(json.dumps({'live_ready':False,'status':'refused_or_capability_unavailable'}));return 2

if __name__=='__main__':raise SystemExit(main())
