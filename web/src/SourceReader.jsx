import {useSurfaceResume} from './surfaceActivity.js';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {readingVersionLabel} from './readingVersionLabel.js';
import { selectedPassage } from './passageSelection.js';
import ReadingAppearance from './ReadingAppearance.jsx';
import {readReadingPreferences,writeReadingPreferences,normalizeReadingPreferences,readingStyle} from './readingPreferences.js';
import {readingPosition,readingPointRect} from './readingPosition.js';
import ReadingNoteMarkers from './ReadingNoteMarkers.jsx';
import LocationMarginNotes from './LocationMarginNotes.jsx';
import {revealReadingPosition} from './readingPosition.js';
import SavedPassageNote from './SavedPassageNote.jsx';
import {readingMarks,verifyReadingCapture} from './readingMarks.js';
import ResizablePanes from './ResizablePanes.jsx';
import RecoverableDraft from './RecoverableDraft.jsx';
import {recoverPassageWriting} from './recoverIntoEditor.js';
import {finishReadingRecovery} from './useWritingRecovery.js';
import './sourceReader.css';
import './readerPresentation.css';
import './readingAppearance.css';

/** Edition-bound reading surface with saved inline marks and adjacent private notes. */
export default function SourceReader({ record, api, drafts, changed, noteEditor, navigate, initialAnnotationId = '',initialDocumentId='',initialReadingPosition=null,focused=false,onFocusChange,onOpenVerse,onReadingPlace,onBookmark,initialMarginOpen,onQuote,onOpenNotebook }) {
  const [appearance,setAppearance]=useState(()=>{try{return readReadingPreferences(window.localStorage);}catch{return normalizeReadingPreferences();}}),appearancePlace=useRef(null);
  const [snapshots,setSnapshots]=useState([]), [cursor,setCursor]=useState(null), [documentId,setDocumentId]=useState('');
  const [document,setDocument]=useState(null), [annotations,setAnnotations]=useState([]), [annotationCursor,setAnnotationCursor]=useState(null);
  const [message,setMessage]=useState(''), [highlight,setHighlight]=useState(null);
  const [activeAnnotation,setActiveAnnotation]=useState(''),[locationNotes,setLocationNotes]=useState([]),[activeLocation,setActiveLocation]=useState('');
  const [marginOpen,setMarginOpen]=useState(()=>initialMarginOpen ?? window.matchMedia('(min-width: 901px)').matches),marginId=useId(),headingId=useId();
  const [selectionPreview,setSelectionPreview]=useState(null),[annotationTools,setAnnotationTools]=useState(false),[loadingSnapshots,setLoadingSnapshots]=useState(true),[recoveryOpen,setRecoveryOpen]=useState(false);
  useEffect(()=>{
    function inspectSelection(){try{setSelectionPreview(textRoot.current ? selectedPassage(textRoot.current,window.getSelection()) : null);}catch{setSelectionPreview(null);}}
    window.document.addEventListener('selectionchange',inspectSelection);
    return()=>window.document.removeEventListener('selectionchange',inspectSelection);
  },[]);
  const textRoot=useRef(null), mark=useRef(null), alive=useRef(true), currentDocument=useRef('');
  const margin=useRef(null), composer=useRef(null), freeComposer=useRef(null);
  function changeAppearance(next){const root=textRoot.current,position=root?readingPosition(root):0;appearancePlace.current=root?{position,top:readingPointRect(root,position)?.top}:null;const clean=normalizeReadingPreferences(next);setAppearance(clean);try{writeReadingPreferences(window.localStorage,clean);}catch{/* Presentation remains available without storage. */}}
  useLayoutEffect(()=>{const place=appearancePlace.current,root=textRoot.current;appearancePlace.current=null;if(!place||!root||place.top==null)return;
    const rect=readingPointRect(root,place.position);if(!rect)return;const delta=rect.top-place.top;
    if(root.scrollHeight>root.clientHeight)root.scrollTop+=delta;else {const container=root.closest('[data-contained-reader],.workspace-reader');if(container)container.scrollTop+=delta;else window.scrollBy({top:delta});}
  },[appearance]);
  useEffect(()=>{const sync=event=>{if(event.key==='research:reading-appearance:v1'){try{changeAppearance(readReadingPreferences(window.localStorage));}catch{}}};window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);},[]);
  useSurfaceResume(()=>{try{const next=readReadingPreferences(window.localStorage);if(JSON.stringify(next)!==JSON.stringify(appearance))changeAppearance(next);}catch{}});
  function turnPage(direction){const root=textRoot.current;if(root)root.scrollBy({top:direction*Math.max(1,root.clientHeight-parseFloat(getComputedStyle(root).lineHeight)),behavior:'instant'});}
  const requestedAnchor=useRef(null);
  const importKey=`import:${record.id}`, captureKey=`capture:${documentId}`;
  useEffect(()=>{onReadingPlace?.(document ? {project_id:record.project_id,record_id:record.id,document_id:document.id,annotation_id:activeAnnotation || null} : null,{projectId:record.project_id,recordId:record.id});return()=>onReadingPlace?.(null,{projectId:record.project_id,recordId:record.id});},[document?.id,record.id,activeAnnotation,onReadingPlace]);
  useSurfaceResume(()=>onReadingPlace?.(document ? {project_id:record.project_id,record_id:record.id,document_id:document.id,annotation_id:activeAnnotation || null}:null,{projectId:record.project_id,recordId:record.id}));
  useEffect(()=>{if(document?.id===initialDocumentId&&Number.isInteger(initialReadingPosition))requestAnimationFrame(()=>revealReadingPosition(textRoot.current,initialReadingPosition));},[document?.id,initialDocumentId,initialReadingPosition]);
  const importDraft=drafts.current.get(importKey) || { edition:'',locator:'',representation_url:'',text:'',saving:false };
  const capture=drafts.current.get(captureKey);
  useEffect(()=>{
    alive.current=true;setLoadingSnapshots(true);
    api.request('reading/documents',{ project_id:record.project_id,source_record_id:record.id }).then(async data=>{
      let requested=null;
      if(initialAnnotationId) {
        try { requested=await api.request('reading/annotation',{ project_id:record.project_id,annotation_id:initialAnnotationId }); }
        catch(error) { if(alive.current) setMessage('The requested passage could not be opened. Select a saved version or check its link.'); }
      }
      if (!alive.current) return;
      requestedAnchor.current=requested;
      setSnapshots(data.items); setCursor(data.next_cursor);
      const retained=[...drafts.current.values()].find(d=>d.sourceRecordId===record.id && d.documentId);
      setDocumentId(requested?.annotation.document_id || initialDocumentId || retained?.documentId || noteEditor.documentForSource(record.project_id,record.id) || data.items[0]?.id || '');
    }).catch(error=>{ if(alive.current) setMessage(error.message); }).finally(()=>{if(alive.current)setLoadingSnapshots(false);});
    return ()=>{ alive.current=false; };
  },[record.id]);
  useEffect(()=>{
    let active=true; currentDocument.current=documentId; setDocument(null);setLocationNotes([]);setActiveLocation(''); setAnnotations([]); setHighlight(null);setActiveAnnotation('');setSelectionPreview(null);setAnnotationTools(false);
    if (!documentId) return;
    Promise.all([api.request('reading/document',{ project_id:record.project_id,document_id:documentId }),
      api.request('reading/annotations',{ project_id:record.project_id,document_id:documentId })]).then(([value,notes])=>{
      if(!active) return;
      if(value.project_id!==record.project_id || value.source_record_id!==record.id) {
        setMessage('This passage belongs to another source. Its text was not opened under this record.'); return;
      }
      setDocument(value); setAnnotations(notes.items); setAnnotationCursor(notes.next_cursor);
      setSnapshots(rows=>rows.some(r=>r.id===value.id) ? rows : [...rows,value]);
      const retained=drafts.current.get(`capture:${documentId}`), requested=requestedAnchor.current;
      if(requested?.annotation.document_id===value.id) {
        if(requested.anchor.anchored) {
          const target=requested.annotation;
          if(target.project_id!==record.project_id || target.document_id!==value.id || target.text_sha256!==value.text_sha256) throw new Error('The saved passage did not match this reading version.');
          setAnnotations(rows=>rows.some(row=>row.id===target.id) ? rows : [...rows,target]);
          setActiveAnnotation(target.id);setHighlight(requested.anchor);setMessage(target.trashed?'This margin writing is in Trash. Its source anchor is retained; restore it before editing.':'Opened the saved source version and exact passage.');
          requestAnimationFrame(()=>revealMark());
        }
        else setMessage('The requested passage needs anchor review. Its position was not changed.');
      } else if(retained) setHighlight(retained);
    }).catch(error=>{ if(active) setMessage(error.message); });
    return ()=>{ active=false; };
  },[documentId]);
  function remember(key,value) { drafts.current.set(key,{...value,sourceRecordId:record.id,projectId:record.project_id,documentId}); changed(); }
  function revealMark(){const element=mark.current,pane=element?.closest('[data-contained-reader]');if(pane){pane.scrollTop+=element.getBoundingClientRect().top-pane.getBoundingClientRect().top-90;}else element?.scrollIntoView({block:'nearest'});}
  function bookmark(annotationId,snapshotId=documentId) {
    if(onBookmark){onBookmark({project_id:record.project_id,record_id:record.id,document_id:snapshotId,annotation_id:annotationId || ''});return;}
    const url=new URL(window.location.href);
    url.searchParams.set('project',record.project_id);url.searchParams.set('record',record.id);url.searchParams.set('document',snapshotId);
    if(annotationId)url.searchParams.set('annotation',annotationId);else url.searchParams.delete('annotation');
    window.history.replaceState(null,'',url);
  }
  function forget(key) { drafts.current.delete(key); changed(); }
  function recoverCapture(value){
    if(value.project_id!==record.project_id || value.record_id!==record.id || value.document_id!==document?.id || value.text_sha256!==document?.text_sha256 || capture?.saving || capture?.submitted){setMessage('Confirm the pending passage save before recovering different writing.');return false;}
    if(value.existing_annotation){
      if(!recoverPassageWriting(noteEditor,record,value)){setMessage('Finish or discard changes in that saved passage’s editor, then inspect this recovery copy again.');return false;}
      const row=value.existing_annotation;forget(captureKey);setAnnotations(old=>[row,...old.filter(item=>item.id!==row.id)]);setActiveAnnotation(row.id);setHighlight({start:row.start_pos,end:row.end_pos});bookmark(row.id);return true;
    }
    const restored={start:value.start,end:value.end,exact:value.exact,capture_kind:value.capture_kind,body:value.body,mark_style:value.mark_style,
      annotation_uuid:value.annotation_uuid,documentId:document.id,sourceRecordId:record.id,saving:false};
    remember(captureKey,restored);setHighlight(restored);setActiveAnnotation('');setMarginOpen(true);setMessage('Recovered private writing. Review it before saving the actual passage note.');return true;
  }
  function editImport(patch) { remember(importKey,{...importDraft,...patch}); }
  async function importText(event) {
    event.preventDefault(); if(importDraft.saving) return;
    const sent={...importDraft}; remember(importKey,{...sent,saving:true}); setMessage('Saving private excerpt…');
    try {
      const value=await api.post('reading/documents',{ project_id:record.project_id,source_record_id:record.id,
        edition:sent.edition,locator:sent.locator,representation_url:sent.representation_url,text:sent.text });
      forget(importKey);
      if(alive.current) { setSnapshots(rows=>[value,...rows.filter(r=>r.id!==value.id)]); setDocumentId(value.id);bookmark('',value.id);setMessage('Private reading excerpt saved.'); }
    } catch(error) { remember(importKey,{...sent,saving:false}); if(alive.current) setMessage(error.message); }
  }
  function select(markStyle='highlight') {
    if(!document || document.id!==documentId || capture?.saving) return;
    try {
      const selected=selectedPassage(textRoot.current,window.getSelection());
      if(!selected) { setMessage('Select a word or passage in the excerpt first.'); return; }
      if(capture && (capture.start!==selected.start || capture.end!==selected.end)) {
        setMessage('Your current passage note is still here. Save or discard it before marking another passage.');
        composer.current?.focus();return;
      }
      if(capture?.submitted) {setMessage('Retry or discard the original submitted note before changing its mark.');return;}
      const value={...selected,annotation_uuid:capture?.annotation_uuid || crypto.randomUUID(),body:capture?.body || '',capture_kind:capture?.capture_kind || 'comment',
        mark_style:markStyle,documentId:document.id,sourceRecordId:record.id,saving:false};
      remember(captureKey,value); setHighlight(value);setActiveAnnotation('');setMarginOpen(true);setMessage('Write in the margin. Save with the button or ⌘/Ctrl + Enter.');
      setAnnotationTools(false);setSelectionPreview(null);window.getSelection()?.removeAllRanges();
      requestAnimationFrame(()=>{composer.current?.focus();composer.current?.scrollIntoView({block:'nearest'});});
    } catch(error) { setMessage(error.message); }
  }
  async function saveCapture() {
    if(!capture || capture.saving || !document || document.id!==documentId) return;
    const key=captureKey,sent={...capture},snapshot=document;
    const payload=sent.submitted || { annotation_uuid:sent.annotation_uuid,project_id:record.project_id,
      document_id:snapshot.id,text_sha256:snapshot.text_sha256,start:sent.start,end:sent.end,exact:sent.exact,
      capture_kind:sent.capture_kind,body:sent.body,mark_style:sent.mark_style || 'highlight' };
    remember(key,{...sent,saving:true,submitted:payload}); setMessage('Saving selected passage…');
    try {
      const value=verifyReadingCapture(await api.post('reading/annotations',payload),payload);
      finishReadingRecovery(drafts.current,{projectId:record.project_id,recordId:record.id,documentId:snapshot.id,captureUUID:payload.annotation_uuid});
      forget(key);
      if(alive.current && currentDocument.current===snapshot.id) { setAnnotations(rows=>[value,...rows.filter(r=>r.id!==value.id)]);setActiveAnnotation(value.id);setHighlight({start:value.start_pos,end:value.end_pos});bookmark(value.id,snapshot.id);setMessage('Passage and margin note saved to your private workspace.'); }
    } catch(error) {
      const rejected=[400,413,422].includes(error.status) && !sent.submitted;
      remember(key,{...sent,saving:false,submitted:rejected ? null : payload});
      if(alive.current) setMessage(error.status===409 ? 'This capture ID is already saved with another version. Your draft remains here; inspect the saved annotations before retrying.' : error.message);
    }
  }
  async function reopen(row,exportFile=false) {
    try {
      const value=await api.request('reading/annotation',{ project_id:record.project_id,annotation_id:row.id });
      if(!alive.current) return;
      if(!exportFile && currentDocument.current!==row.document_id) { setMessage('The reading version changed. Reopen this note from its saved version.'); return; }
      if(exportFile) {
        const url=URL.createObjectURL(new Blob([JSON.stringify(value.web_annotation,null,2)],{ type:'application/ld+json' }));
        const link=window.document.createElement('a'); link.href=url; link.download='private-research-annotation.jsonld'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
      } else if(value.anchor.anchored) {
        if(value.annotation.id!==row.id || value.annotation.project_id!==record.project_id || value.annotation.document_id!==documentId || value.annotation.text_sha256!==document.text_sha256) throw new Error('The passage response did not match this source version.');
        setActiveAnnotation(row.id);setHighlight(value.anchor);bookmark(row.id);requestAnimationFrame(()=>{revealMark();textRoot.current?.focus({preventScroll:true});});
      }
      else setMessage(`Passage needs review: ${value.anchor.status.replaceAll('_',' ')}. Its position was not changed.`);
    } catch(error) { if(alive.current) setMessage(error.message); }
  }
  async function moreSnapshots() {
    try { const value=await api.request('reading/documents',{ project_id:record.project_id,source_record_id:record.id,cursor });
      if(alive.current) { setSnapshots(rows=>[...new Map([...rows,...value.items].map(row=>[row.id,row])).values()]); setCursor(value.next_cursor); }
    } catch(error) { if(alive.current) setMessage(error.message); }
  }
  async function moreAnnotations() {
    try { const value=await api.request('reading/annotations',{ project_id:record.project_id,document_id:documentId,cursor:annotationCursor });
      if(alive.current && currentDocument.current===documentId) { setAnnotations(rows=>[...new Map([...rows,...value.items].map(row=>[row.id,row])).values()]); setAnnotationCursor(value.next_cursor); }
    } catch(error) { if(alive.current) setMessage(error.message); }
  }
  async function refreshAnnotations() {
    try { const value=await api.request('reading/annotations',{ project_id:record.project_id,document_id:documentId });
      if(alive.current && currentDocument.current===documentId) { setAnnotations(value.items); setAnnotationCursor(value.next_cursor); }
    } catch(error) { if(alive.current) setMessage(error.message); }
  }
  function openMargin(ids) {
    if(!window.getSelection()?.isCollapsed) return;
    const index=ids.indexOf(activeAnnotation),id=ids[(index+1)%ids.length],row=annotations.find(item=>item.id===id);
    if(!row) return;
    noteEditor.adopt(row,record.id);setActiveLocation('');setActiveAnnotation(id);setMarginOpen(true);setHighlight({start:row.start_pos,end:row.end_pos});bookmark(id);
    requestAnimationFrame(()=>{
      const card=[...(margin.current?.querySelectorAll('[data-annotation-id]') || [])].find(item=>item.dataset.annotationId===id);
      card?.scrollIntoView({block:'nearest'});(card?.querySelector('textarea') || card)?.focus({preventScroll:true});
    });
  }
  const belongs=row=>row.project_id===record.project_id && row.document_id===documentId;
  const saved=annotations.filter(belongs).map(row=>({...noteEditor.adopt(row,record.id).server,trashed:row.trashed || false,trash_revision:row.trash_revision || 0})).sort((a,b)=>a.start_pos-b.start_pos || a.end_pos-b.end_pos || a.id.localeCompare(b.id));
  const isWriting=row=>row.body.trim() || (row.mark_style || 'highlight')!=='none' || row.capture_kind!=='comment' || noteEditor.entries.get(row.id)?.open || noteEditor.entries.get(row.id)?.status!=='saved' || activeAnnotation===row.id;
  const writingNotes=saved.filter(isWriting),sourceAnchors=saved.filter(row=>!isWriting(row));
  const marked=document ? readingMarks(document,saved.filter(row=>!row.trashed),highlight) : {runs:[],unanchored:[]};
  const pendingRecovery=document && [...drafts.current.values()].some(value=>value?.sent?.document_id===document.id && (value.saving || value.error || value.current));
  const pendingSavedNote=saved.some(row=>{const entry=noteEditor.adopt(row,record.id);return entry.pending || entry.current || entry.status==='error' || entry.status==='conflict';});
  useEffect(()=>{if(capture || pendingRecovery || pendingSavedNote)setMarginOpen(true);},[document?.id,!!capture,pendingRecovery,pendingSavedNote]);
  const importForm=<details className="reader-import" open={!loadingSnapshots && !snapshots.length || importDraft.saving || !!importDraft.text}><summary>{document ? 'Add another excerpt or edition' : 'Add text to read here'}</summary><form onSubmit={importText}>
      <label>Edition / version<input required value={importDraft.edition} disabled={importDraft.saving} maxLength={1000} onChange={e=>editImport({edition:e.target.value})} placeholder="Identify the edition or translation you are reading" /></label>
      <label>Location covered<input required value={importDraft.locator} disabled={importDraft.saving} maxLength={2000} onChange={e=>editImport({locator:e.target.value})} placeholder="Abstract, section, page, or verse" /></label>
      <label>Original source URL (optional)<input type="url" value={importDraft.representation_url} disabled={importDraft.saving} maxLength={2000} onChange={e=>editImport({representation_url:e.target.value})} /></label>
      <label>Plain-text excerpt<textarea required value={importDraft.text} disabled={importDraft.saving} maxLength={12000} rows={7} onChange={e=>editImport({text:e.target.value})} /></label>
      <small>Up to 12,000 characters. Imported text stays private and is not marked as verified scholarship.</small>
      <div><button disabled={importDraft.saving}>{importDraft.saving ? 'Saving…' : 'Save private excerpt'}</button><button type="button" disabled={importDraft.saving} onClick={()=>forget(importKey)}>Discard import draft</button></div>
    </form></details>;
  return <section className="source-reader" style={readingStyle(appearance)} data-reading-theme={appearance.theme} data-reading-flow={appearance.mode} aria-labelledby={headingId} aria-busy={loadingSnapshots || (!!documentId && !document)}>
    <div className="reader-heading-row"><h3 id={headingId}>Source text</h3><div className="reader-view-actions">
      {onFocusChange && <button className="reader-focus" aria-pressed={!focused} onClick={()=>onFocusChange(!focused)}>Library</button>}
      <button className="reader-margin-toggle" aria-expanded={marginOpen} aria-controls={marginId} onClick={()=>setMarginOpen(!marginOpen)}>Notes</button><ReadingAppearance value={appearance} onChange={changeAppearance}/>
    </div></div>
    {loadingSnapshots && !document && <p className="reader-help" role="status">Opening your reading…</p>}
    {document && <>
      {message && <p className="reader-message" role="status">{message}</p>}
      {marked.unanchored.length>0 && <p className="reader-message" role="status">{marked.unanchored.length} saved note(s) need anchor review. Their marks were not moved to other text.</p>}
      {annotations.some(row=>!belongs(row)) && <p className="reader-message" role="status">A returned note did not match this source version and was not displayed. Refresh saved notes to retry.</p>}
      <ResizablePanes className={`reader-desk${marginOpen ? '' : ' is-margin-collapsed'}`} storageKey="research:reader-margin-width-v2" minWidth={50} maxWidth={82} defaultWidth={72} label="Resize source text and margin notes">
        <div className="reader-page">
          <div className="reader-toolbar" role="group" aria-label="Passage annotation tools" hidden={!selectionPreview && !annotationTools}>
            <span className="reader-selection-label">{selectionPreview ? `${Array.from(selectionPreview.exact).length} characters selected` : 'Select a word or passage'}</span>
            <button className="reader-select" onPointerDown={e=>e.preventDefault()} onClick={()=>select('highlight')} disabled={capture?.saving}>Annotate selected text</button>
            <button className="reader-underline" onPointerDown={e=>e.preventDefault()} onClick={()=>select('underline')} disabled={capture?.saving}>Underline</button>
            <button className="reader-note-only" onPointerDown={e=>e.preventDefault()} onClick={()=>select('none')} disabled={capture?.saving}>Margin note</button>
            {onQuote && <button onPointerDown={e=>e.preventDefault()} disabled={!selectionPreview} onClick={()=>onQuote({document,selection:selectionPreview})}>Quote in notebook</button>}
          </div>
          <div className="reader-text-wrap"><ReadingNoteMarkers textRoot={textRoot} notes={locationNotes} layoutKey={JSON.stringify(appearance)} documentId={document.id} activeId={activeLocation} onOpen={ids=>{const i=ids.indexOf(activeLocation),id=ids[(i+1)%ids.length];setActiveLocation(id);setActiveAnnotation('');setHighlight(null);setMarginOpen(true);requestAnimationFrame(()=>freeComposer.current?.open(id));}}/>
          <div ref={textRoot} className="reader-text" dir="auto" tabIndex={0} aria-label="Source excerpt" onKeyDown={event=>{
          if(appearance.mode==='pages'&&['PageDown','PageUp'].includes(event.key)){event.preventDefault();turnPage(event.key==='PageDown'?1:-1);}
          if(event.altKey && event.key.toLowerCase()==='n') {event.preventDefault();if(window.getSelection()?.isCollapsed){setMarginOpen(true);requestAnimationFrame(()=>freeComposer.current?.focus());}else select('none');}
        }}>{marked.runs.map(run=>run.ids.length || run.selected ? <mark key={run.start} ref={run.selected && (!highlight || run.start===highlight.start) ? mark : null}
          className={`${run.highlight ? 'has-highlight ' : ''}${run.underline ? 'has-underline ' : ''}${run.selected ? 'is-selected ' : ''}${run.ids.length>1 ? 'has-overlap' : ''}`}
          {...(run.ids.length ? {role:'button',tabIndex:0,'aria-label':`${run.text} — ${run.ids.length===1 ? 'open margin note' : `${run.ids.length} margin notes; activate to cycle`}`,'aria-pressed':run.ids.includes(activeAnnotation),
            onClick:()=>openMargin(run.ids),onKeyDown:event=>{if(event.key==='Enter' || event.key===' ') {event.preventDefault();openMargin(run.ids);}}} : {})}>{run.text}</mark> : run.text)}</div></div>
          {appearance.mode==='pages'&&<nav className="reading-page-steps" aria-label="Reading pages"><button onClick={()=>turnPage(-1)}>← Previous screen</button><button onClick={()=>turnPage(1)}>Next screen →</button></nav>}
          <p className="reader-selection-hint">Select text to annotate · Alt + N to write a note <button className="reader-annotation-toggle" aria-expanded={!!selectionPreview || annotationTools} onClick={()=>setAnnotationTools(!annotationTools)}>Annotation tools</button></p>
          <details className="reader-edition-details"><summary>Source information · {readingVersionLabel(document)}</summary>
            <label className="reader-version">Reading version<select value={documentId} onChange={e=>{requestedAnchor.current=null;setDocumentId(e.target.value);bookmark('',e.target.value);}}>{snapshots.map(d=><option key={d.id} value={d.id}>{d.edition} · {d.locator} · {d.text_sha256.slice(0,8)}{drafts.current.has(`capture:${d.id}`) ? ' · draft' : ''}</option>)}</select></label>{cursor && <button onClick={moreSnapshots}>More saved excerpts</button>}
            <p>{document.edition}</p><p>{document.locator}</p><p>{document.review_scope}</p>
            {document.representation_url && <a href={document.representation_url} target="_blank" rel="noopener noreferrer">Open original source ↗</a>}
            {document.source_notice && <div className="reader-source-notice"><h4>Source notice & attribution</h4><pre dir="auto">{document.source_notice}</pre></div>}
            {importForm}
          </details>
        </div>
        <aside ref={margin} id={marginId} hidden={!marginOpen} className="reader-margin" aria-label="Passage margin notes" onKeyDown={event=>{if(!event.defaultPrevented && event.key==='Escape' && window.matchMedia('(max-width: 900px)').matches){event.preventDefault();event.stopPropagation();setMarginOpen(false);textRoot.current?.closest('.source-reader')?.querySelector('.reader-margin-toggle')?.focus();}}}>
          <div className="reader-margin-heading"><h4>Notes</h4><button className="reader-refresh" onClick={refreshAnnotations}>Refresh saved notes</button><button className="reader-margin-close" aria-label="Close margin notes" onClick={()=>setMarginOpen(false)}>×</button></div>
          <LocationMarginNotes key={document.id} api={api} record={record} document={document} textRoot={textRoot} drafts={drafts} changed={changed} composerRef={freeComposer} onOpenNotebook={onOpenNotebook} navigate={navigate} onLocations={setLocationNotes} activeId={activeLocation}/>

          {!capture && <details className="reader-recovery-disclosure" open={recoveryOpen || pendingRecovery} onToggle={event=>setRecoveryOpen(event.currentTarget.open)}><summary>Recover unfinished writing</summary><RecoverableDraft key={document.id+':capture-finder'} api={api} projectId={record.project_id} recordId={record.id} contextKind="capture" document={document} body="" drafts={drafts} changed={changed} onRecover={recoverCapture}/></details>}
          {capture && <div className="reader-capture"><h4>In the margin</h4><blockquote dir="auto">{capture.exact}</blockquote>
            <label>Passage mark<select value={capture.mark_style || 'highlight'} disabled={capture.saving || !!capture.submitted} onChange={e=>remember(captureKey,{...capture,mark_style:e.target.value})}><option value="highlight">Highlight</option><option value="underline">Underline</option><option value="none">Margin note only</option></select></label>
            <label>My passage note<textarea ref={composer} value={capture.body} disabled={capture.saving || !!capture.submitted} rows={5} maxLength={10000} onChange={e=>remember(captureKey,{...capture,body:e.target.value})}
              placeholder="Your thought, question, or disagreement…" onKeyDown={event=>{if((event.metaKey || event.ctrlKey) && event.key==='Enter') {event.preventDefault();saveCapture();}}} /></label>
            <label>Capture as<select value={capture.capture_kind} disabled={capture.saving || !!capture.submitted} onChange={e=>remember(captureKey,{...capture,capture_kind:e.target.value})}><option value="comment">Reading note</option><option value="term_candidate">Term to investigate</option><option value="citation_candidate">Scripture reference to check</option></select></label>
            <div><button onClick={saveCapture} disabled={capture.saving}>{capture.saving ? 'Saving…' : capture.submitted ? 'Retry original save' : 'Save passage note'}</button><button disabled={capture.saving} onClick={()=>{finishReadingRecovery(drafts.current,{projectId:record.project_id,recordId:record.id,documentId:document.id,captureUUID:capture.annotation_uuid});forget(captureKey);setHighlight(null);}}>Discard selection draft</button></div>
            <RecoverableDraft dirty key={document.id+':'+capture.start+':'+capture.end} api={api} projectId={record.project_id} recordId={record.id} contextKind="capture" document={document} selection={capture} body={capture.body} markStyle={capture.mark_style || 'highlight'} drafts={drafts} changed={changed} onRecover={recoverCapture}/>
            {capture.submitted && !capture.saving && <small>The response was not confirmed. Retry sends the original note and ID, so it cannot create a second note. Discarding removes this local draft; a committed note may still exist in the cloud. Refresh saved notes to check.</small>}
            <small>Your note stays attached to this exact source version. Capturing it does not create a reviewed claim.</small></div>}
          <div className="reader-annotations"><h4 className="reader-saved-heading">Saved passage notes</h4>
            {writingNotes.map(row=><SavedPassageNote key={row.id} row={row} sourceId={record.id} document={document} editor={noteEditor} reopen={reopen} api={api} drafts={drafts} changed={changed} navigate={navigate} onOpenVerse={onOpenVerse} onTrashChange={result=>setAnnotations(rows=>rows.map(item=>item.id===result.target_id?{...item,trashed:result.state==='trashed',trash_revision:result.revision}:item))} active={activeAnnotation===row.id} />)}
            {sourceAnchors.length>0 && <details className="reader-source-anchors"><summary>Linked source passages · {sourceAnchors.length}</summary><p>These passages anchor source connections. They do not contain a personal note yet.</p>{sourceAnchors.map(row=><SavedPassageNote key={row.id} row={row} sourceId={record.id} document={document} editor={noteEditor} reopen={reopen} api={api} drafts={drafts} changed={changed} navigate={navigate} onOpenVerse={onOpenVerse} onTrashChange={result=>setAnnotations(rows=>rows.map(item=>item.id===result.target_id?{...item,trashed:result.state==='trashed',trash_revision:result.revision}:item))} active={activeAnnotation===row.id} />)}</details>}
            {annotationCursor && <><p className="reader-help">More notes exist. Load them to see their marks in the text.</p><button onClick={moreAnnotations}>More passage notes</button></>}</div>
        </aside>
      </ResizablePanes>
    </>}
    {!document && !loadingSnapshots && <div className="reader-empty-state"><h4>{snapshots.length ? 'Open a reading version' : 'This source needs a reading excerpt.'}</h4><p>Save a short, located excerpt with its edition to begin reading and taking passage notes. Your source record is preserved.</p>{importForm}</div>}
    {!document && message && <p className="reader-message" role="status">{message}</p>}
  </section>;
}
