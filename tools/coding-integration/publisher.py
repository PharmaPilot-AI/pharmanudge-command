"""Trusted operator Git plumbing and nonforce draft publication. Never worker-side."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import control as c

TITLE='fix(auth): prevent native login credential GET fallback'
URL='https://github.com/'+c.REPO+'.git'


def body(request):
    return ('PHARMANUDGE-HANDOFF-04-RESULT\nSource result: '+request['head']+'\nManifest: '+request['manifest']+
      '\nScope: login safeguard only; dummy-value qualification. No deployment or backend authentication.\n')


def prepare(source,base,quarantine,manifest,target):
    """Create a new operator repo/commit from captured blobs, no filters/worktree hooks."""
    c.require(not target.exists(),'preparation_consumed')
    c.require(c.s.hexdigest(base,40) and set(x['path'] for x in manifest)==set(c.s.PATHS),'manifest_paths')
    data=c.s.payloads(quarantine,c.s.PATHS,allow_manifest=True)
    expected=[{'path':n,'sha256':hashlib.sha256(v).hexdigest(),'size':len(v)} for n,v in sorted(data.items())]
    c.require(manifest==expected,'manifest_changed')
    target.mkdir(mode=0o700)
    env={'HOME':str(target),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null',
      'GIT_AUTHOR_NAME':'PharmaNudge operator','GIT_AUTHOR_EMAIL':'operator@example.invalid',
      'GIT_COMMITTER_NAME':'PharmaNudge operator','GIT_COMMITTER_EMAIL':'operator@example.invalid',
      'GIT_AUTHOR_DATE':'2026-10-20T00:00:00Z','GIT_COMMITTER_DATE':'2026-10-20T00:00:00Z'}
    def git(*args,input=None):
        try:
            proc=subprocess.run(['/usr/bin/git','-c','core.hooksPath=/dev/null',*args],cwd=target,env=env,
              input=input,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15,check=True)
            c.require(len(proc.stdout)<=1048576,'git_output_limit');return proc.stdout.decode().strip()
        except (OSError,subprocess.SubprocessError):raise c.Denied('git_preparation_hold') from None
    git('init','-q')
    git('-c','protocol.file.allow=always','fetch','--no-tags','--no-recurse-submodules',str(Path(source).resolve()),base)
    c.require(git('rev-parse','FETCH_HEAD')==base,'base_changed')
    git('read-tree',base)
    for name,raw in sorted(data.items()):
        oid=git('hash-object','-w','--stdin',input=raw)
        git('update-index','--add','--cacheinfo','100644,'+oid+','+name)
    tree=git('write-tree')
    head=git('commit-tree',tree,'-p',base,input=b'fix(auth): native login fallback safeguard\n')
    changes=git('diff-tree','--no-commit-id','--name-only','-r',head).splitlines()
    c.require(set(changes)==set(c.s.PATHS),'commit_scope')
    git('update-ref','refs/heads/result',head)
    return head


class Remote:
    def __init__(self,repo,api=None):
        self.repo=Path(repo);self.api=api or c.b.GitHubIngress._api
    def inspect(self,r):
        c.require(c.s.hexdigest(r['head'],40) and c.s.hexdigest(r['manifest'],64)
                  and r['branch'].startswith('handoff4/') and len(r['branch'])==41,'publication_request')
        rows=self.api(f'repos/{c.REPO}/pulls?state=all&head=PharmaPilot-AI:'+r['branch']+'&per_page=100')
        c.require(isinstance(rows,list) and len(rows)<=1,'remote_ambiguity')
        if not rows:return None
        row=rows[0]
        c.require(row['head']['sha']==r['head'] and row['head']['ref']==r['branch'] and row['head']['repo']['full_name']==c.REPO
          and row['base']['ref']=='main' and row['base']['repo']['full_name']==c.REPO and row['draft'] is True
          and row['state']=='open' and row['title']==TITLE and row['body']==body(r),'remote_pr_mismatch')
        return {'url':row['html_url']}
    def publish(self,r):
        # Called only AFTER durable one-attempt publication intent. Any partial effect holds.
        c.require(self.inspect(r) is None,'remote_already_exists')
        env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin','LANG':'C.UTF-8',
             'GH_CONFIG_DIR':str(Path.home()/'.config/gh'),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
        cmd=c.b.Command(env)
        cmd.run(['/usr/bin/git','-c','core.hooksPath=/dev/null','-c','credential.helper=!/usr/bin/gh auth git-credential',
          'push','--no-verify',URL,r['head']+':refs/heads/'+r['branch']],cwd=self.repo,timeout=30)
        obj=self.api(f'repos/{c.REPO}/git/ref/heads/'+r['branch'])
        c.require(obj['object']['sha']==r['head'],'remote_head_mismatch')
        raw=json.dumps({'title':TITLE,'body':body(r),'head':r['branch'],'base':'main','draft':True}).encode()
        try:
            proc=subprocess.run(['/usr/bin/gh','api',f'repos/{c.REPO}/pulls','--method','POST','--input','-'],
              input=raw,env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=30,check=True)
            c.require(len(proc.stdout)<=65536,'publication_response')
        except (OSError,subprocess.SubprocessError):raise c.Denied('publication_unknown') from None
