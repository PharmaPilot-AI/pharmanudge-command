"""Docker aliases must not expand the reviewed capability set."""
import copy
from pathlib import Path
import unittest
import runtime as r
import control as c

class Capabilities(unittest.TestCase):
    def verify(self,caps):
        job=Path('/tmp/synthetic-job');p=c.proposal('a'*40,'b'*40,1,2)
        obj={'Image':p['image'],'Config':{'User':'0:0','Entrypoint':['/usr/local/bin/python3']},'HostConfig':{
          'ReadonlyRootfs':True,'NetworkMode':'none','Memory':536870912,'MemorySwap':536870912,'NanoCpus':1000000000,
          'PidsLimit':64,'CapDrop':['ALL'],'CapAdd':caps,'Privileged':False,'PidMode':'','SecurityOpt':['no-new-privileges=true'],
          'Tmpfs':{'/work':'rw,nosuid,nodev,size=128m,mode=1777','/out':'rw,noexec,nosuid,nodev,size=1m,mode=1777',
          '/tmp':'rw,noexec,nosuid,nodev,size=8m,mode=1777','/run/warden':'rw,noexec,nosuid,nodev,size=64k,mode=0700'}},
          'Mounts':[{'Destination':d,'Source':str(s),'RW':False} for d,s in [('/inputs',job/'inputs'),('/warden.py',c.HERE/'warden.py'),('/export.py',c.HERE.parent/'development-handoff/handoff.py')]]}
        class Native(r.Runtime):
            def owned(self,token):return copy.deepcopy(obj)
        Native(None).verify_container(p,job,'0'*16)
    def test_legitimate_aliases_through_verifier(self):
        for names in [['CHOWN','KILL','SETGID','SETUID'],['CAP_CHOWN','CAP_KILL','CAP_SETGID','CAP_SETUID'],['CHOWN','CAP_KILL','SETGID','CAP_SETUID']]:
            with self.subTest(names=names):self.verify(names)
    def test_reject_every_nonexact_representation(self):
        good=['CHOWN','KILL','SETGID','SETUID']
        for names in [None,{},'CHOWN KILL SETGID SETUID',tuple(good),[],good[:-1],good+['SYS_ADMIN'],good+['CHOWN'],good+['CAP_CHOWN'],[1,*good[1:]],['chown',*good[1:]],['CAP_cap_CHOWN',*good[1:]],['CAP_CAP_CHOWN',*good[1:]],['CHOWN ',*good[1:]],['0',*good[1:]], [True,*good[1:]]]:
            with self.subTest(names=names),self.assertRaises(c.Denied):self.verify(names)
