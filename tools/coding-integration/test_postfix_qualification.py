"""No native effects: prerequisite reporting cannot turn blockers into PASS."""
import unittest
import postfix_qualification as q

class QualificationTests(unittest.TestCase):
    def test_missing_opt_fixture_and_rejected_plan_are_blockers_not_passes(self):
        result=q.assess([],False)
        self.assertFalse(result['runtime_qualified'])
        self.assertEqual(result['status'],'BLOCKED')
        self.assertIn('cached_image_has_no_opt_executable_fixture',result['blockers'])
        self.assertIn('current_verify_container_rejected_cached_image',result['blockers'])
        self.assertTrue(all(v=='NOT RUN' for v in result['runtime_test_gates'].values()))
    def test_preflight_alone_never_qualifies_runtime_even_if_prerequisites_exist(self):
        result=q.assess(['/opt/existing-fixture'],True)
        self.assertFalse(result['runtime_qualified'])
        self.assertEqual(result['status'],'NOT QUALIFIED')
    def test_status_is_inspection_only_and_defaults_to_unqualified(self):
        self.assertFalse(q.status()['native_executed'])
        self.assertFalse(q.status()['live_enabled'])

if __name__=='__main__':unittest.main()
