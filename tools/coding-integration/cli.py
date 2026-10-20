"""Executable operator procedure; inspection does not initialize a queue or worker."""
import argparse
import json
import os
from pathlib import Path
import time
import control as c

ROOT=Path('/var/lib/pharmanudge-coding-handoff04')
SOURCE=c.HERE.parent.parent
LEGACY=Path('/root/.hermes/profiles/pharmanudge/state/pharmanudge-runner')


def legacy():return c.b.LegacyGuard(LEGACY/'config.json',LEGACY/'state.json',LEGACY/'state.json')


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('status','manifest','pickup','run','resume','review','prepare-publication','publish','stop'))
    parser.add_argument('--mode',choices=('included-only','strict-usd'),default='included-only')
    parser.add_argument('--source-sha');parser.add_argument('--not-before',type=int);parser.add_argument('--not-after',type=int)
    args=parser.parse_args(argv)
    try:
        if args.action=='status':
            print(json.dumps({'live_enabled':False,'automatic_pickup_active':False,'included_only_qualified':False,
              'strict_usd_qualified':False,'provider_requests':0,'canonical_vault_exists':ROOT.exists()}));return 2
        c.require(os.geteuid()==0,'operator_privilege_required')
        ingress=c.b.GitHubIngress()
        if args.action=='manifest':
            c.b.SourceIdentity(SOURCE).verify(args.source_sha)
            c.verify_authorities(ingress)
            base=ingress._api(f'repos/{c.REPO}/git/ref/heads/main')['object']['sha']
            p=c.proposal(args.source_sha,base,args.not_before,args.not_after)
            p['mode']=args.mode
            row=ingress.comment(6286613477)
            p['task']={'comment_id':row['id'],'record_sha256':c.record_digest(row)}
            with legacy().exclusive():p['legacy_sha256']=legacy().inspect()['sha256']
            c.validate_policy(p)
            print(json.dumps({'manifest':p,'manifest_sha256':c.digest(p)},sort_keys=True));return 0
        c.require(ROOT.is_dir(),'canonical_vault_not_provisioned')
        v=c.Vault(ROOT)
        if args.action=='stop':
            # STOP remains executable without a valid/available/expired policy.
            if not os.path.lexists(ROOT/'STOP'):c.s.atomic_json(ROOT/'STOP',{'stopped':True},exclusive=True)
            if v.path.exists():
                state=v.read()
                if state.get('job'):
                    from runtime import Runtime
                    Runtime(v).stop(state['job'])
            print(json.dumps({'stopped':True,'budgets_preserved':True}));return 0
        p=c.private_json(ROOT/'policy.json');c.validate_policy(p)
        checks=c.Checks(p,c.b.SourceIdentity(SOURCE),legacy(),ingress)
        def revalidate():
            checks();c.verify_authorities(ingress)
        if args.action=='pickup':
            revalidate();phase=v.pickup(p,ingress.comment)
        elif args.action in ('run','resume'):
            from supervisor import Supervisor
            phase=Supervisor(v,p,SOURCE,revalidate).window()
        elif args.action=='review':
            v.review(p,time.time(),revalidate);phase=v.read()['phase']
        elif args.action=='prepare-publication':
            import publisher
            with v.locked():
                state=v.guard(p,time.time(),revalidate)
                approval=c.private_json(ROOT/'publication-approval.json')
                c.require(state['phase'] in ('reviewed','review-needed') and state['reviews']==1 and approval=={
                  'policy':c.digest(p),'manifest':state['manifest'],'approved':True},'publication_approval')
                folder=ROOT/'quarantine'/str(state['starts']);manifest=c.private_json(folder/'manifest.json')
                c.require(c.digest(manifest)==state['manifest'],'manifest_drift')
                head=publisher.prepare(SOURCE,p['base_sha'],folder,manifest,ROOT/'publication-repo')
                request={'head':head,'branch':'handoff4/'+state['policy'][:32],'manifest':state['manifest']}
                c.s.atomic_json(ROOT/'publication-request.json',request,exclusive=True);phase='publication-prepared'
        else:
            import publisher
            request=c.private_json(ROOT/'publication-request.json')
            v.publish(p,time.time(),revalidate,request,publisher.Remote(ROOT/'publication-repo'));phase=v.read()['phase']
        print(json.dumps({'phase':phase,'live_enabled':False}));return 0
    except (c.Denied,OSError,KeyError,TypeError,ValueError):
        # Never print arbitrary task/provider/remote/error strings or local diagnostics.
        print(json.dumps({'blocked':True,'live_enabled':False,'reason':'operator_preflight_or_capability_unqualified'}));return 2

if __name__=='__main__':raise SystemExit(main())
