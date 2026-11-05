import React,{useEffect,useRef,useState} from 'react';

export function TrashAction({api,projectId,kind,id,revision,trashRevision=0,trashed=false,disabled=false,onChanged=()=>{},restoreLabel='Undo trash'}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[current,setCurrent]=useState(null);
  const pending=useRef(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const hidden=current?current.state==='trashed':trashed;
  async function change(){if(busy)return;setBusy(true);setMessage('');
    const sent=pending.current || {project_id:projectId,target_kind:kind,target_id:id,target_revision:revision,expected_revision:current?.revision ?? trashRevision,state:hidden?'active':'trashed'};
    pending.current=sent;
    try{const row=await api.request('writing/trash',{},sent);
      if(row.project_id!==projectId || row.target_kind!==kind || row.target_id!==id || row.target_revision!==sent.target_revision || row.revision!==sent.expected_revision+1 || row.state!==sent.state)throw new Error();
      pending.current=null;if(alive.current){setCurrent(row);setMessage(row.state==='trashed'?'Moved to Trash. Content and links are retained.':'Restored with the same identity and links.');onChanged(row);}
    }catch(error){if(alive.current)setMessage(error.status===409?'Writing or Trash changed in another session. Reopen it to compare before changing it.':'Trash update was not confirmed. Retry sends the same request.');}
    finally{if(alive.current)setBusy(false);}
  }
  return <span className="private-trash-action"><button disabled={disabled||busy} onClick={change}>{busy?'Updating Trash…':pending.current?'Retry Trash update':hidden?restoreLabel:'Move to Trash'}</button>{message&&<small role="status">{message}</small>}</span>;
}

export default function PrivateTrash({api,projectId,onOpen,onChanged=()=>{}}){
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[open,setOpen]=useState(false),[message,setMessage]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0),alive=useRef(true);
  useEffect(()=>{alive.current=true;setRows([]);setOpen(false);return()=>{alive.current=false;generation.current++;};},[projectId]);
  async function load(after=''){const token=++generation.current;setLoading(true);setOpen(true);setMessage('');try{
    const result=await api.request('writing/trash',{project_id:projectId,cursor:after,limit:25});
    if(!Array.isArray(result.items)||result.items.some(r=>r.project_id!==projectId||r.state!=='trashed'||!['entry','annotation'].includes(r.target_kind)))throw new Error();
    if(alive.current&&token===generation.current){setRows(old=>after?[...old,...result.items]:result.items);setCursor(result.next_cursor);}
  }catch{if(alive.current&&token===generation.current)setMessage('Could not open private Trash. Retry when signed in.');}finally{if(alive.current&&token===generation.current)setLoading(false);}}
  return <section className="private-trash" aria-label="Private writing Trash"><button disabled={loading} onClick={()=>open?setOpen(false):load()}>{loading?'Opening Trash…':open?'Hide Trash':'Trash'}</button>{open&&<><p>Private notes, questions, and margin writing. Restoring keeps their original links. Nothing is permanently deleted here.</p>{message&&<p role="status">{message}</p>}{!rows.length&&!loading&&!message&&<small>Trash is empty.</small>}{rows.map(row=><article key={row.target_kind+row.target_id}><h4>{row.title || 'Untitled writing'}</h4><pre dir="auto">{row.body}</pre><TrashAction api={api} projectId={projectId} kind={row.target_kind} id={row.target_id} revision={row.target_revision} trashRevision={row.revision} trashed restoreLabel="Restore" onChanged={result=>{setRows(old=>old.filter(r=>r.target_id!==row.target_id||r.target_kind!==row.target_kind));onChanged(result);}}/>{onOpen&&<button onClick={()=>onOpen(row)}>Open original link</button>}</article>)}{cursor&&<button disabled={loading} onClick={()=>load(cursor)}>More in Trash</button>}</>}</section>;
}
