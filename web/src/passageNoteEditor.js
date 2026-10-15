// In-memory editing sessions survive pane/record navigation. Durable saves use CAS.
const sameTarget = (a,b) => a && b && a.id===b.id && a.project_id===b.project_id && a.document_id===b.document_id;
const style = row => row.mark_style || 'highlight';
export class PassageNoteEditor {
  constructor(api, changed = () => {}) { this.api=api; this.changed=changed; this.entries=new Map(); }
  adopt(row, sourceId) {
    let entry=this.entries.get(row.id);
    if (!entry) {
      entry={ server:row,body:row.body,markStyle:style(row),status:'saved',current:null,pending:null,open:false,sourceId,uncertain:false };
      this.entries.set(row.id,entry);
    } else if (!sameTarget(entry.server,row) || entry.sourceId!==sourceId) throw new Error('Passage note identity changed.');
    else if (row.revision>entry.server.revision && entry.status==='saved' && !entry.pending) {
      entry.server=row; entry.body=row.body; entry.markStyle=style(row);
    }
    return entry;
  }
  open(id) { this.entries.get(id).open=true; this.changed(); }
  edit(id, body) {
    const entry=this.entries.get(id);
    entry.body=body;
    if (!entry.pending && entry.status!=='conflict') entry.status=entry.uncertain ? 'error' : body===entry.server.body && entry.markStyle===style(entry.server) ? 'saved' : 'unsaved';
    this.changed();
  }
  editStyle(id, markStyle) {
    if(!['highlight','underline','none'].includes(markStyle)) return;
    const entry=this.entries.get(id);entry.markStyle=markStyle;this.edit(id,entry.body);
  }
  async save(id) {
    const entry=this.entries.get(id);
    if (!entry || entry.pending || entry.status==='conflict' || entry.status==='saved') return entry?.pending;
    const sent=entry.body, sentStyle=entry.markStyle, expected=entry.server.revision;
    entry.status='saving';
    entry.pending=Promise.resolve().then(()=>this.api.request('reading/annotation',{}, {
      annotation_id:id,project_id:entry.server.project_id,body:sent,mark_style:sentStyle,expected_revision:expected,
    })).then(row=>{
      if (!sameTarget(entry.server,row) || row.revision<=expected) throw new Error('Unexpected annotation response.');
      entry.server=row; entry.status=entry.body===row.body && entry.markStyle===style(row) ? 'saved' : 'unsaved'; entry.current=null; entry.uncertain=false;
    }).catch(error=>{
      const current=error.status===409 && error.current;
      if (sameTarget(entry.server,current) && current.revision>expected) {
        entry.uncertain=false;
        if (current.body===sent && style(current)===sentStyle) { // Successful commit followed by a lost response.
          entry.server=current; entry.status=entry.body===sent && entry.markStyle===sentStyle ? 'saved' : 'unsaved'; entry.current=null;
        } else { entry.current=current; entry.status='conflict'; }
      } else { entry.status='error'; entry.uncertain=true; }
    }).finally(()=>{ entry.pending=null; this.changed(); });
    this.changed();
    return entry.pending;
  }
  resolve(id, choice) {
    const entry=this.entries.get(id);
    if (!entry?.current || entry.pending || !['cloud','draft'].includes(choice)) return;
    entry.server=entry.current; entry.current=null;
    if (choice==='cloud') { entry.body=entry.server.body; entry.markStyle=style(entry.server); entry.status='saved'; }
    else { entry.status='unsaved'; this.save(id); }
    this.changed();
  }
  close(id) {
    const entry=this.entries.get(id);
    if (entry.pending) return;
    if (entry.current) entry.server=entry.current;
    entry.body=entry.server.body; entry.markStyle=style(entry.server); entry.current=null; entry.status='saved'; entry.uncertain=false; entry.open=false; this.changed();
  }
  hasDrafts() { return [...this.entries.values()].some(entry=>entry.status!=='saved'); }
  documentForSource(projectId,sourceId) {
    return [...this.entries.values()].find(entry=>entry.sourceId===sourceId && entry.server.project_id===projectId && entry.status!=='saved')?.server.document_id;
  }
}
