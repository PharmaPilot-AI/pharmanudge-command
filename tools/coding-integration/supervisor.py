"""Finite operator controller. No service, timer, provider or approval is installed."""
import time
import control as c
import runtime

class Exhausted(Exception):
    """Only a qualified trusted broker may attest a quiesced checkpoint."""
    def __init__(self,checkpoint,retry_at,quiesced):
        self.checkpoint=checkpoint;self.retry_at=retry_at;self.quiesced=quiesced


class Supervisor:
    def __init__(self,vault,policy,repo,revalidate,engine=None,broker=None,clock=time.time):
        self.v=vault;self.p=policy;self.repo=repo;self.revalidate=revalidate
        self.engine=engine or runtime.Runtime(vault);self.broker=broker or c.NoProvider();self.clock=clock
    def step(self):
        with self.v.locked():
            state=self.v.read()
            c.require(state['events'].count('tick')<12,'tick_budget')
            state['events'].append('tick');self.v.save(state)
            phase=state['phase']
        if phase=='paused':
            if not self.v.resume(self.p,self.clock(),self.revalidate,self.broker):return 'paused'
        elif phase not in ('queued','resume-ready','correction-ready'):return phase
        try:self.engine.run(self.p,self.repo,self.p['task_text'],self.revalidate,self.broker)
        except Exhausted as exc:
            self.v.pause(exc.checkpoint,exc.retry_at,quiesced=exc.quiesced)
        return self.v.read()['phase']
    def window(self):
        # A nonrenewable foreground process, not a recurring agent/schedule.
        deadline=time.monotonic()+max(0,min(3600,self.p['not_after']-self.clock()))
        polls=0
        while self.clock()<self.p['not_after'] and time.monotonic()<deadline and polls<12:
            phase=self.step();polls+=1
            if phase!='paused':return phase
            state=self.v.read()
            # Unknown availability is a blocker, never a reason to probe inference.
            if state['resume_after'] is None:return 'paused-status-unavailable'
            delay=max(1,min(300,state['resume_after']-self.clock(),self.p['not_after']-self.clock()))
            time.sleep(delay)
        return 'expired-or-poll-budget'
