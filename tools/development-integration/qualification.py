"""Explicit, finite, zero-provider-call native qualification; never live activation."""
import argparse
import io
import json
import os
from pathlib import Path
import time
import sys
import unittest
from typing import cast
import bindings as b


class EvidenceRunner(unittest.TextTestResult):
    def __init__(self,*args,**kwargs):super().__init__(*args,**kwargs);self.passed=[]
    def addSuccess(self,test):super().addSuccess(test);self.passed.append(test.id())


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['status','native'])
    parser.add_argument('--allow-synthetic-containers',action='store_true')
    parser.add_argument('--source-sha')
    args=parser.parse_args(argv)
    if args.action=='status':print(json.dumps(b.live_status(),sort_keys=True));return 2
    try:
        b.require(args.allow_synthetic_containers,'explicit_native_permission_required')
        root=Path(__file__).resolve().parents[2]
        source=b.SourceIdentity(root).verify(args.source_sha)
        previous=os.environ.get('PHARMANUDGE_NATIVE_QUALIFICATION')
        os.environ['PHARMANUDGE_NATIVE_QUALIFICATION']='1'
        try:
            import test_native
            suite=unittest.defaultTestLoader.loadTestsFromTestCase(test_native.NativeTests)
            stream=io.StringIO();start=time.monotonic()
            result=cast(EvidenceRunner,unittest.TextTestRunner(stream=stream,verbosity=2,resultclass=EvidenceRunner).run(suite))
            b.SourceIdentity(root).verify(source)
            report={'source_sha':source,'implementation_sha256':b.implementation_digest(),'image_id':b.IMAGE,
              'native_tests_run':result.testsRun,'native_tests_passed':result.passed,
              'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
              'qualified':result.wasSuccessful() and not result.skipped,'duration_seconds':round(time.monotonic()-start,3),
              'provider_calls':0,'billing_qualified':False,'live_enabled':False,'automatic_pickup_active':False,
              'transport':'synthetic assignment in native end-to-end test; no fixture GitHub publication'}
            print(json.dumps(report,sort_keys=True))
            if not report['qualified']:
                # Harmless fixture traces only; never published as success evidence.
                print(stream.getvalue(),file=sys.stderr)
            return 0 if report['qualified'] else 1
        finally:
            if previous is None:os.environ.pop('PHARMANUDGE_NATIVE_QUALIFICATION',None)
            else:os.environ['PHARMANUDGE_NATIVE_QUALIFICATION']=previous
    except (b.Denied,OSError,ValueError,KeyError):
        print(json.dumps({'qualified':False,'live_enabled':False,'status':'qualification_refused'}));return 2


if __name__=='__main__':raise SystemExit(main())
