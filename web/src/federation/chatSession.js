import { BridgeError } from './client.js';
import { definitiveRejection, validBoundedText } from './requestPolicy.js';

// One controller belongs to one account/brain selection, including when a user
// leaves and later returns to the same IDs. Responses cannot cross that epoch.
export class ChatTurnSession {
  constructor(onChange=()=>{}) { this.pending=null;this.flight=null;this.version=0;this.conversationID=null;this.response=null;this.conflict=false;this.epoch=0;this.draft='';this.onChange=onChange; }
  get hasUnsent(){return this.draft.length>0||!!this.pending||!!this.flight;}
  setDraft(value){if(this.pending||this.flight)throw new BridgeError('transfer_uncertain',503);if(value.length>32768)throw new BridgeError('chat_message_invalid',400);this.draft=value;this.onChange();}
  invalidate() { this.epoch++; }
  startNew() { if(this.flight||this.pending&&!this.conflict)throw new BridgeError('transfer_uncertain',503);this.invalidate();this.pending=null;this.version=0;this.conversationID=null;this.response=null;this.conflict=false;this.onChange(); }
  async send(client,path,message,pageID) {
    if(this.flight)return null;
    if(this.conflict)throw new BridgeError('conversation_conflict',409);
    if(!this.pending){
      if(!validBoundedText(message,4096))throw new BridgeError('chat_message_invalid',400);
      this.pending=Object.freeze({conversation_id:this.conversationID,expected_version:this.version,operation_id:crypto.randomUUID(),message,page_id:pageID||null});
      this.draft=message;
    }
    const request=this.pending,epoch=this.epoch,flight={};this.flight=flight;
    this.onChange();
    try {
      const response=await client.request(path,request);
      if(this.epoch!==epoch||this.pending!==request||this.flight!==flight)return null;
      if(!response||!Number.isSafeInteger(response.version)||response.version!==request.expected_version+1||response.version<=this.version||typeof response.conversation_id!=='string'||!response.conversation_id||request.conversation_id&&response.conversation_id!==request.conversation_id)throw new BridgeError('transfer_uncertain',503);
      this.response=response;this.version=response.version;this.conversationID=response.conversation_id;this.pending=null;
      if(this.draft===request.message)this.draft='';
      return response;
    }catch(error){
      if(this.epoch!==epoch||this.pending!==request||this.flight!==flight)return null;
      if(definitiveRejection(error)){this.pending=null;if(error.code==='conversation_conflict')this.conflict=true;}
      throw error;
    }finally{if(this.flight===flight)this.flight=null;this.onChange();}
  }
}

// At most 24 scopes, with a 32768-code-unit UI draft bound per scope. Never evict
// an unsent/pending scope; clean confirmed history can be fetched server-side.
export class ChatSessionRegistry {
  constructor(onChange=()=>{},maximum=24){this.scopes=new Map();this.activeKey=null;this.viewEpoch=0;this.onChange=onChange;this.maximum=maximum;}
  get current(){return this.scopes.get(this.activeKey)||null;}
  get hasUnsent(){return [...this.scopes.values()].some(scope=>scope.hasUnsent);}
  prepare(key){
    if(this.scopes.has(key))return this.scopes.get(key);
    if(this.scopes.size>=this.maximum){const clean=[...this.scopes].find(([id,scope])=>id!==this.activeKey&&!scope.hasUnsent);if(!clean)throw Error('Chat draft memory is full. Clear or reconcile a retained draft before opening another chat scope.');this.scopes.delete(clean[0]);}
    const controller=new ChatTurnSession(()=>{if(this.activeKey===key)this.onChange();});this.scopes.set(key,controller);return controller;
  }
  select(key){const controller=this.prepare(key);this.activeKey=key;this.viewEpoch++;this.onChange();return controller;}
  leave(){this.activeKey=null;this.viewEpoch++;this.onChange();}
  matches(key,epoch){return this.activeKey===key&&this.viewEpoch===epoch;}
}
