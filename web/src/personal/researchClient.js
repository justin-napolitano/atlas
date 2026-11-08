// A scoped browser view of the Go bridge. Credentials never enter this module.
const exact=value=>JSON.stringify(value,(_,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export class ResearchSession{
 constructor(client,account,brain,onChange=()=>{}){Object.assign(this,{client,account,brain,onChange});this.snapshot=null;this.pending=null;this.flight=null;this.uncertain=false;}
 path(action){return `${this.client.brain(this.account,this.brain)}/research/${action}`;}
 async load(){
  const serial=this.loadSerial=(this.loadSerial||0)+1,value=await this.client.request(this.path('state'));
  if(!value||!Array.isArray(value.items)||value.total!==value.items.length||typeof value.generation_id!=='string')throw Error('The research snapshot was not confirmed.');
  if(value.brain_id&&value.brain_id!==this.brain)throw Error('Research response belongs to another brain.');
  if(serial!==this.loadSerial)return this.snapshot;
  this.snapshot=value;this.refreshError=null;
  if(!this.pending&&value.pending?.length){this.pending=structuredClone(value.pending[0].operation);this.uncertain=true;}
  const retained=value.pending?.find(row=>row.operation.operation_id===this.pending?.operation_id);
  if(retained?.receipt?.outcome==='conflict'){this.confirmedConflict=retained.receipt;this.recoveredConflict=retained.receipt.record;}
  this.onChange();return value;
 }
 async save(record,baseRevision=0){
  if(this.flight)return this.flight;
  if(!this.snapshot)throw Error('Load this brain before changing research.');
  if(!this.pending&&this.snapshot.offline)throw Error('Load current research before starting a new change. Your local draft is retained.');
  if(!this.pending){for(const [key,max] of [['title',1000],['document',262144],['body',65536]])if(typeof record[key]==='string'&&(new TextEncoder().encode(record[key]).length>max||record[key].includes('\0')))throw Error('This '+key+' exceeds the supported text limit. Your draft is retained.');}
  this.pending??={operation_id:crypto.randomUUID(),generation_id:this.snapshot.generation_id,base_revision:baseRevision,record:structuredClone({...record,revision:0})};
  const sent=this.pending,wasUncertain=this.uncertain;
  this.flight=(async()=>{
   const receipt=await this.client.request(this.path('operations'),structuredClone(sent));
   if(receipt.operation_id!==sent.operation_id||['organization_id','brain_id','user_id'].some(key=>this.snapshot[key]!==undefined&&receipt[key]!==this.snapshot[key]))throw Error('The research operation was not confirmed. Retry the exact operation.');
   if(receipt.outcome==='conflict'){this.confirmedConflict=receipt;this.recoveredConflict=receipt.record;const error=Error('This research item changed. Both versions remain available for review.');error.current=receipt.record;throw error;}
   if(receipt.outcome!=='accepted'||receipt.generation_id!==sent.generation_id||!receipt.record||receipt.record.revision!==sent.base_revision+1||Object.keys(sent.record).some(key=>key!=='revision'&&exact(receipt.record[key])!==exact(sent.record[key])))throw Error('The research operation was not confirmed.');
   // Acceptance is final even if the following read fails. Consume only the form
   // represented by this operation, including when its original view unmounted.
   this.pending=null;this.uncertain=false;this.recoveredConflict=null;this.confirmedConflict=null;
   const items=[...this.snapshot.items.filter(row=>row.id!==receipt.record.id),receipt.record];this.snapshot={...this.snapshot,items,total:items.length};
   this.onAccepted?.(receipt,sent.record);
   try{await this.load();}catch(error){this.refreshError=error;}
   return receipt;
  })().catch(error=>{if([400,413,422].includes(error.status)&&!wasUncertain){this.pending=null;this.uncertain=false;}else this.uncertain=true;throw error;}).finally(()=>{this.flight=null;this.onChange();});
  this.onChange();return this.flight;
 }
 async resolveConflict(){
  if(this.flight)return this.flight;
  const sent=this.pending;
  if(!sent||this.confirmedConflict?.operation_id!==sent.operation_id||this.confirmedConflict.outcome!=='conflict')throw Error('Only a confirmed conflicting proposal can be resolved. Unknown saves must be retried.');
  this.flight=(async()=>{
   const result=await this.client.request(this.path('resolve'),{operation_id:sent.operation_id});
   if(result?.operation_id!==sent.operation_id||result.resolved!==true)throw Error('Conflict resolution was not confirmed. Retry this same resolution.');
   this.resolvedProposals=[...(this.resolvedProposals||[]),{operation:structuredClone(sent),receipt:this.confirmedConflict}];
   this.pending=null;this.uncertain=false;this.recoveredConflict=null;this.confirmedConflict=null;
   this.onResolved?.(sent.record);
   try{await this.load();}catch(error){this.refreshError=error;}
   return result;
  })().finally(()=>{this.flight=null;this.onChange();});this.onChange();return this.flight;
 }
 get dirty(){return !!this.pending;}
}
export function bindPassage(source,selection){
 if(!source||!selection)throw Error('Select a passage in the source first.');
 const characters=Array.from(source.document);
 if(!Number.isInteger(selection.start)||!Number.isInteger(selection.end)||selection.start<0||selection.end<=selection.start||characters.slice(selection.start,selection.end).join('')!==selection.exact)throw Error('The selected passage did not match this source version.');
 return {source_id:source.id,document_version:source.document_version,sha256:source.sha256,selector:{...selection,prefix:characters.slice(Math.max(0,selection.start-40),selection.start).join(''),suffix:characters.slice(selection.end,selection.end+40).join('')}};
}
export function passageRecord(draft,body,shared=false){
 if(!draft?.source_id||!draft.document_version||!draft.sha256||!draft.selector)throw Error('Inspect the source-bound passage before saving.');
 return newRecord('annotation',{...structuredClone(draft),body,visibility:shared?'shared':'private'});
}
/** Cache completion does not depend on a React view remaining mounted. */
export function consumeResearchForm(form,record){
 if(record.kind==='collection'&&form.groupTitle===record.title){form.group=record.id;form.groupTitle='';}
 if(record.kind==='source'&&form.title===record.title&&form.text===record.document){form.title='';form.text='';if(!form.draft&&!form.body)form.sourceID=record.id;}
 if(record.kind==='annotation'&&form.body===record.body&&form.draft?.source_id===record.source_id&&form.draft.document_version===record.document_version&&form.draft.sha256===record.sha256&&exact(form.draft.selector)===exact(record.selector)&&!!form.shared===(record.visibility==='shared')){form.draft=null;form.body='';form.shared=false;}
}
export function hasRetainedResearchDraft(scopes){
 return [...scopes].some(({store,form={}})=>store?.dirty||!!(form.draft||form.body||form.text||form.groupTitle||form.title));
}
export async function textHash(text){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function newRecord(kind,fields={}){return {id:crypto.randomUUID(),revision:0,kind,visibility:kind==='annotation'||kind==='progress'?'private':'shared',deleted:false,title:'',source_id:'',document_version:'',sha256:'',collection_id:'',document:'',selector:null,body:'',position:0,...fields};}
