"""Checked-in operational defaults must never authorize application work."""
import json
from pathlib import Path
import unittest


class DefaultConfigurationTests(unittest.TestCase):
    def test_example_is_disabled_dry_run_with_empty_allowlist(self):
        config = json.loads(Path(__file__).with_name('config.example.json').read_text())
        self.assertIs(config['enabled'], False)
        self.assertIs(config['dry_run'], True)
        self.assertEqual(config['tasks'], [])
        self.assertEqual(config['repo_dir'], '/root/projects/pharmanudge-command')

    def test_publication_example_has_no_authority(self):
        config = json.loads(Path(__file__).with_name('publication-approval.example.json').read_text())
        self.assertEqual(config, {'enabled': False, 'dry_run': True, 'approvals': []})


if __name__ == '__main__':
    unittest.main()
