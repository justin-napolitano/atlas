import React,{useEffect,useRef,useState} from 'react';

export function RecoveryStatus({status,queue}){
  const labels={idle:'Recovery not saved yet',waiting:'Unsaved · recovery pending',saving:'Saving private recovery copy…',saved:'Recovery saved · note still needs Save',error:'Recovery failed · keep this page open',conflict:'Recovery conflict · both versions retained'};
  return <div className="writing-recovery-status"><small role={['error','conflict'].includes(status.phase)?'alert':undefined}>{labels[status.phase]}</small>{['error','conflict'].includes(status.phase)&&<><button onClick={()=>queue.retry()}>Retry recovery save</button>{status.current&&<details><summary>Compare recovery conflict</summary><pre>{status.current.value?.body || status.current.body}</pre><p>Your writing is still in the editor. Neither version is silently overwritten.</p><button onClick={()=>queue.fork()}>Keep both recovery copies</button></details>}</>}</div>;
}

/** Lists private server copies; opening a preview never overwrites an editor. */
export default function WritingRecovery({api,projectId,onRecover}){
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[message,setMessage]=useState(''),[preview,setPreview]=useState(null),[loading,setLoading]=useState(false);
  const alive=useRef(true),generation=useRef(0);
  useEffect(()=>{alive.current=true;setRows([]);setPreview(null);return()=>{alive.current=false;generation.current++;};},[projectId]);
  async function load(after=''){const token=++generation.current;setLoading(true);setMessage('');try{
    const result=await api.request('notebook/drafts',{project_id:projectId,cursor:after,limit:25});
    if(!Array.isArray(result.items)||result.items.some(r=>r.project_id!==projectId || !r.id?.startsWith('urn:research:writing-draft:') || r.state!=='active'))throw new Error('Recovery list did not match this project.');
    if(alive.current&&token===generation.current){setRows(old=>after?[...old,...result.items]:result.items);setCursor(result.next_cursor);}
  }catch{if(alive.current&&token===generation.current)setMessage('Could not load private recovery. Retry when signed in.');}finally{if(alive.current&&token===generation.current)setLoading(false);}}
  async function inspect(row){const token=++generation.current;try{
    const fresh=await api.request('notebook/draft',{project_id:projectId,draft_id:row.id});
    if(fresh.id!==row.id||fresh.project_id!==projectId||fresh.state!=='active')throw new Error();
    let current=null;const entryId=fresh.entry_id || (fresh.request_uuid?'urn:research:notebook:'+fresh.request_uuid:null);
    if(entryId){try{current=await api.request('notebook/entry',{project_id:projectId,entry_id:entryId});}catch(error){if(fresh.entry_id || error.status!==404)throw error;}}
    if(current&&(current.id!==entryId||current.project_id!==projectId))throw new Error();
    if(alive.current&&token===generation.current)setPreview({row:fresh,current});
  }catch{if(alive.current&&token===generation.current)setMessage('This recovery copy could not be verified. Your editor is unchanged.');}}
  return <section className="unfinished-writing" aria-label="Unfinished writing"><button disabled={loading} onClick={()=>load()}>{loading?'Finding unfinished work…':'Unfinished work'}</button>{message&&<p role="status">{message}</p>}
    {rows.map(row=><article key={row.id}><button onClick={()=>inspect(row)}>{row.value.title || 'Untitled '+row.value.thought_type}</button><small>Private recovery · revision {row.revision}</small></article>)}{cursor&&<button onClick={()=>load(cursor)}>More unfinished work</button>}
    {preview&&<aside aria-label="Writing recovery preview"><h3>{preview.row.value.title || 'Untitled writing'}</h3><pre dir="auto">{preview.row.value.body}</pre>{preview.current&&<><h4>Confirmed note · revision {preview.current.revision}</h4><pre dir="auto">{preview.current.body}</pre>{preview.current.revision!==preview.row.base_revision&&<p>The confirmed note changed. Recovery requires comparing both revisions before an actual save.</p>}</>}<p>Recover fills the editor; it does not save or publish the note.</p><button onClick={()=>{if(onRecover(preview.row,preview.current)!==false)setPreview(null);}}>Recover into editor</button><button onClick={()=>setPreview(null)}>Cancel recovery</button></aside>}
  </section>;
}
