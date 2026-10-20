"""Finite scheduling with fake allowance transport; no provider/worker is started."""
from pathlib import Path
import tempfile
import unittest
import control as c

class SupervisorTests(unittest.TestCase):
    def test_automatic_tick_resumes_only_after_provider_confirmation_and_preserves_starts(self):
        import supervisor
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=c.Vault(root);p=c.proposal('a'*40,'b'*40,1000,4600)
            row={'id':9,'issue_url':'https://api.github.com/repos/'+c.REPO+'/issues/4','user':{'id':319955168,'login':'PharmaPilot-AI'},'body':'fixture','created_at':'x','updated_at':'x'}
            p.update(enabled=True,dry_run=False,task={'comment_id':9,'record_sha256':c.record_digest(row)})
            v.pickup(p,lambda _:row);c.s.atomic_json(root/'approval.json',{'approved':True,'policy':c.digest(p)})
            clock=[1001];calls=[]
            class Broker:
                def admit(_,p):calls.append('admit')
                def status(_):calls.append('status');return {'included_available':True,'observed_at':clock[0],'retry_at':1200}
            broker=Broker()
            class Runtime:
                def run(_,p,repo,task,revalidate,broker):
                    v.admit(p,clock[0],revalidate,broker)
                    if v.read()['starts']==1:raise supervisor.Exhausted('c'*64,1200,True)
                    state=v.read();state.update(phase='review-needed',manifest='d'*64);v.save(state)
                    return []
            sup=supervisor.Supervisor(v,p,Path(t),lambda:None,Runtime(),broker,lambda:clock[0])
            self.assertEqual(sup.step(),'paused')
            clock[0]=1199;self.assertEqual(sup.step(),'paused');self.assertNotIn('status',calls)
            clock[0]=1200;self.assertEqual(sup.step(),'review-needed')
            self.assertEqual(v.read()['starts'],2)
            self.assertEqual(calls,['admit','status','admit'])

    def test_tick_cap_survives_new_supervisor_instance(self):
        import supervisor
        with tempfile.TemporaryDirectory() as t:
            v=c.Vault(Path(t));p=c.proposal('a'*40,'b'*40,1000,4600)
            row={'id':9,'issue_url':'https://api.github.com/repos/'+c.REPO+'/issues/4','user':{'id':319955168,'login':'PharmaPilot-AI'},'body':'fixture','created_at':'x','updated_at':'x'}
            p['task']={'comment_id':9,'record_sha256':c.record_digest(row)}
            v.pickup(p,lambda _:row);state=v.read();state['phase']='review-needed';v.save(state)
            for _ in range(12):supervisor.Supervisor(v,p,Path(t),lambda:None).step()
            with self.assertRaisesRegex(c.Denied,'tick_budget'):
                supervisor.Supervisor(v,p,Path(t),lambda:None).step()

if __name__=='__main__':unittest.main()
