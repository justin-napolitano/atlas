import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ResizablePanes from './ResizablePanes.jsx';
import SourceReader from './SourceReader.jsx';
import ConceptPanel from './ConceptPanel.jsx';
import {mergeResearchMatches} from './lexiconClient.js';
import { PassageNoteEditor } from './passageNoteEditor.js';
import { ReadingWorkspace, blankState, markdownDraft, workspaceAPI } from './workspaceClient.js';
import './style.css';
import './workspace.css';

const api = workspaceAPI();
const fromURL = () => Object.fromEntries(new URLSearchParams(location.search));
const property = (record, key) => (record.attributes?.rdf_properties?.[key] || []).map(value => {
  const literal = value.match(/^"(?:[^"\\]|\\.)*"/);
  try { return literal ? JSON.parse(literal[0]) : value.replace(/^<|>$/g, ''); } catch { return value; }
});
const ir = 'https://islam-research.local/vocab/';
const statuses = { saved: 'Saved to your workspace', unsaved: 'Unsaved changes', saving: 'Saving…', conflict: 'Changed on another device', error: 'Save failed. Your draft is still here.' };

function Workspace() {
  const [, redraw] = useState(0);
  const store = useRef(null);
  const readingDrafts = useRef(new Map());
  const passageNotes = useRef(null);
  if (!passageNotes.current) passageNotes.current = new PassageNoteEditor(api, () => redraw(n => n + 1));
  if (!store.current) store.current = new ReadingWorkspace(api, () => redraw(n => n + 1));
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(fromURL().project || '');
  const [selected, setSelected] = useState(fromURL().record || '');
  const [selectedAnnotation,setSelectedAnnotation] = useState(fromURL().annotation || '');
  const [selectedDocument,setSelectedDocument] = useState(fromURL().document || '');
  const [record, setRecord] = useState(null);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('records');
  const [kind, setKind] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [trail, setTrail] = useState(null);
  const [readingFocus,setReadingFocus]=useState(false);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('research-theme') || 'light'; } catch { return 'light'; } });
  const generation = useRef(0);
  const reader = useRef(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('research-theme', theme); } catch { /* Preference only. */ }
  }, [theme]);
  useEffect(() => {
    let active = true;
    api.request('me').then(() => api.request('projects')).then(data => {
      if (!active) return;
      setProjects(data.items); setProject(value => value || data.items[0]?.id || '');
      if (!data.items.length) setNotice('No research projects yet. Create a project through the owner API.');
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const unload = event => { if (store.current.hasDrafts() || passageNotes.current.hasDrafts() || readingDrafts.current.size) { event.preventDefault(); event.returnValue = ''; } };
    const pop = () => { const state = fromURL(); setProject(state.project || ''); setSelected(state.record || ''); setSelectedAnnotation(state.annotation || '');setSelectedDocument(state.document || ''); };
    addEventListener('beforeunload', unload); addEventListener('popstate', pop);
    return () => { removeEventListener('beforeunload', unload); removeEventListener('popstate', pop); };
  }, []);
  async function loadRows({ append = false, search = false } = {}) {
    if (!project) return;
    const token = ++generation.current;
    setSearching(true); setError(''); setNotice('');
    try {
      let data;
      if(search && query.trim() && scope==='lexicon') {
        const lexical=await api.request('lexicon/search',{project_id:project,q:query});
        data={...lexical,items:mergeResearchMatches([],lexical.items),next_cursor:null};
      } else if(search && query.trim() && scope==='all' && (!kind || kind==='concept')) {
        const [ordinary,lexical]=await Promise.all([
          api.request('search',{project_id:project,q:query,scope,...(kind ? {kind} : {})}),
          api.request('lexicon/search',{project_id:project,q:query})]);
        data={items:mergeResearchMatches(ordinary.items,lexical.items),next_cursor:null,truncated:ordinary.truncated || lexical.truncated};
      } else data=search && query.trim() ? await api.request('search',{project_id:project,q:query,scope,...(kind ? {kind} : {})})
        : await api.request('records',{project_id:project,limit:50,...(kind ? {kind} : {}),...(append && cursor ? {cursor} : {})});
      if(data.items.some(row=>row.project_id!==project))throw new Error('Search results did not match this project.');
      if (token !== generation.current) return;
      setRows(old => append ? [...old, ...data.items] : data.items); setCursor(data.next_cursor || null);
      if (data.truncated) setNotice('Showing the top matches. Narrow your query for more precise results.');
      if (!data.items.length) setNotice('No matching records. Try fewer terms or another search scope.');
    } catch (err) { if (token === generation.current) setError(err.message); }
    finally { if (token === generation.current) setSearching(false); }
  }
  useEffect(() => { setRows([]); setCursor(null); loadRows({ search: Boolean(query.trim()) }); }, [project, kind]);
  useEffect(() => { if (record && matchMedia('(max-width:900px)').matches) { reader.current?.focus(); reader.current?.scrollIntoView(); } }, [record]);
  useEffect(() => {
    let active = true; setRecord(null); setTrail(null);
    if (!selected || !project) return;
    Promise.all([api.request('record', { record_id: selected }), api.request('personal-state', { project_id: project, record_id: selected })
      .catch(err => { if (err.status === 404) return blankState(selected, project); throw err; })]).then(([value, state]) => {
      if (!active) return;
      if (value.project_id !== project) { setError('This record belongs to another project.'); return; }
      store.current.adopt(state); setRecord(value); setError('');
      if (value.kind === 'question') api.request('evidence-path', { project_id: project, record_id: selected, profile_id: 'question_evidence_trail' })
        .then(result => { if (active) setTrail(result); }).catch(() => { if (active) setTrail({ failed: true }); });
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [selected, project]);
  function open(id, nextProject = project, annotationId = '',documentId='') {
    const url = new URL(location.href); url.search = new URLSearchParams({ project: nextProject, ...(id ? { record: id } : {}), ...(annotationId ? { annotation: annotationId } : {}),...(documentId ? {document:documentId} : {}) });
    history.pushState(null, '', url); setSelected(id); setProject(nextProject); setSelectedAnnotation(annotationId);setSelectedDocument(documentId);
  }
  const entry = record && store.current.entries.get(record.id);
  function edit(patch, save = false) { store.current.edit(record.id, patch); if (save) store.current.save(record.id); }
  async function exportNote() {
    const url = URL.createObjectURL(new Blob([await markdownDraft(record, entry)], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = 'research-note.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="shell owner-shell">
    <a className="skip-link" href="#workspace-results">Skip to research records</a>
    <header className="topbar"><a className="brand" href="/">Research notes</a><span>My workspace</span><div className="header-tools"><button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><a href={`/publish.html?${new URLSearchParams({project})}`}>Publish research</a><a href="/">Public research ↗</a></div></header>
    <div className="owner-heading"><h1>Read. Follow the sources. Make notes.</h1><p>Your reading state and notes are private. Saving here does not publish them.</p></div>
    {error && <div role="alert" className="workspace-alert"><p>{error}</p><button onClick={() => location.reload()}>Reconnect workspace</button><small>Export unsaved notes before reloading. The hosted owner endpoint must be configured at this address.</small></div>}
    <form className="workspace-search" onSubmit={e => { e.preventDefault(); loadRows({ search: true }); }}>
      <label>Project<select value={project} onChange={e => open('', e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <label className="workspace-query">Find in my research<input value={query} onChange={e => setQuery(e.target.value)} maxLength={500} placeholder="Words from a title, finding, or note" /></label>
      <label>Search in<select value={scope} onChange={e => {setScope(e.target.value);if(e.target.value==='lexicon')setKind('');}}><option value="records">Records</option><option value="notes">My record notes</option><option value="annotations">My passage notes</option><option value="lexicon">Concept words & definitions</option><option value="all">All my research</option></select></label>
      <label>Type<select value={kind} disabled={scope==='lexicon'} onChange={e => setKind(e.target.value)}><option value="">All types</option>{['source','question','claim','evidence','concept','person'].map(k => <option key={k}>{k}</option>)}</select></label>
      <button type="submit" disabled={!project || searching}>{searching ? 'Loading…' : 'Search'}</button><button type="button" disabled={!project || searching} onClick={() => { setQuery(''); setScope('records'); setKind(''); loadRows(); }}>Browse all</button>
    </form>
    <ResizablePanes storageKey="research:hosted-pane-width" className={`owner-panes${readingFocus && ['source','work','edition'].includes(record?.kind) ? ' reading-focus' : ''}`}>
      <section id="workspace-results" className="workspace-results" aria-label="Research records">
        <p className="workspace-result-count" role="status">{searching ? 'Loading records…' : `${rows.length} records shown`}{notice && ` · ${notice}`}</p>
        {rows.map(row => <article key={row.id} className="workspace-hit"><button className="workspace-row" aria-pressed={selected === row.id} onClick={() => open(row.id)}><small>{row.kind} · {row.review_state}{store.current.entries.has(row.id) && ` · ${store.current.entries.get(row.id).draft.reading}`}</small><strong>{row.title}</strong>{row.matches?.filter(match=>match.channel!=='private_annotation').map((match,i) => <span key={match.channel+':'+i}><b>{match.channel === 'private_note' ? 'My note' : match.channel==='lexicon' ? 'Matched wording' : 'Record'}</b> · {match.excerpt}{match.assertion_kind && ` · ${match.assertion_kind.replaceAll('_',' ')}`}</span>)}</button>
          {row.matches?.filter(match=>match.channel==='private_annotation').map(match=><a key={match.target_id} className="workspace-passage-hit" href={`?${new URLSearchParams({project,record:row.id,annotation:match.target_id})}`} onClick={event=>{ if(event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); open(row.id,project,match.target_id); } }}><small>My passage note · {match.capture_kind?.replaceAll('_',' ')} · revision {match.revision}</small><span>{match.excerpt}</span><b>Open exact passage →</b></a>)}
          {row.matches_truncated && <small className="workspace-match-limit">More matches exist in this source. Narrow your search.</small>}
        </article>)}
        {cursor && <button className="workspace-load" disabled={searching} onClick={() => loadRows({ append: true })}>Load next 50 records</button>}
      </section>
      <section ref={reader} tabIndex={-1} className="workspace-reader" aria-label="Selected record and private notes">
        {!record ? <div className="workspace-empty"><h2>{selected ? 'Opening record…' : 'Start with a question or a source.'}</h2><p>Select a record on the left. Questions show the claims, evidence, and sources behind them.</p></div> : <>
          <div className="workspace-record-heading"><small>{record.kind} · {record.review_state}</small><h2 dir="auto">{record.title}</h2></div>
          <p className="workspace-summary">{record.kind==='concept' && <small>Concept description</small>}{record.summary || 'No summary recorded yet.'}</p>
          {[['Citation', 'http://purl.org/dc/terms/bibliographicCitation'], ['Location', ir+'locator'], ['Scope', ir+'scope']].map(([label, key]) => property(record, key).length > 0 && <section className="workspace-context" key={key}><h3>{label}</h3>{property(record,key).map((text,i) => <p key={i}>{text}</p>)}</section>)}
          {property(record,'http://purl.org/dc/terms/source').filter(url => /^https?:\/\//i.test(url)).map(url => <a className="source-link" key={url} href={url} target="_blank" rel="noreferrer">Open source ↗</a>)}
          {(record.attributes?.recorded_review_status || []).map(text => <p className="workspace-review-scope" key={text}>{text}</p>)}
          {record.kind === 'question' && <EvidenceTrails trail={trail} onOpen={open} />}
          {record.kind === 'concept' && <ConceptPanel key={JSON.stringify([record.project_id,record.id])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} navigate={open} />}
          {['source','work','edition'].includes(record.kind) && <SourceReader key={JSON.stringify([record.id,selectedAnnotation,selectedDocument])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} initialAnnotationId={selectedAnnotation} initialDocumentId={selectedDocument} noteEditor={passageNotes.current} navigate={open} focused={readingFocus} onFocusChange={setReadingFocus} />}
          {entry && <section className="workspace-notes" aria-labelledby="my-notes-heading"><h3 id="my-notes-heading">My reading & notes</h3>
            <label>Reading progress<select value={entry.draft.reading} onChange={e => edit({ reading: e.target.value }, true)}><option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read by me</option></select></label>
            {entry.server.read_at && <small>Read {new Date(entry.server.read_at).toLocaleDateString()}</small>}
            <div className="workspace-decisions">{[['relevant','Keep'],['not_relevant','Skip'],['read_later','Read later'],['unreviewed','Unscreened']].map(([decision,label]) => <button key={decision} aria-pressed={entry.draft.decision === decision} onClick={() => edit({ decision }, true)}>{label}</button>)}</div>
            <label htmlFor="my-note">Reading notes</label><textarea id="my-note" value={entry.draft.note} onChange={e => edit({ note: e.target.value })} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); store.current.save(record.id); } }} maxLength={10000} rows={9} placeholder="What did you learn? What needs more evidence?" />
            <div className="workspace-note-actions"><button disabled={['saved','saving','conflict'].includes(entry.status)} onClick={() => store.current.save(record.id)}>Save note</button><button onClick={exportNote}>Export Markdown</button><span role="status">{statuses[entry.status]}</span></div>
            <small>Notes save with the button or ⌘/Ctrl + Enter. Reading and screening choices save immediately. Markdown exports support the optional Obsidian connector; vault sync is explicit.</small>
            {entry.status === 'conflict' && <div className="workspace-conflict" role="alert"><h4>Both versions are safe to compare.</h4><p>Your draft is above. The cloud version is revision {entry.current.revision}, {entry.current.reading}, {entry.current.decision}.</p><pre>{entry.current.note || '(No note text)'}</pre><button onClick={() => store.current.resolve(record.id,'cloud')}>Use cloud version</button><button onClick={() => store.current.resolve(record.id,'draft')}>Save my draft over this revision</button><p>Previous cloud revisions remain in history.</p></div>}
          </section>}
        </>}
      </section>
    </ResizablePanes>
  </main>;
}

function EvidenceTrails({ trail, onOpen }) {
  if (!trail) return <p role="status">Following recorded evidence trails…</p>;
  if (trail.failed) return <p role="status">Evidence trails could not load. Reopen this question to retry.</p>;
  const nodes = new Map(trail.nodes.map(n => [n.id,n]));
  return <section className="workspace-trails"><h3>Findings & sources</h3>{trail.truncated && <p>Some trails were omitted by the search limits.</p>}
    {!trail.paths.length && <p>No complete source trail is recorded in this graph yet.</p>}
    {trail.paths.map((path,i) => <article key={path.edges.join('|')}><h4>Source trail {i+1}</h4><ol>{path.records.slice(1).map(id => { const n = nodes.get(id); return <li key={id}><small>{n.kind} · {n.review_state}</small><button onClick={() => onOpen(id)}>{n.title}</button>{n.summary && <p>{n.summary}</p>}{property(n,ir+'locator').map((text,j) => <p key={j}>{text}</p>)}</li>; })}</ol></article>)}
    <small>Recorded claims and source locations retain their original review limits. These trails do not establish consensus.</small>
  </section>;
}

createRoot(document.getElementById('root')).render(<Workspace />);
