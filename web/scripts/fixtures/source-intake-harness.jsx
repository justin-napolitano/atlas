// Isolated browser-test adapter. Never an application entry or an authentication bypass.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import AddSource from '../../src/AddSource.jsx';

const records=new Map(),documents=new Map(),receipts=new Map(),requests=[];
let loseResponse=true;
const test=window.__intakeTest={records,documents,receipts,requests};
const api={
  async request(path,params){
    if(path==='source-intakes/candidates')return {items:[...records.values()].filter(row=>row.project_id===params.project_id && row.attributes.url===params.source_url && params.source_url),truncated:false};
    if(path==='search')return {items:[...records.values()].filter(row=>row.project_id===params.project_id && row.title.includes(params.q))};
    if(path==='record')return records.get(params.record_id);
    if(path==='reading/document')return documents.get(params.document_id);
    throw new Error('Unexpected synthetic route');
  },
  async post(path,value){
    if(path!=='source-intakes')throw new Error('Unexpected synthetic write');
    requests.push(JSON.parse(JSON.stringify(value)));
    const prior=receipts.get(value.intake_uuid);
    if(prior){if(prior.input!==JSON.stringify(value))throw new Error('Changed synthetic retry');return prior.result;}
    const source=value.existing_source_record_id || 'synthetic:source:'+records.size;
    if(!records.has(source))records.set(source,{id:source,project_id:value.project_id,kind:'source',title:value.title,review_state:'pending',attributes:{url:value.source_url}});
    let document_id=null;
    if(value.excerpt){document_id='synthetic:document:'+documents.size;documents.set(document_id,{id:document_id,project_id:value.project_id,source_record_id:source,
      ...value.excerpt,text_body:value.excerpt.text.replaceAll('\r\n','\n').replaceAll('\r','\n')});}
    const result={project_id:value.project_id,record_id:source,document_id,replayed:false};
    receipts.set(value.intake_uuid,{input:JSON.stringify(value),result});
    if(loseResponse){loseResponse=false;throw {status:503};}
    return result;
  },
};
function Harness(){
  const drafts=useRef(new Map()),[project,setProject]=useState('synthetic-project'),[created,setCreated]=useState(null),[round,setRound]=useState(0);
  test.drafts=drafts;test.setProject=setProject;test.reset=()=>{setCreated(null);setRound(value=>value+1);};
  return <><p style={{margin:'1rem'}}>Synthetic browser fixture · no real sources or sign-in.</p>{created ? <section id="intake-created"><h2>Source saved</h2><p>{created.record_id}</p><p>{created.document_id || 'Metadata only'}</p>{created.document_id && <blockquote>{documents.get(created.document_id).text_body}</blockquote>}</section>
    : <AddSource key={project+round} api={api} projectId={project} drafts={drafts} onCreated={setCreated}/>}</>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
