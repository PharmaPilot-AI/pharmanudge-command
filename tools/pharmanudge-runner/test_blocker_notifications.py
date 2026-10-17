"""Owner alerts remain static, gated and separate from task execution authority."""
import unittest
from unittest.mock import patch

import test_runner


class BlockerNotificationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_runner.RunnerTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.prepare_repo()
        self.runner = self.fixture.active_runner()
        self.module = test_runner.runner

    def test_rejected_author_alerts_owner_without_claim_or_worker(self):
        self.fixture.remote_issue['user']['login'] = 'unapproved'
        with patch.object(self.runner, 'command', side_effect=self.fixture.fake_remote(self.runner.command)), \
                patch.object(self.runner, 'verify_identity'), patch.object(self.runner, 'notify') as notify:
            with self.assertRaises(self.module.SafetyError):
                self.runner.poll()
        notify.assert_called_once_with('blocker')
        self.assertEqual(self.runner.load_state()['claims'], {})
        self.assertEqual(self.runner.load_state()['days'], {})

    def test_unknown_prior_run_alerts_without_authorizing_new_work(self):
        day = self.module.utc_day()
        with self.runner.lock():
            self.runner.save_state({'version': 1, 'claims': {
                '99:' + 'a' * 64: {'status': 'claimed', 'day': day}}, 'days': {day: 1}})
        with patch.object(self.runner, 'authorize', side_effect=AssertionError('no new authorization')), \
                patch.object(self.runner, 'verify_identity'), patch.object(self.runner, 'notify') as notify:
            self.assertEqual(self.runner.poll(), 'reconciliation-required')
        notify.assert_called_once_with('unknown')
        self.assertEqual(self.runner.load_state()['days'][day], 1)

    def test_exhausted_budget_alerts_without_starting_a_fifth_worker(self):
        day = self.module.utc_day()
        with self.runner.lock():
            self.runner.save_state({'version': 1, 'claims': {
                str(i) + ':' + 'a' * 64: {'status': 'failed', 'day': day}
                for i in range(10, 14)}, 'days': {day: 4}})
        with patch.object(self.runner, 'authorize', return_value='fixture'), \
                patch.object(self.runner, 'verify_identity'), patch.object(self.runner, 'notify') as notify:
            self.assertEqual(self.runner.poll(), 'budget-exhausted')
        notify.assert_called_once_with('blocker')
        self.assertEqual(self.runner.load_state()['days'][day], 4)

    def test_unverified_identity_never_sends_blocker_to_a_wrong_destination(self):
        self.fixture.remote_issue['state'] = 'closed'
        with patch.object(self.runner, 'command', side_effect=self.fixture.fake_remote(self.runner.command)), \
                patch.object(self.runner, 'verify_identity', side_effect=self.module.SafetyError('identity rejected')), \
                patch.object(self.runner, 'notify') as notify:
            with self.assertRaises(self.module.SafetyError):
                self.runner.poll()
        notify.assert_not_called()


if __name__ == '__main__':
    unittest.main()
