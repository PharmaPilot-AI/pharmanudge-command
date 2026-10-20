"""Integrated synthetic task/engine/remote; real persistence/export/Git preparation."""
from pathlib import Path
import subprocess
import tempfile
import unittest
import control as c
import runtime
import publisher

class IntegrationTests(unittest.TestCase):
    def test_one_task_review_capture_commit_and_draft_publication_transport(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);v=c.Vault(root);repo=root/'baseline';repo.mkdir()
            def git(*args):return subprocess.check_output(['git','-c','core.hooksPath=/dev/null',*args],cwd=repo).decode().strip()
            git('init','-q');(repo/'baseline').write_text('dummy fixture');git('add','baseline')
            git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base')
            p=c.proposal('a'*40,git('rev-parse','HEAD'),1000,4600)
            row={'id':11,'issue_url':'https://api.github.com/repos/'+c.REPO+'/issues/4','user':{'id':319955168,'login':'PharmaPilot-AI'},'body':'SYNTHETIC no actual coding task','created_at':'x','updated_at':'x'}
            p.update(enabled=True,dry_run=False,task={'comment_id':11,'record_sha256':c.record_digest(row)})
            v.pickup(p,lambda _:row);c.s.atomic_json(root/'approval.json',{'approved':True,'policy':c.digest(p)})
            class Broker:
                def admit(_,p):pass
            v.admit(p,1001,lambda:None,Broker())
            data={n:b'SYNTHETIC not application implementation\n' for n in c.s.PATHS}
            manifest=runtime.capture(v,p,data,v.read())
            c.s.atomic_json(root/'review.json',{'policy':c.digest(p),'manifest':c.digest(manifest),'verdict':'approve'})
            v.review(p,1100,lambda:None)
            c.s.atomic_json(root/'publication-approval.json',{'policy':c.digest(p),'manifest':c.digest(manifest),'approved':True})
            head=publisher.prepare(repo,p['base_sha'],root/'quarantine/1',manifest,root/'publication-repo')
            req={'head':head,'manifest':c.digest(manifest),'branch':'handoff4/'+c.digest(p)[:32]}
            effects=[]
            class Remote:
                def inspect(_,req):return {'url':'https://github.com/'+c.REPO+'/pull/999'} if effects else None
                def publish(_,req):effects.append(req)
            v.publish(p,1101,lambda:None,req,Remote())
            self.assertEqual(v.read()['phase'],'published')
            self.assertEqual(v.read()['starts'],1)
            self.assertEqual(v.read()['reviews'],1)
            self.assertEqual(v.pickup(p,lambda _:row),'published')
            v.publish(p,1102,lambda:None,req,Remote())
            self.assertEqual(len(effects),1)

if __name__=='__main__':unittest.main()
