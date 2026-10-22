import React,{useEffect,useRef,useState} from 'react';
import {useSurfaceResume} from './surfaceActivity.js';

export default function SubpageContents({entryId,api,onOpen,epoch}){
 const [page,setPage]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),serial=useRef(0);
 async function load(more=false){const token=++serial.current;setBusy(true);setError('');try{const result=await api.request('desktop/pages',{parent_id:entryId,limit:20,...(more&&page?.next_cursor?{cursor:page.next_cursor}:{})});if(token===serial.current)setPage(old=>({...result,items:more?[...(old?.items||[]),...result.items]:result.items}));}catch(err){if(token===serial.current)setError(err.message);}finally{if(token===serial.current)setBusy(false);}}
 useEffect(()=>{load();return()=>{serial.current++;};},[entryId,epoch]);useSurfaceResume(()=>load());
 return <nav className="subpage-contents" aria-label="Subpage contents"><strong>Contents</strong>{page?.items.map(row=><button type="button" key={row.id} onClick={()=>onOpen({kind:'entry',id:row.id})}>{row.title}</button>)}{!page&&busy&&<small role="status">Loading subpages…</small>}{page&&!page.items.length&&<small>Subpages will appear here.</small>}{error&&<small role="alert">{error} <button type="button" onClick={()=>load()}>Retry</button></small>}{page?.next_cursor&&<button type="button" disabled={busy} onClick={()=>load(true)}>More subpages</button>}</nav>;
}
