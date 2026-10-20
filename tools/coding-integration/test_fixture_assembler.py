"""No Docker side effects: archive and fail-closed assembly boundaries."""
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
import control as c

class Assembly(unittest.TestCase):
    def test_deterministic_exact_root_archive(self):
        import fixture_assembler as a
        raw=a.archive();self.assertEqual(raw,a.archive());a.validate_archive(raw)
        for change in ('path','link','bytes','owner','mode'):
            buf=io.BytesIO()
            with tarfile.open(fileobj=buf,mode='w') as t:
                x=tarfile.TarInfo('../escape' if change=='path' else a.MEMBER)
                data=b'changed' if change=='bytes' else a.fixture()
                x.uid=1 if change=='owner' else 0;x.gid=0;x.mode=0o777 if change=='mode' else 0o555
                if change=='link':x.type=tarfile.SYMTYPE;x.linkname='/etc/passwd'
                else:x.size=len(data)
                t.addfile(x,io.BytesIO(data) if x.isfile() else None)
            with self.subTest(change=change),self.assertRaises(c.Denied):a.validate_archive(buf.getvalue())
    def test_wrong_base_foreign_container_and_unexpected_diff(self):
        import fixture_assembler as a
        base={'Id':a.BASE,'RootFS':{'Layers':['sha256:'+'1'*64]},'Config':{}}
        a.validate_base(base)
        for field,val in [('Volumes',{'/x':{}}),('OnBuild',['RUN false']),('Healthcheck',{'Test':['CMD','false']})]:
            with self.subTest(field=field),self.assertRaises(c.Denied):a.validate_base(dict(base,Config={field:val}))
        with self.assertRaises(c.Denied):a.validate_base(dict(base,Id='sha256:'+'0'*64))
        obj={'Id':'a'*64,'Image':a.BASE,'Config':{'Labels':{'org.pharmanudge.fixture.assembly':'b'*16}},'State':{'Status':'created','Running':False,'StartedAt':'0001-01-01T00:00:00Z'},'Mounts':[]}
        a.validate_owned(obj,'a'*64,'b'*16)
        for delta in ({'Image':'wrong'},{'Mounts':[{}]},{'State':{'Status':'exited','Running':False,'StartedAt':'past'}},{'Id':'f'*64}):
            with self.subTest(delta=delta),self.assertRaises(c.Denied):a.validate_owned(dict(obj,**delta),'a'*64,'b'*16)
        a.validate_diff('C /opt\nA /opt/pharmanudge-qualification-fixture\n')
        for diff in ('','A /etc/secret\n','A /opt/pharmanudge-qualification-fixture\nA /extra\n'):
            with self.assertRaises(c.Denied):a.validate_diff(diff)
    def test_committed_config_is_bounded_not_container_identity(self):
        import fixture_assembler as a
        before={'Hostname':'container-only','Env':['PATH='],'User':'65534:65534','Entrypoint':['/bin/false'],'Labels':{}}
        output={k:v for k,v in before.items() if k!='Hostname'}
        a.validate_config(output,before)
        for delta in ({'Volumes':{'/x':{}}},{'Env':['SECRET=changed']},{'Hostname':'unexpected'}):
            with self.assertRaises(c.Denied):a.validate_config(dict(output,**delta),before)
    def test_owned_cleanup_and_commit_uncertainty_never_retries(self):
        import fixture_assembler as a
        for fail in (False,True):
            with tempfile.TemporaryDirectory() as t:
                journal=Path(t)/'attempt.json';calls=[];obj={}
                def fake(*args,data=None):
                    calls.append(args)
                    if args[:2]==('image','inspect'):
                        if args[2]==a.BASE:return a.json.dumps([{'Id':a.BASE,'RootFS':{'Layers':['sha256:'+'1'*64]},'Config':{}}]).encode()
                        return a.json.dumps([{'Id':args[2],'RootFS':{'Layers':['sha256:'+'1'*64,'sha256:'+'2'*64]},'Config':obj['Config']}]).encode()
                    if args[0]=='create':
                        token=next(x.split('=',1)[1] for x in args if x.startswith('--label=')).split('=',1)[1]
                        obj.update(Id='a'*64,Image=a.BASE,Config={'Labels':{'org.pharmanudge.fixture.assembly':token},'User':'65534:65534','Entrypoint':['/bin/false']},
                          State={'Status':'created','Running':False,'StartedAt':'0001-01-01T00:00:00Z'},Mounts=[],
                          HostConfig={'NetworkMode':'none','Privileged':False,'CapDrop':['ALL'],'Memory':67108864,'PidsLimit':16,'SecurityOpt':['no-new-privileges=true']})
                        return b'a'*64
                    if args[0]=='inspect':return a.json.dumps([obj]).encode()
                    if args[0]=='diff':return ('A /'+a.MEMBER+'\n').encode()
                    if args[0]=='cp' and args[1]!='-':
                        buf=io.BytesIO()
                        with tarfile.open(fileobj=buf,mode='w') as tar:
                            x=tarfile.TarInfo(Path(a.MEMBER).name);x.mode=0o555;x.size=len(a.fixture());tar.addfile(x,io.BytesIO(a.fixture()))
                        return buf.getvalue()
                    if args[0]=='commit':
                        if fail:raise TimeoutError('synthetic commit succeeded but reply lost')
                        return ('sha256:'+'3'*64).encode()
                    return b''
                if fail:
                    with self.assertRaises(c.Denied):a.assemble(journal,fake)
                    self.assertEqual(a.json.loads(journal.read_text())['phase'],'unknown')
                else:self.assertEqual(a.assemble(journal,fake)['phase'],'complete')
                self.assertEqual(sum(x[0]=='commit' for x in calls),1)
                self.assertEqual(calls[-1],('rm','a'*64))
                with self.assertRaises(c.Denied):a.assemble(journal,fake)
                self.assertFalse(any(x[0] in ('start','build','pull','run') for x in calls))
    def test_uncertain_create_is_journaled_and_never_retried(self):
        import fixture_assembler as a
        with tempfile.TemporaryDirectory() as t:
            journal=Path(t)/'attempt.json';calls=[]
            def fake(*args,data=None):
                calls.append(args)
                if args[0]=='image':return a.json.dumps([{'Id':a.BASE,'RootFS':{'Layers':['sha256:'+'1'*64]},'Config':{}}]).encode()
                raise TimeoutError('synthetic create timeout')
            with self.assertRaises(c.Denied):a.assemble(journal,fake)
            self.assertEqual(a.json.loads(journal.read_text())['phase'],'unknown')
            count=len(calls)
            with self.assertRaises(c.Denied):a.assemble(journal,fake)
            self.assertEqual(len(calls),count)
