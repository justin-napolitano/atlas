// Synthetic component adapter, excluded from application entries and public builds.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import PilotReading from '../../src/PilotReading.jsx';
import '../../src/style.css';
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function main(){
const resource={resource_id:'synthetic:resource',label:'Synthetic Arabic browser fixture',publisher:'Synthetic adapter',source_notice:'Synthetic notice. <b>Plain text only</b>',reading_note:'No edition or reading inference.',review_limit:'Test text, not Qur’an text or scholarly evidence.',attribution_url:'https://tanzil.net/',verses:await Promise.all([59,83].map(async ayah=>({chapter:4,ayah_start:ayah,ayah_end:ayah,text:`اختبار القراءة ${ayah}`,text_sha256:await digest(`اختبار القراءة ${ayah}`),reference:{id:`synthetic:4:${ayah}`,label:`Q 4:${ayah}`}})))};
const requests=[],receipts=new Map(),documents=new Map(),annotations=new Map();let lost=true;
const test=window.__pilotTest={requests,receipts,documents,annotations};
const api={async request(path,params){
  if(path==='verses/pilot')return structuredClone(resource);
  if(path==='reading/document')return documents.get(params.document_id);
  if(path==='reading/annotation')return annotations.get(params.annotation_id);
  if(path==='verses/materials')return {items:params.cursor ? [{id:'synthetic:material2',project_id:params.project_id,chapter:4,ayah_start:params.ayah_start,ayah_end:params.ayah_end,material_kind:'scholarship',link_kind:'discussion',review_state:'pending',attribution:'Synthetic second source',edition:'Synthetic edition',locator:'Synthetic section',selected_quote:'Synthetic located scholarship.',source_scope:'No historical claim',source_record_id:'synthetic:source2',document_id:'synthetic:document2',annotation_id:'synthetic:annotation2',reference:{label:`Q 4:${params.ayah_start}`}}] : [{id:'synthetic:material',project_id:params.project_id,chapter:4,ayah_start:params.ayah_start,ayah_end:params.ayah_end,material_kind:'tafsir',link_kind:'discussion',review_state:'pending',attribution:'Synthetic commentary <script>inert</script>',edition:'Synthetic edition',locator:'Synthetic section',selected_quote:'Synthetic located commentary.',source_scope:'Bounded synthetic scope',source_record_id:'synthetic:source',document_id:'synthetic:document',annotation_id:'synthetic:annotation',reference:{label:`Q 4:${params.ayah_start}`},citation_changed_needs_review:true}],next_cursor:params.cursor ? null : 'synthetic:material'};
  throw new Error('Unexpected pilot route');
},async post(path,value){
  if(path!=='verses/import-pilot')throw new Error('Unexpected write');requests.push(structuredClone(value));
  const previous=receipts.get(value.request_uuid);if(previous){if(previous.payload!==JSON.stringify(value))throw new Error('Changed retry');return previous.result;}
  const verse=resource.verses.find(v=>v.ayah_start===value.ayah),result={project_id:value.project_id,record_id:'synthetic:imported',document_id:'synthetic:import-document',annotation_id:'synthetic:import-annotation',material_id:'synthetic:import-material',resource_id:resource.resource_id,revision:1};
  documents.set(result.document_id,{id:result.document_id,project_id:value.project_id,source_record_id:result.record_id,text_body:verse.text,text_sha256:verse.text_sha256,source_notice:resource.source_notice});
  annotations.set(result.annotation_id,{annotation:{id:result.annotation_id,project_id:value.project_id,document_id:result.document_id,exact:verse.text,text_sha256:verse.text_sha256},anchor:{anchored:true}});
  receipts.set(value.request_uuid,{payload:JSON.stringify(value),result});if(lost){lost=false;throw {status:503};}return result;
}};
function Harness(){const drafts=useRef(new Map()),[project,setProject]=useState('synthetic-project'),[open,setOpen]=useState(null),[,redraw]=useState(0);test.drafts=drafts;test.setProject=setProject;test.back=()=>setOpen(null);
return <main className="shell"><p>Synthetic browser adapter. Not an authenticated backend.</p>{open ? <section id="pilot-opened"><h2>Exact source requested</h2><pre>{JSON.stringify(open)}</pre><button onClick={()=>setOpen(null)}>Back to pilot</button></section> : <PilotReading key={project} api={api} projectId={project} drafts={drafts} changed={()=>redraw(n=>n+1)} onOpen={(...args)=>setOpen(args)} onCancel={()=>{}}/>}</main>;}
createRoot(document.getElementById('root')).render(<Harness/>);

}
main();
