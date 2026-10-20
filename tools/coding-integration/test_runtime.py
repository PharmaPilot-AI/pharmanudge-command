"""Configuration-only runtime tests; no coding entry point is executed."""
from pathlib import Path
import tempfile
import unittest
import control as c

class RuntimeTests(unittest.TestCase):
    def test_plan_has_privilege_storage_expiry_and_no_secret_mounts(self):
        import runtime
        p=c.proposal('a'*40,'b'*40,1000,4600)
        p['entrypoint']=['/opt/approved-coder','--task','/inputs/task.txt']
        with tempfile.TemporaryDirectory() as t:
            plan=runtime.plan(p,Path(t),'0123456789abcdef',1100)
        joined=' '.join(plan)
        for item in ('--network=none','--read-only','--cap-drop=ALL','--user=0:0','--cap-add=CHOWN','--cap-add=KILL','mode=0700','--pids-limit=64',
                     '--memory=512m','--pull=never','size=128m','size=1m'):
            self.assertIn(item,joined)
        for item in ('docker.sock',',dst=/root','src=/root,','--privileged','--network=host'):
            self.assertNotIn(item,joined)
        self.assertEqual(plan[-2:],[str(1100),'0123456789abcdef'])
    def test_checkout_uses_exact_git_blobs_without_hooks_or_filters(self):
        import runtime
        import subprocess
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);repo=root/'repo';repo.mkdir()
            def git(*args):return subprocess.check_output(['git','-c','core.hooksPath=/dev/null',*args],cwd=repo).decode().strip()
            git('init','-q');(repo/'safe.txt').write_text('dummy only');git('add','safe.txt')
            git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture')
            out=root/'inputs';out.mkdir()
            runtime.checkout(repo,git('rev-parse','HEAD'),out,1024)
            self.assertEqual((out/'safe.txt').read_text(),'dummy only')
            self.assertFalse((out/'.git').exists())
            with self.assertRaisesRegex(c.Denied,'checkout_limit'):runtime.checkout(repo,git('rev-parse','HEAD'),out,1)

    def test_warden_cannot_enter_on_host_and_clock_rollback_cannot_extend_lease(self):
        import warden
        with self.assertRaises(SystemExit):warden.main(9999999999,'0123456789abcdef')
        self.assertTrue(warden.expired(100,200,101,1))
        self.assertTrue(warden.expired(100,200,1,201))
        self.assertFalse(warden.expired(100,200,99,199))

    def test_start_ambiguity_charges_once_and_new_runtime_cannot_retry(self):
        import json
        import runtime
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=c.Vault(root);p=c.proposal('a'*40,'b'*40,1000,4600)
            p.update(enabled=True,dry_run=False,entrypoint=['/opt/approved-coder'])
            row={'id':17,'issue_url':'https://api.github.com/repos/'+c.REPO+'/issues/4','user':{'id':319955168,'login':'PharmaPilot-AI'},'body':'dummy','created_at':'x','updated_at':'x'}
            p['task']={'comment_id':17,'record_sha256':c.record_digest(row)}
            v.pickup(p,lambda _:row);c.s.atomic_json(root/'approval.json',{'approved':True,'policy':c.digest(p)})
            calls=[]
            class Broker:
                def admit(_,p):pass
            class Native(runtime.Runtime):
                def verify_container(_,p,job,token):pass  # daemon metadata is synthetic in this fault test
                def docker(_, *args):
                    calls.append(args[0])
                    if args[0]=='image':return (p['image']+'\n').encode() if args[-1]=='{{.Id}}' else b''
                    if args[0]=='create':return b'container'
                    if args[0]=='start':raise c.Denied('synthetic_start_timeout')
                    if args[0]=='inspect':return json.dumps([{'Config':{'Labels':{'pharmanudge.handoff':'04','pharmanudge.job':v.read()['job']}}}]).encode()
                    return b''
            with patch.object(runtime,'checkout',return_value=0):
                with self.assertRaisesRegex(c.Denied,'runtime_outcome_hold'):
                    Native(v,clock=lambda:1100).run(p,root,'dummy',lambda:None,Broker())
                with self.assertRaisesRegex(c.Denied,'outcome_hold'):
                    Native(v,clock=lambda:1101).run(p,root,'dummy',lambda:None,Broker())
            self.assertEqual(v.read()['starts'],1)
            self.assertEqual(v.read()['phase'],'unknown')
            self.assertEqual(calls.count('create'),1)

    def test_unexpected_daemon_configuration_is_rejected_before_start(self):
        import runtime
        with tempfile.TemporaryDirectory() as t:
            v=c.Vault(Path(t));p=c.proposal('a'*40,'b'*40,1000,4600)
            class Native(runtime.Runtime):
                def owned(_,token):return {'Image':p['image'],'Config':{'User':'0'},'HostConfig':{'NetworkMode':'host'}}
            with self.assertRaisesRegex(c.Denied,'runtime_configuration'):
                Native(v).verify_container(p,Path(t),'0123456789abcdef')

    def test_checkpoint_is_actual_captured_bytes_and_tamper_blocks_restore(self):
        import runtime
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=c.Vault(root)
            data={name:b'dummy checkpoint\n' for name in c.s.PATHS}
            pin=runtime.checkpoint(v,data)
            out=root/'source';out.mkdir()
            runtime.restore(v,pin,out)
            self.assertEqual((out/c.s.PATHS[0]).read_bytes(),data[c.s.PATHS[0]])
            (root/'checkpoints'/pin/c.s.PATHS[0]).write_bytes(b'tampered')
            with self.assertRaisesRegex(c.Denied,'checkpoint_drift'):runtime.restore(v,pin,out)

    def test_operator_exporter_never_adds_worker_tmp_to_python_import_path(self):
        import inspect
        import runtime
        self.assertNotIn("sys.path.insert(0,'/tmp')",inspect.getsource(runtime.Runtime.run))

if __name__=='__main__':unittest.main()
