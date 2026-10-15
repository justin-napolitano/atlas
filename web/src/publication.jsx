import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import ResizablePanes from './ResizablePanes.jsx';
import {workspaceAPI} from './workspaceClient.js';
import {PublicationWorkspace,publicKinds} from './publicationWorkspace.js';
import './style.css';
import './workspace.css';
import './publication.css';

const api=workspaceAPI();
const initial=()=>Object.fromEntries(new URLSearchParams(location.search));
function Publication() {
  const [,redraw]=useState(0),model=useRef(null);
  if(!model.current) model.current=new PublicationWorkspace(api,()=>redraw(n=>n+1));
  const [projects,setProjects]=useState([]),[project,setProject]=useState(initial().project||''),[previewId,setPreviewId]=useState(initial().preview||'');
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[query,setQuery]=useState(''),[loading,setLoading]=useState(false);
  const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('research-theme')||'light';}catch{return 'light';}});
  const generation=useRef(0),activeProject=useRef(project);activeProject.current=project;
  const previewRegion=useRef(null),messageRegion=useRef(null);
  const entry=project ? model.current.entry(project) : null;
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem('research-theme',theme);}catch{}},[theme]);
  useEffect(()=>{
    let active=true;
    api.request('me').then(()=>api.request('projects')).then(data=>{if(active){setProjects(data.items);setProject(value=>value||data.items[0]?.id||'');setReady(true);}}).catch(err=>{if(active)setError(err.message);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    const unload=event=>{if(model.current.hasDrafts()){event.preventDefault();event.returnValue='';}};
    const pop=()=>{const value=initial();setProject(value.project||'');setPreviewId(value.preview||'');};
    addEventListener('beforeunload',unload);addEventListener('popstate',pop);
    return()=>{removeEventListener('beforeunload',unload);removeEventListener('popstate',pop);};
  },[]);
  useEffect(()=>{if(ready && project){model.current.load(project,previewId);setQuery('');loadRows(project,'');}},[project,ready,previewId]);
  useEffect(()=>{if(entry?.preview) requestAnimationFrame(()=>{previewRegion.current?.scrollIntoView({block:'start'});previewRegion.current?.focus({preventScroll:true});});},[project,entry?.preview?.id]);
  useEffect(()=>{if(['approved','withdrawn','conflict'].includes(entry?.status)) requestAnimationFrame(()=>{messageRegion.current?.scrollIntoView({block:'nearest'});messageRegion.current?.focus({preventScroll:true});});},[project,entry?.status]);
  async function loadRows(target=project,search=query,append=false) {
    const token=++generation.current;setLoading(true);
    try {
      const data=search.trim() ? await api.request('search',{project_id:target,q:search,scope:'records'})
        : await api.request('records',{project_id:target,limit:50,...(append && cursor ? {cursor}:{})});
      if(token!==generation.current || activeProject.current!==target) return;
      setRows(previous=>append ? [...new Map([...previous,...data.items].map(row=>[row.id,row])).values()] : data.items);setCursor(data.next_cursor||null);setError('');
    } catch(err){if(token===generation.current)setError(err.message);}
    finally{if(token===generation.current)setLoading(false);}
  }
  function chooseProject(value){history.pushState(null,'','/publish.html?'+new URLSearchParams({project:value}));setProject(value);setPreviewId('');setRows([]);setCursor(null);}
  async function makePreview(){const target=project;await model.current.makePreview(target);const value=model.current.entry(target).preview;if(value && activeProject.current===target) history.replaceState(null,'','/publish.html?'+new URLSearchParams({project:target,preview:value.id}));}
  const current=entry?.preview && entry.head?.snapshot_id===entry.preview.id && entry.head.status==='published';
  return <main className="shell owner-shell publication-shell">
    <a className="skip-link" href="#publication-review">Skip to publication review</a>
    <header className="topbar"><a className="brand" href="/">Research notes</a><span>Publish research</span><div className="header-tools"><button onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?'Light mode':'Dark mode'}</button><a href={`/workspace.html?${new URLSearchParams({project})}`}>My workspace</a><a href="/">Public research ↗</a></div></header>
    <div className="owner-heading"><h1>Publish research</h1><p>Choose the records and connections to share. Inspect a private preview before making it public.</p></div>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {ready && <><form className="workspace-search" onSubmit={event=>{event.preventDefault();loadRows();}}>
      <label>Project<select value={project} onChange={event=>chooseProject(event.target.value)}>{projects.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
      <label className="workspace-query">Find records<input value={query} maxLength={500} onChange={event=>setQuery(event.target.value)} placeholder="Search titles and summaries" /></label>
      <button disabled={!project||loading}>Search</button><button type="button" disabled={!project||loading} onClick={()=>{setQuery('');loadRows(project,'');}}>Browse all</button>
    </form>
    {entry && <ResizablePanes storageKey="research:publication-pane-width" className="owner-panes publication-panes">
      <section className="publication-picker" aria-label="Choose public records"><h2>1. Choose records</h2><p className="publication-help">{entry.selections.size} selected · up to 100 per release. Notes and reading excerpts cannot be selected here.</p>
        {loading && <p role="status">Loading records…</p>}
        {rows.map(row=>{const eligible=publicKinds.has(row.kind)&&row.review_state!=='withdrawn';return <label className="publication-pick" key={row.id}>
          <input type="checkbox" checked={entry.selections.has(row.id)} disabled={entry.busy||!eligible} onChange={event=>model.current.select(project,row,event.target.checked)} />
          <span><strong>{row.title}</strong><small>{row.kind} · {row.review_state}{!eligible && ' · private-only or withdrawn'}</small></span>
        </label>;})}
        {!loading&&!rows.length&&<p>No records found. Try another search or project.</p>}
        {cursor && <button className="workspace-load" disabled={loading} onClick={()=>loadRows(project,'',true)}>Load next 50 records</button>}
      </section>
      <section id="publication-review" tabIndex={-1} className="publication-review" aria-label="Review publication">
        <section className="publication-head"><h2>Approved snapshot</h2><p>{entry.head ? `${entry.head.status==='published'?'approved for publication':entry.head.status} · revision ${entry.head.revision}` : 'Loading approval status…'}</p>{entry.head?.snapshot_id && <code>{entry.head.snapshot_id}</code>}<button disabled={entry.busy} onClick={()=>model.current.load(project)}>Refresh approval status</button>{entry.preview&&<button onClick={()=>{previewRegion.current?.scrollIntoView({block:'start'});previewRegion.current?.focus({preventScroll:true});}}>Jump to saved preview</button>}</section>
        <h2>2. Choose what to include</h2>
        {!entry.selections.size && <p>Choose a question and its supporting claims, located evidence, and sources. Connections are included only when you select them below.</p>}
        {[...entry.selections.values()].map(row=><article className="publication-selection" key={row.record_id}><h3>{row.title}</h3>
          <label><input type="checkbox" checked={row.include_summary} disabled={entry.busy} onChange={event=>model.current.option(project,row.record_id,'include_summary',event.target.checked)} />Include recorded summary</label>
          <label><input type="checkbox" checked={row.include_bibliography} disabled={entry.busy} onChange={event=>model.current.option(project,row.record_id,'include_bibliography',event.target.checked)} />Include citation, locator, source links, scope, and original review limits</label>
          <button disabled={entry.busy} onClick={()=>model.current.select(project,{id:row.record_id,project_id:project,kind:row.kind},false)}>Remove record</button>
        </article>)}
        <section className="publication-relations"><h3>Recorded connections</h3><button disabled={entry.busy||!entry.selections.size} onClick={()=>model.current.findRelations(project)}>Find connections between selected records</button>
          {entry.relationsTruncated && <p role="status">Showing the first 300 recorded connections. Narrow the record selection to inspect a smaller set.</p>}
          {entry.relations.map(row=><label className="publication-edge" key={row.id}><input type="checkbox" checked={entry.relationIds.has(row.id)} disabled={entry.busy} onChange={event=>model.current.relation(project,row.id,event.target.checked)} /><span>{row.source_title}<b>→ {row.predicate.split(/[/#]/).at(-1)} →</b>{row.target_title}<small>{row.predicate} · {row.review_state}</small></span></label>)}
        </section>
        <button className="publication-preview-button" disabled={entry.busy||!entry.head||!entry.selections.size} onClick={makePreview}>{entry.status==='previewing'?'Preparing preview…':'Make private preview'}</button>
        {entry.preview && <section ref={previewRegion} tabIndex={-1} className="publication-preview"><h2>3. Inspect the exact public preview</h2><p>{entry.preview.payload.nodes.length} records · {entry.preview.payload.edges.length} connections. These records and the complete JSON are the public payload. Your notes, reading state, and publication rationale stay private.</p>
          <p><a href={`/publish.html?${new URLSearchParams({project,preview:entry.preview.id})}`}>Reopen this saved preview</a></p>
          {entry.preview.payload.nodes.map(node=><article className="public-record-preview" key={node.id}><small>{node.type} · {node.status} · source revision {node.source_revision}</small><h3>{node.label}</h3>{node.summary && <p>{node.summary}</p>}
            {[['Citation',node.citation],['Location',node.locator],['Scope',node.scope],['Source role',node.role]].map(([label,value])=>value&&<p key={label}><b>{label}:</b> {value}</p>)}
            {!!node.people?.length && <p><b>Authors:</b> {node.people.join('; ')}</p>}
            {node.links?.map(link=><a key={link.url} href={/^https?:\/\//.test(link.url)?link.url:undefined} target="_blank" rel="noreferrer">{link.url}</a>)}
            {node.review_limits?.map((text,index)=><p className="publication-help" key={index}>{text}</p>)}<code>{node.id}</code>
          </article>)}
          {!!entry.preview.payload.edges.length && <section><h3>Included connections</h3>{entry.preview.payload.edges.map(edge=><p key={edge.id}>{edge.from} → {edge.predicate} → {edge.to} · {edge.status}</p>)}</section>}
          <details className="publication-json"><summary>Complete public JSON, provenance, and preview digest</summary><code>{entry.preview.payload_sha256}</code><pre>{JSON.stringify(entry.preview.payload,null,2)}</pre></details>
          {current ? <p className="publication-current">This snapshot is already approved. A successful build is still required to update the public site.</p> : <div className="publication-approval">
            <label>Private publication rationale<textarea value={entry.rationale} disabled={entry.busy} maxLength={2000} rows={3} onChange={event=>model.current.form(project,{rationale:event.target.value})} /></label>
            <label className="publication-ack"><input type="checkbox" checked={entry.rights} disabled={entry.busy||entry.needsPreview||entry.needsHead} onChange={event=>model.current.form(project,{rights:event.target.checked})} /><span>I inspected this exact preview for privacy, attribution, and quotation rights. I intend to make its contents public. Publication does not mark sources as verified.</span></label>
            <button className="publication-approve" disabled={entry.busy||!entry.rights||!entry.rationale.trim()||entry.needsPreview||entry.needsHead||!entry.head} onClick={()=>model.current.approve(project)}>{entry.status==='approving'?'Approving…':'Approve this snapshot'}</button>
          </div>}
        </section>}
        {entry.message && <p ref={messageRegion} tabIndex={-1} className="publication-message" role="status">{entry.message}</p>}
        {entry.head?.status==='published' && <details className="publication-withdraw"><summary>Withdraw the active snapshot</summary><p>This removes the active snapshot from storage's public reads. The public site and cached copies change only after a replacement build.</p>
          <label>Private withdrawal reason<textarea value={entry.withdrawReason} disabled={entry.busy} rows={3} maxLength={2000} onChange={event=>model.current.form(project,{withdrawReason:event.target.value})} /></label>
          <label className="publication-ack"><input type="checkbox" checked={entry.withdrawConfirmed} disabled={entry.busy||entry.needsHead} onChange={event=>model.current.form(project,{withdrawConfirmed:event.target.checked})} /><span>Withdraw revision {entry.head.revision}; keep its editorial history.</span></label>
          <button className="publication-withdraw-button" disabled={entry.busy||entry.needsHead||!entry.withdrawConfirmed||!entry.withdrawReason.trim()} onClick={()=>model.current.withdraw(project)}>Withdraw snapshot</button>
        </details>}
      </section>
    </ResizablePanes>}
    {!projects.length && <p>No research projects yet. Start in your owner workspace.</p>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Publication/>);
