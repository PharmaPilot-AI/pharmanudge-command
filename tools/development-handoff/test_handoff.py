import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from typing import Any

SPEC=importlib.util.spec_from_file_location('handoff',Path(__file__).with_name('handoff.py'))
assert SPEC is not None and SPEC.loader is not None and SPEC.origin is not None
h=importlib.util.module_from_spec(SPEC)
if Path(SPEC.origin).exists():
    import sys
    sys.modules['handoff']=h
    SPEC.loader.exec_module(h)

W='11111111-1111-4111-8111-111111111111'
A='22222222-2222-4222-8222-222222222222'
S='a'*40
BASE='e9f9a02870125eefd521b13cbe41cc2e0f39e3c2'
BODY='Synthetic offline task; no accounts or external actions.'
PATHS=['src/lib/auth/login-native-fallback.test.cjs','src/routes/login.tsx']

def policy() -> dict[str,Any]:
    return dict(version=1,approved=True,window_id=W,control_source_sha=S,
      runner_reference_sha='3babd020119b87f0079df6706f02062cb72c7b9e',base_commit=BASE,
      issue=101,task_author_id=319955168,task_author_login='PharmaPilot-AI',
      task_body_sha256=hashlib.sha256(BODY.encode()).hexdigest(),paths=PATHS[:],
      not_before=1000,not_after=4600,max_polls=12,poll_seconds=300,max_starts=1,
      worker_seconds=1200,grace_seconds=30,max_turns=30,max_cost_microusd=1000000,
      provider='openai-codex',model='gpt-6.1-sol')

def digest(x):
    return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()

def record(p=None) -> dict[str,Any]:
    p=p or policy()
    obj=dict(execution_window_id=p['window_id'],assignment_id=A,repo='PharmaPilot-AI/pharmanudge-command',
      issue=p['issue'],author_id=p['task_author_id'],author_login=p['task_author_login'],
      task_body_sha256=p['task_body_sha256'],base_commit=p['base_commit'],
      runner_source_sha=p['runner_reference_sha'],executor_source_sha=p['control_source_sha'],policy_sha256=digest(p))
    return dict(id=301,repo='PharmaPilot-AI/pharmanudge-command',thread=4,action='created',
      user=dict(id=319955168,login='PharmaPilot-AI'),created_at='1970-01-01T00:16:40Z',
      updated_at='1970-01-01T00:16:40Z',body='PHARMANUDGE-TASK-AUTH-V1\n'+json.dumps(obj))

class AuthorityTests(unittest.TestCase):
    def test_creation_time_is_valid_and_inside_approved_window(self):
        for created in ['1970-01-01T00:16:39Z','1970-01-01T01:16:40Z','2026-99-99T99:99:99Z']:
            with self.subTest(created=created):
                row=dict(record(),created_at=created,updated_at=created)
                with self.assertRaises(h.Denied):h.parse_assignment(row,policy())

    def test_strict_assignment_and_policy_pins(self):
        self.assertTrue(callable(getattr(h,'parse_assignment',None)), 'strict ingress is missing')
        p=policy(); good=record(p)
        self.assertEqual(h.parse_assignment(good,p)['assignment_id'],A)
        changes=[{'thread':8},{'repo':'other/repo'},{'action':'edited'},
          {'user':{'id':1,'login':'PharmaPilot-AI'}},{'user':{'id':319955168,'login':'impostor'}},
          {'updated_at':'2026-10-19T00:01:00Z'}, {'body':'ordinary task prose'},
          {'body':good['body']+'\nexecute me'}, {'body':'PHARMANUDGE-TASK-RESULT-V1\n{}'}]
        for mutation in changes:
            with self.subTest(mutation=mutation):
                with self.assertRaises(h.Denied):h.parse_assignment(dict(good,**mutation),p)
        for key in ['executor_source_sha','base_commit','policy_sha256','task_body_sha256']:
            obj=json.loads(good['body'].split('\n',1)[1]);obj[key]='b'*len(obj[key])
            with self.assertRaises(h.Denied):h.parse_assignment(dict(good,body='PHARMANUDGE-TASK-AUTH-V1\n'+json.dumps(obj)),p)
        for raw in ['{"x":1,"x":2}','['*1100+'0'+']'*1100,'NaN']:
            with self.assertRaises(h.Denied):h.parse_assignment(dict(good,body='PHARMANUDGE-TASK-AUTH-V1\n'+raw),p)
        for change in [dict(approved=False),dict(max_starts=2),dict(max_cost_microusd=True),dict(paths=['.env']),dict(not_after=5000)]:
            with self.assertRaises(h.Denied):h.validate_policy(dict(p,**change))

class StoreTests(unittest.TestCase):
    def test_forged_phase_without_a_claim_is_invalid_state(self):
        with tempfile.TemporaryDirectory() as d:
            s=h.Store(Path(d)/'vault')
            with s.locked():s.arm(policy(),1000,0)
            value=s.read();value['phase']='output-pending';h.atomic_json(s.path,value)
            with self.assertRaises(h.Denied):s.read()

    def test_window_pacing_restart_stop_and_no_renewal(self):
        self.assertTrue(hasattr(h,'Store'),'durable controls missing')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'controls';p=policy();s=h.Store(root)
            with s.locked():s.arm(p,1000,baseline=300)
            with s.locked():
                self.assertTrue(s.tick(p,1000));self.assertFalse(s.tick(p,1001))
            s=h.Store(root)
            with s.locked():
                self.assertEqual(s.read()['polls'],1)
                with self.assertRaises(h.Denied):s.arm(p,1100,baseline=301)
                with self.assertRaises(h.Denied):s.guard(dict(p,max_polls=13),1300)
                s.stop('operator_stop')
            with s.locked():
                with self.assertRaises(h.Denied):s.tick(p,1300)
                self.assertEqual(s.read()['polls'],1)
                self.assertEqual(s.read()['expires_at'],4600)
            self.assertEqual(root.stat().st_mode & 0o777,0o700)
            self.assertEqual((root/'state.json').stat().st_mode & 0o777,0o600)

class FakeHost:
    missing: Any
    error: Any
    output: Any
    """Synthetic trusted-host, transport, broker and process boundaries; never launch."""
    def __init__(self,p=None):
        self.p=p or policy();self.rows=[];self.events=[];self.now=1000
        self.legacy_keys={};self.legacy_unknown=False;self.missing=None;self.error=None
        self.charged=0;self.provider_calls=0;self.output=None
    def identity(self):return S
    def legacy(self):
        return h.LegacySnapshot(digest({'claims':self.legacy_keys}),tuple(self.legacy_keys),self.legacy_unknown,0,True,False)
    def verify_legacy(self,value):return value==self.legacy()
    def assignment(self,repo,thread,comment_id):
        return next(row for row in self.rows if row['id']==comment_id)
    def attest(self,kind,p):
        if self.missing==kind:raise h.Denied('capability_unavailable')
        return h.Capability(kind,p['window_id'],digest(p),p['not_after'],p['max_cost_microusd'])
    def verify_capability(self,c,p,now):return c==self.attest(c.kind,p) and now<c.expires_at
    def comments(self,repo,thread):
        self.events.append(('comments',repo,thread));return {'complete':True,'records':copy.deepcopy(self.rows)}
    def task(self,repo,issue):
        self.events.append(('task',issue))
        return dict(repo=repo,issue=issue,state='open',is_pr=False,author_id=319955168,author_login='PharmaPilot-AI',
           body=BODY,main_refs=[BASE,BASE,BASE])
    def reserve(self,cap,claim,request_id,deadline):
        self.events.append(('reserve',claim))
        if self.error=='reserve':raise RuntimeError('private adapter detail')
        return h.Grant(request_id,cap.window_id,cap.policy_sha256,claim,deadline,cap.max_cost_microusd)
    def verify_grant(self,g,p,now):return g.policy_sha256==digest(p) and now<g.expires_at and g.max_cost_microusd==1000000
    def run(self,plan,cap,grant,guard):
        self.events.append(('run',plan,grant));guard()
        if self.error=='run':raise RuntimeError('uncertain fake process outcome')
        return h.Outcome('completed','33333333-3333-4333-8333-333333333333')
    def seal(self,output_id,p):
        self.events.append(('seal',output_id))
        return h.OutputSeal(output_id,digest(p),str(self.output))
    def verify_seal(self,seal,p):return self.error!='seal' and seal.policy_sha256==digest(p)
    def review(self,manifest,claim,p):
        self.events.append(('review',claim))
        return h.ReviewStamp('independent-reviewer',p['window_id'],claim,digest(p),digest(manifest),
            digest({'synthetic_evidence':'not a live worker test result'}),'approve-draft')
    def verify_review(self,stamp,p):return self.error!='review' and stamp.policy_sha256==digest(p)
    def revoke(self,grant):self.events.append(('revoke',grant.claim_key))

class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)/'controls';self.p=policy();self.host=FakeHost(self.p)
    def engine(self,p=None):return h.Controller(p or self.p,self.host,root=self.root,clock=lambda:self.host.now)
    def test_legacy_snapshot_cannot_drift_during_a_window(self):
        e=self.engine();e.initialize()
        self.host.legacy_keys={'5:'+('b'*64):'review-needed'}
        self.host.rows=[record(self.p)]
        with self.assertRaises(h.Denied):e.poll()
        self.assertFalse(any(x[0]=='run' for x in self.host.events))

    def test_admitted_checkpoint_recovers_without_reclaiming(self):
        self.assertTrue(callable(getattr(h.Controller,'admit',None)),'durable admission boundary missing')
        e=self.engine();e.initialize();row=record(self.p)
        with e.store.locked():e.admit(row,h.parse_assignment(row,self.p))
        self.assertEqual(e.store.read()['starts'],0)
        self.host.rows=[row]
        self.assertEqual(self.engine().poll(),'output-pending')
        self.assertEqual(self.engine().store.read()['starts'],1)

    def test_missing_capability_or_legacy_hold_cannot_initialize(self):
        for missing in ('isolation','budget'):
            self.host.missing=missing
            with self.assertRaises(h.Denied):self.engine().initialize()
            self.assertFalse(self.root.exists())
        self.host.missing=None;self.host.legacy_unknown=True
        with self.assertRaises(h.Denied):self.engine().initialize()
        self.assertFalse(self.root.exists())
        with self.assertRaises(h.Denied):h.Controller(self.p,root=self.root).initialize()
        self.assertFalse(self.root.exists())

    def test_unknown_budget_or_process_attempt_never_retries(self):
        for point in ('reserve','run'):
            with self.subTest(point=point),tempfile.TemporaryDirectory() as d:
                self.root=Path(d)/'vault';self.host=FakeHost();self.host.error=point
                e=self.engine();e.initialize();self.host.rows=[record()]
                with self.assertRaises(h.Denied):e.poll()
                s=e.store.read();self.assertEqual(s['starts'],1);self.assertEqual(s['phase'],'unknown')
                before=len(self.host.events);self.host.error=None;self.host.now=1300
                with self.assertRaises(h.Denied):self.engine().poll()
                self.assertEqual(len(self.host.events),before)
                self.assertTrue((self.root/'STOP').exists())

    def test_corrupt_state_overlap_stop_expiry_and_late_start(self):
        e=self.engine();e.initialize()
        with e.store.locked(),self.assertRaises(h.Denied):self.engine().poll()
        s=e.store.read();original=copy.deepcopy(s)
        for value in (-1,True,13,'1'):
            s=copy.deepcopy(original);s['polls']=value;h.atomic_json(e.store.path,s)
            before=len(self.host.events)
            with self.assertRaises(h.Denied):e.store.read()
            self.assertEqual(len(self.host.events),before)
        h.atomic_json(e.store.path,original)
        self.host.now=4000;self.host.rows=[record()]
        with self.assertRaises(h.Denied):e.poll()
        self.assertFalse(any(x[0]=='run' for x in self.host.events))
        self.assertEqual(e.store.read()['starts'],0)

    def test_idle_and_self_generated_records_do_not_start(self):
        e=self.engine();e.initialize()
        self.assertEqual(e.poll(),'idle');before=len(self.host.events)
        self.assertEqual(e.poll(),'not-due');self.assertEqual(len(self.host.events),before)
        self.host.now=1300;self.host.rows=[dict(record(),body='PHARMANUDGE-TASK-RESULT-V1\\n{}')]
        self.assertEqual(e.poll(),'idle')
        self.assertEqual(e.store.read()['starts'],0)
        self.assertFalse(any(x[0]=='reserve' for x in self.host.events))

    def test_only_sealed_export_and_independent_matching_review_produce_a_plan(self):
        self.assertTrue(callable(getattr(h.Controller,'quarantine',None)),'reviewable export handoff missing')
        e=self.engine();e.initialize();self.host.rows=[record()]
        e.poll();self.host.output=Path(self.tmp.name)/'worker';self.host.output.mkdir()
        for path in PATHS:
            f=self.host.output/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('synthetic source')
        with self.assertRaises(h.Denied):e.publication_plan()
        manifest=e.quarantine();self.assertEqual([x['path'] for x in manifest],PATHS)
        with self.assertRaises(h.Denied):e.publication_plan()
        e.review();plan=e.publication_plan()
        self.assertFalse(plan['publication_enabled']);self.assertTrue(plan['draft_only'])
        self.assertEqual(plan['quarantine_manifest_sha256'],digest(manifest))
        self.assertEqual(e.store.read()['starts'],1)
        with self.assertRaises(h.Denied):e.review()
        self.assertEqual(len([x for x in self.host.events if x[0]=='review']),1)

    def test_reservation_request_id_and_start_intent_are_durable_before_reservation(self):
        e=self.engine();e.initialize();self.host.rows=[record()]
        original=self.host.reserve;observed=[]
        def reserve(cap,claim,request_id,deadline):
            s=e.store.read();observed.append((s['starts'],s['claim']['budget_state'],s['claim']['grant_id'],request_id))
            return original(cap,claim,request_id,deadline)
        self.host.reserve=reserve
        self.assertEqual(e.poll(),'output-pending')
        self.assertEqual(observed[0][0:2],(1,'attempted'))
        self.assertEqual(observed[0][2],observed[0][3])

    def test_expiry_during_intent_persistence_prevents_even_budget_reservation(self):
        e=self.engine();e.initialize();self.host.rows=[record()]
        original=e.store.save
        def save(s):
            original(s)
            if s['claim'] and s['claim']['budget_state']=='attempted':self.host.now=4600
        e.store.save=save
        with self.assertRaises(h.Denied):e.poll()
        self.assertFalse(any(x[0]=='reserve' for x in self.host.events))
        self.assertEqual(e.store.read()['starts'],1)

    def test_last_idle_poll_disables_window_without_waiting_or_renewing(self):
        e=self.engine();e.initialize()
        result=None
        for n in range(12):
            self.host.now=1000+n*300
            result=e.poll()
        self.assertEqual(result,'poll-cap')
        s=e.store.read();self.assertEqual(s['polls'],12);self.assertFalse(s['enabled']);self.assertTrue(s['dry_run'])
        self.assertTrue((self.root/'STOP').exists())
        before=len(self.host.events)
        with self.assertRaises(h.Denied):self.engine().poll()
        self.assertEqual(len(self.host.events),before)

    def completed_output(self):
        e=self.engine();e.initialize();self.host.rows=[record()];e.poll()
        self.host.output=Path(self.tmp.name)/'worker';self.host.output.mkdir()
        for path in PATHS:
            f=self.host.output/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('synthetic source')
        return e

    def test_expiry_and_stop_do_not_contact_adapters(self):
        e=self.engine();e.initialize();before=len(self.host.events);self.host.now=4600
        with self.assertRaises(h.Denied):e.poll()
        self.assertEqual(len(self.host.events),before);self.assertFalse(e.store.read()['enabled'])
        self.assertEqual(e.store.read()['expires_at'],4600)

    def test_stop_during_fake_process_keeps_unknown_claim_and_revokes_grant(self):
        e=self.engine();e.initialize();self.host.rows=[record()];original=self.host.run
        def stop(plan,cap,grant,guard):
            e.store.stop('operator_stop')
            return h.Outcome('completed','33333333-3333-4333-8333-333333333333')
        self.host.run=stop
        with self.assertRaises(h.Denied):e.poll()
        self.assertEqual(e.store.read()['starts'],1);self.assertEqual(e.store.read()['phase'],'unknown')
        self.assertTrue(any(x[0]=='revoke' for x in self.host.events))

    def test_stale_issue_or_edited_assignment_has_no_start(self):
        e=self.engine();e.initialize();self.host.rows=[dict(record(),updated_at='2026-10-19T00:01:00Z')]
        with self.assertRaises(h.Denied):e.poll()
        self.assertEqual(e.store.read()['starts'],0)
        self.assertFalse(any(x[0]=='reserve' for x in self.host.events))

    def test_false_isolation_attestation_cannot_be_replaced_by_json_booleans(self):
        self.host.attest=lambda kind,p:{'kind':kind,'enforced':True,'budget':True}
        with self.assertRaises(h.Denied):self.engine().initialize()
        self.assertFalse(self.root.exists())

    def test_unsealed_output_is_not_read_or_imported(self):
        e=self.completed_output();self.host.error='seal'
        with self.assertRaises(h.Denied):e.quarantine()
        self.assertFalse((self.root/'quarantine').exists())
        self.assertEqual(e.store.read()['phase'],'unknown')

    def test_forged_review_and_changed_quarantine_never_authorize_publication(self):
        e=self.completed_output();e.quarantine();self.host.error='review'
        with self.assertRaises(h.Denied):e.review()
        with self.assertRaises(h.Denied):e.publication_plan()
        self.assertEqual(e.store.read()['starts'],1)

    def test_changed_export_after_independent_review_invalidates_the_plan(self):
        e=self.completed_output();e.quarantine();e.review()
        (self.root/'quarantine'/PATHS[0]).write_text('tampered synthetic file')
        with self.assertRaises(h.Denied):e.publication_plan()

    def test_predecessor_stop_is_not_bypassed_by_a_new_vault(self):
        snapshot=self.host.legacy()
        object.__setattr__(snapshot,'stop_requested',True)
        self.host.legacy=lambda:snapshot
        with self.assertRaises(h.Denied):self.engine().initialize()
        self.assertFalse(self.root.exists())

    def test_process_is_not_contacted_after_start_intent_crosses_deadline(self):
        e=self.engine();e.initialize();self.host.rows=[record()];original=e.store.save
        def save(s):
            original(s)
            if s['claim'] and s['claim']['process_state']=='attempted':self.host.now=2200
        e.store.save=save
        with self.assertRaises(h.Denied):e.poll()
        self.assertFalse(any(x[0]=='run' for x in self.host.events))
        self.assertEqual(e.store.read()['starts'],1)

    def test_control_record_edit_after_admission_checks_blocks_start(self):
        e=self.engine();e.initialize();self.host.rows=[record()];original=self.host.task;reads=[]
        def task(repo,issue):
            value=original(repo,issue);reads.append(1)
            if len(reads)==2:self.host.rows[0]=dict(self.host.rows[0],updated_at='1970-01-01T00:16:41Z')
            return value
        self.host.task=task
        with self.assertRaises(h.Denied):e.poll()
        self.assertEqual(e.store.read()['starts'],0)
        self.assertFalse(any(x[0] in ('reserve','run') for x in self.host.events))

    def test_one_task_claims_before_fake_process_and_never_automatically_restarts(self):
        self.assertTrue(hasattr(h,'Controller'),'execution handoff missing')
        e=self.engine();e.initialize();self.host.rows=[record(self.p)]
        self.assertEqual(e.poll(),'output-pending')
        state=e.store.read();self.assertEqual(state['starts'],1)
        self.assertEqual(state['claim']['budget_state'],'acquired')
        self.assertEqual(state['claim']['process_state'],'finished')
        calls=[x for x in self.host.events if x[0]=='run'];self.assertEqual(len(calls),1)
        plan=calls[0][1]
        self.assertNotEqual(plan.uid,0);self.assertEqual(plan.host_mounts,())
        self.assertTrue(getattr(plan,'read_only_root',False))
        self.assertTrue(getattr(plan,'no_new_privileges',False))
        self.assertEqual(getattr(plan,'linux_capabilities',None),())
        self.assertEqual(plan.network,'inference-broker-only');self.assertEqual(plan.argv[0:2],('hermes','chat'))
        self.assertNotIn('--yolo',plan.argv);self.assertNotIn('--oneshot',plan.argv)
        self.assertEqual(plan.env,{'HOME':'/workspace/home','PATH':'/usr/bin:/bin','LANG':'C.UTF-8'})
        self.host.now=1300
        self.assertEqual(self.engine().poll(),'output-pending')
        self.assertEqual(len([x for x in self.host.events if x[0]=='run']),1)
        with self.assertRaises(h.Denied):self.engine().initialize()

class ExportTests(unittest.TestCase):
    def test_aliases_binary_and_oversized_files_are_rejected(self):
        import os
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/'worker';src.mkdir()
            for path in PATHS:
                f=src/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('synthetic')
            target=src/PATHS[0];outside=root/'outside';outside.write_text('synthetic')
            target.unlink();target.symlink_to(outside)
            with self.assertRaises(h.Denied):h.export_output(src,root/'reject1',policy())
            target.unlink();os.link(outside,target)
            with self.assertRaises(h.Denied):h.export_output(src,root/'reject2',policy())
            target.unlink();target.write_bytes(b'bad'+bytes([0]))
            with self.assertRaises(h.Denied):h.export_output(src,root/'reject3',policy())
            target.write_bytes(b'x'*(128*1024+1))
            with self.assertRaises(h.Denied):h.export_output(src,root/'reject4',policy())
            target.write_bytes(bytes([255]))
            with self.assertRaises(h.Denied):h.export_output(src,root/'reject5',policy())

    def test_snapshot_is_quarantined_and_forbidden_content_never_imported(self):
        self.assertTrue(callable(getattr(h,'export_output',None)),'quarantine exporter missing')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/'worker';src.mkdir()
            for path in PATHS:
                f=src/path;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('synthetic source\\n')
            out=root/'quarantine';manifest=h.export_output(src,out,policy())
            self.assertEqual([x['path'] for x in manifest],PATHS)
            self.assertEqual((out/PATHS[0]).read_text(),'synthetic source\\n')
            (src/PATHS[0]).write_text('changed after snapshot')
            self.assertEqual((out/PATHS[0]).read_text(),'synthetic source\\n')
            with self.assertRaises(h.Denied):h.export_output(src,out,policy())
            for extra in ['.env','.git/config','other/secret.txt','src/not-approved.ts']:
                f=src/extra;f.parent.mkdir(parents=True,exist_ok=True);f.write_text('synthetic forbidden')
                with self.assertRaises(h.Denied):h.export_output(src,root/'rejected',policy())
                f.unlink()
                for parent in list(f.parents):
                    if parent==src:break
                    try:parent.rmdir()
                    except OSError:break

class FakeBroker:
    def __init__(self):self.now=1000;self.reserved=0;self.provider_calls=0;self.permits={};self.uncertain=False
    def verify_grant(self,g,p,now):return g.policy_sha256==digest(p) and now<g.expires_at and self.now<g.expires_at
    def authorize_call(self,g,request_id,p):
        if self.now>=g.expires_at or self.reserved+600000>g.max_cost_microusd:raise h.Denied('external_budget_or_expiry')
        self.reserved+=600000
        permit=h.CallPermit(g.token,request_id,digest(p),600000,g.expires_at)
        self.permits[request_id]=permit;return permit
    def verify_permit(self,permit,g,p,now):return self.permits.get(permit.request_id)==permit and now<permit.expires_at
    def execute_bounded(self,permit,payload):
        if self.now>=permit.expires_at:raise h.Denied('external_expiry')
        self.provider_calls+=1
        if self.uncertain:raise RuntimeError('uncertain synthetic provider response')
        return h.BilledResult('synthetic output',600000)

class BudgetGateTests(unittest.TestCase):
    def test_external_reservation_and_expiry_bound_each_fake_provider_attempt(self):
        self.assertTrue(hasattr(h,'InferenceGate'),'enforceable-budget integration missing')
        with tempfile.TemporaryDirectory() as d:
            p=policy();grant=h.Grant(A,W,digest(p),'101:'+p['task_body_sha256'],2200,1000000)
            broker=FakeBroker();gate=h.InferenceGate(p,grant,broker,root=Path(d)/'journal',clock=lambda:broker.now)
            request={'request_id':W,'payload':'synthetic model input'}
            self.assertEqual(gate.invoke(request),'synthetic output')
            self.assertEqual(broker.provider_calls,1)
            with self.assertRaises(h.Denied):gate.invoke(request)
            self.assertEqual(broker.provider_calls,1)
            with self.assertRaises(h.Denied):gate.invoke(dict(request,request_id='44444444-4444-4444-8444-444444444444'))
            self.assertEqual(broker.provider_calls,1)
            broker.now=2200
            with self.assertRaises(h.Denied):broker.authorize_call(grant,'55555555-5555-4555-8555-555555555555',p)
    def test_expired_response_is_not_returned_even_when_fake_provider_completed(self):
        with tempfile.TemporaryDirectory() as d:
            p=policy();grant=h.Grant(A,W,digest(p),'101:'+p['task_body_sha256'],2200,1000000)
            broker=FakeBroker();original=broker.execute_bounded
            def late(permit,payload):
                result=original(permit,payload);broker.now=2200;return result
            broker.execute_bounded=late
            gate=h.InferenceGate(p,grant,broker,root=Path(d)/'journal',clock=lambda:broker.now)
            with self.assertRaises(h.Denied):gate.invoke({'request_id':W,'payload':'synthetic'})
            self.assertEqual(broker.provider_calls,1)

    def test_future_window_cannot_infer_early_even_if_broker_attests(self):
        with tempfile.TemporaryDirectory() as d:
            p=policy();grant=h.Grant(A,W,digest(p),'101:'+p['task_body_sha256'],2200,1000000)
            broker=FakeBroker();broker.now=999
            gate=h.InferenceGate(p,grant,broker,root=Path(d)/'journal',clock=lambda:broker.now)
            with self.assertRaises(h.Denied):gate.invoke({'request_id':W,'payload':'synthetic'})
            self.assertEqual(broker.provider_calls,0)

    def test_unknown_model_outcome_holds_the_entire_lease_across_restart(self):
        self.assertTrue(hasattr(h,'InferenceGate'),'budget journal missing')
        with tempfile.TemporaryDirectory() as d:
            p=policy();grant=h.Grant(A,W,digest(p),'101:'+p['task_body_sha256'],2200,1000000)
            broker=FakeBroker();broker.uncertain=True;root=Path(d)/'journal'
            with self.assertRaises(h.Denied):h.InferenceGate(p,grant,broker,root=root,clock=lambda:broker.now).invoke({'request_id':W,'payload':'synthetic'})
            broker.uncertain=False
            with self.assertRaises(h.Denied):h.InferenceGate(p,grant,broker,root=root,clock=lambda:broker.now).invoke({'request_id':A,'payload':'synthetic'})
            self.assertEqual(broker.provider_calls,1)

class DraftTests(unittest.TestCase):
    def test_disabled_draft_inspection_cannot_arm_or_supply_live_capabilities(self):
        self.assertTrue(callable(getattr(h,'inspect_draft',None)),'disabled operator interface missing')
        p=policy();p.update(approved=False,window_id=None,control_source_sha=None,issue=None,
            task_body_sha256=None,not_before=None,not_after=None)
        a=json.loads(record()['body'].split(chr(10),1)[1])
        for k in ['execution_window_id','assignment_id','issue','task_body_sha256','executor_source_sha','policy_sha256']:a[k]=None
        draft=dict(enabled=False,dry_run=True,policy=p,assignment=a)
        result=h.inspect_draft(draft)
        self.assertFalse(result['live_ready']);self.assertEqual(result['policy_template_sha256'],digest(p))
        with self.assertRaises(h.Denied):h.inspect_draft(dict(draft,enabled=True))
        with self.assertRaises(h.Denied):h.inspect_draft(dict(draft,capabilities={'isolation':True,'spend_cap':True}))
        with self.assertRaises(h.Denied):h.Controller(policy()).initialize()

if __name__=='__main__':unittest.main()
