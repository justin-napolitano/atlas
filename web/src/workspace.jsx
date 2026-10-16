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
import ResearchSearch from './ResearchSearch.jsx';
import ResearchBrief from './ResearchBrief.jsx';
import {verifyReadingPlace} from './readingPlace.js';
import './atlasWorkspace.css';
import {currentReadingAnchor,notebookAnchorForProject} from './readingNavigation.js';

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
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [libraryMode,setLibraryMode]=useState('readings');
  const [libraryRows,setLibraryRows]=useState([]),[libraryCursor,setLibraryCursor]=useState(null),[libraryError,setLibraryError]=useState(''),[libraryLoading,setLibraryLoading]=useState(false);
  const [notebookEntryId,setNotebookEntryId]=useState(fromURL().entry_id || '');
  const [briefAnchor,setBriefAnchor]=useState(null);
  const libraryGeneration=useRef(0),navigationRef=useRef(null);

  const [currentReadingPlace,setCurrentReadingPlace]=useState(null);
  const [libraryView,setLibraryView]=useState(fromURL().view || '');
  const [collectionReading,setCollectionReading]=useState(null);
  const [collectionReadingId,setCollectionReadingId]=useState(fromURL().reading_id || '');
  const [collectionError,setCollectionError]=useState('');
  const [notebookAnchor,setNotebookAnchor]=useState(()=>fromURL().document ? {project_id:fromURL().project || '',record_id:fromURL().record,document_id:fromURL().document,annotation_id:fromURL().annotation || null} : null);
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
    const unload = event => { if (store.current.hasDrafts() || passageNotes.current.hasDrafts() || [...readingDrafts.current].some(([key,value])=>!key.startsWith('research-brief:') || !value.saved)) { event.preventDefault(); event.returnValue = ''; } };
    const pop = () => { const state = fromURL(); setProject(state.project || ''); setSelected(state.record || ''); setSelectedAnnotation(state.annotation || '');setSelectedDocument(state.document || '');setBriefAnchor(null);setNotebookEntryId(state.entry_id || '');setLibraryView(['add-source','article-pilot','pilot','compare','collection','collection-intake','collection-link','notebook','search','assistant'].includes(state.view) ? state.view : '');setVerseReference(verseFromURL());setCollectionReadingId(state.reading_id || '');setNotebookAnchor(state.document ? {project_id:state.project || '',record_id:state.record,document_id:state.document,annotation_id:state.annotation || null} : null);setComparison({left:{record_id:state.left_source || state.record || '',document_id:state.left_document || state.document || ''},right:{record_id:state.right_source || '',document_id:state.right_document || ''}}); };
    addEventListener('beforeunload', unload); addEventListener('popstate', pop);
    return () => { removeEventListener('beforeunload', unload); removeEventListener('popstate', pop); };
  }, []);
  async function loadLibrary(append=false){
    if(!project)return;const token=++libraryGeneration.current;setLibraryLoading(true);setLibraryError('');
    try{const page=await api.request('reading/library',{project_id:project,limit:50,...(append && libraryCursor?{cursor:libraryCursor}:{})});
      if(!Array.isArray(page.items) || page.items.some(row=>row.project_id!==project || !row.record_id || !row.document_id))throw new Error('The reading library did not match this project.');
      if(token!==libraryGeneration.current)return;
      setLibraryRows(old=>append?[...old,...page.items]:page.items);setLibraryCursor(page.next_cursor || null);
      const locationState=fromURL();
      if(!append && !locationState.record && !locationState.view){
        let place=null;try{place=verifyReadingPlace(await api.request('reading/desk',{project_id:project}),project);}catch(error){if(error.status!==404){setLibraryError('Your bookmark could not be loaded. Choose a saved reading below.');return;}}
        if(token!==libraryGeneration.current || fromURL().record || fromURL().view)return;
        if(place)open(place.record_id,project,place.annotation_id || '',place.document_id);
        else if(page.items[0])open(page.items[0].record_id,project,'',page.items[0].document_id);
      }
    }catch(error){if(token===libraryGeneration.current)setLibraryError(error.message);}finally{if(token===libraryGeneration.current)setLibraryLoading(false);}
  }
  useEffect(()=>{setBriefAnchor(null);setNotebookAnchor(value=>notebookAnchorForProject(project,value));setLibraryRows([]);setLibraryCursor(null);loadLibrary();return()=>{libraryGeneration.current++;};},[project]);
  navigationRef.current={search:()=>showLibrary('search'),close:()=>setLibraryOpen(false)};
  useEffect(()=>{if(libraryView==='search')requestAnimationFrame(()=>window.document.getElementById('research-search-query')?.focus());},[libraryView]);
  useEffect(()=>{const handle=event=>{if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='k'){event.preventDefault();navigationRef.current.search();}if(event.key==='Escape')navigationRef.current.close();};addEventListener('keydown',handle);return()=>removeEventListener('keydown',handle);},[]);
  function prepareResearch(){const valid=record?.project_id===project && record.id===selected,anchor=currentReadingAnchor(project,record?.id,fromURL(),currentReadingPlace);setBriefAnchor(valid?{record,documentId:anchor.documentId,annotationId:anchor.annotationId}:null);showLibrary('assistant');}

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
    history.pushState(null, '', url);setLibraryOpen(false);setNotebookEntryId('');setBriefAnchor(null);setNotebookAnchor(null); setLibraryView('');setSelected(id); setProject(nextProject); setSelectedAnnotation(annotationId);setSelectedDocument(documentId);
  }
  function showLibrary(view,reference=null) {
    setLibraryOpen(false);
    const url=new URL(location.href);url.searchParams.set('project',project);url.searchParams.set('view',view);
    for(const key of ['chapter','ayah_start','ayah_end']) {if(reference)url.searchParams.set(key,reference[key]);else url.searchParams.delete(key);}
    setVerseReference(reference);if(view!=='notebook'){setNotebookEntryId('');url.searchParams.delete('entry_id');}
    history.pushState(null,'',url);setLibraryView(view);setReadingFocus(false);
  }
  function compare(target) {
    target=target || {record_id:record?.id || '',document_id:currentReadingAnchor(project,record?.id,fromURL(),currentReadingPlace).documentId};
    setLibraryOpen(false);setComparison({left:target,right:{}});
    const url=new URL(location.href);url.searchParams.set('project',project);url.searchParams.set('view','compare');
    for(const key of ['left_source','left_document','right_source','right_document'])url.searchParams.delete(key);
    if(target.record_id)url.searchParams.set('left_source',target.record_id);if(target.document_id)url.searchParams.set('left_document',target.document_id);
    history.pushState(null,'',url);setLibraryView('compare');setReadingFocus(false);
  }
  function chooseCollection(collection,reading){setCollectionReadingId(reading.id);setCollectionReading(collectionPreset(collection,reading));showLibrary('collection-intake');const url=new URL(location.href);url.searchParams.set('reading_id',reading.id);history.replaceState(null,'',url);}
  function afterIntake(result){
    loadRows();loadLibrary();
    if(libraryView==='collection-intake' && collectionReadingId && result.document_id){
      const url=new URL(location.href);url.search=new URLSearchParams({project:result.project_id,record:result.record_id,document:result.document_id,reading_id:collectionReadingId,view:'collection-link'});history.pushState(null,'',url);
      setProject(result.project_id);setSelected(result.record_id);setSelectedDocument(result.document_id);setSelectedAnnotation('');setLibraryView('collection-link');
    }else open(result.record_id,result.project_id,'',result.document_id || '');
  }
  function openNotebookEntry(entryId=''){setNotebookAnchor(null);setNotebookEntryId(entryId);showLibrary('notebook');const url=new URL(location.href);if(entryId)url.searchParams.set('entry_id',entryId);else url.searchParams.delete('entry_id');history.replaceState(null,'',url);}
  function showNotebook(withReading=false){setNotebookEntryId('');const anchor=currentReadingAnchor(project,record?.id,fromURL(),currentReadingPlace);setNotebookAnchor(withReading && record?.project_id===project && anchor.documentId?{project_id:project,record_id:record.id,document_id:anchor.documentId,annotation_id:anchor.annotationId || null}:null);showLibrary('notebook');}

  function comparisonSelection(side,target){const url=new URL(location.href);for(const [key,value] of [[side+'_source',target.record_id],[side+'_document',target.document_id]]){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}history.replaceState(null,'',url);}
  function closeLibrary() {if(!selected && libraryRows[0]){open(libraryRows[0].record_id,project,'',libraryRows[0].document_id);return;}const url=new URL(location.href);url.searchParams.delete('view');history.pushState(null,'',url);setSelectedAnnotation(url.searchParams.get('annotation') || '');setSelectedDocument(url.searchParams.get('document') || '');setLibraryView('');}
  const entry = record && store.current.entries.get(record.id);
  function edit(patch, save = false) { if(!record || record.project_id!==project)return;store.current.edit(record.id, patch); if (save) store.current.save(record.id); }
  async function exportNote() {
    const url = URL.createObjectURL(new Blob([await markdownDraft(record, entry)], { type: 'text/markdown' }));
    const link = document.createElement('a'); link.href = url; link.download = 'research-note.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const effectiveBrief=briefAnchor || (record?.project_id===project && record.id===selected?{record,...currentReadingAnchor(project,record.id,fromURL())}:null);
  const isReading=record && ['source','work','edition'].includes(record.kind);
  return <main className={`shell owner-shell atlas-workspace${libraryView==='notebook'?' is-notebook':''}${libraryView ? ' has-library-view' : ''}${libraryOpen?' is-library-open':''}`}>
    <a className="skip-link" href="#workspace-view">Skip to workspace</a>
    <header className="topbar atlas-header"><button className="atlas-library-toggle" aria-expanded={libraryOpen} aria-controls="atlas-library" onClick={()=>setLibraryOpen(!libraryOpen)}>Library</button><a className="brand" href="/workspace.html">ATLAS</a><nav className="atlas-destinations" aria-label="Workspace destinations"><button aria-current={!libraryView?'page':undefined} onClick={closeLibrary}>Reading</button><button aria-current={libraryView==='notebook'?'page':undefined} onClick={()=>showNotebook()} disabled={!project}>Notebook</button></nav><button className="atlas-search-launch" onClick={()=>showLibrary('search')} disabled={!project}>Search your research <kbd>⌘ K</kbd></button><div className="header-tools"><button className="atlas-agent-launch" onClick={prepareResearch} disabled={!project}>Agents</button><details className="atlas-account-tools" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}><summary>More</summary><div className="atlas-account-menu"><button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><a href={`/publish.html?${new URLSearchParams({project})}`}>Publish research</a><a href="/">Public research ↗</a></div></details></div></header>
    {error && <div role="alert" className="workspace-alert"><p>{error}</p><button onClick={() => location.reload()}>Reconnect workspace</button><small>Export unsaved notes before reloading.</small></div>}
    <ResizablePanes storageKey="research:reader-library-v1" className={`owner-panes atlas-body${readingFocus?' reading-focus':''}`} minWidth={14} maxWidth={32} defaultWidth={19} label="Resize library and reading workspace">
      <aside id="atlas-library" className="atlas-library workspace-results" aria-label="Research library">
        <div className="atlas-library-heading"><span className="atlas-kicker">Your library</span><label className="atlas-project"><span className="sr-only">Research project</span><select aria-label="Research project" value={project} onChange={event=>open('',event.target.value)}>{projects.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label><p>Read. Make notes. Follow the sources.</p></div>
        <nav className="atlas-primary-nav" aria-label="Research workspace"><button aria-current={!libraryView?'page':undefined} onClick={closeLibrary}>Reading</button><button aria-current={libraryView==='notebook'?'page':undefined} onClick={()=>showNotebook()} disabled={!project}>My notebook</button></nav>
        <details className="workspace-tools"><summary>Study tools</summary><nav className="workspace-library-actions" aria-label="Reading library actions"><button disabled={!project} onClick={()=>compare()}>Compare readings</button><button disabled={!project} onClick={()=>showLibrary('collection')}>Reading collection & context</button><button disabled={!project} onClick={()=>showLibrary('pilot')}>Start Qur’an pilot</button><button disabled={!project} onClick={()=>showLibrary('add-source')}>Add a source</button><button disabled={!project} onClick={()=>showLibrary('article-pilot')}>Read the Sirry article</button></nav></details>
        <div className="atlas-library-tabs" role="group" aria-label="Library contents"><button aria-pressed={libraryMode==='readings'} onClick={()=>setLibraryMode('readings')}>Readings</button><button aria-pressed={libraryMode==='records'} onClick={()=>setLibraryMode('records')}>All research</button></div>
        <section className="atlas-saved-readings" aria-label="Saved readings" hidden={libraryMode!=='readings'}>
          <p className="workspace-result-count" role="status">{libraryLoading?'Opening your library…':`${libraryRows.length}${libraryCursor?'+':''} saved excerpts`}</p>
          {libraryError && <p role="status" className="atlas-library-error">{libraryError} <button onClick={()=>loadLibrary()}>Retry library</button></p>}
          {libraryRows.map(row=><button key={row.document_id} className="atlas-reading-item" aria-current={selected===row.record_id && (!selectedDocument || selectedDocument===row.document_id)?'page':undefined} onClick={()=>open(row.record_id,project,'',row.document_id)}><strong>{row.title}</strong><span>{row.locator}</span><small>{(store.current.entries.get(row.record_id)?.draft.reading || row.reading)==='read'?'Read by you · ':''}{row.edition}</small></button>)}
          {!libraryLoading && !libraryError && !libraryRows.length && <div className="atlas-library-empty"><p>Your saved reading excerpts will appear here.</p><button onClick={()=>showLibrary('collection')}>Choose a starting reading</button><button onClick={()=>showLibrary('add-source')}>Add your own source</button></div>}
          {libraryCursor && <button className="workspace-load" disabled={libraryLoading} onClick={()=>loadLibrary(true)}>More saved readings</button>}
        </section>
        <section id="workspace-results" className="atlas-all-records" aria-label="Research records" hidden={libraryMode!=='records'}><p className="workspace-result-count" role="status">{searching?'Loading records…':`${rows.length} records shown`}{notice && ` · ${notice}`}</p>
        {rows.map(row => <article key={row.id} className="workspace-hit"><button className="workspace-row" aria-pressed={selected === row.id} onClick={() => open(row.id)}><small>{row.kind} · {row.review_state}{store.current.entries.has(row.id) && ` · ${store.current.entries.get(row.id).draft.reading}`}</small><strong>{row.title}</strong>{row.matches?.filter(match=>match.channel!=='private_annotation').map((match,i) => <span key={match.channel+':'+i}><b>{match.channel === 'private_note' ? 'My note' : match.channel==='lexicon' ? 'Matched wording' : 'Record'}</b> · {match.excerpt}{match.assertion_kind && ` · ${match.assertion_kind.replaceAll('_',' ')}`}</span>)}</button>
          {row.matches?.filter(match=>match.channel==='private_annotation').map(match=><a key={match.target_id} className="workspace-passage-hit" href={`?${new URLSearchParams({project,record:row.id,annotation:match.target_id})}`} onClick={event=>{ if(event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); open(row.id,project,match.target_id); } }}><small>My passage note · {match.capture_kind?.replaceAll('_',' ')} · revision {match.revision}</small><span>{match.excerpt}</span><b>Open exact passage →</b></a>)}
          {row.matches_truncated && <small className="workspace-match-limit">More matches exist in this source. Narrow your search.</small>}
        </article>)}
        {cursor && <button className="workspace-load" disabled={searching} onClick={() => loadRows({ append: true })}>Load next 50 records</button>}
        <details className="atlas-advanced-search"><summary>Filter research records</summary>    <form className="workspace-search" onSubmit={e => { e.preventDefault(); loadRows({ search: true }); }}>

      <label className="workspace-query">Find in my research<input value={query} onChange={e => setQuery(e.target.value)} maxLength={500} placeholder="Words from a title, finding, or note" /></label>
      <label>Search in<select value={scope} onChange={e => {setScope(e.target.value);if(e.target.value==='lexicon')setKind('');}}><option value="records">Records</option><option value="notes">My record notes</option><option value="annotations">My passage notes</option><option value="lexicon">Concept words & definitions</option><option value="notebook">My notebook</option><option value="all">Records, reading notes & concepts</option></select></label>
      <label>Type<select value={kind} disabled={scope==='lexicon'} onChange={e => setKind(e.target.value)}><option value="">All types</option>{['source','question','claim','evidence','concept','person'].map(k => <option key={k}>{k}</option>)}</select></label>
      <button type="submit" disabled={!project || searching}>{searching ? 'Loading…' : 'Search'}</button><button type="button" disabled={!project || searching} onClick={() => { setQuery(''); setScope('records'); setKind(''); loadRows(); }}>Browse all</button>
    </form></details></section>
        <details className="atlas-bookmark-tools"><summary>Reading place</summary>{project && <ReadingPlace key={project} api={api} projectId={project} place={!libraryView && currentReadingPlace?.project_id===project && currentReadingPlace.record_id===record?.id ? currentReadingPlace : null} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onResume={open}/>}</details>
        <p className="atlas-private-note">Private workspace. Publishing is a separate choice.</p>
      </aside>
      <section ref={reader} id="workspace-view" tabIndex={-1} className="workspace-reader atlas-reading-workspace" aria-label={libraryView==='notebook'?'Your notebook':'Selected record and private notes'}>
        <div hidden={libraryView!=='search'}>{project && <ResearchSearch key={project} api={api} projectId={project} onOpen={open} onOpenNotebook={openNotebookEntry} onClose={closeLibrary}/>}</div>
        {libraryView && libraryView!=='notebook' && <div className="atlas-view-back"><button onClick={closeLibrary}>← Back to reading</button></div>}
        {libraryView==='search' ? null : libraryView==='assistant' ? selected && !effectiveBrief?<p role="status">Opening the source for your research question…</p>:<ResearchBrief key={JSON.stringify([project,effectiveBrief?.record?.id,effectiveBrief?.documentId,effectiveBrief?.annotationId])} api={api} projectId={project} record={effectiveBrief?.record || null} documentId={effectiveBrief?.documentId || ''} annotationId={effectiveBrief?.annotationId || ''} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpenNotebook={openNotebookEntry} onClose={closeLibrary}/> : libraryView==='collection-link' ? <CollectionReadingLink key={JSON.stringify([project,collectionReadingId,selectedDocument])} api={api} projectId={project} readingId={collectionReadingId} documentId={selectedDocument} sourceRecordId={selected} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onVerse={reference=>showLibrary('pilot',reference)}/> : libraryView==='notebook' ? <><ResearchNotebook key={project+':'+notebookEntryId} projectTitle={projects.find(row=>row.id===project)?.title || ''} initialEntryId={notebookEntryId} onEntryChange={entryId=>{const url=new URL(location.href);if(entryId)url.searchParams.set('entry_id',entryId);else url.searchParams.delete('entry_id');history.replaceState(null,'',url);}} api={api} projectId={project} initialQuery={scope==='notebook' ? query : ''} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpenSource={open} anchor={notebookAnchorForProject(project,notebookAnchor)}/></> : libraryView==='collection-intake' && !collectionReading ? <section><p role="status">{collectionError || 'Loading the selected reading…'}</p><button onClick={()=>showLibrary('collection')}>Return to reading collection</button></section> : libraryView==='collection' ? <ReadingCollection api={api} initialAyah={fromURL().collection_ayah} onVerseChange={ayah=>{const url=new URL(location.href);url.searchParams.set('collection_ayah',ayah);history.replaceState(null,'',url);}} onChoose={chooseCollection} onOpenVerse={reference=>showLibrary('pilot',reference)} onClose={closeLibrary}/> : libraryView==='compare' ? <ReadingComparison key={JSON.stringify([project,comparison])} api={api} projectId={project} initialLeft={comparison.left} initialRight={comparison.right} onSelection={comparisonSelection} onOpen={open} onClose={closeLibrary}/> : ['add-source','article-pilot','collection-intake'].includes(libraryView) ? <AddSource key={project+libraryView} initialPreset={libraryView==='article-pilot' ? sirryPilotPreset : libraryView==='collection-intake' ? collectionReading || undefined : undefined} api={api} projectId={project} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onCancel={closeLibrary} onCreated={afterIntake} /> : libraryView==='pilot' ? <PilotReading key={JSON.stringify([project,verseReference])} initialReference={verseReference} api={api} projectId={project} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onCancel={closeLibrary} /> : <>
          {!record ? <div className="workspace-empty atlas-empty-reading"><span className="atlas-kicker">A place to think</span><h1>{selected?'Opening your reading…':libraryLoading?'Finding your place…':'Start with a source. Follow a question.'}</h1><p>Read the text, keep your notes beside it, and explore its connections when you need them.</p>{!selected && project && <><button onClick={()=>showLibrary('collection')}>Browse starting readings</button><button onClick={()=>showLibrary('add-source')}>Add a source</button><button onClick={()=>showLibrary('search')}>Search your research</button></>}</div> : <>
            <header className="workspace-record-heading atlas-record-heading"><div><small>{record.kind} · {record.review_state}</small><h2 dir="auto">{record.title}</h2></div>{entry && <button className="atlas-read-status" aria-pressed={entry.draft.reading==='read'} disabled={['saving','conflict'].includes(entry.status)} onClick={()=>edit({reading:entry.draft.reading==='read'?'reading':'read'},true)}>{entry.draft.reading==='read'?'Read by you':'Mark as read'}</button>}</header>
            {isReading && <nav className="atlas-reading-context-actions" aria-label="Explore this reading"><button onClick={()=>compare()}>Compare</button><button onClick={()=>showNotebook(true)}>Note on this reading</button><button onClick={prepareResearch}>Ask a research question</button></nav>}
          {['source','work','edition'].includes(record.kind) && <SourceReader key={JSON.stringify([record.id,selectedAnnotation,selectedDocument])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} initialAnnotationId={selectedAnnotation} initialDocumentId={selectedDocument} noteEditor={passageNotes.current} navigate={open} focused={readingFocus} onFocusChange={setReadingFocus} onReadingPlace={setCurrentReadingPlace} onOpenVerse={reference=>showLibrary('pilot',reference)} />}

            <details className="atlas-record-context" open={!isReading}><summary>{isReading?'Source details & connections':'Findings, evidence & connections'}</summary>          <p className="workspace-summary">{record.kind==='concept' && <small>Concept description</small>}{record.summary || 'No summary recorded yet.'}</p>
          {[['Citation', 'http://purl.org/dc/terms/bibliographicCitation'], ['Location', ir+'locator'], ['Scope', ir+'scope']].map(([label, key]) => property(record, key).length > 0 && <section className="workspace-context" key={key}><h3>{label}</h3>{property(record,key).map((text,i) => <p key={i}>{text}</p>)}</section>)}
          {property(record,'http://purl.org/dc/terms/source').filter(url => /^https?:\/\//i.test(url)).map(url => <a className="source-link" key={url} href={url} target="_blank" rel="noreferrer">Open source ↗</a>)}
          {(record.attributes?.recorded_review_status || []).map(text => <p className="workspace-review-scope" key={text}>{text}</p>)}
          {record.kind === 'question' && <EvidencePaths api={api} trail={trail} onOpen={open} onCompare={compare} />}
          <RecordContext key={record.project_id+record.id} api={api} record={record} onOpen={open} onCompare={compare}/>
          {record.kind === 'concept' && <ConceptPanel key={JSON.stringify([record.project_id,record.id])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} navigate={open} />}
</details>
            <details className="atlas-record-notes"><summary>My reading notes & progress {entry && entry.status!=='saved'?`· ${statuses[entry.status]}`:''}</summary>          {entry && <section className="workspace-notes" aria-labelledby="my-notes-heading"><h3 id="my-notes-heading">My reading & notes</h3>
            <label>Reading progress<select value={entry.draft.reading} onChange={e => edit({ reading: e.target.value }, true)}><option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read by me</option></select></label>
            {entry.server.read_at && <small>Read {new Date(entry.server.read_at).toLocaleDateString()}</small>}
            <div className="workspace-decisions">{[['relevant','Keep'],['not_relevant','Skip'],['read_later','Read later'],['unreviewed','Unscreened']].map(([decision,label]) => <button key={decision} aria-pressed={entry.draft.decision === decision} onClick={() => edit({ decision }, true)}>{label}</button>)}</div>
            <label htmlFor="my-note">Reading notes</label><textarea id="my-note" value={entry.draft.note} onChange={e => edit({ note: e.target.value })} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); store.current.save(record.id); } }} maxLength={10000} rows={9} placeholder="What did you learn? What needs more evidence?" />
            <div className="workspace-note-actions"><button disabled={['saved','saving','conflict'].includes(entry.status)} onClick={() => store.current.save(record.id)}>Save note</button><button onClick={exportNote}>Export Markdown</button><span role="status">{statuses[entry.status]}</span></div>
            <RecoverableDraft key={record.project_id+record.id+':record-note'} api={api} projectId={record.project_id} recordId={record.id} contextKind="record_note" body={entry.draft.note} baseRevision={entry.server.revision} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onRecover={value=>recoverRecordWriting(store.current,record,value)}/>
            <small>Notes save with the button or ⌘/Ctrl + Enter. Reading and screening choices save immediately. Markdown exports support the optional Obsidian connector; vault sync is explicit.</small>
            {entry.status === 'conflict' && <div className="workspace-conflict" role="alert"><h4>Both versions are safe to compare.</h4><p>Your draft is above. The cloud version is revision {entry.current.revision}, {entry.current.reading}, {entry.current.decision}.</p><pre>{entry.current.note || '(No note text)'}</pre><button onClick={() => store.current.resolve(record.id,'cloud')}>Use cloud version</button><button onClick={() => store.current.resolve(record.id,'draft')}>Save my draft over this revision</button><p>Previous cloud revisions remain in history.</p></div>}
          </section>}</details>
          </>}
        </>}
      </section>
    </ResizablePanes>
  </main>;
}

createRoot(document.getElementById('root')).render(<Workspace />);
