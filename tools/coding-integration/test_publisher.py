"""Actual temporary Git; remote publication is synthetic transport only."""
import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest
import control as c

class PublisherTests(unittest.TestCase):
    def test_operator_commit_contains_only_exact_captured_allowed_blobs(self):
        import publisher
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);repo=root/'repo';repo.mkdir()
            def git(*args):return subprocess.check_output(['git','-c','core.hooksPath=/dev/null',*args],cwd=repo).decode().strip()
            git('init','-q');(repo/'unchanged').write_text('base');git('add','unchanged')
            git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','base')
            base=git('rev-parse','HEAD');out=root/'output';out.mkdir()
            data={name:b'dummy fixture only\n' for name in c.s.PATHS}
            for name,raw in data.items():
                path=out/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            manifest=[{'path':n,'sha256':hashlib.sha256(v).hexdigest(),'size':len(v)} for n,v in sorted(data.items())]
            (out/'manifest.json').write_text('{}')
            head=publisher.prepare(repo,base,out,manifest,root/'publish')
            self.assertEqual(subprocess.check_output(['git','show',head+':unchanged'],cwd=root/'publish'),b'base')
            changes=subprocess.check_output(['git','diff-tree','--no-commit-id','--name-only','-r',head],cwd=root/'publish').decode().splitlines()
            self.assertEqual(set(changes),set(c.s.PATHS))
            with self.assertRaisesRegex(c.Denied,'preparation_consumed'):publisher.prepare(repo,base,out,manifest,root/'publish')
    def test_remote_adoption_requires_exact_head_draft_base_marker(self):
        import publisher
        request={'head':'a'*40,'branch':'handoff4/'+'b'*32,'manifest':'c'*64}
        good={'head':{'sha':request['head'],'ref':request['branch'],'repo':{'full_name':c.REPO}},
          'base':{'ref':'main','repo':{'full_name':c.REPO}},'draft':True,'state':'open',
          'title':publisher.TITLE,'body':publisher.body(request),'html_url':'https://github.com/'+c.REPO+'/pull/999'}
        remote=publisher.Remote('/tmp/nonexistent',lambda path:[good])
        self.assertEqual(remote.inspect(request)['url'],good['html_url'])
        good['draft']=False
        with self.assertRaisesRegex(c.Denied,'remote_pr_mismatch'):remote.inspect(request)

if __name__=='__main__':unittest.main()
