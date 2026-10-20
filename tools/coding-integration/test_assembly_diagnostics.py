"""Fault-injected assembly; no Docker daemon or real assembly effects."""
import json
from pathlib import Path
import tempfile
import unittest
import fixture_assembler as a
import control as c

class AssemblyDiagnostics(unittest.TestCase):
    def fake(self,fail_primary=True):
        obj={};calls=[]
        def run(*args,data=None):
            calls.append(args)
            if args[:2]==('image','inspect'):
                return json.dumps([{'Id':a.BASE,'RootFS':{'Layers':['sha256:'+'1'*64]},'Config':{}}]).encode()
            if args[0]=='create':
                token=next(x.split('=',2)[2] for x in args if x.startswith('--label='))
                obj.update(Id='a'*64,Image=a.BASE,Config={'Labels':{'org.pharmanudge.fixture.assembly':token},'User':'65534:65534','Entrypoint':['/bin/false']},
                  State={'Status':'created','Running':False,'StartedAt':'0001-01-01T00:00:00Z'},Mounts=[],
                  HostConfig={'NetworkMode':'none','Privileged':False,'CapDrop':['ALL'],'Memory':67108864,'PidsLimit':16,'SecurityOpt':['no-new-privileges=true']})
                return b'a'*64
            if args[0]=='inspect':return json.dumps([obj]).encode()
            if args[0]=='diff':return ('A /'+a.MEMBER+'\n').encode()
            if args[0]=='cp' and args[1]!='-':return b'not a tar'
            if args[0]=='rm':raise OSError('PRIVATE_CLEANUP_PAYLOAD')
            return b''
        return run,calls
    def test_cleanup_journal_failure_also_preserves_primary(self):
        from unittest.mock import patch
        original=a.c.s.atomic_json
        def persist(path,state):
            if 'cleanup_failure' in state:raise OSError('PRIVATE_PERSIST_ERROR')
            return original(path,state)
        with tempfile.TemporaryDirectory() as t:
            journal=Path(t)/'attempt.json';run,_=self.fake()
            with patch.object(a.c.s,'atomic_json',persist),self.assertRaises(c.Denied) as caught:
                a.assemble(journal,run)
            self.assertEqual(str(caught.exception),'assembly_hold_manual_reconciliation')
            self.assertEqual(json.loads(journal.read_text())['primary_failure']['category'],'archive_parse')
            self.assertTrue(caught.exception.evidence['cleanup_journal_error'])
    def test_cleanup_cannot_replace_archive_primary_or_its_journal_evidence(self):
        with tempfile.TemporaryDirectory() as t:
            journal=Path(t)/'attempt.json';run,calls=self.fake()
            with self.assertRaises(c.Denied) as caught:a.assemble(journal,run)
            state=json.loads(journal.read_text())
            self.assertEqual(state['phase'],'unknown')
            self.assertEqual(state['primary_failure']['category'],'archive_parse')
            self.assertEqual(state['primary_failure']['field'],'truncated')
            self.assertEqual(state['primary_failure']['operation_stage'],'copy-out-verify')
            self.assertIn('cleanup_failure',state)
            self.assertEqual(str(caught.exception),'assembly_hold_manual_reconciliation')
            self.assertNotIn('PRIVATE',json.dumps(state));self.assertFalse(any(x[0]=='commit' for x in calls))
            count=len(calls)
            with self.assertRaises(c.Denied):a.assemble(journal,run)
            self.assertEqual(len(calls),count)
