"""Image metadata compatibility must not weaken exact job ownership."""
import json
from pathlib import Path
import tempfile
import unittest
import control as c
import runtime

class ImageLabelTests(unittest.TestCase):
    def check(self, inherited, extra=None, image=None, inspected=None):
        token='0123456789abcdef'
        labels=dict(inherited or {})
        labels.update({'pharmanudge.handoff':'04','pharmanudge.job':token})
        labels.update(extra or {})
        class Native(runtime.Runtime):
            def docker(_, *args):
                if args[0]=='image':
                    return json.dumps([{'Id':inspected or c.b.IMAGE,'Config':{'Labels':inherited}}]).encode()
                return json.dumps([{'Image':image or c.b.IMAGE,'Config':{'Labels':labels}}]).encode()
        with tempfile.TemporaryDirectory() as folder:
            return Native(c.Vault(Path(folder))).owned(token)
    def test_exact_inherited_metadata_is_accepted(self):
        self.check({'org.opencontainers.image.ref.name':'cached fixture'})
    def test_null_image_labels_are_accepted(self):
        self.check(None)
    def test_unexpected_container_label_is_rejected(self):
        with self.assertRaisesRegex(c.Denied,'foreign_container'):
            self.check({}, {'unexpected':'value'})
    def test_wrong_job_is_rejected(self):
        with self.assertRaisesRegex(c.Denied,'foreign_container'):
            self.check({}, {'pharmanudge.job':'f'*16})
    def test_wrong_container_or_inspected_image_is_rejected(self):
        for kwargs in ({'image':'sha256:'+'0'*64},{'inspected':'sha256:'+'0'*64}):
            with self.subTest(kwargs=kwargs),self.assertRaisesRegex(c.Denied,'foreign_container'):
                self.check({},**kwargs)
    def test_reserved_image_label_is_rejected(self):
        with self.assertRaisesRegex(c.Denied,'image_labels'):
            self.check({'pharmanudge.job':'image-controlled'})
    def test_changed_inherited_label_is_rejected(self):
        with self.assertRaisesRegex(c.Denied,'foreign_container'):
            self.check({'org.opencontainers.image.ref.name':'pinned'},
                       {'org.opencontainers.image.ref.name':'changed'})

if __name__=='__main__':unittest.main()
