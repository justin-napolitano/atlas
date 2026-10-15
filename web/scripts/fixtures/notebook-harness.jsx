// Explicit synthetic owner boundary; never included in an application artifact.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ResearchNotebook from '../../src/ResearchNotebook.jsx';
const project='synthetic:project',anchor={record_id:'synthetic:source',document_id:'synthetic:document',annotation_id:'synthetic:annotation'};
const entries=new Map(),history=new Map(),requests=[],receipts=new Map();let lose=true,loseEdit=true,wrong=false;
const fixture=window.__notebookTest={entries,requests,history,anchor};
const passage={item_kind:'passage_note',thought_type:'passage_note',id:anchor.annotation_id,project_id:project,title:'Original passage note',body:'Single authoritative passage body',...anchor,
  source_title:'Synthetic Arabic source',edition:'Synthetic edition',locator:'p. 2',selected_quote:'😀 التفسير tafsīr',revision:1,state:'active',cursor:'passage_note:'+anchor.annotation_id};
const recordNote={...passage,id:anchor.record_id,item_kind:'record_note',thought_type:'record_note',title:'Original record note',body:'Single authoritative reading-record note',document_id:null,annotation_id:null,selected_quote:null,cursor:'record_note:'+anchor.record_id};
function record(row){entries.set(row.id,row);history.set(row.id,[structuredClone(row),...(history.get(row.id) || [])]);return structuredClone(row);}
const api={async post(path,value){if(path!=='notebook/entries')throw new Error('Unexpected fixture POST');requests.push(structuredClone(value));let receipt=receipts.get(value.request_uuid);
  if(!receipt){const row=record({...value,id:'urn:research:notebook:'+value.request_uuid,revision:1,state:'active',source_title:passage.source_title,selected_quote:passage.selected_quote,edition:passage.edition,locator:passage.locator});receipt={id:row.id,project_id:project,revision:1};receipts.set(value.request_uuid,receipt);}
  if(lose){lose=false;throw {status:503,message:'Notebook save could not be confirmed.'};}return receipt;
},async request(path,params={},value){
  if(path==='notebook/items'){const rows=[...[...entries.values()].map(row=>({...row,item_kind:'entry',cursor:'entry:'+row.id})),passage,recordNote].filter(row=>row.state===params.state && (!params.thought_type || row.thought_type===params.thought_type) && (!params.q || (row.body+' '+row.title+' '+row.selected_quote).includes(params.q))).sort((a,b)=>a.cursor.localeCompare(b.cursor));return {items:rows.filter(row=>row.cursor>(params.cursor || '')).slice(0,25).map(row=>({...row,...(wrong?{project_id:'other'}:{})})),next_cursor:null};}
  if(path==='notebook/entry' && !value){const row=structuredClone(entries.get(params.entry_id));row.links=row.links.map(link=>({rationale:link.rationale,id:link.id,kind:link.kind}));return row;}
  if(path==='notebook/entry' && value){requests.push(structuredClone(value));const current=entries.get(value.entry_id),fields=['thought_type','title','body','links','state'];
    if(current.revision!==value.expected_revision){if(current.revision===value.expected_revision+1 && fields.every(key=>JSON.stringify(current[key])===JSON.stringify(value[key])))return structuredClone(current);throw {status:409,current:structuredClone(current),message:'Another device changed this thought.'};}
    const row=record({...current,...value,id:value.entry_id,revision:current.revision+1});if(loseEdit){loseEdit=false;throw {status:503,message:'Correction save could not be confirmed.'};}return row;
  }
  if(path==='notebook/history'){const rows=history.get(params.entry_id).filter(row=>!params.before_revision || row.revision<params.before_revision);return {items:rows.slice(0,1).map(row=>({revision:row.revision,snapshot:row})),next_before_revision:rows.length>1?rows[0].revision:null};}
  throw new Error('Unexpected synthetic notebook route');
}};
fixture.remote=()=>{const row=[...entries.values()][0];record({...row,body:'Cloud thought from another device',revision:row.revision+1});};fixture.wrong=v=>{wrong=v;};
function Harness(){const drafts=useRef(new Map()),[round,setRound]=useState(0),[initialQuery,setInitialQuery]=useState('');fixture.drafts=drafts;fixture.remount=()=>setRound(v=>v+1);fixture.search=setInitialQuery;
  return <main style={{maxWidth:1100,margin:'auto'}}><p>Synthetic notebook API fixture · no live owner sign-in</p><ResearchNotebook key={round} api={api} projectId={project} drafts={drafts} anchor={anchor} initialQuery={initialQuery} onOpenSource={(...args)=>{fixture.opened=args;}}/></main>;}
createRoot(document.getElementById('root')).render(<Harness/>);
