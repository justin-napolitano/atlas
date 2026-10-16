// Explicit synthetic owner boundary; never included in an application artifact.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/style.css';
import ResearchNotebook from '../../src/ResearchNotebook.jsx';
import SourceReader from '../../src/SourceReader.jsx';
import {PassageNoteEditor} from '../../src/passageNoteEditor.js';
import ResearchSources from '../../src/ResearchSources.jsx';
import ResearchQuestions from '../../src/ResearchQuestions.jsx';
const project='synthetic:project',anchor={record_id:'synthetic:source',document_id:'synthetic:document',annotation_id:'synthetic:annotation'};
const entries=new Map(),history=new Map(),requests=[],receipts=new Map();let lose=true,loseEdit=true,wrong=false;
const fixture=window.__notebookTest={entries,requests,history,anchor};
const recoveryRows=new Map();fixture.recoveryRows=recoveryRows;
const trashRows=new Map();fixture.trashRows=trashRows;
const records=[{id:'synthetic:source',project_id:project,kind:'source',title:'Synthetic Arabic source',summary:'A source with saved text',review_state:'pending'},{id:'synthetic:reference',project_id:project,kind:'source',title:'Metadata-only reference',summary:'An independent bibliographic record',review_state:'pending'},{id:'synthetic:work',project_id:project,kind:'work',title:'A source work',summary:'A bibliographic work',review_state:'pending'},{id:'synthetic:curated-question',project_id:project,kind:'question',title:'A recorded research question',summary:'A question from the research graph',revision:1,review_state:'pending'}];
const passage={item_kind:'passage_note',thought_type:'passage_note',id:anchor.annotation_id,project_id:project,title:'Original passage note',body:'Single authoritative passage body',...anchor,
  source_title:'Synthetic Arabic source',edition:'Synthetic edition',locator:'p. 2',selected_quote:'😀 التفسير tafsīr',revision:1,state:'active',cursor:'passage_note:'+anchor.annotation_id};
const recordNote={...passage,id:anchor.record_id,item_kind:'record_note',thought_type:'record_note',title:'Original record note',body:'Single authoritative reading-record note',document_id:null,annotation_id:null,selected_quote:null,cursor:'record_note:'+anchor.record_id};
function record(row){entries.set(row.id,row);history.set(row.id,[structuredClone(row),...(history.get(row.id) || [])]);return structuredClone(row);}
const sourceText='😀 التفسير tafsīr',sourceHash=crypto.subtle.digest('SHA-256',new TextEncoder().encode(sourceText)).then(buffer=>[...new Uint8Array(buffer)].map(value=>value.toString(16).padStart(2,'0')).join(''));
const quoteCaptures=new Map(),quoteRequests=[];fixture.quoteRequests=quoteRequests;fixture.quoteCaptures=quoteCaptures;
async function sourceDocument(){return {id:anchor.document_id,project_id:project,source_record_id:anchor.record_id,text_body:sourceText,text_sha256:await sourceHash,edition:'Synthetic edition',locator:'p. 2',source_notice:'Synthetic test text',representation_url:''};}
async function sourceAnnotation(){return {id:anchor.annotation_id,project_id:project,document_id:anchor.document_id,text_sha256:await sourceHash,start_pos:0,end_pos:Array.from(sourceText).length,exact:sourceText,capture_kind:'comment',mark_style:'highlight',body:'Original passage note',revision:1};}
const api={async post(path,value){if(path==='reading/annotations'){quoteRequests.push(structuredClone(value));const id='urn:research:annotation:'+value.annotation_uuid;let row=quoteCaptures.get(id);if(!row){row={...value,id,start_pos:value.start,end_pos:value.end,revision:1};quoteCaptures.set(id,row);}if(fixture.loseQuote){fixture.loseQuote=false;throw new Error('Quote response lost.');}return row;}if(path!=='notebook/entries')throw new Error('Unexpected fixture POST');requests.push(structuredClone(value));let receipt=receipts.get(value.request_uuid);
  if(!receipt){const row=record({...value,id:'urn:research:notebook:'+value.request_uuid,revision:1,state:'active',source_title:value.record_id?passage.source_title:null,selected_quote:value.annotation_id?passage.selected_quote:null,edition:value.document_id?passage.edition:null,locator:value.document_id?passage.locator:null});receipt={id:row.id,project_id:project,revision:1};receipts.set(value.request_uuid,receipt);}
  if(lose){lose=false;throw {status:503,message:'Notebook save could not be confirmed.'};}return receipt;
},async request(path,params={},value){
  if(path==='writing/trash' && value){
    const key=value.target_kind+':'+value.target_id,previous=trashRows.get(key);
    if(previous && previous.revision!==value.expected_revision){if(previous.revision===value.expected_revision+1 && previous.state===value.state)return structuredClone(previous);throw {status:409,current:previous};}
    const row={...value,revision:value.expected_revision+1};trashRows.set(key,row);
    if(value.target_kind==='entry'){const entry=entries.get(value.target_id);entry.trashed=value.state==='trashed';entry.trash_revision=row.revision;}
    if(fixture.loseTrash){fixture.loseTrash=false;throw {status:503};}return structuredClone(row);
  }
  if(path==='writing/trash')return {items:[...trashRows.values()].filter(row=>row.state==='trashed').map(row=>({...row,...(row.target_kind==='entry'?{title:entries.get(row.target_id).title,body:entries.get(row.target_id).body}:{title:'Margin note',body:'Synthetic margin writing'})})),next_cursor:null};
  if(path==='notebook/draft' && value){
    const id='urn:research:writing-draft:'+value.draft_uuid,current=recoveryRows.get(id);
    if(current&&['entry_id','request_uuid','record_id','document_id','annotation_id','reading_position','base_revision'].some(k=>(current[k] ?? null)!==(value[k] ?? null)))throw Object.assign(new Error('Immutable recovery target'),{status:422});
    if(current && current.revision!==value.expected_revision){
      if(current.revision===value.expected_revision+1 && JSON.stringify(current.value)===JSON.stringify(value.value) && current.state===value.state)return structuredClone(current);
      throw {status:409,current:structuredClone(current)};
    }
    const row={...value,id,revision:value.expected_revision+1,base_snapshot:value.entry_id?structuredClone(history.get(value.entry_id)?.find(r=>r.revision===value.base_revision)):null};
    recoveryRows.set(id,row);return structuredClone(row);
  }
  if(path==='notebook/drafts')return {items:[...recoveryRows.values()].filter(row=>row.state==='active'&&row.project_id===params.project_id),next_cursor:null};
  if(path==='notebook/draft')return structuredClone(recoveryRows.get(params.draft_id));
  if(path==='record')return records.find(row=>row.id===params.record_id);
  if(path==='records')return {items:records.filter(row=>!params.kind||row.kind===params.kind).map(row=>({...row,...(fixture.foreignRecords?{project_id:'other'}:{})})),next_cursor:null};
  if(path==='evidence-path')return {project_id:project,nodes:[],edges:[],paths:[]};
  if(path==='record-context')return {project_id:project,record_id:params.record_id,items:[],next_cursor:null};
  if(path==='reading/documents')return {items:[await sourceDocument()],next_cursor:null};
  if(path==='reading/document')return sourceDocument();
  if(path==='reading/annotations')return {items:[await sourceAnnotation(),...quoteCaptures.values()],next_cursor:null};
  if(path==='reading/annotation'){const annotation=params.annotation_id===anchor.annotation_id?await sourceAnnotation():quoteCaptures.get(params.annotation_id);return {annotation,anchor:{anchored:true,start:annotation.start_pos,end:annotation.end_pos}};}
  if(['reading/scripture-citations','verses/annotation-links','lexicon/annotation-links'].includes(path))return {items:[],next_cursor:null};
  if(path==='research/search')return {truncated:false,items:[{kind:'record',id:'synthetic:source',project_id:project,record_id:'synthetic:source',title:'Synthetic authority source',excerpt:'Background on authority',record_kind:'source'},{kind:'concept',id:'synthetic:concept',project_id:project,concept_id:'synthetic:concept',title:'Authority',excerpt:'Synthetic concept'}]};
  if(path==='notebook/network')return {project_id:project,items:[...entries.values()].filter(row=>row.state==='active'&&!row.trashed),truncated:false};
  if(path==='notebook/items'){const rows=[...[...entries.values()].map(row=>({...row,item_kind:'entry',cursor:'entry:'+row.id})),passage,recordNote].filter(row=>(!params.document_id||row.document_id===params.document_id)&&(!params.location_only||row.reading_position!=null)&&!row.trashed && (!params.item_scope || params.item_scope==='all' || (params.item_scope==='writing'?row.item_kind==='entry':row.item_kind!=='entry')) && row.state===params.state && (!params.thought_type || row.thought_type===params.thought_type) && (!params.q || (row.body+' '+row.title+' '+row.selected_quote).includes(params.q))).sort((a,b)=>a.cursor.localeCompare(b.cursor));return {items:(wrong&&!rows.length?[recordNote]:rows.filter(row=>row.cursor>(params.cursor || '')).slice(0,25)).map(row=>({...row,...(wrong?{project_id:'other'}:{})})),next_cursor:null};}
  if(path==='notebook/entry' && !value){const row=structuredClone(entries.get(params.entry_id));if(!row)throw Object.assign(new Error('Not found'),{status:404});row.links=row.links.map(link=>({rationale:link.rationale,id:link.id,kind:link.kind}));return row;}
  if(path==='notebook/entry' && value){requests.push(structuredClone(value));if(fixture.hold){fixture.hold=false;await new Promise(resolve=>{fixture.release=resolve;});}const current=entries.get(value.entry_id),fields=['thought_type','title','body','links','state'];
    if(current.revision!==value.expected_revision){if(current.revision===value.expected_revision+1 && fields.every(key=>JSON.stringify(current[key])===JSON.stringify(value[key])))return structuredClone(current);throw {status:409,current:structuredClone(current),message:'Another device changed this thought.'};}
    const row=record({...current,...value,id:value.entry_id,revision:current.revision+1});if(loseEdit){loseEdit=false;throw {status:503,message:'Correction save could not be confirmed.'};}return row;
  }
  if(path==='notebook/history'){const rows=history.get(params.entry_id).filter(row=>!params.before_revision || row.revision<params.before_revision);return {items:rows.slice(0,1).map(row=>({revision:row.revision,snapshot:row})),next_before_revision:rows.length>1?rows[0].revision:null};}
  throw new Error('Unexpected synthetic notebook route');
}};
fixture.seed=()=>{const target=[...entries.values()].find(row=>row.state==='active');return record({id:'synthetic:linked-note',project_id:project,title:'A related idea',body:`A note linking back: [[${target.id}|original idea]]`,thought_type:'note',links:[],state:'active',revision:1,record_id:null,document_id:null,annotation_id:null});};
fixture.remote=()=>{const row=[...entries.values()][0];record({...row,body:'Cloud thought from another device',revision:row.revision+1});};fixture.wrong=v=>{wrong=v;};fixture.normal=()=>{lose=false;loseEdit=false;};
function Harness(){const drafts=useRef(new Map()),[round,setRound]=useState(0),[initialQuery,setInitialQuery]=useState(''),[inlineSources,setInlineSources]=useState(false),[destination,setDestination]=useState(new URLSearchParams(location.search).has('margin')?'margin':'notes'),[compose,setCompose]=useState(''),[questionAnchor,setQuestionAnchor]=useState(null);fixture.inline=setInlineSources;fixture.drafts=drafts;fixture.remount=()=>setRound(v=>v+1);fixture.search=setInitialQuery;fixture.losePageMemory=()=>{drafts.current=new Map();setRound(v=>v+1);};
  const editor=useRef(null);if(!editor.current)editor.current=new PassageNoteEditor(api,()=>setRound(v=>v));
  const common={api,projectId:project,drafts,inlineSources,initialQuery,onOpenSource:(...args)=>{fixture.opened=args;}};
  return <main style={{maxWidth:1100,margin:'auto'}}><p>Synthetic notebook API fixture · no live owner sign-in</p><nav><button onClick={()=>setDestination('margin')}>Sample margin</button><button onClick={()=>setDestination('sources')}>Sample sources</button><button onClick={()=>setDestination('questions')}>Sample questions</button><button onClick={()=>setDestination('notes')}>Sample notes</button></nav>
    {destination==='margin'?<SourceReader key={round} record={records[0]} api={api} drafts={drafts} changed={()=>{}} noteEditor={editor.current} initialDocumentId={anchor.document_id}/>:destination==='sources'?<ResearchSources api={api} projectId={project} readings={[{record_id:anchor.record_id,document_id:anchor.document_id,edition:'Synthetic edition',locator:'p. 2',reading:'read'}]} onOpen={(...args)=>{fixture.opened=args;}} onAdd={()=>{fixture.added=true;}} onQuestion={row=>{setQuestionAnchor({project_id:project,record_id:row.id});setCompose(crypto.randomUUID());setDestination('questions');}}/>:destination==='questions'?<ResearchQuestions key={round} {...common} anchor={questionAnchor} composeRequest={compose} onComposeConsumed={()=>setCompose('')}/>:<ResearchNotebook {...common} key={round} anchor={anchor}/>}
  </main>;}
createRoot(document.getElementById('root')).render(<Harness/>);
