import {frontmatterRange} from './markdownProperties.js';
import {RecoveryQueue,recoveryFingerprint as fingerprint} from './recoveryQueue.js';

const equal=(a,b)=>fingerprint(a)===fingerprint(b);
export const captureTitle=body=>{const range=frontmatterRange(body);const text=range?body.slice(range.to):body;return text.split('\n').find(line=>line.trim())?.replace(/^\s{0,3}#{1,6}\s+/,'').trim().slice(0,300)||'Untitled note';};
const fields=row=>({body:row.body||'',title:row.title_mode==='automatic'?'':row.title||'',thought_type:row.thought_type||'note',links:row.links||[],state:row.state||'active'});
const anchor=row=>Object.fromEntries(['record_id','document_id','annotation_id','reading_position'].map(key=>[key,row[key]??null]));

/** One body authority. Sessions live outside disposable views and never in browser storage. */
export class ConnectedWriting {
  constructor(api,{row=null,requestUUID=crypto.randomUUID(),value=null,recovery=null,anchorValue=null,onChanged=()=>{},delay=800}={}){
    Object.assign(this,{api,row,requestUUID,onChanged,delay});
    this.id=row?.id||'urn:research:notebook:'+requestUUID;
    this.value=value?structuredClone(value):row?fields(row):fields({title_mode:'automatic'});
    this.anchor=anchor(row||recovery||anchorValue||{});this.recoveries=new Map();
    this.queue=new RecoveryQueue({identity:requestUUID,revision:row?.revision||0,delay,write:sent=>this.write(sent)});
    this.queue.subscribe(()=>this.onChanged(this));
    if(recovery){
      const key=recovery.base_revision,queue=this.recovery(key,recovery);
      queue.latest=this.recoveryPayload(key);queue.latestFingerprint=fingerprint(queue.latest);queue.confirmedFingerprint=queue.latestFingerprint;
    }
  }
  recoveryPayload(revision){return {entry_id:revision?this.id:null,request_uuid:revision?null:this.requestUUID,...this.anchor,
    base_revision:revision,value:structuredClone(this.value),state:'active',owner_confirmed:true};}
  recovery(revision=this.row?.revision||0,saved=null){
    if(!this.recoveries.has(revision)){
      const identity=saved?saved.id.replace('urn:research:writing-draft:',''):crypto.randomUUID();
      const queue=new RecoveryQueue({identity,revision:saved?.revision||0,delay:this.delay,write:async sent=>{
        const row=await this.api.request('workspace/draft',{},sent);
        if(row.id!=='urn:research:writing-draft:'+sent.draft_uuid||row.base_revision!==sent.base_revision||row.entry_id!==sent.entry_id||row.request_uuid!==sent.request_uuid||!equal(row.value,sent.value)||row.state!==sent.state)throw new Error('Writing recovery did not confirm this exact draft.');
        return row;
      }});queue.subscribe(()=>this.onChanged(this));this.recoveries.set(revision,queue);
    }
    return this.recoveries.get(revision);
  }
  edit(patch){
    this.value={...this.value,...patch};
    this.recovery().enqueue(this.recoveryPayload(this.row?.revision||0));
    if(this.value.body.trim())this.queue.enqueue(this.value);else this.queue.hold(this.value);
    this.onChanged(this);
  }
  async write(sent){
    const revision=sent.expected_revision,previous=this.recovery(revision);
    await previous.flush();
    const {draft_uuid,expected_revision,...value}=sent;
    const payload={...value,owner_confirmed:true};let row;
    if(!revision){delete payload.state;row=await this.api.post('workspace/notes',{request_uuid:this.requestUUID,...this.anchor,...payload});}
    else row=await this.api.request('workspace/note',{}, {entry_id:this.id,expected_revision,...payload,title_mode:value.title?'manual':'automatic'});
    if(row.id!==this.id||row.trashed||row.revision!==revision+1||!equal(fields(row),value)||!equal(anchor(row),this.anchor))
      throw Object.assign(new Error('This note changed elsewhere. Both versions are retained.'),{status:409,current:row});
    this.row=row;
    // Protect typing that happened during a held note acknowledgement before
    // retiring the earlier baseline. No earlier response replaces this.value.
    if(!equal(this.value,value)){
      const next=this.recovery(row.revision);next.enqueue(this.recoveryPayload(row.revision));await next.flush();
      if(next.status.phase==='saved')previous.finish();
    }else previous.finish();
    this.onChanged(this);return row;
  }
  adopt(row){
    if(!this.saved||this.queue.busy||this.queue.sent||!row||row.id!==this.id||row.project_id!==this.row.project_id||row.revision<this.row.revision)return false;
    if(!equal(anchor(row),this.anchor))throw new Error('The original note anchor changed; no writing was replaced.');
    this.row=row;this.value=fields(row);this.queue.revision=row.revision;
    this.queue.latest=structuredClone(this.value);this.queue.latestFingerprint=fingerprint(this.value);this.queue.confirmedFingerprint=this.queue.latestFingerprint;
    for(const recovery of this.recoveries.values())recovery.finish();
    this.queue.publish('saved',{row});return true;
  }
  get saved(){return !!this.row&&equal(fields(this.row),this.value)&&!this.queue.sent&&!this.queue.busy;}
  get dirty(){return !this.saved&&!!(this.value.body||this.row||this.queue.sent);}
  get title(){return this.value.title||captureTitle(this.value.body);}
  flush(){for(const recovery of this.recoveries.values())recovery.flush();return this.queue.flush();}
  retry(){for(const recovery of this.recoveries.values())if(['error','conflict'].includes(recovery.status.phase))recovery.retry();return this.queue.retry();}
  resolve(choice){
    const current=this.queue.status.current;if(!current||!['mine','cloud'].includes(choice))return;
    this.row=current;this.queue.sent=null;this.queue.revision=current.revision;
    this.queue.latestFingerprint=null;this.queue.confirmedFingerprint=null;
    this.queue.publish('idle');
    if(choice==='cloud'){this.value=fields(current);for(const recovery of this.recoveries.values())recovery.finish();}
    else this.edit({});
    this.onChanged(this);
  }
}
