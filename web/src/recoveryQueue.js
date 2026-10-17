/** Serial CAS recovery writes. Failed requests stay frozen until an explicit retry. */
export const recoveryFingerprint=value=>JSON.stringify(value,(_,item)=>item && !Array.isArray(item) && typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export class RecoveryQueue {
  constructor({write,identity,revision=0,delay=800,maxDelay=5000}){
    Object.assign(this,{write,identity,revision,delay,maxDelay});this.listeners=new Set();this.status={phase:'idle'};
  }
  subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  publish(phase,extra={}){this.status={phase,...extra};for(const listener of this.listeners)listener(this.status);}
  enqueue(payload){
    const fingerprint=recoveryFingerprint(payload);
    if(fingerprint===this.latestFingerprint)return;
    this.latest=structuredClone(payload);this.latestFingerprint=fingerprint;
    if(this.status.phase==='error' || this.status.phase==='conflict')return;
    clearTimeout(this.quiet);this.quiet=setTimeout(()=>this.flush(),this.delay);
    if(!this.deadline)this.deadline=setTimeout(()=>this.flush(),this.maxDelay);
    if(!this.busy)this.publish('waiting');
  }
  async flush(){
    clearTimeout(this.quiet);clearTimeout(this.deadline);this.quiet=this.deadline=null;
    if(this.busy || !this.latest || ['error','conflict'].includes(this.status.phase))return;
    if(!this.sent&&this.latestFingerprint===this.confirmedFingerprint)return;
    if(!this.sent)this.sent={...this.latest,draft_uuid:this.identity,expected_revision:this.revision};
    const sent=this.sent;this.busy=true;this.publish('saving');
    try{
      const row=await this.write(structuredClone(sent));
      if(row.revision!==sent.expected_revision+1)throw new Error('Recovery revision was not confirmed');
      this.revision=row.revision;this.sent=null;this.busy=false;
      const {draft_uuid,expected_revision,...payload}=sent;
      this.confirmedFingerprint=recoveryFingerprint(payload);
      if(recoveryFingerprint(payload)!==this.latestFingerprint){this.publish('waiting');return this.flush();}
      this.publish('saved',{row});
    }catch(error){this.busy=false;this.publish(error.status===409?'conflict':'error',{error,current:error.current || null});}
  }
  retry(){if(this.busy)return;this.publish('waiting');return this.flush();}
  fork(){if(this.busy)return;this.identity=crypto.randomUUID();this.revision=0;this.sent=null;this.confirmedFingerprint=null;this.publish('waiting');return this.flush();}
  finish(){
    if(!this.latest)return Promise.resolve();
    this.enqueue({...this.latest,state:'discarded'});
    return this.flush();
  }
}
