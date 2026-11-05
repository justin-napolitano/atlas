// Synthetic browser surface only; production uses the normal authenticated API.
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import RecoverableDraft from '../../src/RecoverableDraft.jsx';
import {workspaceAPI} from '../../src/workspaceClient.js';
import '../../src/style.css';
const document={id:'synthetic:document',project_id:'synthetic',source_record_id:'synthetic:source',text_sha256:'a'.repeat(64),text_body:'😀 tafsīr and التفسير.'};
const annotation={id:'synthetic:annotation',project_id:'synthetic',document_id:document.id,text_sha256:document.text_sha256,start_pos:2,end_pos:8,exact:'tafsīr',capture_kind:'comment',revision:1};
const api=workspaceAPI();let rejectRecovery=false;
function Harness(){const [mode,setMode]=useState(new URL(location.href).searchParams.get('mode') || 'record_note'),[hasSelection,setHasSelection]=useState(new URL(location.href).searchParams.get('finder')!=='true'),[body,setBody]=useState(''),[recovered,setRecovered]=useState(null),drafts=useRef(new Map()),[,render]=useState(0);
  window.__draftTest={drafts,setRejectRecovery:value=>{rejectRecovery=value;},setFinder:()=>{const url=new URL(location.href);url.searchParams.set('finder','true');history.pushState(null,'',url);setHasSelection(false);},setMode:value=>{const url=new URL(location.href);url.searchParams.set('mode',value);history.pushState(null,'',url);setMode(value);setBody('');setRecovered(null);}};
  return <main className="shell"><p>Synthetic recoverable writing adapter. No live user data or sign-in.</p><h1>Unfinished reading notes</h1><label>Editor<textarea style={{width:'100%',boxSizing:'border-box',minHeight:120}} id="draft-editor" value={body} onChange={event=>setBody(event.target.value)}/></label>
    <RecoverableDraft key={mode} api={api} projectId="synthetic" recordId="synthetic:source" contextKind={mode} document={mode==='record_note' ? undefined : document} annotation={mode==='annotation' ? annotation : undefined} selection={mode==='capture' && hasSelection ? {annotation_uuid:'12345678-1234-4123-8123-123456789012',start:13,end:20,exact:'التفسير',capture_kind:'comment'} : undefined} body={body} markStyle={mode==='record_note' ? 'none' : 'underline'} baseRevision={mode==='annotation' ? 1 : 0} drafts={drafts} changed={()=>render(x=>x+1)} onRecover={value=>{if(rejectRecovery)return false;setBody(value.body);setRecovered(value);return true;}}/>
    {recovered && <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}} id="recovered-payload">{JSON.stringify(recovered)}</pre>}
  </main>;
}
createRoot(globalThis.document.getElementById('root')).render(<Harness/>);
