// Synthetic browser boundary only. No owner content and no production auth bypass.
import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/style.css';
import '../../src/workspace.css';
import '../../src/atlasWorkspace.css';
const resources=__QURAN_TEST_DATA__;
const annotations=new Map();
const entries=new Map(),documents=new Map(),bindings=new Map(),recovery=new Map(),requests=[];
const progressRows=new Map();let loseProgress=false;
let place=null,lost=false,held=null,loseHighlight=false;
const clone=value=>structuredClone(value),hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const contextKey=value=>JSON.stringify([value.project_id,value.resource_key,Number(value.chapter),Number(value.ayah_start),Number(value.ayah_end),value.note_scope||'verse']);
async function bind(value){const key=contextKey(value);if(bindings.has(key))return bindings.get(key);
  const meta=resources.catalog.resources.find(r=>r.key===value.resource_key),corpus=resources.chapters[value.chapter],start=Number(value.ayah_start),end=Number(value.ayah_end);
  const text=corpus.verses.slice(start-1,end).map(v=>v[value.resource_key==='itani-god'?'translation':'arabic'].text).join('\n');
  const record='synthetic:quran:'+value.resource_key,id='synthetic:quran:document:'+key;
  const doc={id,project_id:value.project_id,source_record_id:record,locator:`Q ${value.chapter}:${start}`+(end!==start?'–'+end:''),text_body:text,text_sha256:await hash(text),edition:meta.label,source_notice:meta.source_notice};
  if(value.note_scope!=='verse'){doc.id=null;}else documents.set(id,doc);const row={project_id:value.project_id,resource_key:value.resource_key,resource_id:meta.resource_id,record_id:record,document:doc.id?doc:null,reference:{...corpus.verses[start-1].reference,ayah_end:value.note_scope==='verse'?end:null,ayah_start:value.note_scope==='verse'?start:null,chapter:value.note_scope==='source'?null:Number(value.chapter)}};bindings.set(key,row);return row;
}
const quranAPI={async request(path,query={},body){const value=body||query;requests.push({path,value:clone(value)});
  if(path==='quran/catalog')return clone(resources.catalog);
  if(path==='quran/chapter')return clone(resources.chapters[value.chapter]);
  if(path==='quran/words'){
    const text=resources.chapters[value.chapter].verses[value.ayah-1].arabic;
    return {chapter:Number(value.chapter),ayah:Number(value.ayah),resource_key:'tanzil-uthmani',text_sha256:text.text_sha256,
      words:[...text.text.matchAll(/\S+/gu)].filter(match=>/\p{L}/u.test(match[0])).map((match,i)=>({position:i+1,start:Array.from(text.text.slice(0,match.index)).length,end:Array.from(text.text.slice(0,match.index+match[0].length)).length,arabic:match[0],translation:'Synthetic meaning '+(i+1)}))};
  }
  if(path==='quran/place'){if(!body)return clone(place);if((place?.revision||0)!==value.expected_revision)throw Object.assign(new Error('Changed place'),{status:409,current:clone(place)});place={...value,revision:value.expected_revision+1};return clone(place);}
  if(path==='quran/progress'){
    if(!body)return {project_id:value.project_id,items:[...progressRows.values()].filter(row=>row.project_id===value.project_id)};
    const key=JSON.stringify([value.project_id,value.chapter,value.ayah]),old=progressRows.get(key);
    if(old?.revision===value.expected_revision+1&&old.is_read===value.is_read)return clone(old);
    if((old?.revision||0)!==value.expected_revision)throw Object.assign(new Error('Progress changed elsewhere'),{status:409,current:clone(old)});
    const row={project_id:value.project_id,chapter:value.chapter,ayah:value.ayah,is_read:value.is_read,revision:value.expected_revision+1,read_at:value.is_read?'2026-10-19T00:00:00Z':null};progressRows.set(key,row);
    if(loseProgress){loseProgress=false;throw new Error('Synthetic lost progress reply');}return clone(row);
  }
  if(path==='quran/binding')return clone(bindings.get(contextKey(value))||null);
  if(path==='quran/notes')return {items:[...entries.values()].filter(row=>row.quran_context?.note_scope===value.note_scope&&row.quran_context?.resource_key===value.resource_key),next_cursor:null};
  if(path==='quran/marks')return {items:[...annotations.values()].filter(row=>row.locator.startsWith('Q '+value.chapter+':')),next_cursor:null};
  if(path==='reading/annotation'){const row=annotations.get(value.annotation_id);if(body){const updated={...row,body:body.body,mark_style:body.mark_style,revision:row.revision+1};annotations.set(row.id,updated);return clone(updated);}return {annotation:clone(row),anchor:{anchored:true,start:row.start_pos,end:row.end_pos},web_annotation:{id:row.id,type:'Annotation'}};}
  if(path==='notebook/items')return {items:[...entries.values()].filter(r=>r.document_id===value.document_id&&!r.trashed),next_cursor:null};
  if(path==='notebook/network')return {project_id:value.project_id,items:[...entries.values()],truncated:false};
  if(path==='reading/draft')return {...body,id:'urn:research:draft:'+body.draft_uuid,revision:body.expected_revision+1};
  if(path==='notebook/draft'){const id='urn:research:writing-draft:'+body.draft_uuid,row={...body,id,revision:body.expected_revision+1};recovery.set(id,row);return clone(row);}
  if(path==='notebook/entry'){
    const row=entries.get(value.entry_id);if(!body)return clone(row);
    if(row.revision!==value.expected_revision)throw Object.assign(new Error('Changed elsewhere'),{status:409,current:clone(row)});
    const updated={...row,...body,revision:row.revision+1};entries.set(row.id,updated);return clone(updated);
  }
  if(path==='verses/materials')return {items:[],next_cursor:null};
  throw new Error('Unexpected fixture request: '+path);
},async post(path,value){requests.push({path,value:clone(value)});
  if(path==='reading/annotations'){const doc=documents.get(value.document_id),context=[...bindings.values()].find(b=>b.document?.id===doc.id);const id='urn:research:annotation:'+value.annotation_uuid,row=annotations.get(id)||{...value,id,revision:1,start_pos:value.start,end_pos:value.end,source_record_id:doc.source_record_id,locator:doc.locator,resource_key:context.resource_key,prefix:'',suffix:''};annotations.set(id,row);if(loseHighlight){loseHighlight=false;throw new Error('Synthetic lost highlight acknowledgement');}return clone(row);}
  if(path==='quran/binding')return clone(await bind(value));
  if(path==='quran/notes'){
    const binding=await bind(value),id='urn:research:notebook:'+value.request_uuid;
    let note=entries.get(id);if(!note){note={id,project_id:value.project_id,record_id:binding.record_id,document_id:binding.document?.id||null,annotation_id:null,reading_position:binding.document?0:null,quran_context:{note_scope:value.note_scope,resource_key:value.resource_key,chapter:value.chapter},thought_type:'note',title:binding.reference.label,body:value.body,links:[],state:'active',revision:1,item_kind:'entry'};entries.set(id,note);}
    if(lost){lost=false;await new Promise(resolve=>held=resolve);throw new Error('Synthetic lost acknowledgement');}
    return clone({binding,note});
  }throw new Error('Unexpected fixture write: '+path);
}};

const workspaceDrafts=new Map(),collections=new Map(),members=new Map(),views=new Map(),connections=new Map();
let heldCreate=null,holdCreate=false,loseCreate=false;
const originalFetch=globalThis.fetch;
const label=body=>body.split('\n').find(line=>line.trim())?.replace(/^\s{0,3}#{1,6}\s+/,'').trim().slice(0,300)||'Untitled note';
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const all=()=>[...entries.values()].filter(row=>!row.trashed);
globalThis.fetch=async(input,options={})=>{
 const url=new URL(input,location.origin);if(!url.pathname.startsWith('/v1/'))return originalFetch(input,options);
 const path=url.pathname.slice(4),query=Object.fromEntries(url.searchParams),value=options.body?JSON.parse(options.body):null;
 if(path==='me')return response({actor:'synthetic'});
 if(path==='workspace/notes'&&!value)return response({items:all().filter(row=>(row.thought_type||'note')===(query.thought_type||row.thought_type||'note')&&(row.title+' '+row.body).toLowerCase().includes((query.q||'').toLowerCase())).reverse(),next_cursor:null});
 if(path==='workspace/notes'){
  const id='urn:research:notebook:'+value.request_uuid;let row=entries.get(id);
  if(!row){row={...clone(value),id,project_id:null,workspace_id:'owner',title_mode:value.title?'manual':'automatic',title:value.title||label(value.body),state:'active',revision:1,trash_revision:0};entries.set(id,row);}
  if(holdCreate){holdCreate=false;await new Promise(resolve=>heldCreate=resolve);}if(loseCreate){loseCreate=false;return response({detail:'Synthetic lost acknowledgement'},503);}return response(clone(row),201);
 }
 if(path==='workspace/note'){
  const row=entries.get(value?.entry_id||query.entry_id);if(!row)return response({},404);
  if(!value)return response(clone(row));
  if(row.revision!==value.expected_revision)return response({current:clone(row)},409);
  const next={...row,...clone(value),revision:row.revision+1,title_mode:value.title_mode,title:value.title_mode==='automatic'?label(value.body):value.title};entries.set(row.id,next);return response(next);
 }
 if(path==='workspace/draft'){
  const id='urn:research:writing-draft:'+value.draft_uuid,row={...clone(value),id,project_id:null,revision:value.expected_revision+1};workspaceDrafts.set(id,row);return response(row);
 }
 if(path==='workspace/drafts')return response({items:[...workspaceDrafts.values()].filter(row=>row.state==='active'),next_cursor:null});
 if(path==='workspace/continue')return response({reading:place?[{...place,reader:'quran'}]:[],documents:[],notes:all(),drafts:[...workspaceDrafts.values()].filter(row=>row.state==='active')});
 if(path==='workspace/search')return response({items:all().filter(row=>(row.title+' '+row.body).toLowerCase().includes((query.q||'').toLowerCase())).map(row=>({kind:'entry',...row})),truncated:false});
 if(path==='workspace/questions')return response({items:all().filter(row=>row.thought_type==='question'),next_cursor:null});
 if(path==='workspace/collections'&&!value)return response({items:[...collections.values()],next_cursor:null});
 if(path==='workspace/collections'){const row={...clone(value),id:'collection:'+value.request_uuid,revision:1};collections.set(row.id,row);return response(row,201);}
 if(path==='workspace/views'&&!value)return response({items:[...views.values()],next_cursor:null});
 if(path==='workspace/views'){const row={...clone(value),id:'view:'+value.request_uuid,revision:1};views.set(row.id,row);return response(row,201);}
 if(path==='workspace/view/results'){const view=views.get(query.view_id);return response({view,items:all().filter(row=>(row.title+' '+row.body).toLowerCase().includes(view.query.q.toLowerCase())),next_cursor:null});}
 if(path==='workspace/membership'){const key=value.collection_id+value.target_id,row={...clone(value),revision:value.expected_revision+1};members.set(key,row);return response(row);}
 if(path==='workspace/members')return response({items:[...members.values()].filter(row=>row.collection_id===query.collection_id&&row.state==='active').map(row=>({...row,target:{kind:row.target_kind,...entries.get(row.target_id)}})),next_cursor:null});
 if(path==='workspace/neighborhood')return response({root:{kind:query.kind,id:query.id,title:entries.get(query.id)?.title||'Synthetic target'},nodes:[{kind:query.kind,id:query.id,title:entries.get(query.id)?.title||'Synthetic target'}],edges:[...connections.values()].filter(row=>row.from_id===query.id||row.to_id===query.id),truncated:false});
 if(path==='workspace/connections'){const row={...clone(value),id:'connection:'+value.request_uuid,revision:1};connections.set(row.id,row);return response(row,201);}
 if(path==='workspace/investigation')return response(null);
 if(path==='workspace/reflections')return response({items:[],next_cursor:null});
 if(path==='workspace/sources')return response({items:[],next_cursor:null});
 if(path==='library/shelf'||path==='library/continue')return response({items:[],next_cursor:null});
 if(path.startsWith('quran/')||path.startsWith('reading/')||path.startsWith('notebook/')||path==='verses/materials'){
  const params={project_id:null,...query};if(value){try{return response(await (options.method==='POST'?quranAPI.post(path,value):quranAPI.request(path,{},value)));}catch(error){return response({detail:error.message,current:error.current},error.status||500);}}
  try{return response(await quranAPI.request(path,params));}catch(error){return response({detail:error.message},error.status||404);}
 }
 return response({detail:'Synthetic fixture has no handler for '+path},404);
};
window.__connectedTest={entries,workspaceDrafts,collections,members,views,requests,hold:()=>holdCreate=true,lose:()=>loseCreate=true,release:()=>heldCreate?.(),remount:null};
import('../../src/ConnectedWorkspace.jsx').then(({default:ConnectedWorkspace})=>{
let root=createRoot(document.getElementById('root'));root.render(<ConnectedWorkspace/>);
window.__connectedTest.remount=()=>{root.unmount();root=createRoot(document.getElementById('root'));root.render(<ConnectedWorkspace/>);};

});
