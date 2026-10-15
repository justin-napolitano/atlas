import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ResizablePanes from './ResizablePanes.jsx';
import SourceReader from './SourceReader.jsx';
import AddSource from './AddSource.jsx';
import ReadingPlace from './ReadingPlace.jsx';
import PilotReading from './PilotReading.jsx';
import ReadingComparison from './ReadingComparison.jsx';
import ReadingCollection from './ReadingCollection.jsx';
import CollectionReadingLink from './CollectionReadingLink.jsx';
import ResearchNotebook from './ResearchNotebook.jsx';
import RecoverableDraft from './RecoverableDraft.jsx';
import {recoverRecordWriting} from './recoverIntoEditor.js';
import {collectionPreset} from './readerCollectionClient.js';
import RecordContext from './RecordContext.jsx';
import EvidencePaths from './EvidencePaths.jsx';
import {sirryPilotPreset} from './researchPilot.js';
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
const verseFromURL=()=>{const value=fromURL(),chapter=Number(value.chapter),start=Number(value.ayah_start),end=Number(value.ayah_end || value.ayah_start);return Number.isInteger(chapter) && chapter>=1 && chapter<=114 && Number.isInteger(start) && start>=1 && Number.isInteger(end) && end>=start && end<=286 ? {chapter,ayah_start:start,ayah_end:end} : null;};
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
  const [currentReadingPlace,setCurrentReadingPlace]=useState(null);
  const [libraryView,setLibraryView]=useState(fromURL().view || '');
  const [collectionReading,setCollectionReading]=useState(null);
  const [collectionReadingId,setCollectionReadingId]=useState(fromURL().reading_id || '');
  const [collectionError,setCollectionError]=useState('');
  const [notebookAnchor,setNotebookAnchor]=useState(()=>fromURL().document ? {record_id:fromURL().record,document_id:fromURL().document,annotation_id:fromURL().annotation || null} : null);
  const [verseReference,setVerseReference]=useState(verseFromURL());
  const [comparison,setComparison]=useState(()=>({left:{record_id:fromURL().left_source || fromURL().record || '',document_id:fromURL().left_document || fromURL().document || ''},right:{record_id:fromURL().right_source || '',document_id:fromURL().right_document || ''}}));
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('research-theme') || 'light'; } catch { return 'light'; } });
  const generation = useRef(0);
  const reader = useRef(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('research-theme', theme); } catch { /* Preference only. */ }
  }, [theme]);
  useEffect(()=>{
    if(libraryView!=='collection-intake' || collectionReading?.preset_id?.endsWith(':'+collectionReadingId))return;
    let active=true;setCollectionReading(null);setCollectionError('');
    api.request('reading/collection').then(value=>{const reading=value.readings.find(row=>row.id===collectionReadingId);if(!reading)throw new Error('That collection reading is unavailable. Return to the collection and select a source.');if(active)setCollectionReading(collectionPreset(value,reading));}).catch(err=>{if(active)setCollectionError(err.message);});
    return()=>{active=false;};
  },[libraryView,collectionReadingId]);
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
    const pop = () => { const state = fromURL(); setProject(state.project || ''); setSelected(state.record || ''); setSelectedAnnotation(state.annotation || '');setSelectedDocument(state.document || '');setLibraryView(['add-source','article-pilot','pilot','compare','collection','collection-intake','collection-link','notebook'].includes(state.view) ? state.view : '');setVerseReference(verseFromURL());setCollectionReadingId(state.reading_id || '');setNotebookAnchor(state.document ? {record_id:state.record,document_id:state.document,annotation_id:state.annotation || null} : null);setComparison({left:{record_id:state.left_source || state.record || '',document_id:state.left_document || state.document || ''},right:{record_id:state.right_source || '',document_id:state.right_document || ''}}); };
    addEventListener('beforeunload', unload); addEventListener('popstate', pop);
    return () => { removeEventListener('beforeunload', unload); removeEventListener('popstate', pop); };
  }, []);
  async function loadRows({ append = false, search = false } = {}) {
    if (!project) return;
    if(search && scope==='notebook'){showNotebook();return;}
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
    history.pushState(null, '', url); setLibraryView('');setSelected(id); setProject(nextProject); setSelectedAnnotation(annotationId);setSelectedDocument(documentId);
  }
  function showLibrary(view,reference=null) {
    const url=new URL(location.href);url.searchParams.set('project',project);url.searchParams.set('view',view);
    for(const key of ['chapter','ayah_start','ayah_end']) {if(reference)url.searchParams.set(key,reference[key]);else url.searchParams.delete(key);}
    setVerseReference(reference);
    history.pushState(null,'',url);setLibraryView(view);setReadingFocus(false);
  }
  function compare(target={record_id:record?.id || '',document_id:currentReadingPlace?.document_id || ''}) {
    setComparison({left:target,right:{}});
    const url=new URL(location.href);url.searchParams.set('project',project);url.searchParams.set('view','compare');
    for(const key of ['left_source','left_document','right_source','right_document'])url.searchParams.delete(key);
    if(target.record_id)url.searchParams.set('left_source',target.record_id);if(target.document_id)url.searchParams.set('left_document',target.document_id);
    history.pushState(null,'',url);setLibraryView('compare');setReadingFocus(false);
  }
  function chooseCollection(collection,reading){setCollectionReadingId(reading.id);setCollectionReading(collectionPreset(collection,reading));showLibrary('collection-intake');const url=new URL(location.href);url.searchParams.set('reading_id',reading.id);history.replaceState(null,'',url);}
  function afterIntake(result){
    loadRows();
    if(libraryView==='collection-intake' && collectionReadingId && result.document_id){
      const url=new URL(location.href);url.search=new URLSearchParams({project:result.project_id,record:result.record_id,document:result.document_id,reading_id:collectionReadingId,view:'collection-link'});history.pushState(null,'',url);
      setProject(result.project_id);setSelected(result.record_id);setSelectedDocument(result.document_id);setSelectedAnnotation('');setLibraryView('collection-link');
    }else open(result.record_id,result.project_id,'',result.document_id || '');
  }
  function showNotebook(){setNotebookAnchor(currentReadingPlace?.project_id===project && currentReadingPlace.record_id===record?.id ? {record_id:currentReadingPlace.record_id,document_id:currentReadingPlace.document_id,annotation_id:currentReadingPlace.annotation_id || null} : null);showLibrary('notebook');}
  function comparisonSelection(side,target){const url=new URL(location.href);for(const [key,value] of [[side+'_source',target.record_id],[side+'_document',target.document_id]]){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}history.replaceState(null,'',url);}
  function closeLibrary() {const url=new URL(location.href);url.searchParams.delete('view');history.pushState(null,'',url);setSelectedAnnotation(url.searchParams.get('annotation') || '');setSelectedDocument(url.searchParams.get('document') || '');setLibraryView('');}
  const entry = record && store.current.entries.get(record.id);
  function edit(patch, save = false) { store.current.edit(record.id, patch); if (save) store.current.save(record.id); }
  async function exportNote() {
    const url = URL.createObjectURL(new Blob([await markdownDraft(record, entry)], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = 'research-note.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className={`shell owner-shell${libraryView ? ' has-library-view' : ''}`}>
    <a className="skip-link" href="#workspace-results">Skip to research records</a>
    <header className="topbar"><a className="brand" href="/">Research notes</a><span>My workspace</span><div className="header-tools"><button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><a href={`/publish.html?${new URLSearchParams({project})}`}>Publish research</a><a href="/">Public research ↗</a></div></header>
    <div className="owner-heading"><h1>Read. Follow the sources. Make notes.</h1><p>Your reading state and notes are private. Saving here does not publish them.</p></div>
    {error && <div role="alert" className="workspace-alert"><p>{error}</p><button onClick={() => location.reload()}>Reconnect workspace</button><small>Export unsaved notes before reloading. The hosted owner endpoint must be configured at this address.</small></div>}
    <form className="workspace-search" onSubmit={e => { e.preventDefault(); loadRows({ search: true }); }}>
      <label>Project<select value={project} onChange={e => open('', e.target.value)}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
      <label className="workspace-query">Find in my research<input value={query} onChange={e => setQuery(e.target.value)} maxLength={500} placeholder="Words from a title, finding, or note" /></label>
      <label>Search in<select value={scope} onChange={e => {setScope(e.target.value);if(e.target.value==='lexicon')setKind('');}}><option value="records">Records</option><option value="notes">My record notes</option><option value="annotations">My passage notes</option><option value="lexicon">Concept words & definitions</option><option value="notebook">My notebook</option><option value="all">Records, reading notes & concepts</option></select></label>
      <label>Type<select value={kind} disabled={scope==='lexicon'} onChange={e => setKind(e.target.value)}><option value="">All types</option>{['source','question','claim','evidence','concept','person'].map(k => <option key={k}>{k}</option>)}</select></label>
      <button type="submit" disabled={!project || searching}>{searching ? 'Loading…' : 'Search'}</button><button type="button" disabled={!project || searching} onClick={() => { setQuery(''); setScope('records'); setKind(''); loadRows(); }}>Browse all</button>
    </form>
    {project && <ReadingPlace key={project} api={api} projectId={project} place={!libraryView && currentReadingPlace?.project_id===project && currentReadingPlace.record_id===record?.id ? currentReadingPlace : null} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onResume={open} />}
    {libraryView && <label className="library-project">Project<select value={project} onChange={event=>open('',event.target.value)}>{projects.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}
    <details className="workspace-tools" open={!libraryView}><summary>Reading tools</summary><nav className="workspace-library-actions" aria-label="Reading library actions"><button disabled={!project} onClick={()=>showLibrary('add-source')}>Add a source</button><button disabled={!project} onClick={()=>showLibrary('article-pilot')}>Read the Sirry article</button><button disabled={!project} onClick={()=>showLibrary('pilot')}>Start Qur’an pilot</button><button disabled={!project} onClick={()=>compare()}>Compare readings</button><button disabled={!project} onClick={()=>showLibrary('collection')}>Reading collection & context</button><button disabled={!project} onClick={showNotebook}>My notebook</button></nav></details>
    {libraryView==='collection-link' ? <CollectionReadingLink key={JSON.stringify([project,collectionReadingId,selectedDocument])} api={api} projectId={project} readingId={collectionReadingId} documentId={selectedDocument} sourceRecordId={selected} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onVerse={reference=>showLibrary('pilot',reference)}/> : libraryView==='notebook' ? <><button onClick={closeLibrary}>Back to my reading</button><ResearchNotebook key={project} api={api} projectId={project} initialQuery={scope==='notebook' ? query : ''} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpenSource={open} anchor={notebookAnchor}/></> : libraryView==='collection-intake' && !collectionReading ? <section><p role="status">{collectionError || 'Loading the selected reading…'}</p><button onClick={()=>showLibrary('collection')}>Return to reading collection</button></section> : libraryView==='collection' ? <ReadingCollection api={api} initialAyah={fromURL().collection_ayah} onVerseChange={ayah=>{const url=new URL(location.href);url.searchParams.set('collection_ayah',ayah);history.replaceState(null,'',url);}} onChoose={chooseCollection} onOpenVerse={reference=>showLibrary('pilot',reference)} onClose={closeLibrary}/> : libraryView==='compare' ? <ReadingComparison key={JSON.stringify([project,comparison])} api={api} projectId={project} initialLeft={comparison.left} initialRight={comparison.right} onSelection={comparisonSelection} onOpen={open} onClose={closeLibrary}/> : ['add-source','article-pilot','collection-intake'].includes(libraryView) ? <AddSource key={project+libraryView} initialPreset={libraryView==='article-pilot' ? sirryPilotPreset : libraryView==='collection-intake' ? collectionReading || undefined : undefined} api={api} projectId={project} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onCancel={closeLibrary} onCreated={afterIntake} /> : libraryView==='pilot' ? <PilotReading key={JSON.stringify([project,verseReference])} initialReference={verseReference} api={api} projectId={project} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onCancel={closeLibrary} /> : <ResizablePanes storageKey="research:hosted-pane-width" className={`owner-panes${readingFocus && ['source','work','edition'].includes(record?.kind) ? ' reading-focus' : ''}`}>
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
          {record.kind === 'question' && <EvidencePaths api={api} trail={trail} onOpen={open} onCompare={compare} />}
          <RecordContext key={record.project_id+record.id} api={api} record={record} onOpen={open} onCompare={compare}/>
          {record.kind === 'concept' && <ConceptPanel key={JSON.stringify([record.project_id,record.id])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} navigate={open} />}
          {['source','work','edition'].includes(record.kind) && <SourceReader key={JSON.stringify([record.id,selectedAnnotation,selectedDocument])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} initialAnnotationId={selectedAnnotation} initialDocumentId={selectedDocument} noteEditor={passageNotes.current} navigate={open} focused={readingFocus} onFocusChange={setReadingFocus} onReadingPlace={setCurrentReadingPlace} onOpenVerse={reference=>showLibrary('pilot',reference)} />}
          {entry && <section className="workspace-notes" aria-labelledby="my-notes-heading"><h3 id="my-notes-heading">My reading & notes</h3>
            <label>Reading progress<select value={entry.draft.reading} onChange={e => edit({ reading: e.target.value }, true)}><option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read by me</option></select></label>
            {entry.server.read_at && <small>Read {new Date(entry.server.read_at).toLocaleDateString()}</small>}
            <div className="workspace-decisions">{[['relevant','Keep'],['not_relevant','Skip'],['read_later','Read later'],['unreviewed','Unscreened']].map(([decision,label]) => <button key={decision} aria-pressed={entry.draft.decision === decision} onClick={() => edit({ decision }, true)}>{label}</button>)}</div>
            <label htmlFor="my-note">Reading notes</label><textarea id="my-note" value={entry.draft.note} onChange={e => edit({ note: e.target.value })} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); store.current.save(record.id); } }} maxLength={10000} rows={9} placeholder="What did you learn? What needs more evidence?" />
            <div className="workspace-note-actions"><button disabled={['saved','saving','conflict'].includes(entry.status)} onClick={() => store.current.save(record.id)}>Save note</button><button onClick={exportNote}>Export Markdown</button><span role="status">{statuses[entry.status]}</span></div>
            <RecoverableDraft key={record.project_id+record.id+':record-note'} api={api} projectId={record.project_id} recordId={record.id} contextKind="record_note" body={entry.draft.note} baseRevision={entry.server.revision} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onRecover={value=>recoverRecordWriting(store.current,record,value)}/>
            <small>Notes save with the button or ⌘/Ctrl + Enter. Reading and screening choices save immediately. Markdown exports support the optional Obsidian connector; vault sync is explicit.</small>
            {entry.status === 'conflict' && <div className="workspace-conflict" role="alert"><h4>Both versions are safe to compare.</h4><p>Your draft is above. The cloud version is revision {entry.current.revision}, {entry.current.reading}, {entry.current.decision}.</p><pre>{entry.current.note || '(No note text)'}</pre><button onClick={() => store.current.resolve(record.id,'cloud')}>Use cloud version</button><button onClick={() => store.current.resolve(record.id,'draft')}>Save my draft over this revision</button><p>Previous cloud revisions remain in history.</p></div>}
          </section>}
        </>}
      </section>
    </ResizablePanes>}
  </main>;
}

createRoot(document.getElementById('root')).render(<Workspace />);
