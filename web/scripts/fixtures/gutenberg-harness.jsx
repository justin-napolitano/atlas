import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import GutenbergSearch from '../../src/GutenbergSearch.jsx';
import GutenbergReader from '../../src/GutenbergReader.jsx';
import SourceReader from '../../src/SourceReader.jsx';
import {PassageNoteEditor} from '../../src/passageNoteEditor.js';
import {WorkspaceNavigation} from '../../src/WorkspaceNavigation.jsx';
import '../../src/style.css';
import '../../src/atlasWorkspace.css';
import '../../src/gutenberg.css';
const book=__GUTENBERG_TEST_BOOK__,documents=new Map(),notes=new Map(),entries=new Map(),records=new Map(),recovery=new Map();
let place=null,lost=false,posts=[],library=null;
const clone=v=>structuredClone(v);
const makeDoc=(project,section)=>({id:`synthetic:gutenberg:${project}:${book.version}:${section}`,project_id:project,source_record_id:`synthetic:gutenberg:${project}:${book.book_id}`,text_body:book.sections[section].text,text_sha256:book.sections[section].text_sha256,edition:book.edition,locator:book.sections[section].label,representation_url:book.representation_url,source_notice:book.attribution,review_scope:'Synthetic unreviewed fixture'});
async function ensure(binding){const document=makeDoc(binding.project_id,binding.section);documents.set(document.id,document);records.set(document.source_record_id,{id:document.source_record_id,project_id:binding.project_id,kind:'source',title:book.title,revision:1});return {project_id:binding.project_id,record_id:document.source_record_id,document};}
const api={async request(path,q={},body){const v=body||q;
  if(path==='record')return clone(records.get(q.record_id));
  if(path==='library/item'){if(body)library={...library,...body,revision:body.expected_revision+1};return clone(library);}
  if(path==='library/resolve')return {source_available:true,edition_id:'synthetic:edition'};
  if(path==='catalog/gutenberg/search')return {items:[{book_id:book.book_id,title:book.title,creators:book.creators.join(', ')}],query:q.q,next_page:null};
  if(path==='catalog/gutenberg/book')return clone(book);
  if(path==='catalog/gutenberg/section')return makeDoc(q.project_id,q.section);
  if(path==='catalog/gutenberg/place'){
    if(!body){if(!place)throw Object.assign(new Error('No saved place'),{status:404});return clone(place);}
    if(place?.revision===body.expected_revision+1 && place.position===body.position && place.section===body.section)return clone(place);
    if((place?.revision||0)!==body.expected_revision)throw Object.assign(new Error('Competing place'),{status:409,current:clone(place)});
    place={...body,revision:body.expected_revision+1};return clone(place);
  }
  if(path==='reading/document')return clone(documents.get(v.document_id));
  if(path==='reading/documents')return {items:[...documents.values()].filter(d=>d.source_record_id===q.source_record_id),next_cursor:null};
  if(path==='reading/annotations')return {items:[...notes.values()].filter(n=>n.document_id===v.document_id),next_cursor:null};
  if(path==='reading/annotation'){
    const n=notes.get(v.annotation_id);if(!n)throw new Error('Missing annotation');
    return {annotation:clone(n),anchor:{anchored:true,start:n.start_pos,end:n.end_pos},web_annotation:{type:'Annotation'}};
  }
  if(path==='notebook/items')return {items:[...entries.values()].filter(n=>n.document_id===q.document_id),next_cursor:null};
  if(path==='notebook/network')return {project_id:q.project_id,items:[...entries.values()],truncated:false};
  if(path==='notebook/entry')return clone(entries.get(q.entry_id));
  if(path==='notebook/draft'||path==='reading/draft'){const row={...v,id:v.draft_id||v.draft_uuid,revision:1};if(body)recovery.set(row.id,row);return row;}
  if(path==='reading/drafts')return {items:[],next_cursor:null};
  return {items:[],next_cursor:null};
},async post(path,body){posts.push({path,body:clone(body)});
  if(path==='library/index-source'){library ||= {id:'synthetic:library',revision:1,on_shelf:false,reading_status:'needs_review',preferred_edition_id:null};return {item_id:library.id};}
  if(path==='catalog/gutenberg/binding')return ensure(body);
  if(path==='catalog/gutenberg/annotations'){
    const {document}=await ensure(body.binding),v=body.annotation;
    if(document.id!==v.document_id || Array.from(document.text_body).slice(v.start,v.end).join('')!==v.exact)throw new Error('Wrong quote');
    const id='urn:research:annotation:'+v.annotation_uuid;
    if(!notes.has(id))notes.set(id,{...v,id,start_pos:v.start,end_pos:v.end,prefix:'',suffix:'',revision:1});
    if(lost){lost=false;throw new Error('Synthetic lost note response');}
    return clone(notes.get(id));
  }
  if(path==='catalog/gutenberg/notes'){
    await ensure(body.binding);const v=body.note,id='urn:research:notebook:'+v.request_uuid;
    if(!entries.has(id))entries.set(id,{...v,id,state:'active',revision:1});
    return clone(entries.get(id));
  }
  throw new Error('Unexpected fixture write '+path);
}};
window.__books={library:()=>library,documents,notes,entries,records,posts,place:()=>place,lose:()=>{lost=true;}};
function App(){const [id,setId]=useState(0),[source,setSource]=useState(null),[host,setHost]=useState(null),[,redraw]=useState(0);const drafts=useRef(new Map()),editor=useRef(null);if(!editor.current)editor.current=new PassageNoteEditor(api,()=>redraw(n=>n+1));
  window.__books.reopen=()=>setId(0);
  return <WorkspaceNavigation.Provider value={host}><div className="atlas-workspace" style={{display:'grid',gridTemplateColumns:'220px minmax(0,1fr)',height:'100vh'}}><aside style={{overflow:'auto'}}><button onClick={()=>{setId(0);setSource(null);}}>Sources</button><div ref={setHost}/></aside><main className="workspace-reader" style={{overflow:'auto',minWidth:0,padding:24}}>{source?<><button onClick={()=>setSource(null)}>Return to book</button><SourceReader record={records.get(source.recordId)} api={api} drafts={drafts} changed={()=>redraw(n=>n+1)} noteEditor={editor.current} initialDocumentId={source.docId} initialAnnotationId={source.annotationId}/></>:id?<GutenbergReader api={api} projectId="synthetic" bookId={id} drafts={drafts} changed={()=>redraw(n=>n+1)} noteEditor={editor.current} onBack={()=>setId(0)} onOpen={(recordId,project,annotationId,docId)=>setSource({recordId,annotationId,docId})}/>:<GutenbergSearch api={api} onOpen={setId}/>}</main></div></WorkspaceNavigation.Provider>;
}
document.documentElement.dataset.theme='dark';createRoot(document.getElementById('root')).render(<App/>);
