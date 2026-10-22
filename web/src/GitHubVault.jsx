import React,{useEffect,useRef,useState} from 'react';
import {useSurfaceResume} from './surfaceActivity.js';

/** Private native connection and bounded inventory; opening never uploads writing. */
export default function GitHubVault({api,onOpen}){
 const [value,setValue]=useState(null),[repository,setRepository]=useState(''),[branch,setBranch]=useState('main'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null);
 const attempt=useRef(null),live=useRef(true);
 async function load(){try{const row=await api.request('desktop/vault');if(live.current)setValue(row);}catch(err){if(live.current)setError(err.message);}}
 useEffect(()=>{live.current=true;load();return()=>{live.current=false;};},[]);useSurfaceResume(load);
 async function connect(event){event.preventDefault();setBusy(true);setError('');attempt.current??={repository:repository.trim(),branch:branch.trim(),owner_confirmed:true};
  try{const row=await api.post('desktop/vault/connect',attempt.current);if(!row.connection||row.connection.repository.toLowerCase()!==attempt.current.repository.toLowerCase()||row.connection.branch!==attempt.current.branch)throw Error('Connection was not confirmed. Retry the same connection.');if(live.current){setValue(row);attempt.current=null;}}
  catch(err){if([400,422,403].includes(err.status))attempt.current=null;if(live.current)setError(err.message);}finally{if(live.current)setBusy(false);}}
 async function inspect(more=false){setBusy(true);setError('');try{const row=await api.request('desktop/vault/preview',{...(more&&preview?.next_cursor?{cursor:preview.next_cursor}:{})});if(live.current)setPreview(old=>more?{...row,items:[...old.items,...row.items]}:row);}catch(err){if(live.current)setError(err.message);}finally{if(live.current)setBusy(false);}}
 const connection=value?.connection;
 return <section className="connected-document"><header className="connected-section-title"><h1>Private vault</h1></header>
 {!value&&!error&&<p role="status">Opening…</p>}
 {value&&!connection&&<><p>Connect your private GitHub repository. Your writing stays on this Mac until you choose to sync it.</p>
 <form className="connected-properties" onSubmit={connect}><label>Repository<input autoFocus autoComplete="off" placeholder="owner/repository" value={repository} disabled={busy||!!attempt.current} maxLength={201} onChange={event=>setRepository(event.target.value)}/></label><label>Branch<input value={branch} disabled={busy||!!attempt.current} maxLength={128} onChange={event=>setBranch(event.target.value)}/></label><button disabled={busy||!repository.trim()||!branch.trim()}>{busy?'Checking…':attempt.current?'Retry connection':'Connect privately'}</button></form>
 <p className="connected-muted-action">Uses your installed GitHub CLI login. No credentials are copied into Atlas.</p></>}
 {connection&&<><p>{connection.repository} · {connection.branch}</p><p>Connected as {connection.account_login}. Nothing has been uploaded.</p><button disabled={busy} onClick={()=>inspect()}>{busy?'Checking…':'Preview my pages'}</button></>}
 {error&&<p role="alert">{error}{!value&&<button onClick={load}>Retry</button>}</p>}
 {preview&&<section aria-label="Vault preview"><p>Preview only · no pages uploaded. {preview.next_cursor?'More pages are available.':''}</p>{preview.items.map(row=><div className="vault-preview-row" key={row.id}><button onClick={()=>onOpen({kind:'entry',id:row.id})}>{row.title}</button><small>{row.eligible?'Available for a future reviewed sync':row.reason}</small></div>)}{!preview.items.length&&<p>No saved pages in this part of your notebook.</p>}{preview.next_cursor&&<button disabled={busy} onClick={()=>inspect(true)}>More pages</button>}</section>}
 </section>;
}
