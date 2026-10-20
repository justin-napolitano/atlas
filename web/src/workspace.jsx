import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ResizablePanes from './ResizablePanes.jsx';
import SourceReader from './SourceReader.jsx';
import AddSource from './AddSource.jsx';
import ReadingPlace from './ReadingPlace.jsx';
import PilotReading from './PilotReading.jsx';
import QuranReader from './QuranReader.jsx';
import ReadingComparison from './ReadingComparison.jsx';
import ReadingCollection from './ReadingCollection.jsx';
import CollectionReadingLink from './CollectionReadingLink.jsx';
import ResearchNotebook from './ResearchNotebook.jsx';
import ResearchSources from './ResearchSources.jsx';
import LibraryShelf from './LibraryShelf.jsx';
import SaveToLibrary from './SaveToLibrary.jsx';
const GutenbergReader=lazy(()=>import('./GutenbergReader.jsx'));
import ResearchQuestions from './ResearchQuestions.jsx';
import ProjectDirectories from './ProjectDirectories.jsx';
import WorkingSurfaces from './WorkingSurfaces.jsx';
import {workStatus} from './workingCache.js';
import './workingTabs.css';
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
import {WorkspaceNavigation} from './WorkspaceNavigation.jsx';
import {useModalFocus} from './useModalFocus.js';
import {currentReadingAnchor,notebookAnchorForProject} from './readingNavigation.js';

const api = workspaceAPI();
const localPreview=document.querySelector('meta[name="research-storage-mode"]')?.content==='local-preview';
const fromURL = () => Object.fromEntries(new URLSearchParams(location.search));
const property = (record, key) => (record.attributes?.rdf_properties?.[key] || []).map(value => {
  const literal = value.match(/^"(?:[^"\\]|\\.)*"/);
  try { return literal ? JSON.parse(literal[0]) : value.replace(/^<|>$/g, ''); } catch { return value; }
});
const verseFromURL=()=>{const value=fromURL(),chapter=Number(value.chapter),start=Number(value.ayah_start),end=Number(value.ayah_end || value.ayah_start);return Number.isInteger(chapter) && chapter>=1 && chapter<=114 && Number.isInteger(start) && start>=1 && Number.isInteger(end) && end>=start && end<=286 ? {chapter,ayah_start:start,ayah_end:end,resource_key:value.resource_key || 'itani-god',...(['verse','surah','source'].includes(value.note_scope)?{note_scope:value.note_scope}:{})} : null;};
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
  const [selectedReadingPosition,setSelectedReadingPosition]=useState(fromURL().position==null?null:Number(fromURL().position));
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
  const [sidebarHidden,setSidebarHidden]=useState(false),[navigationHost,setNavigationHost]=useState(null);
  const sidebarToggle=useRef(null),sidebar=useRef(null);
  const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:900px)').matches);
  useEffect(()=>{const media=matchMedia('(max-width:900px)'),change=()=>setNarrow(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  useModalFocus(sidebar,narrow&&libraryOpen);
  const closeSidebar=()=>{setLibraryOpen(false);requestAnimationFrame(()=>sidebarToggle.current?.focus());};
  const [libraryMode,setLibraryMode]=useState('readings');
  const [libraryRows,setLibraryRows]=useState([]),[libraryCursor,setLibraryCursor]=useState(null),[libraryError,setLibraryError]=useState(''),[libraryLoading,setLibraryLoading]=useState(false);
  const [composeIntent,setComposeIntent]=useState(null);
  const [notebookEntryId,setNotebookEntryId]=useState(fromURL().entry_id || '');
  const [notebookQuery,setNotebookQuery]=useState('');
  const [briefAnchor,setBriefAnchor]=useState(null);
  const [readingRequests,setReadingRequests]=useState({});
  const [workTabs,setWorkTabs]=useState([]),[entryTitles,setEntryTitles]=useState({});
  const surfaces=useRef(null);
  const workStatuses=Object.fromEntries(workTabs.map(item=>[item.key,workStatus(item,{drafts:readingDrafts.current,records:store.current.entries,passages:passageNotes.current.entries})]));
  const protectedWork=new Set(Object.keys(workStatuses).filter(key=>workStatuses[key]));
  const libraryGeneration=useRef(0),navigationRef=useRef(null);

  const [currentReadingPlace,setCurrentReadingPlace]=useState(null);
  const [libraryView,setLibraryView]=useState(fromURL().view || '');
  const [gutenbergVersion,setGutenbergVersion]=useState(fromURL().book_version || '');
  const [gutenbergId,setGutenbergId]=useState(Number(fromURL().book_id)||0);
  const [collectionReading,setCollectionReading]=useState(null);
  const [collectionReadingId,setCollectionReadingId]=useState(fromURL().reading_id || '');
  const [collectionError,setCollectionError]=useState('');
  const [notebookAnchor,setNotebookAnchor]=useState(()=>fromURL().document ? {project_id:fromURL().project || '',record_id:fromURL().record,document_id:fromURL().document,annotation_id:fromURL().annotation || null} : null);
  const [verseReference,setVerseReference]=useState(verseFromURL());
  const quranLocationChanged=useCallback(value=>setVerseReference(value),[]);
  const [comparison,setComparison]=useState(()=>({left:{record_id:fromURL().left_source || fromURL().record || '',document_id:fromURL().left_document || fromURL().document || ''},right:{record_id:fromURL().right_source || '',document_id:fromURL().right_document || ''}}));
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('research-theme') || 'dark'; } catch { return 'dark'; } });
  const generation = useRef(0);
  const reader = useRef(null);
  const workKey=project && (libraryView==='gutenberg'?JSON.stringify([project,'gutenberg',gutenbergId]):['notebook','questions','quran','shelf'].includes(libraryView)?JSON.stringify([project,libraryView]):(!libraryView || libraryView==='records') && selected?JSON.stringify([project,'record',selected]):'');
  const workReady=(!!libraryView && libraryView!=='records') || !selected || (record?.id===selected && record.project_id===project);
  const workSnapshot={project,selected,selectedAnnotation,selectedDocument,selectedReadingPosition,libraryView,notebookEntryId,notebookAnchor,verseReference,comparison,briefAnchor,readingFocus,notebookQuery,gutenbergId,gutenbergVersion};
  const workURL=location.href,workState=JSON.stringify(workSnapshot);
  const workTitle=libraryView==='gutenberg'?(entryTitles[project+':gutenberg:'+gutenbergId] || 'Gutenberg #'+gutenbergId):libraryView==='shelf'?'Library':libraryView==='quran'?'Qur’an':libraryView==='questions'?(entryTitles[project+':questions'] || 'Questions'):libraryView==='notebook'?(entryTitles[project+':notebook'] || 'Notes'):record?.id===selected?record.title:'Reading';
  useLayoutEffect(()=>{if(!workKey || !workReady)return;const item={key:workKey,project,title:workTitle,kind:libraryView==='quran'?'Reading':libraryView==='questions'?'Question':libraryView==='notebook'?'Note':['source','work','edition'].includes(record?.kind)?'Reading':record?.kind==='question'?'Research question':'Record',url:workURL,snapshot:JSON.parse(workState)};
    setWorkTabs(items=>{const old=items.find(row=>row.key===workKey);if(JSON.stringify(old)===JSON.stringify(item))return items;return old?items.map(row=>row.key===workKey?item:row):[...items,item];});
  },[workKey,workReady,workTitle,workURL,workState]);
  function chooseWork(item){surfaces.current?.capture();const s=item.snapshot;history.pushState(null,'',item.url);setLibraryOpen(false);setComposeIntent(null);setProject(s.project);setSelected(s.selected);setSelectedAnnotation(s.selectedAnnotation);setSelectedDocument(s.selectedDocument);setSelectedReadingPosition(s.selectedReadingPosition ?? null);setLibraryView(s.libraryView);setNotebookEntryId(s.notebookEntryId);setNotebookAnchor(s.notebookAnchor);setVerseReference(s.verseReference);setComparison(s.comparison);setBriefAnchor(s.briefAnchor);setReadingFocus(s.readingFocus);setNotebookQuery(s.notebookQuery);setGutenbergId(s.gutenbergId || 0);setGutenbergVersion(s.gutenbergVersion || '');}
  function closeWork(item){if(protectedWork.has(item.key)){setNotice('This tab stays open to protect unfinished work. Save, export, or discard changes before closing.');chooseWork(item);return;}surfaces.current?.capture();setWorkTabs(items=>items.filter(row=>row.key!==item.key));if(item.key===workKey){const next=workTabs.filter(row=>row.project===project && row.key!==item.key).at(-1);if(next)chooseWork(next);else showLibrary('sources');}}
  function openWorkspace(view){const item=workTabs.find(row=>row.key===JSON.stringify([project,view]));if(item)chooseWork(item);else if(view==='notebook')openNotebookEntry();else showLibrary(view);}
  function entryChanged(entryId,title){
    const label=title || (libraryView==='questions'?'Untitled question':'Untitled note');
    setEntryTitles(items=>({...items,[project+':'+libraryView]:label}));
    const withEntry=value=>{const url=new URL(value);if(entryId)url.searchParams.set('entry_id',entryId);else url.searchParams.delete('entry_id');return url.href;};
    setWorkTabs(items=>items.map(item=>item.key===workKey?{...item,title:label,url:withEntry(item.url)}:item));
    if(navigationRef.current?.workKey===workKey)history.replaceState(null,'',withEntry(location.href));
  }
  const readingPlaceChanged=useCallback((value,context)=>{const route=navigationRef.current;if(route?.projectId===context?.projectId && route?.recordId===context?.recordId && (!route.view || route.view==='records'))setCurrentReadingPlace(value);},[]);
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
    }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const unload = event => { if (store.current.hasDrafts() || passageNotes.current.hasDrafts() || [...readingDrafts.current].some(([key,value])=>!key.startsWith('research-brief:') || !value.saved)) { event.preventDefault(); event.returnValue = ''; } };
    const pop = () => { surfaces.current?.capture(); const state = fromURL(); setProject(state.project || ''); setSelected(state.record || ''); setSelectedAnnotation(state.annotation || '');setSelectedDocument(state.document || '');setSelectedReadingPosition(state.position==null?null:Number(state.position));setBriefAnchor(null);setNotebookEntryId(state.entry_id || '');setLibraryView(['shelf','add-source','article-pilot','pilot','quran','gutenberg','compare','collection','collection-intake','collection-link','notebook','questions','sources','records','search','assistant'].includes(state.view) ? state.view : '');setGutenbergId(Number(state.book_id)||0);setGutenbergVersion(state.book_version || '');setVerseReference(verseFromURL());setCollectionReadingId(state.reading_id || '');setNotebookAnchor(state.document ? {project_id:state.project || '',record_id:state.record,document_id:state.document,annotation_id:state.annotation || null} : null);setComparison({left:{record_id:state.left_source || state.record || '',document_id:state.left_document || state.document || ''},right:{record_id:state.right_source || '',document_id:state.right_document || ''}}); };
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
      if(!append && !locationState.record && !locationState.view && libraryView!=='shelf'){
        let place=null;try{place=verifyReadingPlace(await api.request('reading/desk',{project_id:project}),project);}catch(error){if(error.status!==404){setLibraryError('Your bookmark could not be loaded. Choose a saved reading below.');return;}}
        if(token!==libraryGeneration.current || fromURL().record || fromURL().view)return;
        if(place)open(place.record_id,project,place.annotation_id || '',place.document_id);
        else if(page.items[0])open(page.items[0].record_id,project,'',page.items[0].document_id);
      }
    }catch(error){if(token===libraryGeneration.current)setLibraryError(error.message);}finally{if(token===libraryGeneration.current)setLibraryLoading(false);}
  }
  useEffect(()=>{setBriefAnchor(null);setNotebookAnchor(value=>notebookAnchorForProject(project,value));setLibraryRows([]);setLibraryCursor(null);loadLibrary();return()=>{libraryGeneration.current++;};},[project]);
  navigationRef.current={search:()=>showLibrary('search'),close:()=>setLibraryOpen(false),projectId:project,recordId:selected,view:libraryView,workKey};
  useEffect(()=>{if(libraryView==='search')requestAnimationFrame(()=>window.document.getElementById('research-search-query')?.focus());},[libraryView]);
  useEffect(()=>{const handle=event=>{if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='k'){event.preventDefault();navigationRef.current.search();}if(event.key==='Escape')navigationRef.current.close();};addEventListener('keydown',handle);return()=>removeEventListener('keydown',handle);},[]);
  function prepareResearch(){const valid=!['questions','notebook','sources'].includes(libraryView) && record?.project_id===project && record.id===selected,anchor=currentReadingAnchor(project,record?.id,fromURL(),currentReadingPlace);setBriefAnchor(valid?{record,documentId:anchor.documentId,annotationId:anchor.annotationId}:{record:null,documentId:'',annotationId:''});showLibrary('assistant');}

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
  function open(id, nextProject = project, annotationId = '',documentId='',readingPosition=null) {
    const existing=workTabs.find(item=>item.key===JSON.stringify([nextProject,'record',id]));
    if(existing && !annotationId && !documentId){chooseWork(existing);return;}
    if(annotationId || documentId){const key=JSON.stringify([nextProject,id]);setReadingRequests(items=>({...items,[key]:(items[key] || 0)+1}));setCurrentReadingPlace(null);}
    const url = new URL(location.href); url.search = new URLSearchParams({ project: nextProject, ...(id ? { record: id } : {}), ...(annotationId ? { annotation: annotationId } : {}),...(documentId ? {document:documentId} : {}),...(Number.isInteger(readingPosition)&&readingPosition>=0?{position:String(readingPosition)}:{}) });
    history.pushState(null, '', url);setLibraryOpen(false);setNotebookEntryId('');setBriefAnchor(null);setNotebookAnchor(null); setLibraryView('');setSelected(id); setProject(nextProject); setSelectedAnnotation(annotationId);setSelectedDocument(documentId);setSelectedReadingPosition(readingPosition);
  }
  function openProject(id){open('',id);setLibraryView('sources');const url=new URL(location.href);url.searchParams.set('view','sources');history.replaceState(null,'',url);}
  function showLibrary(view,reference=null) {
    setLibraryOpen(false);
    const url=new URL(location.href);url.searchParams.set('project',project);url.searchParams.set('view',view);
    for(const key of ['chapter','ayah_start','ayah_end','resource_key','note_scope']) {if(reference?.[key]!=null)url.searchParams.set(key,reference[key]);else url.searchParams.delete(key);}
    setVerseReference(reference);if(view!=='notebook'){setNotebookEntryId('');url.searchParams.delete('entry_id');}
    history.pushState(null,'',url);setLibraryView(view);setReadingFocus(false);
  }
  function openGutenberg(bookId){setGutenbergVersion('');setGutenbergId(bookId);showLibrary('gutenberg');const url=new URL(location.href);url.searchParams.set('book_id',bookId);url.searchParams.delete('book_version');history.replaceState(null,'',url);}
  function openShelfTarget(target){
    if(target.reader==='document'){open(target.record_id,target.project_id,'',target.document_id,target.position);return;}
    surfaces.current?.capture();setLibraryOpen(false);setReadingFocus(false);setProject(target.project_id);
    const params={project:target.project_id};
    if(target.reader==='quran'){
      const ref={chapter:target.chapter,ayah_start:target.ayah,ayah_end:target.ayah,resource_key:target.resource_key};
      setVerseReference(ref);setLibraryView('quran');Object.assign(params,{view:'quran',...ref});
    }else{setGutenbergId(target.book_id);setGutenbergVersion(target.version);setLibraryView('gutenberg');Object.assign(params,{view:'gutenberg',book_id:target.book_id,book_version:target.version});}
    history.pushState(null,'','?'+new URLSearchParams(params));
  }
  function openShelfNote(note){
    if(note.item_kind!=='entry'){open(note.record_id,note.origin_project_id,note.annotation_id || '',note.document_id || '',note.reading_position);return;}
    surfaces.current?.capture();setProject(note.origin_project_id);setNotebookQuery('');setNotebookAnchor(null);setNotebookEntryId(note.id);setLibraryView('notebook');setLibraryOpen(false);
    history.pushState(null,'','?'+new URLSearchParams({project:note.origin_project_id,view:'notebook',entry_id:note.id}));
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
  function openNotebookEntry(entryId=''){setNotebookQuery('');setNotebookAnchor(null);setNotebookEntryId(entryId);showLibrary('notebook');const url=new URL(location.href);if(entryId)url.searchParams.set('entry_id',entryId);else url.searchParams.delete('entry_id');history.replaceState(null,'',url);}
  function showNotebook(withReading=false){setNotebookQuery(scope==='notebook'?query:'');setNotebookEntryId('');const anchor=currentReadingAnchor(project,record?.id,fromURL(),currentReadingPlace);setNotebookAnchor(withReading && record?.project_id===project && anchor.documentId?{project_id:project,record_id:record.id,document_id:anchor.documentId,annotation_id:anchor.annotationId || null}:null);showLibrary('notebook');}

  function createWorkspaceItem(type,source=null){
    setNotebookQuery('');setNotebookEntryId('');setNotebookAnchor(source?{project_id:project,record_id:source.id,document_id:libraryRows.find(row=>row.record_id===source.id)?.document_id || null,annotation_id:null}:null);
    setComposeIntent({type,id:crypto.randomUUID()});showLibrary(type==='question'?'questions':'notebook');
  }
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
  return <main onClickCapture={()=>surfaces.current?.capture()} className={`shell owner-shell atlas-workspace${isReading&&!libraryView?' is-reading':''}${libraryView==='notebook'?' is-notebook':''}${libraryView==='quran'?' is-quran':''}${libraryView ? ' has-library-view' : ''}${libraryOpen?' is-library-open':''}${sidebarHidden?' is-sidebar-collapsed':''}`}>
    <a className="skip-link" href="#workspace-view">Skip to workspace</a>
    <button ref={sidebarToggle} className="workspace-sidebar-toggle" aria-label="Show sidebar" aria-expanded={narrow?libraryOpen:!sidebarHidden&&!readingFocus} aria-controls="atlas-library" onClick={()=>{setSidebarHidden(false);setReadingFocus(false);setLibraryOpen(value=>!value);requestAnimationFrame(()=>document.querySelector('#atlas-library button')?.focus());}}>☰</button>
    {libraryOpen&&<button className="workspace-sidebar-scrim" aria-label="Close sidebar" onClick={closeSidebar}/>}

    {error && <div role="alert" className="workspace-alert"><p>{error}</p><button onClick={() => location.reload()}>Reconnect workspace</button><small>Export unsaved notes before reloading.</small></div>}
    <ResizablePanes storageKey="research:unified-sidebar-width-v1" className={`owner-panes atlas-body${readingFocus?' reading-focus':''}`} unit="px" minWidth={200} maxWidth={320} defaultWidth={240} label="Resize library and reading workspace">
      <aside ref={sidebar} id="atlas-library" className="atlas-library workspace-results" aria-label="Research library" onClick={event=>{if(matchMedia('(max-width:900px)').matches&&event.target.closest('[data-document-open]'))closeSidebar();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();closeSidebar();}}}>
        <div className="workspace-sidebar-top"><span className="workspace-wordmark">Atlas</span><button aria-label="Hide sidebar" onClick={()=>{setSidebarHidden(true);closeSidebar();}}>‹</button></div>
        <button className="workspace-sidebar-search" onClick={()=>showLibrary('search')} disabled={!project}>Search <kbd>⌘ K</kbd></button>
        <button className="workspace-sidebar-new" onClick={()=>createWorkspaceItem(libraryView==='questions'?'question':'note')} disabled={!project}>{libraryView==='questions'?'New question':'New note'}</button>
        <button className="workspace-sidebar-library" aria-current={libraryView==='shelf'?'page':undefined} onClick={()=>openWorkspace('shelf')}>Library</button>
        <ProjectDirectories api={api} projects={projects} current={project} onOpen={openProject} onCreated={row=>{setProjects(items=>[...items.filter(item=>item.id!==row.id),row]);openProject(row.id);}}><nav className="atlas-primary-nav" aria-label="Research workspace"><button aria-current={libraryView==='sources'||!libraryView?'page':undefined} onClick={()=>showLibrary('sources')}>Sources</button><button aria-current={libraryView==='questions'?'page':undefined} onClick={()=>openWorkspace('questions')}>Questions</button><button aria-current={libraryView==='notebook'?'page':undefined} onClick={()=>openWorkspace('notebook')}>Notes</button><button aria-current={libraryView==='quran'?'page':undefined} onClick={()=>openWorkspace('quran')}>Qur’an</button></nav><div ref={setNavigationHost} className="workspace-document-navigation"/></ProjectDirectories>
        <div hidden={!!libraryView&&libraryView!=='records'} className="atlas-content-library"><div className="atlas-library-tabs" role="group" aria-label="Library contents"><button aria-pressed={libraryMode==='readings'} onClick={()=>setLibraryMode('readings')}>Readings</button><button aria-pressed={libraryMode==='records'} onClick={()=>setLibraryMode('records')}>All research</button></div>
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
        </div>
        {workTabs.length>0&&<details className="workspace-recent" open={protectedWork.size?true:undefined}><summary>Open work{protectedWork.size?` · ${protectedWork.size} pending`:""}</summary>{workTabs.map(item=><button key={item.key} aria-current={item.key===workKey?'page':undefined} onClick={()=>chooseWork(item)}><span>{item.title}</span>{workStatuses[item.key]&&<small>{workStatuses[item.key]}</small>}</button>)}</details>}
        <footer className="workspace-sidebar-footer"><button onClick={prepareResearch} disabled={!project}>Research tools</button><details><summary>Workspace</summary><button onClick={()=>setTheme(theme==='dark'?'light':'dark')}>{theme==='dark'?'Light mode':'Dark mode'}</button><a href={`/publish.html?${new URLSearchParams({project})}`}>Publish research</a><a href="/">Public research ↗</a></details>{localPreview&&<details className="workspace-storage-status"><summary>Local · this Mac</summary><p>Saves on this Mac only. Hosted PostgreSQL and owner sign-in are not connected in this review.</p></details>}<small>Private · publishing is explicit</small></footer>
      </aside>
      <section inert={libraryOpen&&narrow?'':undefined} ref={reader} id="workspace-view" tabIndex={-1} className="workspace-reader atlas-reading-workspace" aria-label={libraryView==='notebook'?'Your notebook':'Selected record and private notes'}>
        <div hidden={libraryView!=='search'}>{project && <ResearchSearch key={project} api={api} projectId={project} onOpen={open} onOpenNotebook={openNotebookEntry} onClose={closeLibrary}/>}</div>
        <WorkspaceNavigation.Provider value={navigationHost}>
        <WorkingSurfaces ref={surfaces} activeKey={workKey} ready={workReady} protectedKeys={protectedWork} transientKey={project+':'+libraryView} openKeys={workTabs.map(item=>item.key)}>
        {libraryView && !['notebook','questions','sources','shelf'].includes(libraryView) && <div className="atlas-view-back"><button onClick={closeLibrary}>← Back to reading</button></div>}
        {libraryView==='shelf' ? <LibraryShelf api={api} projects={projects} projectId={project} onOpen={openShelfTarget} onOpenNote={openShelfNote} onFindBook={openGutenberg}/> : libraryView==='gutenberg' ? <Suspense fallback={<p role="status">Opening book…</p>}><GutenbergReader key={project+':'+gutenbergId} api={api} projectId={project} bookId={gutenbergId} version={gutenbergVersion} onTitle={title=>setEntryTitles(items=>({...items,[project+':gutenberg:'+gutenbergId]:title}))} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} noteEditor={passageNotes.current} onOpen={open} onOpenNotebook={row=>openNotebookEntry(row.id)} onBack={()=>showLibrary('sources')}/></Suspense> : libraryView==='quran' ? <QuranReader key={project} api={api} projectId={project} initialReference={verseReference} onLocation={quranLocationChanged} noteEditor={passageNotes.current} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onOpenNotebook={row=>openNotebookEntry(row.id)}/> : libraryView==='sources' ? <ResearchSources onFindBooks={()=>openWorkspace('shelf')} onOpenGutenberg={openGutenberg} api={api} projectId={project} readings={libraryRows} onOpen={open} onMoreReadings={libraryCursor?()=>loadLibrary(true):null} onAdd={()=>showLibrary('add-source')} onQuestion={source=>createWorkspaceItem('question',source)}/> : libraryView==='questions' ? <ResearchQuestions initialEntryId={notebookEntryId} onEntryChange={entryChanged} api={api} projectId={project} inlineSources noteEditor={passageNotes.current} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpenSource={open} anchor={notebookAnchorForProject(project,notebookAnchor)} composeRequest={composeIntent?.type==='question'?composeIntent.id:''} onComposeConsumed={()=>setComposeIntent(null)} projectTitle={projects.find(row=>row.id===project)?.title || ''}/> : libraryView==='search' ? null : libraryView==='assistant' ? selected && !effectiveBrief?<p role="status">Opening the source for your research question…</p>:<ResearchBrief key={JSON.stringify([project,effectiveBrief?.record?.id,effectiveBrief?.documentId,effectiveBrief?.annotationId])} api={api} projectId={project} record={effectiveBrief?.record || null} documentId={effectiveBrief?.documentId || ''} annotationId={effectiveBrief?.annotationId || ''} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpenNotebook={openNotebookEntry} onClose={closeLibrary}/> : libraryView==='collection-link' ? <CollectionReadingLink key={JSON.stringify([project,collectionReadingId,selectedDocument])} api={api} projectId={project} readingId={collectionReadingId} documentId={selectedDocument} sourceRecordId={selected} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onVerse={reference=>showLibrary('pilot',reference)}/> : libraryView==='notebook' ? <><ResearchNotebook onOpenQuran={reference=>showLibrary('quran',reference)} composeRequest={composeIntent?.type==='note'?composeIntent.id:''} onComposeConsumed={()=>setComposeIntent(null)} initialCollection="writing" inlineSources noteEditor={passageNotes.current} key={project+':'+notebookEntryId} projectTitle={projects.find(row=>row.id===project)?.title || ''} initialEntryId={notebookEntryId} onEntryChange={entryChanged} api={api} projectId={project} initialQuery={notebookQuery} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpenSource={open} anchor={notebookAnchorForProject(project,notebookAnchor)}/></> : libraryView==='collection-intake' && !collectionReading ? <section><p role="status">{collectionError || 'Loading the selected reading…'}</p><button onClick={()=>showLibrary('collection')}>Return to reading collection</button></section> : libraryView==='collection' ? <ReadingCollection api={api} initialAyah={fromURL().collection_ayah} onVerseChange={ayah=>{const url=new URL(location.href);url.searchParams.set('collection_ayah',ayah);history.replaceState(null,'',url);}} onChoose={chooseCollection} onOpenVerse={reference=>showLibrary('pilot',reference)} onClose={closeLibrary}/> : libraryView==='compare' ? <ReadingComparison key={JSON.stringify([project,comparison])} api={api} projectId={project} initialLeft={comparison.left} initialRight={comparison.right} onSelection={comparisonSelection} onOpen={open} onClose={closeLibrary}/> : ['add-source','article-pilot','collection-intake'].includes(libraryView) ? <AddSource key={project+libraryView} initialPreset={libraryView==='article-pilot' ? sirryPilotPreset : libraryView==='collection-intake' ? collectionReading || undefined : undefined} api={api} projectId={project} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onCancel={closeLibrary} onCreated={afterIntake} /> : libraryView==='pilot' ? <PilotReading key={JSON.stringify([project,verseReference])} initialReference={verseReference} api={api} projectId={project} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onOpen={open} onCancel={closeLibrary} /> : <>
          {!record ? <div className="workspace-empty atlas-empty-reading"><span className="atlas-kicker">A place to think</span><h1>{selected?'Opening your reading…':libraryLoading?'Finding your place…':'Start with a source. Follow a question.'}</h1><p>Read the text, keep your notes beside it, and explore its connections when you need them.</p>{!selected && project && <><button onClick={()=>showLibrary('quran')}>Read the Qur’an</button><button onClick={()=>showLibrary('collection')}>Browse starting readings</button><button onClick={()=>showLibrary('add-source')}>Add a source</button><button onClick={()=>showLibrary('search')}>Search your research</button></>}</div> : <>
            <header className="workspace-record-heading atlas-record-heading"><div><small>{record.kind} · {record.review_state}</small><h2 dir="auto">{record.title}</h2>{isReading&&<SaveToLibrary key={record.id+selectedDocument} api={api} source={record} documentId={selectedDocument}/>}</div>{entry && <button className="atlas-read-status" aria-pressed={entry.draft.reading==='read'} disabled={['saving','conflict'].includes(entry.status)} onClick={()=>edit({reading:entry.draft.reading==='read'?'reading':'read'},true)}>{entry.draft.reading==='read'?'Read by you':'Mark as read'}</button>}</header>

          {record.attributes?.quran_resource&&<button onClick={async()=>{const doc=selectedDocument?await api.request('reading/document',{project_id:project,document_id:selectedDocument}):null;const match=/^Q (\d+):(\d+)(?:–(\d+))?$/.exec(doc?.locator||'');showLibrary('quran',match?{chapter:Number(match[1]),ayah_start:Number(match[2]),ayah_end:Number(match[3]||match[2]),resource_key:record.attributes.quran_resource}:null);}}>← Continue in the Qur’an</button>}
          {['source','work','edition'].includes(record.kind) && <SourceReader key={JSON.stringify([record.id,selectedAnnotation,selectedDocument,readingRequests[JSON.stringify([project,record.id])] || 0])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} initialAnnotationId={selectedAnnotation} onOpenNotebook={row=>openNotebookEntry(row.id)} initialReadingPosition={selectedReadingPosition} initialDocumentId={selectedDocument} noteEditor={passageNotes.current} navigate={open} focused={readingFocus} onFocusChange={setReadingFocus} onReadingPlace={readingPlaceChanged} onOpenVerse={reference=>showLibrary('pilot',reference)} />}

            {isReading && <nav className="atlas-reading-context-actions" aria-label="Explore this reading"><button onClick={()=>compare()}>Compare</button><button onClick={()=>showNotebook(true)}>Note on this reading</button><button onClick={()=>createWorkspaceItem('question',record)}>Ask a research question</button></nav>}
            <details className="atlas-record-context" open={!isReading}><summary>{isReading?'Source details & connections':'Findings, evidence & connections'}</summary>          <p className="workspace-summary">{record.kind==='concept' && <small>Concept description</small>}{record.summary || 'No summary recorded yet.'}</p>
          {[['Citation', 'http://purl.org/dc/terms/bibliographicCitation'], ['Location', ir+'locator'], ['Scope', ir+'scope']].map(([label, key]) => property(record, key).length > 0 && <section className="workspace-context" key={key}><h3>{label}</h3>{property(record,key).map((text,i) => <p key={i}>{text}</p>)}</section>)}
          {property(record,'http://purl.org/dc/terms/source').filter(url => /^https?:\/\//i.test(url)).map(url => <a className="source-link" key={url} href={url} target="_blank" rel="noreferrer">Open source ↗</a>)}
          {(record.attributes?.recorded_review_status || []).map(text => <p className="workspace-review-scope" key={text}>{text}</p>)}
          {record.kind === 'question' && <EvidencePaths api={api} trail={trail} onOpen={open} onCompare={compare} />}
          <RecordContext key={record.project_id+record.id} api={api} record={record} onOpen={open} onCompare={compare}/>
          {record.kind === 'concept' && <ConceptPanel key={JSON.stringify([record.project_id,record.id])} record={record} api={api} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} navigate={open} />}
</details>
            <details className="atlas-record-notes"><summary>My reading notes & progress {entry && entry.status!=='saved'?`· ${statuses[entry.status]}`:''}</summary>          {entry && <section className="workspace-notes" aria-labelledby={"my-notes-heading-"+encodeURIComponent(JSON.stringify([project,record.id,libraryView]))}><h3 id={"my-notes-heading-"+encodeURIComponent(JSON.stringify([project,record.id,libraryView]))}>My reading & notes</h3>
            <label>Reading progress<select value={entry.draft.reading} onChange={e => edit({ reading: e.target.value }, true)}><option value="unread">Unread</option><option value="reading">Reading</option><option value="read">Read by me</option></select></label>
            {entry.server.read_at && <small>Read {new Date(entry.server.read_at).toLocaleDateString()}</small>}
            <div className="workspace-decisions">{[['relevant','Keep'],['not_relevant','Skip'],['read_later','Read later'],['unreviewed','Unscreened']].map(([decision,label]) => <button key={decision} aria-pressed={entry.draft.decision === decision} onClick={() => edit({ decision }, true)}>{label}</button>)}</div>
            <label htmlFor={"my-note-"+encodeURIComponent(JSON.stringify([project,record.id,libraryView]))}>Reading notes</label><textarea data-record-note="" id={"my-note-"+encodeURIComponent(JSON.stringify([project,record.id,libraryView]))} value={entry.draft.note} onChange={e => edit({ note: e.target.value })} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); store.current.save(record.id); } }} maxLength={10000} rows={9} placeholder="What did you learn? What needs more evidence?" />
            <div className="workspace-note-actions"><button disabled={['saved','saving','conflict'].includes(entry.status)} onClick={() => store.current.save(record.id)}>Save note</button><button onClick={exportNote}>Export Markdown</button><span role="status">{statuses[entry.status]}</span></div>
            <RecoverableDraft dirty={entry.draft.note!==entry.server.note} key={record.project_id+record.id+':record-note'} api={api} projectId={record.project_id} recordId={record.id} contextKind="record_note" body={entry.draft.note} baseRevision={entry.server.revision} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onRecover={value=>recoverRecordWriting(store.current,record,value)}/>
            <small>Notes save with the button or ⌘/Ctrl + Enter. Reading and screening choices save immediately. Markdown exports support the optional Obsidian connector; vault sync is explicit.</small>
            {entry.status === 'conflict' && <div className="workspace-conflict" role="alert"><h4>Both versions are safe to compare.</h4><p>Your draft is above. The cloud version is revision {entry.current.revision}, {entry.current.reading}, {entry.current.decision}.</p><pre>{entry.current.note || '(No note text)'}</pre><button onClick={() => store.current.resolve(record.id,'cloud')}>Use cloud version</button><button onClick={() => store.current.resolve(record.id,'draft')}>Save my draft over this revision</button><p>Previous cloud revisions remain in history.</p></div>}
          </section>}</details>
          </>}
        </>}
        {(!libraryView || libraryView==='records') && isReading && <ReadingPlace key={project+':reading'} api={api} projectId={project} place={currentReadingPlace?.project_id===project && currentReadingPlace.record_id===record?.id?currentReadingPlace:null} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onResume={open}/>}
        {libraryView==='sources' && <section className="atlas-reading-tools" aria-label="Reading tools"><h3>Reading tools</h3><nav><button disabled={!project} onClick={closeLibrary}>Resume reading</button><button disabled={!project} onClick={()=>compare()}>Compare readings</button><button disabled={!project} onClick={()=>showLibrary('collection')}>Reading collection & context</button><button disabled={!project} onClick={()=>showLibrary('quran')}>Read the Qur’an</button><button disabled={!project} onClick={()=>showLibrary('pilot')}>Verse import tools</button><button disabled={!project} onClick={()=>showLibrary('article-pilot')}>Read the Sirry article</button><button onClick={()=>{setLibraryMode('records');showLibrary('records');}}>All research</button></nav>{project && <ReadingPlace key={project} api={api} projectId={project} place={!libraryView && currentReadingPlace?.project_id===project && currentReadingPlace.record_id===record?.id?currentReadingPlace:null} drafts={readingDrafts} changed={()=>redraw(n=>n+1)} onResume={open}/>}</section>}
        </WorkingSurfaces>
        </WorkspaceNavigation.Provider>
      </section>
    </ResizablePanes>
  </main>;
}

createRoot(document.getElementById('root')).render(<Workspace />);
