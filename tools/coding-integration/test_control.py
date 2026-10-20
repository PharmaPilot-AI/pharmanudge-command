"""Hermetic HANDOFF-04 controls; all provider and remote effects are fake."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))

class Controls(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('control',HERE/'control.py')
        assert spec and spec.loader
        self.c=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.c)
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.v=self.c.Vault(self.root)
        self.p=self.c.proposal('a'*40,'b'*40,1000,4600)
        self.comment={'id':17,'issue_url':'https://api.github.com/repos/PharmaPilot-AI/pharmanudge-command/issues/4',
          'user':{'id':319955168,'login':'PharmaPilot-AI'},'body':'synthetic login task',
          'created_at':'2026-10-20T08:17:25Z','updated_at':'2026-10-20T08:17:25Z'}
        self.p['task']={'comment_id':17,'record_sha256':self.c.record_digest(self.comment)}
    def test_canonical_pickup_is_durable_deduplicated_and_not_approval(self):
        calls=[]
        def get(id):calls.append(id);return self.comment
        self.assertEqual(self.v.pickup(self.p,get), 'queued')
        self.assertEqual(self.c.Vault(self.root).pickup(self.p,get), 'queued')
        self.assertEqual(self.v.read()['starts'],0)
        self.assertEqual(self.v.read()['phase'],'queued')
        with self.assertRaisesRegex(self.c.Denied,'operator_approval_required'):
            self.v.admit(self.p,1001,lambda:None)
        self.assertEqual(calls,[17,17])

    def approve(self):
        self.p.update(enabled=True,dry_run=False)
        self.v.pickup(self.p,lambda _:self.comment)
        self.c.s.atomic_json(self.root/'approval.json',{'approved':True,'policy':self.c.digest(self.p)})
    def test_admission_requires_separate_pinned_approval_and_consumes_before_effect(self):
        self.approve();calls=[]
        class Broker:
            def admit(_,p):calls.append(p['mode'])
        self.v.admit(self.p,1001,lambda:calls.append('revalidated'),Broker())
        self.assertEqual(self.v.read()['phase'],'start-intent')
        self.assertEqual(self.v.read()['starts'],1)
        with self.assertRaisesRegex(self.c.Denied,'outcome_hold'):
            self.c.Vault(self.root).admit(self.p,1002,lambda:None,Broker())
        self.assertEqual(calls,['revalidated','included-only'])
    def test_real_provider_contract_is_missing_in_both_modes(self):
        for mode in ('included-only','strict-usd'):
            with self.assertRaisesRegex(self.c.Denied,'unqualified_provider_contract'):
                self.c.NoProvider().admit(dict(self.p,mode=mode))
    def test_disabled_proposal_cannot_admit_even_with_local_approval(self):
        self.v.pickup(self.p,lambda _:self.comment)
        self.c.s.atomic_json(self.root/'approval.json',{'approved':True,'policy':self.c.digest(self.p)})
        with self.assertRaisesRegex(self.c.Denied,'execution_disabled'):
            self.v.admit(self.p,1001,lambda:None)

    def test_exhaustion_checkpoints_and_provider_time_controls_resume_without_probe(self):
        self.approve()
        class Broker:
            def admit(_,p):pass
            def status(_):return {'included_available':True,'observed_at':1200,'retry_at':1199}
        self.v.admit(self.p,1001,lambda:None,Broker())
        self.v.pause('c'*64,1200,quiesced=True)
        self.assertEqual(self.v.read()['phase'],'paused')
        self.assertFalse(self.v.resume(self.p,1199,lambda:None,Broker()))
        self.assertTrue(self.c.Vault(self.root).resume(self.p,1200,lambda:None,Broker()))
        self.assertEqual(self.v.read()['starts'],1)
        self.v.admit(self.p,1201,lambda:None,Broker())
        self.assertEqual(self.v.read()['starts'],2)
    def test_reset_never_overrides_stop_expiry_drift_or_unknown(self):
        self.approve()
        self.v.pause('c'*64,None,quiesced=True)
        class Broker:
            def status(_):return {'included_available':True,'observed_at':1200,'retry_at':1200}
        (self.root/'STOP').touch()
        with self.assertRaisesRegex(self.c.Denied,'stopped'):self.v.resume(self.p,1200,lambda:None,Broker())
        (self.root/'STOP').unlink()
        with self.assertRaisesRegex(self.c.Denied,'expiry_or_clock'):self.v.resume(self.p,4600,lambda:None,Broker())
        with self.assertRaisesRegex(self.c.Denied,'drift'):self.v.resume(self.p,1200,lambda:(_ for _ in ()).throw(self.c.Denied('drift')),Broker())
        self.v.pause('c'*64,1200,quiesced=False)
        with self.assertRaisesRegex(self.c.Denied,'outcome_hold'):self.v.resume(self.p,1200,lambda:None,Broker())
    def test_unsafe_or_unknown_status_stays_paused_without_inference(self):
        self.approve();self.v.pause('c'*64,None,quiesced=True)
        self.assertFalse(self.v.resume(self.p,1200,lambda:None))
        self.assertEqual(self.v.read()['phase'],'paused')

    def test_review_is_external_exact_output_and_one_correction_only(self):
        self.approve();state=self.v.read();state.update(phase='review-needed',manifest='d'*64,starts=1);self.v.save(state)
        row={'policy':self.c.digest(self.p),'manifest':'d'*64,'verdict':'correct'}
        with self.assertRaisesRegex(self.c.Denied,'review_authority'):
            self.v.review(self.p,1100,lambda:None)
        self.c.s.atomic_json(self.root/'review.json',row)
        self.v.review(self.p,1100,lambda:None)
        self.assertEqual(self.v.read()['phase'],'correction-ready')
        self.assertEqual(self.v.read()['reviews'],1)
        self.assertEqual(self.v.read()['corrections'],1)
        state=self.v.read();state.update(phase='review-needed',manifest='e'*64,starts=2);self.v.save(state)
        with self.assertRaisesRegex(self.c.Denied,'review_budget'):self.v.review(self.p,1101,lambda:None)
    def test_publication_unknown_is_reconciled_readonly_not_retried(self):
        self.approve();state=self.v.read();state.update(phase='reviewed',manifest='d'*64,reviews=1);self.v.save(state)
        self.c.s.atomic_json(self.root/'publication-approval.json',{'policy':self.c.digest(self.p),'manifest':'d'*64,'approved':True})
        calls=[]
        class Remote:
            def inspect(_,request):calls.append('inspect');return None
            def publish(_,request):calls.append('publish');raise TimeoutError()
        request={'manifest':'d'*64,'head':'e'*40,'branch':'handoff4/'+self.c.digest(self.p)[:32]}
        with self.assertRaisesRegex(self.c.Denied,'publication_unknown'):
            self.v.publish(self.p,1100,lambda:None,request,Remote())
        with self.assertRaisesRegex(self.c.Denied,'publication_unknown'):
            self.c.Vault(self.root).publish(self.p,1101,lambda:None,request,Remote())
        self.assertEqual(calls,['inspect','publish','inspect'])
        class Found:
            def inspect(_,request):return {'url':'https://github.com/PharmaPilot-AI/pharmanudge-command/pull/999'}
        self.v.publish(self.p,1102,lambda:None,request,Found())
        self.assertEqual(self.v.read()['phase'],'published')

    def test_corrupt_counters_policy_drift_and_edited_canonical_record_fail_closed(self):
        self.v.pickup(self.p,lambda _:self.comment)
        state=self.v.read();state['starts']=True;self.c.s.atomic_json(self.v.path,state)
        with self.assertRaisesRegex(self.c.Denied,'queue_schema'):self.v.read()
        self.v.path.unlink();self.comment['body']='edited'
        with self.assertRaisesRegex(self.c.Denied,'canonical_drift'):self.v.pickup(self.p,lambda _:self.comment)
    def test_policy_expansion_is_rejected_before_queue_write(self):
        self.p['max_starts']=3
        with self.assertRaisesRegex(self.c.Denied,'policy_caps'):self.v.pickup(self.p,lambda _:self.comment)
        self.assertFalse(self.v.path.exists())

    def test_concrete_revalidation_binds_source_base_task_and_legacy(self):
        calls=[]
        class Ingress:
            def comment(_,id):calls.append(id);return self.comment
            def _api(_,path):return {'object':{'sha':self.p['base_sha']}}
        class Source:
            def verify(_,pin):calls.append(pin)
        class Legacy:
            def exclusive(_):return self.c.contextlib.nullcontext()
            def inspect(_):return {'sha256':'f'*64,'consumed_keys':[]}
        self.p['legacy_sha256']='f'*64
        checks=self.c.Checks(self.p,Source(),Legacy(),Ingress(),lambda:1100)
        checks()
        self.assertEqual(calls,['a'*40,17])
        self.p['base_sha']='c'*40
        class Wrong(Ingress):
            def _api(_,path):return {'object':{'sha':'b'*40}}
        with self.assertRaisesRegex(self.c.Denied,'base_drift'):
            self.c.Checks(self.p,Source(),Legacy(),Wrong(),lambda:1100)()

    def test_exhausted_status_updates_provider_backoff_without_resetting_budget(self):
        self.approve();self.v.pause('c'*64,1100,quiesced=True)
        class Broker:
            def status(_):return {'included_available':False,'observed_at':1200,'retry_at':1500}
        self.assertFalse(self.v.resume(self.p,1200,lambda:None,Broker()))
        self.assertEqual(self.v.read()['resume_after'],1500)
    def test_status_causing_stop_cannot_resume(self):
        self.approve();self.v.pause('c'*64,None,quiesced=True)
        class Broker:
            def status(_):
                (self.root/'STOP').touch()
                return {'included_available':True,'observed_at':1200,'retry_at':1200}
        with self.assertRaisesRegex(self.c.Denied,'stopped'):self.v.resume(self.p,1200,lambda:None,Broker())

    def test_unknown_status_after_reset_does_not_busy_retry(self):
        self.approve();self.v.pause('c'*64,1100,quiesced=True)
        class Broker:
            def status(_):raise TimeoutError('synthetic status transport')
        self.assertFalse(self.v.resume(self.p,1200,lambda:None,Broker()))
        self.assertIsNone(self.v.read()['resume_after'])

if __name__=='__main__':unittest.main()
