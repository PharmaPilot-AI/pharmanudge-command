"""Read-back diagnostics for individual fields, using only synthetic tar bytes."""
import io
from pathlib import Path
import tarfile
import unittest
import fixture_assembler as a

class Archives(unittest.TestCase):
    def tar(self,**changes):
        buf=io.BytesIO();data=changes.pop('data',a.fixture());count=changes.pop('count',1)
        with tarfile.open(fileobj=buf,mode='w',format=tarfile.PAX_FORMAT) as t:
            for _ in range(count):
                m=tarfile.TarInfo(Path(a.MEMBER).name);m.uid=m.gid=0;m.mode=0o555;m.size=len(data)
                for k,v in changes.items():setattr(m,k,v)
                t.addfile(m,io.BytesIO(data) if m.isfile() else None)
        return buf.getvalue()
    def rejections(self):
        return [('member_count',self.tar(count=2)),('type',self.tar(type=tarfile.SYMTYPE,linkname='/dummy')),
          ('linkname',self.tar(linkname='dummy')),('name',self.tar(name='../escape')),
          ('uid',self.tar(uid=1)),('gid',self.tar(gid=1)),('mode',self.tar(mode=0o777)),
          ('size',self.tar(data=b'short')),('content',self.tar(data=b'x'*len(a.fixture()))),
          ('parse',b'x'*10240),('truncated',self.tar()[:600])]
    def test_specific_metadata_content_and_parse_failures(self):
        a.verify_copy_out(self.tar())
        for field,data in self.rejections():
            with self.subTest(field=field),self.assertRaises(a.c.Denied) as caught:a.verify_copy_out(data)
            self.assertEqual(caught.exception.evidence['field'],field)
            self.assertNotIn('escape',str(caught.exception.evidence))
    def test_copy_in_fixed_mtime_and_pax_remain_rejected(self):
        a.validate_archive(a.archive())
        for field,change in [('mtime',{'mtime':1}),('pax_headers',{'pax_headers':{'comment':'DUMMY'}})]:
            raw=self.tar(name=a.MEMBER,**change)
            with self.subTest(field=field),self.assertRaises(a.c.Denied) as caught:a.validate_archive(raw)
            self.assertEqual(caught.exception.evidence['field'],field)
