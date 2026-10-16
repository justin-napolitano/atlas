import {RecoveryQueue,recoveryFingerprint} from './recoveryQueue.js';
import {notebookMetadata,verifyThought} from './notebookClient.js';

/** Serialize actual notebook writes; failed acknowledgements retry the same ID/CAS. */
export function marginWriter({api,projectId,id,initial,onConfirmed=()=>{},delay=800,maxDelay=5000}){
  const anchor=Object.fromEntries(['record_id','document_id','annotation_id','reading_position'].map(k=>[k,initial[k] ?? null]));
  const uuid=id.slice('urn:research:notebook:'.length);
  const queue=new RecoveryQueue({identity:uuid,revision:initial.revision || 0,delay,maxDelay,write:async sent=>{
    const metadata=notebookMetadata(sent);
    let row;
    if(sent.expected_revision===0){
      const payload={project_id:projectId,request_uuid:uuid,...anchor,...metadata,owner_confirmed:true};delete payload.state;
      const result=await api.post('notebook/entries',payload);
      if(result.id!==id||result.project_id!==projectId)throw new Error('Margin creation returned another note');
      row=await api.request('notebook/entry',{project_id:projectId,entry_id:id});
    }else row=await api.request('notebook/entry',{}, {project_id:projectId,entry_id:id,expected_revision:sent.expected_revision,...metadata,owner_confirmed:true});
    verifyThought(row,projectId,id);
    if(Object.keys(anchor).some(k=>(row[k] ?? null)!==anchor[k]))throw new Error('Margin location was not confirmed');
    if(row.trashed||row.revision!==sent.expected_revision+1||recoveryFingerprint(notebookMetadata(row))!==recoveryFingerprint(metadata)){
      throw Object.assign(new Error('This note changed elsewhere. Both versions are retained.'),{status:409,current:row});
    }
    queue.row=row;onConfirmed(row);return row;
  }});
  queue.row=initial.revision?initial:null;return queue;
}
