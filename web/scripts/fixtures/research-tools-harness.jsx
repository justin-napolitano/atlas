// Explicit synthetic API boundary. Excluded from both application build manifests.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ResearchSearch from '../../src/ResearchSearch.jsx';
import ResearchBrief from '../../src/ResearchBrief.jsx';
import ResearchNotebook from '../../src/ResearchNotebook.jsx';
import '../../src/style.css';

const project='synthetic:project',record={id:'synthetic:source',project_id:project,title:'Synthetic source on interpretation'};
const document={id:'synthetic:document',project_id:project,source_record_id:record.id,text_body:'😀 التفسير tafsīr',text_sha256:'82bbc646a6ae4207420df87479767e05047854ac1c672bfd0aaeaeac1b8192f0',edition:'Synthetic edition',locator:'Synthetic p. 2',representation_url:'https://example.invalid/source',source_notice:'Synthetic provider notice retained verbatim.'};
const annotation={id:'synthetic:annotation',project_id:project,document_id:document.id,text_sha256:document.text_sha256,start_pos:2,end_pos:9,exact:'التفسير'};
const fixture=window.__researchTools={requests:[],queries:[],entries:new Map(),opened:[],exported:null,scenario:'normal',lose:true};
const base={project_id:project,title:'Interpretation',excerpt:'A located example about tafsīr.',record_id:record.id,document_id:null,annotation_id:null,entry_id:null,concept_id:null,revision:1,edition:null,locator:null,channel:'private',match_basis:'literal',thought_type:null};
const rows=[{...base,kind:'document',id:document.id,title:'Located source passage',document_id:document.id,edition:document.edition,locator:document.locator},
  {...base,kind:'passage_note',id:annotation.id,title:'My exact passage note',document_id:document.id,annotation_id:annotation.id},
  {...base,kind:'thought',id:'synthetic:question',entry_id:'synthetic:question',thought_type:'question',title:'A saved research question'},
  {...base,kind:'concept',id:'opaque:spelling',record_id:'synthetic:concept',concept_id:'synthetic:concept',title:'Tafsīr concept'}];
const api={async request(path,params){
  if(path==='research/search'){fixture.queries.push({...params});if(params.q==='stale')await new Promise(resolve=>{fixture.releaseSearch=resolve;});return {query:params.q,items:rows.map(row=>({...row,project_id:params.project_id})),truncated:params.q==='broad',ranking:'exact_title_then_title_prefix_then_literal_match'};}
  if(path==='reading/document')return {...document,...(fixture.scenario==='wrong-project'?{project_id:'foreign:project'}:fixture.scenario==='wrong-document-hash'?{text_body:document.text_body+' changed'}:{})};
  if(path==='reading/annotation')return {annotation:{...annotation,...(fixture.scenario==='wrong-hash'?{text_sha256:'b'.repeat(64)}:{})},anchor:{anchored:true}};
  if(path==='notebook/entry')return structuredClone(fixture.entries.get(params.entry_id));
  if(path==='notebook/network')return {project_id:project,items:[...fixture.entries.values()],truncated:false};
  if(path==='notebook/items')return {items:[...fixture.entries.values()].map(row=>({...row,item_kind:'entry',selected_quote:annotation.exact,source_title:record.title,edition:document.edition,locator:document.locator})),next_cursor:null};
  throw new Error(`Unexpected synthetic route: ${path}`);
},async post(path,value){if(path!=='notebook/entries')throw new Error('Unexpected synthetic POST');fixture.requests.push(structuredClone(value));const id=`urn:research:notebook:${value.request_uuid}`;if(!fixture.entries.has(id))fixture.entries.set(id,{...value,id,revision:1,state:'active'});if(fixture.lose){fixture.lose=false;throw {status:503,message:'The save response was lost. Retry the original request.'};}return {id,project_id:project,revision:1};}};
const nativeObjectURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{blob.text().then(text=>{fixture.exported=JSON.parse(text);});return nativeObjectURL(blob);};
const nativeClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(!this.download)return nativeClick.call(this);};
function Harness(){const drafts=useRef(new Map()),[view,setView]=useState('search'),[currentProject,setProject]=useState(project),[round,setRound]=useState(0),[entry,setEntry]=useState('');fixture.drafts=drafts;
  fixture.search=()=>{setView('search');setProject(project);setRound(n=>n+1);};fixture.project=value=>setProject(value);fixture.brief=scenario=>{fixture.scenario=scenario || 'normal';setProject(project);setView('brief');setRound(n=>n+1);};fixture.remount=()=>setRound(n=>n+1);
  return <main style={{maxWidth:1000,margin:'auto'}}><p style={{padding:12,fontSize:12}}>Synthetic research tools boundary · no live owner sign-in or agent execution</p>{view==='search'?<ResearchSearch key={round} api={api} projectId={currentProject} onOpen={(...args)=>{fixture.opened=args;}} onOpenNotebook={(id)=>{fixture.opened=['notebook',id];}}/>:view==='brief'?<ResearchBrief key={round} api={api} projectId={currentProject} record={record} documentId={document.id} annotationId={annotation.id} drafts={drafts} onOpenNotebook={id=>{fixture.opened=['notebook',id];setEntry(id);setView('notebook');}}/>:<ResearchNotebook api={api} projectId={project} drafts={drafts} initialEntryId={entry}/>}</main>;
}
createRoot(window.document.getElementById('root')).render(<Harness/>);
