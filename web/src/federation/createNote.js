// New-note retries use one immutable local intent, even after a lost response.
export class CreateNoteIntent{
 constructor(client,account,brain){Object.assign(this,{client,account,brain});this.pending=null;this.flight=null;}
 create(){
  if(this.flight)return this.flight;
  this.pending??={page_id:crypto.randomUUID(),edit_id:crypto.randomUUID(),expected_version:0,content:{title:'Untitled note',body:'',state:'active'}};
  const intent=this.pending;
  this.flight=(async()=>{const {page_id,...body}=intent;const row=await this.client.request(`${this.client.page(this.account,this.brain,page_id)}/edit`,body);if(row.page_id!==page_id||!Number.isSafeInteger(row.version)||row.version<1)throw Error('The new note was not confirmed. Retry the same note.');if(this.pending===intent)this.pending=null;return row;})().finally(()=>{this.flight=null;});
  return this.flight;
 }
}
