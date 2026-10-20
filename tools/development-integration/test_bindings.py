import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

HERE=Path(__file__).parent
SPEC=importlib.util.spec_from_file_location('bindings',HERE/'bindings.py')
assert SPEC and SPEC.loader
b=importlib.util.module_from_spec(SPEC);sys.modules[SPEC.name]=b
if (HERE/'bindings.py').exists():SPEC.loader.exec_module(b)

class IngressTests(unittest.TestCase):
    def test_canonical_authority_task_and_remote_base_are_checked(self):
        fixture_spec=importlib.util.spec_from_file_location('handoff_fixture',HERE.parent/'development-handoff/test_handoff.py')
        assert fixture_spec and fixture_spec.loader
        fixture=importlib.util.module_from_spec(fixture_spec);fixture_spec.loader.exec_module(fixture)
        p=fixture.policy();row=fixture.record(p)
        remote={k:row[k] for k in ('id','body','created_at','updated_at','user')}
        remote['issue_url']='https://api.github.com/repos/'+b.REPO+'/issues/4'
        task={'number':p['issue'],'state':'open','body':fixture.BODY,'user':{'id':319955168,'login':'PharmaPilot-AI'}}
        def api(endpoint):
            if '/issues/comments/' in endpoint:return remote
            if endpoint.endswith('/git/ref/heads/main'):return {'object':{'sha':p['base_commit']}}
            return task
        ingress=b.GitHubIngress(api);config={'enabled':True,'dry_run':False,'policy':p}
        self.assertEqual(ingress.authorize(config,row['id'])['assignment']['assignment_id'],fixture.A)
        remote['user']={'id':1,'login':'PharmaPilot-AI'}
        with self.assertRaises(b.Denied):ingress.authorize(config,row['id'])
        remote['user']={'id':319955168,'login':'PharmaPilot-AI'};task['body']='changed'
        with self.assertRaises(b.Denied):ingress.authorize(config,row['id'])

    def test_canonical_reads_are_fixed_and_disabled_policy_cannot_dispatch(self):
        self.assertTrue(hasattr(b,'GitHubIngress'),'concrete ingress missing')
        calls=[]
        def api(endpoint):
            calls.append(endpoint)
            return {'id':9,'body':'repository prose is not authority'}
        ingress=b.GitHubIngress(api)
        self.assertEqual(ingress.comment(9)['id'],9)
        self.assertEqual(calls,['repos/PharmaPilot-AI/pharmanudge-command/issues/comments/9'])
        with self.assertRaises(b.Denied):ingress.comment(True)
        with self.assertRaises(b.Denied):ingress.authorize({'enabled':False},9)
        self.assertEqual(len(calls),1)
        self.assertTrue(hasattr(b,'CodexBudget'))
        with self.assertRaisesRegex(b.Denied,'hard_spend_capability_unavailable'):
            b.CodexBudget().reserve('openai-codex','gpt-6.1-sol',1000000)

class SandboxTests(unittest.TestCase):
    def test_concrete_plan_cannot_pull_or_expose_host_controls(self):
        self.assertTrue(hasattr(b,'DockerSandbox'),'concrete sandbox missing')
        with tempfile.TemporaryDirectory() as d:
            sandbox=b.DockerSandbox(Path(d))
            job=sandbox.prepare('basic',5)
            argv=sandbox.argv(job)
            for flag in ['--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges=true','--user=65534:65534','--memory=64m','--memory-swap=64m','--cpus=0.25','--pids-limit=16']:
                self.assertIn(flag,argv)
            self.assertNotIn('--privileged',argv)
            self.assertNotIn('--init',argv)
            self.assertNotIn('--rm',argv)
            with self.assertRaises(b.Denied):sandbox.prepare('hermes',5)
            with self.assertRaises(b.Denied):sandbox.prepare('basic',True)
            with self.assertRaises(b.Denied):sandbox.prepare('basic',1200)

class AdmissionTests(unittest.TestCase):
    def test_disabled_or_unbudgeted_coding_admission_never_launches(self):
        self.assertTrue(hasattr(b,'PaidAdmission'),'composed admission missing')
        calls=[]
        class Source:
            def verify(self,sha):calls.append('source')
        class Legacy:
            def exclusive(self):
                import contextlib
                return contextlib.nullcontext()
            def inspect(self):calls.append('legacy');return {'sha256':'0'*64,'consumed_keys':(),'daily_charges':{}}
        class Ingress:
            def authorize(self,config,comment):calls.append('ingress');return {'assignment':{'issue':1,'task_body_sha256':'a'*64}}
        admission=b.PaidAdmission(Source(),Legacy(),Ingress())
        with self.assertRaises(b.Denied):admission.check({'enabled':False},1)
        self.assertEqual(calls,[])
        config={'enabled':True,'dry_run':False,'policy':{'control_source_sha':'a'*40},'legacy_sha256':'0'*64}
        with self.assertRaisesRegex(b.Denied,'hard_spend_capability_unavailable'):admission.check(config,1)
        self.assertEqual(calls,['source','legacy','ingress'])

class CliTests(unittest.TestCase):
    def test_inspection_defaults_never_run_native_or_paid_work(self):
        spec=importlib.util.spec_from_file_location('qualification',HERE/'qualification.py')
        self.assertTrue((HERE/'qualification.py').exists(),'qualification entrypoint missing')
        assert spec and spec.loader
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        import contextlib
        import io
        out=io.StringIO()
        with contextlib.redirect_stdout(out):self.assertEqual(module.main(['status']),2)
        self.assertFalse(json.loads(out.getvalue())['live_enabled'])
        with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(module.main(['native','--source-sha','a'*40]),2)

class LegacyTests(unittest.TestCase):
    def test_existing_lock_snapshot_and_unknown_holds_are_preserved(self):
        self.assertTrue(hasattr(b.LegacyGuard,'exclusive'),'cooperative predecessor lock missing')
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);state=root/'state.json';config=root/'config.json';lock=root/'state.json.lock'
            config.write_text(json.dumps({'enabled':False,'dry_run':True}))
            value={'version':1,'claims':{'1:'+('a'*64):{'status':'review-needed','day':'2026-10-19'}},'days':{'2026-10-19':1}}
            state.write_text(json.dumps(value));lock.touch(mode=0o600)
            guard=b.LegacyGuard(config,state,state);before=state.read_bytes()
            with guard.exclusive():self.assertEqual(len(guard.inspect()['consumed_keys']),1)
            self.assertEqual(state.read_bytes(),before)
            value['claims']['1:'+('a'*64)]['status']='unknown';state.write_text(json.dumps(value))
            with self.assertRaises(b.Denied):guard.inspect()
            (root/'STOP').touch()
            with self.assertRaises(b.Denied):guard.inspect()

class UnknownTests(unittest.TestCase):
    def test_uncertain_native_start_cannot_be_retried(self):
        from types import SimpleNamespace
        calls=[]
        class UncertainSandbox:
            def __init__(self,root):self.root=root
            def prepare(self,kind,ttl):return SimpleNamespace(token='synthetic-job')
            def start(self,job):calls.append('start');raise OSError('synthetic uncertain start')
            def cleanup(self,job):calls.append('cleanup')
        with tempfile.TemporaryDirectory() as d:
            pipeline=b.QualificationPipeline(Path(d),sandbox_factory=UncertainSandbox)
            with self.assertRaises(b.Denied):pipeline.run()
            state=json.loads((Path(d)/'qualification.json').read_text())
            self.assertEqual(state['phase'],'unknown');self.assertEqual(state['starts'],1)
            with self.assertRaises(b.Denied):pipeline.run()
            self.assertEqual(calls,['start','cleanup'])

class ClockTests(unittest.TestCase):
    def test_absolute_forward_jump_and_monotonic_backstop_both_expire(self):
        spec=importlib.util.spec_from_file_location('guest_fixture',HERE/'guest.py')
        assert spec and spec.loader
        guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest)
        self.assertTrue(callable(getattr(guest,'expired',None)),'dual-clock expiry missing')
        self.assertTrue(guest.expired(10,20,9,21))
        self.assertTrue(guest.expired(10,20,11,1))
        self.assertFalse(guest.expired(10,20,9,19))

class GuestEntryTests(unittest.TestCase):
    def test_warden_refuses_host_entry_without_optimizable_assert(self):
        import ast
        tree=ast.parse((HERE/'guest.py').read_text())
        guard=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='guard')
        self.assertIsInstance(guard.body[0],ast.If,'PID/UID refusal must survive Python optimization')
        spec=importlib.util.spec_from_file_location('safe_guest_fixture',HERE/'guest.py');assert spec and spec.loader
        guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest)
        with self.assertRaises(SystemExit):guest.guard('basic')
        try:guest.worker('basic')
        except BaseException as exc:self.assertIsInstance(exc,SystemExit)
        else:self.fail('host child entry was accepted')

if __name__=='__main__':unittest.main()
