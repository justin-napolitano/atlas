export const publicKinds=new Set('source work edition claim evidence question hypothesis concept lexical_form sense definition occurrence person place period tradition school event article'.split(' '));
const sameHead=(a,b)=>a && b && a.revision===b.revision && a.snapshot_id===b.snapshot_id && a.status===b.status;

export class PublicationWorkspace {
  constructor(api,changed=()=>{}) {this.api=api;this.changed=changed;this.entries=new Map();}
  entry(project) {
    if(!this.entries.has(project)) this.entries.set(project,{
      project,selections:new Map(),relations:[],relationIds:new Set(),relationsTruncated:false,
      head:null,preview:null,status:'idle',message:'',rationale:'',rights:false,withdrawReason:'',withdrawConfirmed:false,
      generation:0,relationGeneration:0,busy:false,dirty:false,needsPreview:false,needsHead:false,
    });
    return this.entries.get(project);
  }
  invalidate(entry) {entry.preview=null;entry.rights=false;entry.status='idle';entry.message='Selection changed. Make a new preview before approval.';entry.dirty=true;}
  select(project,row,selected) {
    const entry=this.entry(project);
    if(entry.busy || row.project_id!==project || !publicKinds.has(row.kind) || row.review_state==='withdrawn') return;
    if(selected && !entry.selections.has(row.id)) {
      if(entry.selections.size>=100) {entry.message='A release can contain up to 100 records.';this.changed();return;}
      entry.selections.set(row.id,{record_id:row.id,title:row.title,kind:row.kind,include_summary:false,include_bibliography:false});
    } else if(!selected) entry.selections.delete(row.id);
    this.invalidate(entry);entry.relations=[];entry.relationIds.clear();entry.relationsTruncated=false;entry.relationGeneration++;
    this.changed();
  }
  option(project,id,key,value) {
    const entry=this.entry(project),row=entry.selections.get(id);
    if(entry.busy || !row || !['include_summary','include_bibliography'].includes(key)) return;
    row[key]=!!value;this.invalidate(entry);this.changed();
  }
  relation(project,id,selected) {
    const entry=this.entry(project);
    if(entry.busy || !entry.relations.some(row=>row.id===id)) return;
    selected ? entry.relationIds.add(id) : entry.relationIds.delete(id);
    this.invalidate(entry);this.changed();
  }
  form(project,patch) {
    const entry=this.entry(project);if(entry.busy) return;
    for(const key of ['rationale','rights','withdrawReason','withdrawConfirmed']) if(key in patch) entry[key]=patch[key];
    this.changed();
  }
  async load(project,previewId='') {
    const entry=this.entry(project);if(entry.busy) return;
    const generation=++entry.generation;entry.busy=true;entry.status='loading';this.changed();
    try {
      const head=await this.api.request('publication/head',{project_id:project});
      const preview=previewId ? await this.api.request('publication/preview',{project_id:project,preview_id:previewId}) : null;
      if(generation!==entry.generation) return;
      if(entry.head && !sameHead(entry.head,head)) entry.rights=false;
      entry.head=head;entry.needsHead=false;entry.rights=false;
      if(preview) {
        if(preview.project_id!==project || preview.payload.project.id!==project) throw new Error('Preview project changed.');
        entry.preview=preview;entry.rights=false;entry.rationale='';entry.dirty=false;
        entry.selections=new Map(preview.payload.nodes.map(row=>[row.id,{record_id:row.id,title:row.label,kind:row.type,include_summary:!!row.summary,include_bibliography:!!(row.citation||row.locator||row.links?.length||row.scope||row.role||row.people?.length)}]));
        entry.relations=preview.payload.edges.map(row=>({id:row.id,from_id:row.from,to_id:row.to,predicate:row.predicate,review_state:row.status,
          source_title:entry.selections.get(row.from)?.title || row.from,target_title:entry.selections.get(row.to)?.title || row.to}));
        entry.relationIds=new Set(preview.payload.edges.map(row=>row.id));
      }
      entry.status='idle';entry.message='';
    } catch(error) {if(generation===entry.generation) {entry.status='error';entry.message=error.message;}}
    finally {if(generation===entry.generation) {entry.busy=false;this.changed();}}
  }
  async findRelations(project) {
    const entry=this.entry(project);if(entry.busy || !entry.selections.size) return;
    const generation=++entry.relationGeneration;
    entry.busy=true;entry.status='loading';this.changed();
    try {
      const data=await this.api.post('publication/relations',{project_id:project,record_ids:[...entry.selections.keys()]});
      if(generation!==entry.relationGeneration) return;
      entry.relations=data.items;entry.relationsTruncated=data.truncated;
      const allowed=new Set(data.items.map(row=>row.id));
      const previous=[...entry.relationIds];entry.relationIds=new Set(previous.filter(id=>allowed.has(id)));
      if(previous.some(id=>!allowed.has(id))) this.invalidate(entry);
      entry.status='idle';entry.message=data.items.length ? 'Choose the recorded connections you want to include.' : 'No recorded connections between the selected records.';
    } catch(error) {entry.status='error';entry.message=error.message;}
    finally {entry.busy=false;this.changed();}
  }
  async makePreview(project) {
    const entry=this.entry(project);if(entry.busy || !entry.selections.size || !entry.head) return;
    entry.busy=true;entry.status='previewing';entry.rights=false;this.changed();
    try {
      const value=await this.api.post('publication/previews',{project_id:project,
        selections:[...entry.selections.values()].map(({record_id,include_summary,include_bibliography})=>({record_id,include_summary,include_bibliography})),relation_ids:[...entry.relationIds]});
      if(value.project_id!==project || value.payload.project.id!==project) throw new Error('Preview project changed.');
      entry.preview=value;entry.dirty=false;entry.needsPreview=false;entry.status='idle';entry.message='Preview saved privately. Inspect all included content before approving.';
    } catch(error) {entry.status='error';entry.message=error.message;}
    finally {entry.busy=false;this.changed();}
  }
  async approve(project) {
    const entry=this.entry(project);
    if(entry.busy || !entry.preview || !entry.head || !entry.rights || !entry.rationale.trim() || entry.needsPreview || entry.needsHead || entry.head.snapshot_id===entry.preview.id) return;
    const sent={preview_id:entry.preview.id,expected_sha256:entry.preview.payload_sha256,expected_revision:entry.head.revision,rationale:entry.rationale,rights_checked:true};
    entry.busy=true;entry.status='approving';this.changed();
    try {
      entry.head=await this.api.post('publication/approve',sent);entry.rights=false;entry.rationale='';entry.status='approved';entry.dirty=false;
      entry.message='Snapshot approved. The public site changes after a successful publication build.';
    } catch(error) {
      entry.status=error.status===409 ? 'conflict' : 'error';
      if(error.status===409) {entry.needsPreview=true;entry.rights=false;}
      entry.message=error.status===409 ? 'The research or public revision changed. Refresh the public status and make a new preview.' : 'Approval was not confirmed. Keep this preview and retry the same request, or refresh the public status.';
      // Keep the exact expected revision, digest, and rationale for a lost-response retry.
    } finally {entry.busy=false;this.changed();}
  }
  async withdraw(project) {
    const entry=this.entry(project);
    if(entry.busy || entry.needsHead || entry.head?.status!=='published' || !entry.withdrawConfirmed || !entry.withdrawReason.trim()) return;
    entry.busy=true;entry.status='withdrawing';this.changed();
    try {
      entry.head=await this.api.post('publication/withdraw',{project_id:project,expected_revision:entry.head.revision,rationale:entry.withdrawReason});
      entry.status='withdrawn';entry.rights=false;entry.withdrawConfirmed=false;entry.withdrawReason='';
      entry.message='Snapshot withdrawn in storage. A replacement build is required to update the public site and caches.';
    } catch(error) {entry.status=error.status===409 ? 'conflict' : 'error';entry.message='Withdrawal was not confirmed. Refresh the public status before trying again.';entry.withdrawConfirmed=false;entry.needsHead=true;}
    finally {entry.busy=false;this.changed();}
  }
  hasDrafts() {return [...this.entries.values()].some(entry=>entry.dirty || entry.busy || entry.rationale || entry.withdrawReason);}
}
