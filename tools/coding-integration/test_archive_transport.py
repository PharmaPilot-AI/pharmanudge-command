"""Actual bounded wrapper, dummy executables only; never touches Docker."""
import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import fixture_assembler as a

class Transport(unittest.TestCase):
    def fake(self,root,code):
        p=Path(root)/'fake-docker';p.write_text('#!'+sys.executable+'\n'+code);p.chmod(0o755);return str(p)
    def test_timeout_os_nonzero_and_live_output_limits(self):
        from bounded_process import Failure
        cases=[('timeout','import time;time.sleep(5)',{'timeout':.2}),
          ('nonzero_exit','import sys;sys.stderr.write("PRIVATE_ERROR");sys.exit(7)',{}),
          ('stdout_limit','import os\nwhile True:os.write(1,b"x"*8192)',{'stdout_limit':1024}),
          ('stderr_limit','import os\nwhile True:os.write(2,b"PRIVATE"*8192)',{'stderr_limit':1024})]
        for category,code,opts in cases:
            with self.subTest(category=category),tempfile.TemporaryDirectory() as t:
                exe=self.fake(t,code)
                with patch.object(a,'DOCKER',exe),self.assertRaises(Failure) as caught:a.docker('cp','dummy:/x','-',**opts)
                e=caught.exception.evidence;self.assertEqual(e['category'],category)
                self.assertTrue(e['direct_child_reaped']);self.assertNotIn('PRIVATE',str(e))
                if category=='nonzero_exit':self.assertEqual(e['exit_code'],7)
                if category.endswith('_limit'):self.assertEqual(e[category.replace('_limit','_bytes')],1025)
                self.assertLess(e['elapsed_ms'],3000)
        with patch.object(a,'DOCKER','/nonexistent/fake-docker'),self.assertRaises(Failure) as caught:a.docker('inspect','dummy')
        self.assertEqual(caught.exception.evidence['category'],'os_error');self.assertIsNone(caught.exception.evidence['exit_code'])
    def test_child_and_descendant_pipe_cleanup_without_masking_timeout(self):
        import bounded_process as b
        original=b.subprocess.Popen;children=[]
        def spawn(*args,**kw):
            proc=original(*args,**kw);children.append(proc);return proc
        realkill=b.os.killpg
        def kill_then_error(pid,sig):
            realkill(pid,sig);raise OSError('PRIVATE cleanup diagnostic')
        with tempfile.TemporaryDirectory() as t:
            pidfile=Path(t)/'descendant.pid'
            exe=self.fake(t,'import os,time\npid=os.fork()\nif pid==0:time.sleep(5);os._exit(0)\nopen('+repr(str(pidfile))+',"w").write(str(pid))\nos.write(1,str(pid).encode());os._exit(0)\n')
            with patch.object(a,'DOCKER',exe),patch.object(b.subprocess,'Popen',spawn),patch.object(b.os,'killpg',kill_then_error),self.assertRaises(b.Failure) as caught:
                a.docker('cp','dummy:/x','-',timeout=.2)
            e=caught.exception.evidence;self.assertEqual(e['category'],'timeout');self.assertEqual(e['cleanup_category'],'kill_error')
            self.assertTrue(e['direct_child_reaped']);self.assertEqual(children[0].returncode,0)
            self.assertTrue(all(s.closed for s in (children[0].stdout,children[0].stderr)))
            import time
            status=Path('/proc')/pidfile.read_text()/'status'
            end=time.monotonic()+.5
            def stopped():
                try:raw=status.read_text()
                except FileNotFoundError:return True
                return any(line.startswith('State:') and ('Z' in line or 'X' in line) for line in raw.splitlines())
            while not stopped() and time.monotonic()<end:time.sleep(.01)
            self.assertTrue(stopped())
    def test_no_inherited_stdin_or_private_environment(self):
        with tempfile.TemporaryDirectory() as t:
            exe=self.fake(t,'import os,sys\nassert sys.stdin.buffer.read()==b""\nassert "SYNTHETIC_PRIVATE_TOKEN" not in os.environ\nsys.stdout.write("ok")\n')
            with patch.dict(os.environ,{'SYNTHETIC_PRIVATE_TOKEN':'DUMMY'}),patch.object(a,'DOCKER',exe):
                self.assertEqual(a.docker('inspect','dummy'),b'ok')

    def test_readback_binary_success_truncation_and_malformed_tar_through_docker_wrapper(self):
        import base64
        from test_archive_verification import Archives
        valid=Archives().tar()
        for field,data in [(None,valid),*Archives().rejections()]:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as t:
                exe=self.fake(t,'import sys,base64\nsys.stdout.buffer.write(base64.b64decode('+repr(base64.b64encode(data))+'))\n')
                with patch.object(a,'DOCKER',exe):out=a.docker('cp','dummy:/opt/fixture','-')
                self.assertEqual(out.evidence['category'],'ok');self.assertEqual(out.evidence['stdout_bytes'],len(data))
                if field:
                    with self.assertRaises(a.ArchiveFailure) as caught:a.verify_copy_out(out)
                    self.assertEqual(caught.exception.evidence['field'],field)
                else:self.assertEqual(a.verify_copy_out(out)['category'],'ok')
    def test_incomplete_input_is_not_reported_as_success(self):
        from bounded_process import Failure
        import bounded_process as b
        import fcntl
        original=b.subprocess.Popen
        def small_pipe(*args,**kwargs):
            proc=original(*args,**kwargs)
            fcntl.fcntl(proc.stdin.fileno(),fcntl.F_SETPIPE_SZ,4096)
            return proc
        with tempfile.TemporaryDirectory() as t:
            exe=self.fake(t,'import os\nos._exit(0)\n')
            with patch.object(a,'DOCKER',exe),patch.object(b.subprocess,'Popen',small_pipe),self.assertRaises(Failure) as caught:
                a.docker('cp','-','dummy:/',data=b'x'*32768)
            self.assertEqual(caught.exception.evidence['category'],'stdin_incomplete')
            self.assertTrue(caught.exception.evidence['direct_child_reaped'])

    def test_docker_binary_tar_round_trip_and_sanitized_success_evidence(self):
        with tempfile.TemporaryDirectory() as t:
            exe=self.fake(t,'import sys\nraw=sys.stdin.buffer.read()\nsys.stderr.buffer.write(b"PRIVATE_DIAGNOSTIC")\nsys.stdout.buffer.write(raw)\n')
            def reject_real(*args,**kwargs):
                self.fail('old wrapper hardcodes real Docker; no real subprocess was launched')
            with patch.object(a,'DOCKER',exe,create=True),patch.object(a.subprocess,'run',reject_real):
                out=a.docker('cp','-','dummy:/',data=a.archive())
            self.assertEqual(out,a.archive())
            e=out.evidence
            self.assertEqual(e['category'],'ok');self.assertEqual(e['exit_code'],0)
            self.assertEqual(e['stdout_bytes'],len(out));self.assertEqual(e['stdin_bytes'],len(out))
            self.assertEqual(e['stderr_bytes'],len(b'PRIVATE_DIAGNOSTIC'))
            self.assertGreaterEqual(e['elapsed_ms'],0)
            self.assertNotIn('PRIVATE',str(e));self.assertEqual(e['stage'],'docker_cp_in')
