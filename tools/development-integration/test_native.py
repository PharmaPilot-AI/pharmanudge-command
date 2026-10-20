"""Opt-in actual Docker qualification: harmless fixed programs, no models/network."""
import os
from pathlib import Path
import tempfile
import unittest
import bindings as b

@unittest.skipUnless(os.environ.get('PHARMANUDGE_NATIVE_QUALIFICATION')=='1','explicit native qualification only')
class NativeTests(unittest.TestCase):
    def test_deadline_stops_real_detached_children(self):
        self.assertTrue(callable(getattr(b.DockerSandbox,'wait_exited',None)),'independent expiry binding missing')
        with tempfile.TemporaryDirectory() as d:
            sandbox=b.DockerSandbox(Path(d));job=sandbox.prepare('wait',5)
            try:
                sandbox.start(job);sandbox.wait_child_ready(job)
                before=sandbox.host_pids(job)
                self.assertGreaterEqual(len(before),3)
                sandbox.wait_exited(job)
                self.assertTrue(all(not sandbox.executing(pid) for pid in before))
                self.assertFalse((job.root/'out/late.txt').exists())
            finally:sandbox.cleanup(job)

    def test_cpu_quota_is_actually_throttled(self):
        with tempfile.TemporaryDirectory() as d:
            evidence=b.DockerSandbox(Path(d)).run_fixture('cpu')
            self.assertIn('cpu_throttled',evidence)
            self.assertGreater(evidence['cpu_throttled'],0)

    def test_memory_limit_causes_local_cgroup_oom(self):
        with tempfile.TemporaryDirectory() as d:
            evidence=b.DockerSandbox(Path(d)).run_fixture('memory')
            self.assertEqual(evidence.get('worker_exit'),-9)
            self.assertGreater(evidence.get('oom_kill',0),0)

    def test_pid_limit_denies_additional_forks(self):
        with tempfile.TemporaryDirectory() as d:
            evidence=b.DockerSandbox(Path(d)).run_fixture('pids')
            self.assertTrue(evidence.get('fork_denied'))
            self.assertLessEqual(evidence.get('children_started',100),14)

    def test_stop_preempts_absolute_expiry(self):
        import time
        with tempfile.TemporaryDirectory() as d:
            sandbox=b.DockerSandbox(Path(d));job=sandbox.prepare('wait',10)
            try:
                sandbox.start(job);sandbox.wait_child_ready(job);pids=sandbox.host_pids(job)
                started=time.monotonic();sandbox.stop(job);sandbox.wait_exited(job)
                self.assertLess(time.monotonic()-started,3)
                self.assertTrue(all(not sandbox.executing(pid) for pid in pids))
            finally:sandbox.cleanup(job)

    def test_supervisor_sigkill_does_not_disable_container_expiry(self):
        self.assertTrue(callable(getattr(b.DockerSandbox,'recover',None)),'cleanup-only recovery missing')
        import json
        import subprocess
        import sys
        import time
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);sandbox=b.DockerSandbox(root);process=None;job=None
            script="import bindings as b,time,json; from pathlib import Path; import sys; root=Path(sys.argv[1]); s=b.DockerSandbox(root); j=s.prepare('wait',7); s.start(j); s.wait_child_ready(j); (root/'ready.json').write_text(json.dumps({'token':j.token})); time.sleep(100)"
            try:
                process=subprocess.Popen([sys.executable,'-B','-c',script,d],cwd=Path(__file__).parent,
                    env={'HOME':d,'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                until=time.monotonic()+10
                while not (root/'ready.json').exists() and time.monotonic()<until and process.poll() is None:time.sleep(.05)
                self.assertTrue((root/'ready.json').exists(),'synthetic supervisor failed readiness')
                token=json.loads((root/'ready.json').read_text())['token'];job=sandbox.recover(token)
                pids=sandbox.host_pids(job);process.kill();process.wait(timeout=2)
                self.assertEqual(process.returncode,-9)
                sandbox.wait_exited(job)
                self.assertTrue(all(not sandbox.executing(pid) for pid in pids))
                with self.assertRaises(b.Denied):sandbox.start(job)
            finally:
                if process and process.poll() is None:process.kill();process.wait(timeout=2)
                if job:sandbox.cleanup(job)
                else:
                    for lease in root.glob('*/lease/lease.json'):
                        sandbox.cleanup(sandbox.recover(lease.parent.parent.name))

    def test_assignment_to_independent_validation_and_preparation(self):
        self.assertTrue(hasattr(b,'QualificationPipeline'),'concrete zero-call pipeline missing')
        with tempfile.TemporaryDirectory() as d:
            pipeline=b.QualificationPipeline(Path(d))
            result=pipeline.run()
            self.assertEqual(result['phase'],'publication-prepared')
            self.assertEqual(result['starts'],1)
            self.assertEqual(result['provider_calls'],0)
            self.assertFalse(result['publication_enabled'])
            self.assertNotEqual(result['producer_job'],result['validator_job'])
            self.assertEqual([x['path'] for x in result['manifest']],list(b.safety.PATHS))
            with self.assertRaises(b.Denied):pipeline.run()

    def test_unprivileged_child_cannot_stop_or_ptrace_warden(self):
        self.assertIn('guard-attack',b.KINDS)
        with tempfile.TemporaryDirectory() as d:
            evidence=b.DockerSandbox(Path(d)).run_fixture('guard-attack')
            self.assertTrue(evidence['warden_not_stopped'])
            self.assertTrue(evidence['warden_memory_denied'])

    def test_real_synthetic_host_canary_and_credentials_are_not_exposed(self):
        with tempfile.TemporaryDirectory() as d:
            sandbox=b.DockerSandbox(Path(d));job=sandbox.prepare('basic',10)
            self.assertTrue((Path(d)/'host-controls/credential-canary').is_file(),'host-only canary missing')
            try:
                sandbox.start(job);evidence=sandbox.seal(job)['evidence']
                self.assertTrue(evidence['host_paths_denied'])
                self.assertTrue(evidence.get('credential_env_absent',False))
            finally:sandbox.cleanup(job)

    def test_basic_real_isolation(self):
        self.assertTrue(callable(getattr(b.DockerSandbox,'run_fixture',None)),'native execution binding missing')
        with tempfile.TemporaryDirectory() as d:
            sandbox=b.DockerSandbox(Path(d))
            evidence=sandbox.run_fixture('basic')
            self.assertEqual(evidence['uid'],65534)
            self.assertEqual(evidence['cap_eff'],0)
            self.assertTrue(evidence['no_new_privs'])
            self.assertTrue(evidence['readonly_root'])
            self.assertTrue(evidence['readonly_input_denied'])
            self.assertTrue(evidence['host_paths_denied'])
            self.assertTrue(evidence['outbound_denied'])
            self.assertEqual(evidence['memory_max'],67108864)
            self.assertEqual(evidence['pids_max'],16)
            self.assertEqual(evidence['cpu_max'],[25000,100000])

if __name__=='__main__':unittest.main()
