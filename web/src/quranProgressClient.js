import {RecoveryQueue} from './recoveryQueue.js';

export function verifyProgress(row,projectId,chapters){
  if(row?.project_id!==projectId||!Number.isInteger(row.chapter)||!Number.isInteger(row.ayah)||row.chapter<1||row.chapter>chapters.length||row.ayah<1||row.ayah>chapters[row.chapter-1].ayah_count||typeof row.is_read!=='boolean'||!Number.isInteger(row.revision)||row.revision<1||(row.is_read?typeof row.read_at!=='string'||!Number.isFinite(Date.parse(row.read_at)):row.read_at!==null))throw new Error('Reading progress did not match this project and verse.');
  return row;
}

/** Private per-ayah CAS queues survive view navigation with the draft owner. */
export class QuranProgressClient{
  constructor(api,projectId,store,chapters,changed=()=>{}){Object.assign(this,{api,projectId,store,chapters,changed});this.rows=new Map();this.queues=new Map();this.listeners=new Set();this.loaded=false;this.loading=false;this.error='';}
  subscribe=listener=>{this.listeners.add(listener);return()=>this.listeners.delete(listener);};
  emit(){this.changed();for(const listener of this.listeners)listener();}
  key(c,a){return c+':'+a;}
  draftKey(c,a){return 'quran-progress:'+JSON.stringify([this.projectId,c,a]);}
  async load(){if(this.loading)return;this.loading=true;this.error='';this.emit();try{
    const page=await this.api.request('quran/progress',{project_id:this.projectId});
    if(page.project_id!==this.projectId||!Array.isArray(page.items)||page.items.length>6236)throw new Error('Reading progress did not match this project.');
    const rows=new Map();for(const row of page.items){verifyProgress(row,this.projectId,this.chapters);const key=this.key(row.chapter,row.ayah);if(rows.has(key))throw new Error('Duplicate reading progress.');rows.set(key,row);}
    for(const [key,row] of rows){const q=this.queues.get(key);if((!q||!q.sent&&!q.busy&&['idle','saved'].includes(q.status.phase))&&row.revision>(this.rows.get(key)?.revision||0)){this.rows.set(key,row);this.totals=null;if(q){q.row=row;q.revision=row.revision;q.latest=null;q.latestFingerprint=null;q.confirmedFingerprint=null;q.status={phase:'saved',row};}}}
    this.loaded=true;
  }catch{this.error='Reading progress could not be loaded. Your reading and notes are unchanged.';}finally{this.loading=false;this.emit();}}
  desired(c,a){return this.store.get(this.draftKey(c,a))?.is_read??this.rows.get(this.key(c,a))?.is_read??false;}
  queue(c,a){const key=this.key(c,a),draftKey=this.draftKey(c,a);if(this.queues.has(key))return this.queues.get(key);
    const queue=new RecoveryQueue({identity:crypto.randomUUID(),revision:this.rows.get(key)?.revision||0,write:async sent=>{
      const {draft_uuid,...payload}=sent;let response;try{response=await this.api.request('quran/progress',{},payload);}catch(error){if(error.status===409){const current=verifyProgress(error.current,this.projectId,this.chapters);if(current.chapter!==c||current.ayah!==a)throw new Error('Conflicting progress did not match this ayah.');}throw error;}const row=verifyProgress(response,this.projectId,this.chapters);
      if(row.chapter!==c||row.ayah!==a||row.is_read!==sent.is_read||row.revision!==sent.expected_revision+1)throw new Error('Progress save was not confirmed for this ayah.');
      this.rows.set(key,row);this.totals=null;queue.row=row;return row;
    }});queue.row=this.rows.get(key);queue.subscribe(status=>{
      const held=this.store.get(draftKey);
      if(held&&status.phase==='saved'&&status.row?.is_read===held.is_read)this.store.delete(draftKey);
      else if(held)this.store.set(draftKey,{...held,saving:['saving','waiting'].includes(status.phase),error:status.error?.message||'',current:status.current||null});
      this.emit();
    });this.queues.set(key,queue);return queue;
  }
  set(c,a,is_read){if(!this.loaded||this.error||this.desired(c,a)===is_read)return;const q=this.queue(c,a),blocked=['error','conflict'].includes(q.status.phase);
    this.store.set(this.draftKey(c,a),{projectId:this.projectId,workspaceMode:'quran',is_read,saving:!blocked,error:q.status.error?.message||'',current:q.status.current||null});
    q.enqueue({project_id:this.projectId,chapter:c,ayah:a,is_read,owner_confirmed:true});this.emit();return q.flush();
  }
  resolve(c,a,choice){const q=this.queue(c,a);if(q.busy||!q.status.current)return;
    const row=verifyProgress(q.status.current,this.projectId,this.chapters);if(row.chapter!==c||row.ayah!==a)throw new Error('Conflicting progress belongs to another ayah.');
    this.rows.set(this.key(c,a),row);this.totals=null;q.row=row;q.revision=row.revision;q.sent=null;q.confirmedFingerprint=null;
    if(choice==='saved'){this.store.delete(this.draftKey(c,a));q.latest=null;q.latestFingerprint=null;q.publish('saved',{row});}
    else if(choice==='mine')q.retry();this.emit();
  }
  counts(chapter){if(!this.totals){this.totals={total:0,chapters:new Map()};for(const row of this.rows.values())if(row.is_read){this.totals.total++;this.totals.chapters.set(row.chapter,(this.totals.chapters.get(row.chapter)||0)+1);}}return {total:this.totals.total,chapter:this.totals.chapters.get(chapter)||0};}
  failures(){return [...this.queues.entries()].filter(([,q])=>['error','conflict'].includes(q.status.phase));}
}
