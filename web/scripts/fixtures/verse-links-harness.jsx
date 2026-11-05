// Explicit synthetic owner boundary adapter; never an application entry.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import VerseLinks from '../../src/VerseLinks.jsx';
const annotation={id:'synthetic:annotation',project_id:'synthetic:project',document_id:'synthetic:document',text_sha256:'synthetic:hash',exact:'😀 التفسير and tafsīr. Synthetic selected source.'};
const materials=new Map(),requests=[],receipts=new Map();let lose=true,wrongProject=false;
const fixture=window.__verseTest={materials,requests,receipts,annotation};
const api={async request(path,params){
  if(path==='verses/material')return {...materials.get(params.material_id),...(wrongProject ? {project_id:'other'} : {})};
  if(path==='verses/annotation-links'){const rows=[...materials.values()].sort((a,b)=>a.id.localeCompare(b.id)),start=params.cursor ? rows.findIndex(row=>row.id===params.cursor)+1 : 0;
    return {items:rows.slice(start,start+1).map(row=>({...row,...(wrongProject ? {project_id:'other'} : {})})),next_cursor:rows.length>start+1 ? rows[start].id : null};}
  throw new Error('Unexpected synthetic read');
},async post(path,value){if(path!=='verses/materials')throw new Error('Unexpected synthetic write');requests.push(JSON.parse(JSON.stringify(value)));
  let result=receipts.get(value.request_uuid);if(!result){const row={...value,id:'synthetic:material:'+materials.size,revision:1,document_id:annotation.document_id,text_sha256:annotation.text_sha256,
    selected_quote:annotation.exact,review_state:'pending',reference:{id:`verse:${value.chapter}:${value.ayah_start}`,label:`Q ${value.chapter}:${value.ayah_start}`,chapter:value.chapter,ayah_start:value.ayah_start,ayah_end:value.ayah_end}};
    materials.set(row.id,row);result={id:row.id,project_id:row.project_id,revision:1};receipts.set(value.request_uuid,result);}
  if(lose){lose=false;throw {status:503};}return result;
}};
function Harness(){const drafts=useRef(new Map()),[round,setRound]=useState(0);fixture.drafts=drafts;fixture.remount=()=>setRound(x=>x+1);fixture.wrong=value=>{wrongProject=value;};
  return <main style={{maxWidth:900,margin:'auto',padding:12}}><p>Synthetic API fixture · no live sign-in or scholarly review</p><blockquote dir="auto">{annotation.exact}</blockquote>
    <VerseLinks key={round} api={api} projectId={annotation.project_id} annotation={annotation} sourceTitle="Synthetic Arabic/Unicode source" drafts={drafts} onOpenVerse={value=>{fixture.opened=value;}}/></main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
