import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PassageNoteEditor} from '../../src/passageNoteEditor.js';
import QuranReader from '../../src/QuranReader.jsx';
import '../../src/style.css';
import '../../src/readerPresentation.css';
const resources=__QURAN_TEST_DATA__;
const annotations=new Map();
const entries=new Map(),documents=new Map(),bindings=new Map(),recovery=new Map(),requests=[];
let place=null,lost=false,held=null;
const clone=value=>structuredClone(value),hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const contextKey=value=>JSON.stringify([value.project_id,value.resource_key,Number(value.chapter),Number(value.ayah_start),Number(value.ayah_end),value.note_scope||'verse']);
async function bind(value){const key=contextKey(value);if(bindings.has(key))return bindings.get(key);
  const meta=resources.catalog.resources.find(r=>r.key===value.resource_key),corpus=resources.chapters[value.chapter],start=Number(value.ayah_start),end=Number(value.ayah_end);
  const text=corpus.verses.slice(start-1,end).map(v=>v[value.resource_key==='itani-god'?'translation':'arabic'].text).join('\n');
  const record='synthetic:quran:'+value.resource_key,id='synthetic:quran:document:'+key;
  const doc={id,project_id:value.project_id,source_record_id:record,locator:`Q ${value.chapter}:${start}`+(end!==start?'–'+end:''),text_body:text,text_sha256:await hash(text),edition:meta.label,source_notice:meta.source_notice};
  if(value.note_scope!=='verse'){doc.id=null;}else documents.set(id,doc);const row={project_id:value.project_id,resource_key:value.resource_key,resource_id:meta.resource_id,record_id:record,document:doc.id?doc:null,reference:{...corpus.verses[start-1].reference,ayah_end:value.note_scope==='verse'?end:null,ayah_start:value.note_scope==='verse'?start:null,chapter:value.note_scope==='source'?null:Number(value.chapter)}};bindings.set(key,row);return row;
}
const api={async request(path,query={},body){const value=body||query;requests.push({path,value:clone(value)});
  if(path==='quran/catalog')return clone(resources.catalog);
  if(path==='quran/chapter')return clone(resources.chapters[value.chapter]);
  if(path==='quran/place'){if(!body)return clone(place);if((place?.revision||0)!==value.expected_revision)throw Object.assign(new Error('Changed place'),{status:409,current:clone(place)});place={...value,revision:value.expected_revision+1};return clone(place);}
  if(path==='quran/binding')return clone(bindings.get(contextKey(value))||null);
  if(path==='quran/notes')return {items:[...entries.values()].filter(row=>row.quran_context?.note_scope===value.note_scope&&row.quran_context?.resource_key===value.resource_key),next_cursor:null};
  if(path==='quran/marks')return {items:[...annotations.values()].filter(row=>row.locator.startsWith('Q '+value.chapter+':')),next_cursor:null};
  if(path==='reading/annotation'){const row=annotations.get(value.annotation_id);if(body){const updated={...row,body:body.body,mark_style:body.mark_style,revision:row.revision+1};annotations.set(row.id,updated);return clone(updated);}return {annotation:clone(row),anchor:{anchored:true,start:row.start_pos,end:row.end_pos},web_annotation:{id:row.id,type:'Annotation'}};}
  if(path==='notebook/items')return {items:[...entries.values()].filter(r=>r.document_id===value.document_id&&!r.trashed),next_cursor:null};
  if(path==='notebook/network')return {project_id:value.project_id,items:[...entries.values()],truncated:false};
  if(path==='notebook/draft'){const id='urn:research:writing-draft:'+body.draft_uuid,row={...body,id,revision:body.expected_revision+1};recovery.set(id,row);return clone(row);}
  if(path==='notebook/entry'){
    const row=entries.get(value.entry_id);if(!body)return clone(row);
    if(row.revision!==value.expected_revision)throw Object.assign(new Error('Changed elsewhere'),{status:409,current:clone(row)});
    const updated={...row,...body,revision:row.revision+1};entries.set(row.id,updated);return clone(updated);
  }
  if(path==='verses/materials')return {items:[],next_cursor:null};
  throw new Error('Unexpected fixture request: '+path);
},async post(path,value){requests.push({path,value:clone(value)});
  if(path==='reading/annotations'){const doc=documents.get(value.document_id),context=[...bindings.values()].find(b=>b.document?.id===doc.id);const id='urn:research:annotation:'+value.annotation_uuid,row=annotations.get(id)||{...value,id,revision:1,start_pos:value.start,end_pos:value.end,source_record_id:doc.source_record_id,locator:doc.locator,resource_key:context.resource_key,prefix:'',suffix:''};annotations.set(id,row);return clone(row);}
  if(path==='quran/binding')return clone(await bind(value));
  if(path==='quran/notes'){
    const binding=await bind(value),id='urn:research:notebook:'+value.request_uuid;
    let note=entries.get(id);if(!note){note={id,project_id:value.project_id,record_id:binding.record_id,document_id:binding.document?.id||null,annotation_id:null,reading_position:binding.document?0:null,quran_context:{note_scope:value.note_scope,resource_key:value.resource_key,chapter:value.chapter},thought_type:'note',title:binding.reference.label,body:value.body,links:[],state:'active',revision:1,item_kind:'entry'};entries.set(id,note);}
    if(lost){lost=false;await new Promise(resolve=>held=resolve);throw new Error('Synthetic lost acknowledgement');}
    return clone({binding,note});
  }throw new Error('Unexpected fixture write: '+path);
}};
function Harness(){const drafts=useRef(new Map()),editor=useRef(null),[generation,setGeneration]=useState(0),[,render]=useState(0);if(!editor.current)editor.current=new PassageNoteEditor(api,()=>render(n=>n+1));window.__quranTest={annotations,entries,documents,bindings,requests,recovery,place:()=>place,lost:()=>lost=true,release:()=>held?.(),remount:()=>{drafts.current=new Map();setGeneration(n=>n+1);},drafts};
  return <div className="workspace-reader" style={{height:'100vh',overflow:'auto',padding:'20px 36px',boxSizing:'border-box'}}><QuranReader key={generation} api={api} projectId="synthetic" noteEditor={editor.current} drafts={drafts} changed={()=>render(n=>n+1)} onOpen={(...args)=>window.__opened=args} onOpenNotebook={row=>window.__notebook=row}/></div>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
