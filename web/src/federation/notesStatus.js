import {recoveryFingerprint} from '../recoveryQueue.js';
export function ownerNoteStatus(session){
 if(session.saved)return 'Saved';
 const phase=session.queue.status.phase;
 if(phase==='conflict')return 'Conflict · both versions retained';
 if(phase==='error')return 'Save unconfirmed · draft retained';
 const payload=session.recoveryPayload(session.row?.revision||0),fingerprint=recoveryFingerprint(payload);
 if([...session.recoveries.values()].some(queue=>queue.confirmedFingerprint===fingerprint))return 'Recovery copy saved · note not yet saved';
 return phase==='saving'?'Saving…':session.dirty?'Unsaved writing':'New note';
}
export function replicaNoteStatus(session){
 if(session.error)return 'Local save unconfirmed · draft retained';
 if(session.composing)return 'Composing…';
 if(session.saving)return 'Saving locally…';
 if(!session.saved)return 'Unsaved local changes';
 if(session.page.generation_review)return 'Saved locally · restore review needed';
 if(session.page.conflict)return 'Saved locally · conflict needs review';
 return session.page.version>session.page.synced_version?'Saved locally · awaiting sync':'Saved locally and synced';
}
export function downloadMarkdown(body,name='note.md'){
 const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
