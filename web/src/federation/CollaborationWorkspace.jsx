import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CollaborationClient, DraftSession, normalizeNewlines } from './client.js';
import NotesLayout from './NotesLayout.jsx';
import {parseNoteQuery} from './noteQuery.js';
import {replicaNoteStatus,downloadMarkdown} from './notesStatus.js';
import {CreateNoteIntent} from './createNote.js';
import {readNoteLink,stableNoteLink,noteReferences} from './noteLinks.js';
import './notes.css';

const client = new CollaborationClient();
const friendly = error => error?.message || 'The operation was not confirmed. Your writing is retained.';
const scopeKey = (account, brain) => `${account}/${brain}`;

export default function CollaborationWorkspace({renderResearch = null} = {}) {
  const [ready, setReady] = useState(false), [code, setCode] = useState(''), [profiles, setProfiles] = useState([]), [account, setAccount] = useState('');
  const [bridgeMissing,setBridgeMissing]=useState(false),[ownerURL,setOwnerURL]=useState('');
  const searchGeneration=useRef(0),navigationGeneration=useRef(0),creations=useRef(new Map()),searchInput=useRef(null);
  const [history,setHistory]=useState(null),[activity,setActivity]=useState(null);const linkTarget=useRef(readNoteLink()),searchedQuery=useRef(null);
  const [brains, setBrains] = useState([]), [offline, setOffline] = useState(false), [brain, setBrain] = useState(''), [state, setState] = useState(null), [pageID, setPageID] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [auto, setAuto] = useState(false), [query, setQuery] = useState(''), [results, setResults] = useState(null);
  const [, redraw] = useState(0), sessions = useRef(new Map()), active = useRef({ account, brain });
  active.current = { account, brain };
  const activePage = useRef(pageID); activePage.current = pageID;
  const refresh = () => redraw(n => n + 1);
  const profile = profiles.find(item => item.id === account), selectedBrain = brains.find(item => item.brain_id === brain);
  const pages = state?.pages || [], page = pages.find(item => item.page_id === pageID);
  const creationKey=scopeKey(account,brain);if(brain&&!creations.current.has(creationKey))creations.current.set(creationKey,new CreateNoteIntent(client,account,brain));const creation=creations.current.get(creationKey);
  const sessionKey = `${scopeKey(account, brain)}/${pageID}`;
  let session = sessions.current.get(sessionKey);
  if (page && !session) { session = new DraftSession(client, account, brain, page, refresh); sessions.current.set(sessionKey, session); }
  const currentLinks=useMemo(()=>noteReferences(session?.value.body||'',pages),[session?.value.body,pages]);
  const backlinks=useMemo(()=>pages.filter(row=>row.page_id!==pageID&&row.content.state!=='deleted'&&noteReferences(row.content.body,pages).some(link=>link.id===pageID)),[pages,pageID]);
  const sameScope = (a, b) => active.current.account === a && active.current.brain === b;

  async function loadProfiles() { const value = await client.request('profiles'); setProfiles(value.items); setOwnerURL(value.private_workspace_url || ''); setReady(true); }
  useEffect(() => { client.open().then(loadProfiles).catch(error => { if(error.status===404)setBridgeMissing(true); }); }, []);
  useEffect(() => {
    const unload = event => { if ([...sessions.current.values()].some(s => !s.saved)) { event.preventDefault(); event.returnValue = ''; } };
    addEventListener('beforeunload', unload); return () => removeEventListener('beforeunload', unload);
  }, []);
  async function unlock(event) { event.preventDefault(); setError(''); try { await client.open(code); setCode(''); await loadProfiles(); } catch (err) { setCode(''); setError(friendly(err)); } }
  async function flushAll() { for (const s of sessions.current.values()) if (!s.saved) await s.flush(); }
  async function chooseAccount(value) {
    searchGeneration.current++;
    const navigation=++navigationGeneration.current;setBusy(true);try { await flushAll();if(navigationGeneration.current!==navigation)return;active.current={account:value,brain:''};setHistory(null);setActivity(null);setAccount(value); setBrain(''); setState(null); setPageID(''); setBrains([]); setAuto(false); setResults(null); setNotice('Choose Load my brains to read your current memberships.'); setError(''); } catch (err) { setError(friendly(err)); }finally{setBusy(false);}
  }
  async function loadBrains() {
    const selected = account; setBusy(true); setError('');
    try { const value = await client.request(`${client.profile(selected)}/brains`); if (active.current.account !== selected) return; setBrains(value.items || []); setOffline(!!value.offline); setNotice(value.offline ? 'Service unavailable. These are saved local copies; current access has not been verified.' : 'Only brains available to this account are listed. Select one to begin.'); }
    catch (err) { if (active.current.account === selected) setError(friendly(err)); } finally { setBusy(false); }
  }
  async function applyState(a, b, value) {
    if (!sameScope(a, b)) return;
    for (const row of value.pages) sessions.current.get(`${scopeKey(a, b)}/${row.page_id}`)?.adopt(row);
    setState(value); setPageID(previous=>linkTarget.current?.brain===b&&value.pages.some(item=>item.page_id===linkTarget.current.page)?linkTarget.current.page:value.pages.some(item=>item.page_id===previous)?previous:value.pages.find(item=>item.content.state!=='deleted')?.page_id||'');
  }
  async function readState(a = account, b = brain) { const value = await client.request(`${client.brain(a, b)}/state`); await applyState(a, b, value); return value; }
  async function chooseBrain(item) {
    searchGeneration.current++;const navigation=++navigationGeneration.current;
    setBusy(true); setError('');
    try {
      await flushAll(); const a = account, b = item.brain_id;
      const value = await client.request(`${client.brain(a, b)}/${offline ? 'open' : 'select'}`, {});
      if (active.current.account !== a||navigationGeneration.current!==navigation) return false;
      active.current = { account: a, brain: b }; setBrain(b); setPageID(''); setAuto(false); setResults(null);
      setState(value);setHistory(null);setActivity(null); setNotice(offline ? 'Opened a saved copy. No transfer was enabled.' : item.can_write ? 'Brain selected. Writing saves locally; choose Sync now to transfer it.' : 'Brain selected with read-only access.');
      for (const row of value.pages) sessions.current.get(`${scopeKey(a, b)}/${row.page_id}`)?.adopt(row);
      setPageID(linkTarget.current?.brain===b&&value.pages.some(row=>row.page_id===linkTarget.current.page)?linkTarget.current.page:value.pages.find(row=>row.content.state!=='deleted')?.page_id||'');return value;
    } catch (err) { setError(friendly(err)); } finally { setBusy(false); }
  }
  async function synchronize() {
    if (!account || !brain || busy) return;
    const a = account, b = brain; setBusy(true); setError('');
    try { await flushAll(); const result = await client.request(`${client.brain(a, b)}/sync`, {}); if (!sameScope(a, b)) return; await readState(a, b); setNotice(result.complete ? result.conflicts ? 'Sync finished. A changed page needs review.' : 'Sync complete. Current permitted changes are saved locally.' : 'A sync batch is saved. Some changes are still pending; sync again to continue.'); setOffline(false); }
    catch (err) { if (sameScope(a, b)) { setError(friendly(err)); setNotice('No uncertain transfer has been acknowledged. Local writing is retained.'); await readState(a, b).catch(() => {}); if ([401, 403].includes(err.status)) { setAuto(false); setResults(null);searchGeneration.current++; } } }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!auto || !brain) return;
    const run = () => { if (navigator.onLine) synchronize(); };
    const timer = setInterval(run, 15000); addEventListener('online', run);
    return () => { clearInterval(timer); removeEventListener('online', run); };
  }, [auto, account, brain, busy]);
  async function newPage(){if(!creation||busy)return;const a=account,b=brain;setBusy(true);setError('');try{await flushAll();const row=await creation.create();if(!sameScope(a,b))return;setState(old=>({...old,pages:[...old.pages.filter(item=>item.page_id!==row.page_id),row]}));setPageID(row.page_id);}catch(err){if(sameScope(a,b))setError(friendly(err));}finally{setBusy(false);}}
  async function resolve() {
    try { await session.flush(); const current = session.page; await client.request(`${client.page(account, brain, pageID)}/${current.generation_review ? 'resolve-generation' : 'resolve'}`, { ...(current.generation_review ? {} : { operation_id: current.operation_id }), version: session.version, server_revision: current.conflict?.server?.revision || 0 }); await readState(); setNotice('Reviewed merge queued as a new operation. Sync when ready.'); } catch (err) { setError(friendly(err)); }
  }
  async function search(event,more=false){event?.preventDefault();const a=account,generation=++searchGeneration.current;setError('');try{const body=more?{...searchedQuery.current,offset:(results?.offset||0)+(results?.items.length||0)}:parseNoteQuery(query);if(!more)searchedQuery.current={...body};const value=await client.request(`${client.profile(a)}/search`,body);if(active.current.account===a&&generation===searchGeneration.current)setResults({...value,offset:body.offset});}catch(err){if(active.current.account===a&&generation===searchGeneration.current)setError(friendly(err));}}
  function exportDraft(){downloadMarkdown(session.export(),'note.md');}
  async function exportBrain(){setError('');try{await flushAll();const response=await fetch('/api/collaboration/'+client.brain(account,brain)+'/export',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Atlas-CSRF':client.csrf},body:'{}'});if(!response.ok)throw Error('Brain export was not confirmed. Recheck access and try again.');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=brain+'.tar';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){setError(friendly(err));}}
  async function copyLink(){try{await navigator.clipboard.writeText(stableNoteLink(location.href,brain,pageID));setNotice('Stable link copied. Opening it still requires access to this brain.');}catch{setError('The clipboard is unavailable. Your note is retained.');}}
  const actorName=id=>profiles.find(row=>row.user_id===id)?.name||(id?'Member '+id.slice(-8):'Recorded change');
  async function loadHistory(){const a=account,b=brain,id=pageID,epoch=navigationGeneration.current;setError('');try{const value=await client.request(client.page(a,b,id)+'/history');if(sameScope(a,b)&&activePage.current===id&&navigationGeneration.current===epoch)setHistory(value);}catch(err){if(sameScope(a,b))setError(friendly(err));}}
  useEffect(()=>{setActivity(null);if(!account||!brain||!pageID||!page?.remote)return;let live=true;client.request(client.page(account,brain,pageID)+'/history').then(value=>{if(live)setActivity(value.find(item=>item.actor_user_id)||null);}).catch(()=>{});return()=>{live=false;};},[account,brain,pageID,page?.remote?.revision]);
  useEffect(()=>{const key=event=>{if(event.isComposing||event.repeat||event.altKey||!(event.metaKey||event.ctrlKey))return;if(event.key.toLowerCase()==='k'){event.preventDefault();searchInput.current?.focus();}else if(event.key.toLowerCase()==='n'&&brain){event.preventDefault();newPage();}};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[account,brain,busy]);
  if (!ready) return <main className="federation-workspace federation-setup"><section><a href={bridgeMissing ? '/workspace.html' : '/workspace.html?collaboration=1'}>Atlas</a><h1>Open your notes</h1>{bridgeMissing ? <><p>Start the separate collaboration launcher, then open the local URL in its private launch file.</p><p>Your private workspace stays on this service. Shared brains use the separate Go replica.</p><a href="/workspace.html">Return to private notes</a></> : <><p>Paste the one-time setup code from your local launch file. Your configured account credentials stay in the Go bridge.</p><form onSubmit={unlock}><label>Local setup code<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required /></label><button type="submit">Open workspace</button></form></>}{error && <p role="alert">{error}</p>}<p>Account sign-in is configured separately. This screen does not implement SSO.</p></section></main>;
  const selectPage=async id=>{try{if(session)await session.flush();linkTarget.current=null;setPageID(id);setHistory(null);history.pushState(null,'',stableNoteLink(location.href,brain,id));}catch(err){setError(friendly(err));}};
  return <NotesLayout className="notes-connected" sidebar={<aside className="notes-list" aria-label="Notes">
    <header><a href="?collaboration=1">Atlas</a><button onClick={newPage} disabled={!state?.enabled||!state?.can_write||busy}>{creation?.pending?'Retry new note':'New note'}</button></header>
    <div className="notes-brains" aria-label="Brains and accounts"><div role="group" aria-label="Accounts">{profiles.map(item=><button key={item.id} aria-pressed={account===item.id} onClick={()=>chooseAccount(item.id)} disabled={busy}>{item.name||item.id}</button>)}</div><button onClick={loadBrains} disabled={!account||busy}>Load my brains</button>{linkTarget.current&&<button disabled={busy||!brains.some(row=>row.brain_id===linkTarget.current.brain)} onClick={()=>chooseBrain(brains.find(row=>row.brain_id===linkTarget.current.brain))}>Open linked note</button>}{brains.map(item=><button key={item.brain_id} data-brain-id={item.brain_id} aria-current={brain===item.brain_id?'page':undefined} disabled={busy} onClick={()=>chooseBrain(item)}><span>{item.name||'Untitled brain'}</span><small>{item.kind==='private'?'Private':'Shared'}{item.can_write?'':' · Read only'}</small></button>)}</div>
    <form className="federation-search" onSubmit={search}><label htmlFor="federation-search">Search across my permitted brains</label><div><input ref={searchInput} id="federation-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="type:incident service:payments" maxLength={512}/><button disabled={!account} type="submit">Search notes</button></div></form>
    <section className="notes-list-items federation-pages" aria-label="Notes in this brain">{pages.map(row=><button key={row.page_id} data-page-id={row.page_id} aria-current={pageID===row.page_id?'page':undefined} onClick={()=>selectPage(row.page_id)}><span>{sessions.current.get(`${scopeKey(account,brain)}/${row.page_id}`)?.value.title||row.content.title||'Untitled note'}</span><small>{row.content.state==='deleted'?'Trash':row.operation_status==='conflict'?'Needs review':row.version>row.synced_version?'Pending sync':''}</small></button>)}{brain&&!pages.length&&<p>Sync to download notes, or start writing.</p>}</section>
    <footer><span>{offline?'Offline copy':'Explicit sync'}</span>{ownerURL&&<a href={ownerURL}>Owner notes</a>}</footer>
  </aside>}>
    <header className="notes-scope-header"><div><strong>{selectedBrain?.name||'Choose a brain'}</strong><small>{brain?`${selectedBrain?.kind==='private'?'Private':'Shared'} · ${profile?.name||account}`:'Private and team notes use the same workspace.'}</small></div>{brain&&<div><button onClick={synchronize} disabled={busy||!state?.enabled}>{busy?'Working…':'Sync now'}</button><label><input type="checkbox" checked={auto} onChange={event=>setAuto(event.target.checked)} disabled={!state?.enabled}/>Sync while connected</label></div>}</header>
    <div className="federation-status" role="status">{notice||'Select a brain explicitly. Notes never move between brains automatically.'}{state?.revoked&&<strong> Access revoked. Transfers stopped.</strong>}</div>{error&&<p className="federation-error" role="alert">{error}</p>}
    {results&&<section className="federation-search-results notes-document" aria-label="Note search results"><header><h2>{results.total} permitted matches</h2><button onClick={()=>setResults(null)}>Close search</button></header>{results.items.map(item=><article key={`${item.brain_id}/${item.record_id}`}><button onClick={async()=>{const destination=brains.find(row=>row.brain_id===item.brain_id);if(destination){linkTarget.current={brain:item.brain_id,page:item.record_id};const selected=await chooseBrain(destination);if(selected){setPageID(selected.pages.some(row=>row.page_id===item.record_id)?item.record_id:'');setNotice(selected.pages.some(row=>row.page_id===item.record_id)?'Note opened.':'Sync this selected brain to download the linked note.');setResults(null);}}}}>{item.title}</button><p>{item.snippet}</p><small>{item.brain_name||brains.find(row=>row.brain_id===item.brain_id)?.name||'Permitted brain'}</small></article>)}{(results.offset||0)+results.items.length<results.total&&<button onClick={()=>search(null,true)} disabled={busy}>More matches</button>}</section>}
    {session?<section className="notes-document federation-writing" aria-label="Page editor"><p className="notes-brain-context">{selectedBrain?.name} · {selectedBrain?.kind==='private'?'Private':'Shared'}</p>{activity&&<p className="notes-brain-context">Edited by {actorName(activity.actor_user_id)} · {new Date(activity.recorded_at).toLocaleString()}</p>}<Editor key={sessionKey} session={session} writable={state?.enabled&&state?.can_write} onSync={synchronize}/>
      <div className="notes-inline-actions"><button onClick={exportDraft}>Export note</button><button onClick={copyLink}>Copy stable link</button><button disabled={busy||!brain||!state?.enabled} onClick={exportBrain}>Export brain</button><button onClick={loadHistory}>History</button></div>
      {session.error&&<div role="alert"><p>{friendly(session.error)}</p><button onClick={()=>session.flush().catch(()=>{})}>Retry exact local save</button><button onClick={exportDraft}>Export my draft</button>{session.error.code==='local_version_conflict'&&<button onClick={()=>session.keepDraftAsNewLocalVersion().catch(()=>{})}>Save my draft as a new local version</button>}</div>}
      {session.page.conflict&&<section className="federation-conflict" aria-label="Review conflicting versions"><h2>Review the changed note</h2><p>Both versions are retained. Merge in the editor, then queue the result.</p>{[['Base',session.page.conflict.base?.content],['Submitted local version',session.page.conflict.local],['Server version',session.page.conflict.server?.content]].map(([name,content])=><article key={name}><h3>{name}</h3><pre>{content?.body??'No earlier version'}</pre></article>)}<button disabled={!session.page.conflict.server} onClick={()=>session.edit({...session.page.conflict.server.content})}>Use server version in editor</button><button onClick={resolve}>Queue reviewed merge</button></section>}
      {session.page.generation_review&&!session.page.conflict&&<section role="alert"><h3>Retained local writing</h3><pre>{session.value.body}</pre><h3>Current server writing</h3><pre>{session.page.remote?.content?.body??"No server note in the current replica. Sync to recheck."}</pre><p>The service was restored. Your local writing is retained. Inspect the current server version before queueing it again.</p><button onClick={synchronize}>Load current server version</button><button onClick={resolve}>Queue reviewed merge</button></section>}
      {currentLinks.length>0&&<section className="notes-links"><h2>Links</h2>{currentLinks.map(row=><button key={row.id} onClick={()=>selectPage(row.id)}>{row.label}</button>)}</section>}
      {backlinks.length>0&&<section className="notes-links"><h2>Linked from</h2>{backlinks.map(row=><button key={row.page_id} onClick={()=>selectPage(row.page_id)}>{row.content.title}</button>)}</section>}
      {history&&<section className="notes-history"><h2>History</h2>{history.map((item,index)=><p key={item.event_id||index}>{item.kind.replaceAll('_',' ')} · {actorName(item.actor_user_id)} · {new Date(item.recorded_at).toLocaleString()}</p>)}</section>}
    </section>:<section className="notes-empty"><h1>Notes</h1><p>Choose a private or team brain, then a note.</p></section>}
    {brain && renderResearch?.({client,account,brain,profile,state})}
  </NotesLayout>;

}

function Editor({ session, writable, onSync }) {
  const value = session.value;
  function keyDown(event) {
    if ((event.metaKey || event.ctrlKey) && ['s', 'Enter'].includes(event.key) && !event.nativeEvent.isComposing && !session.composing) {
      event.preventDefault(); const sync = event.key === 'Enter'; session.flush().then(() => { if (sync) onSync(); }).catch(() => {});
    }
  }
  return <article className="federation-editor" onKeyDown={keyDown}><header><span role="status">{replicaNoteStatus(session)}</span><span>{writable ? 'Editable' : 'Read only'}</span></header><label>Page title<NativeTitle session={session} writable={writable} /></label><label className="federation-body-label">Page body<NativeBody session={session} writable={writable} /></label><footer><button disabled={!writable} onClick={()=>session.edit({state:value.state==='deleted'?'active':'deleted'})}>{value.state==='deleted'?'Restore note':'Move to Trash'}</button><button onClick={() => session.flush().catch(() => {})} disabled={!writable || session.saved || session.composing}>Save locally</button></footer></article>;
}
function NativeTitle({ session, writable }) {
  const node = useRef(null), initial = useRef(session.value.title);
  useLayoutEffect(() => { if (node.current && node.current.value !== session.value.title) node.current.value = session.value.title; }, [session.value.title]);
  return <input ref={node} aria-label="Page title" defaultValue={initial.current} maxLength={1000} readOnly={!writable}
    onChange={event => session.edit({ title: event.target.value })}
    onCompositionStart={() => session.composition(true)} onCompositionEnd={() => session.composition(false)} />;
}
function NativeBody({ session, writable }) {
  const node = useRef(null), initial = useRef(normalizeNewlines(session.value.body));
  const rendered = normalizeNewlines(session.value.body);
  useLayoutEffect(() => {
    // Native input already changed the DOM. Do not rewrite value/defaultValue
    // during local edits or autosave: that breaks Chromium's native undo groups.
    if (node.current && node.current.value !== rendered) node.current.value = rendered;
  }, [rendered]);
  return <textarea ref={node} aria-label="Page body" defaultValue={initial.current}
    onChange={event => session.edit({ body: event.target.value }, event.nativeEvent.inputType)}
    onCompositionStart={() => session.composition(true)} onCompositionEnd={() => session.composition(false)}
    readOnly={!writable} spellCheck />;
}
