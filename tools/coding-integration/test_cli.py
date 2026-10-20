import contextlib
import io
from pathlib import Path
import unittest

class CliTests(unittest.TestCase):
    def test_status_is_readonly_and_run_is_denied_before_any_worker(self):
        import cli
        before=cli.ROOT.exists()
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(cli.main(['status']),2)
        self.assertIn('"live_enabled": false',out.getvalue())
        self.assertEqual(cli.ROOT.exists(),before)
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(cli.main(['run']),2)
        self.assertEqual(cli.ROOT.exists(),before)

if __name__=='__main__':unittest.main()
