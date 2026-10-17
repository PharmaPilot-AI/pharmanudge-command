"""Validate the actual installed unit's launch shape without querying live services."""
from unittest.mock import patch
import unittest

import test_runner


class InstalledIdentityShapeTests(unittest.TestCase):
    def test_python_module_gateway_launch_is_supported_without_process_environment(self):
        fixture = test_runner.RunnerTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        r = fixture.make_runner()
        module = test_runner.runner
        properties = (
            'Id=hermes-gateway-pharmanudge.service\n'
            'ActiveState=active\nSubState=running\nMainPID=123\n'
            'WorkingDirectory=/root/.hermes/profiles/pharmanudge\n'
            'ExecStart={ path=/usr/local/lib/hermes-agent/venv/bin/python ; '
            'argv[]=/usr/local/lib/hermes-agent/venv/bin/python -m hermes_cli.main '
            '--profile pharmanudge gateway run ; ignore_errors=no ; pid=123 ; code=(null) ; status=0/0 }\n'
        )
        wrapper = '#!/bin/sh\nexec /usr/local/bin/hermes -p pharmanudge "$@"\n'
        with patch.object(r, 'command', return_value=properties) as command, \
                patch.object(module.Path, 'read_text', return_value=wrapper), \
                patch.object(module.os, 'access', return_value=True):
            self.assertTrue(r.verify_identity()['verified'])
        args = command.call_args.args[0]
        self.assertEqual(args[:4], ['systemctl', '--user', 'show', module.SERVICE])
        self.assertNotIn('Environment', ' '.join(args))
        self.assertNotIn('/proc/', ' '.join(args))


if __name__ == '__main__':
    unittest.main()
