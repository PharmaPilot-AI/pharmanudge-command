"""Offline regressions for the three reviewed defects; no Docker/provider calls."""
import ctypes
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import control as c
import runtime
import warden
import test_control as fixtures

class Corrections(unittest.TestCase):
    def fixture(self):
        setup=fixtures.Controls();setup.setUp();self.addCleanup(setup.doCleanups);setup.approve()
        return setup

    def test_stale_guard_snapshot_is_rejected_across_vault_restart(self):
        f=self.fixture();old=f.v.read()
        f.v.guard(f.p,1500,lambda:None)
        old['phase']='running'
        with self.assertRaisesRegex(f.c.Denied,'stale_queue_write'):f.v.save(old)
        self.assertEqual(f.v.read()['last_clock'],1500)
        with self.assertRaisesRegex(f.c.Denied,'expiry_or_clock'):
            f.c.Vault(f.root).guard(f.p,1200,lambda:None)

    def test_runtime_capture_keeps_new_guard_clock(self):
        f=self.fixture();state=f.v.read();state.update(starts=1,phase='start-intent',job='0'*16);f.v.save(state)
        f.v.guard(f.p,1500,lambda:None)
        runtime.capture(f.v,f.p,{n:b'dummy\n' for n in c.s.PATHS},state)
        self.assertEqual(f.v.read()['last_clock'],1500)
        self.assertEqual(f.v.read()['phase'],'review-needed')
        with self.assertRaisesRegex(f.c.Denied,'expiry_or_clock'):
            f.c.Vault(f.root).guard(f.p,1200,lambda:None)

    def test_full_runtime_collection_preserves_latest_clock(self):
        import base64
        f=self.fixture();f.p['entrypoint']=['/opt/dummy']
        # Entry point participates in the policy pin; initialize a fresh fixture queue.
        f.v.path.unlink();f.v.pickup(f.p,lambda _:f.comment)
        f.c.s.atomic_json(f.root/'approval.json',{'approved':True,'policy':f.c.digest(f.p)})
        times=iter([1100,1101,1102,1103,1104,1105,1500])
        class Broker:
            def admit(_,p):pass
        class Native(runtime.Runtime):
            def verify_container(_,p,job,token):pass
            def stop(_,token):pass
            def docker(_, *args):
                if args[0]=='image':return (f.p['image']+'\n').encode() if args[-1]=='{{.Id}}' else b''
                if args[0]=='exec':
                    code=args[-1]
                    if 'completion.json' in code:
                        return json.dumps({'version':1,'job':f.v.read()['job'],'exit_code':0,'quiesced':True}).encode()
                    if 'os.listdir' in code:return b'[1]'
                    return json.dumps({n:base64.b64encode(b'dummy\n').decode() for n in c.s.PATHS}).encode()
                return b''
        with patch.object(runtime,'checkout',return_value=0):
            Native(f.v,clock=lambda:next(times)).run(f.p,f.root,'dummy',lambda:None,Broker())
        self.assertEqual(f.v.read()['last_clock'],1500)
        self.assertEqual(f.v.read()['phase'],'review-needed')

    def warden_fixture(self,wall,mono,returncode=0):
        child=Mock();child.poll.return_value=returncode;child.returncode=returncode
        patches=[patch.object(warden.os,'getpid',return_value=1),patch.object(warden.os,'getuid',return_value=0),
          patch.object(warden.ctypes,'CDLL',return_value=Mock(prctl=Mock(return_value=0))),
          patch.object(warden.shutil,'copytree'),patch.object(warden.os,'walk',return_value=[]),
          patch.object(warden.Path,'read_text',return_value='["/opt/dummy"]'),
          patch.object(warden.time,'time',side_effect=wall),patch.object(warden.time,'monotonic',side_effect=mono),
          patch.object(warden.subprocess,'Popen',return_value=child),patch.object(warden.os,'kill'),
          patch.object(warden.os,'waitpid',side_effect=ChildProcessError),patch.object(warden.time,'sleep')]
        from contextlib import ExitStack
        stack=ExitStack();self.addCleanup(stack.close)
        results=[stack.enter_context(p) for p in patches]
        return results[8],child

    def test_preparation_past_wall_deadline_never_launches(self):
        popen,_=self.warden_fixture([100,201],[10,11])
        with self.assertRaises(SystemExit):warden.main(200,'0'*16)
        popen.assert_not_called()

    def test_preparation_past_monotonic_deadline_with_wall_rollback_never_launches(self):
        popen,_=self.warden_fixture([100,99],[10,111])
        with self.assertRaises(SystemExit):warden.main(200,'0'*16)
        popen.assert_not_called()

    def test_slow_chmod_or_entry_load_is_fenced_before_launch(self):
        popen,_=self.warden_fixture([100,101,201],[10,11,12])
        with self.assertRaises(SystemExit):warden.main(200,'0'*16)
        popen.assert_not_called()

    def test_forged_tmp_markers_cannot_seal_failed_job(self):
        for kind in ('file','symlink','directory'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as d:
                forged=Path(d)/'warden-sealed'
                if kind=='file':forged.touch()
                elif kind=='symlink':forged.symlink_to('/nonexistent')
                else:forged.mkdir()
                self.warden_fixture([100,101,102,103,104,201],[10,11,12,13,14,111],returncode=1)
                with patch.object(warden.os,'open') as writer:
                    warden.main(200,'0'*16)
                    writer.assert_not_called()
                self.assertFalse(runtime.sealed(b'null','0'*16))

    def test_success_record_is_written_only_by_warden_after_zero_exit(self):
        import os
        popen,_=self.warden_fixture([100,101,102,103,104,201],[10,11,12,13,14,111])
        with tempfile.TemporaryFile(mode='w+') as stream:
            fd=os.dup(stream.fileno())
            with patch.object(warden.os,'open',return_value=fd) as writer, patch.object(warden.os,'replace') as publish:
                warden.main(200,'0'*16)
            stream.seek(0)
            self.assertTrue(runtime.sealed(stream.read().encode(),'0'*16))
            args,kwargs=writer.call_args
            self.assertEqual(args[0],'/run/warden/pending.json')
            publish.assert_called_once_with('/run/warden/pending.json','/run/warden/completion.json')
            self.assertTrue(args[1]&os.O_EXCL)
            self.assertTrue(args[1]&os.O_NOFOLLOW)
        self.assertEqual(popen.call_args.kwargs['user'],65534)
        self.assertEqual(popen.call_args.kwargs['group'],65534)
        self.assertEqual(popen.call_args.kwargs['extra_groups'],[])

    def test_completion_binds_success_quiescence_and_exact_job(self):
        good={'version':1,'job':'0'*16,'exit_code':0,'quiesced':True}
        self.assertTrue(runtime.sealed(json.dumps(good).encode(),'0'*16))
        for change in ({'job':'1'*16},{'exit_code':1},{'quiesced':False}):
            self.assertFalse(runtime.sealed(json.dumps(dict(good,**change)).encode(),'0'*16))
