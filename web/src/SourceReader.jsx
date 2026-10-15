import React, { useEffect, useId, useRef, useState } from 'react';
import { selectedPassage } from './passageSelection.js';
import SavedPassageNote from './SavedPassageNote.jsx';
import {readingMarks,verifyReadingCapture} from './readingMarks.js';
import ResizablePanes from './ResizablePanes.jsx';
import './sourceReader.css';

/** Edition-bound reading surface with saved inline marks and adjacent private notes. */
export default function SourceReader({ record, api, drafts, changed, noteEditor, navigate, initialAnnotationId = '',initialDocumentId='',focused=false,onFocusChange }) {
  const [snapshots,setSnapshots]=useState([]), [cursor,setCursor]=useState(null), [documentId,setDocumentId]=useState('');
  const [document,setDocument]=useState(null), [annotations,setAnnotations]=useState([]), [annotationCursor,setAnnotationCursor]=useState(null);
  const [message,setMessage]=useState(''), [highlight,setHighlight]=useState(null);
  const [activeAnnotation,setActiveAnnotation]=useState('');
  const [marginOpen,setMarginOpen]=useState(true),marginId=useId();
  const textRoot=useRef(null), mark=useRef(null), alive=useRef(true), currentDocument=useRef('');
  const margin=useRef(null), composer=useRef(null);
  const requestedAnchor=useRef(null);
  const importKey=`import:${record.id}`, captureKey=`capture:${documentId}`;
  const importDraft=drafts.current.get(importKey) || { edition:'',locator:'',representation_url:'',text:'',saving:false };
  const capture=drafts.current.get(captureKey);
  useEffect(()=>{
    alive.current=true;
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
    }).catch(error=>{ if(alive.current) setMessage(error.message); });
    return ()=>{ alive.current=false; };
  },[record.id]);
  useEffect(()=>{
    let active=true; currentDocument.current=documentId; setDocument(null); setAnnotations([]); setHighlight(null);setActiveAnnotation('');
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
          setActiveAnnotation(target.id);setHighlight(requested.anchor);setMessage('Opened the saved source version and exact passage.');
          requestAnimationFrame(()=>mark.current?.scrollIntoView({block:'nearest'}));
        }
        else setMessage('The requested passage needs anchor review. Its position was not changed.');
      } else if(retained) setHighlight(retained);
    }).catch(error=>{ if(active) setMessage(error.message); });
    return ()=>{ active=false; };
  },[documentId]);
  function remember(key,value) { drafts.current.set(key,value); changed(); }
  function bookmark(annotationId,snapshotId=documentId) {
    const url=new URL(window.location.href);
    url.searchParams.set('project',record.project_id);url.searchParams.set('record',record.id);url.searchParams.set('document',snapshotId);
    if(annotationId)url.searchParams.set('annotation',annotationId);else url.searchParams.delete('annotation');
    window.history.replaceState(null,'',url);
  }
  function forget(key) { drafts.current.delete(key); changed(); }
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
      const value={...selected,annotation_uuid:crypto.randomUUID(),body:capture?.body || '',capture_kind:capture?.capture_kind || 'comment',
        mark_style:markStyle,documentId:document.id,sourceRecordId:record.id,saving:false};
      remember(captureKey,value); setHighlight(value);setActiveAnnotation('');setMarginOpen(true);setMessage('Write in the margin. Save with the button or ⌘/Ctrl + Enter.');
      window.getSelection()?.removeAllRanges();
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
        setActiveAnnotation(row.id);setHighlight(value.anchor);bookmark(row.id);requestAnimationFrame(()=>{mark.current?.scrollIntoView({block:'nearest'});textRoot.current?.focus({preventScroll:true});});
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
    noteEditor.adopt(row,record.id);noteEditor.open(id);setActiveAnnotation(id);setMarginOpen(true);setHighlight({start:row.start_pos,end:row.end_pos});bookmark(id);
    requestAnimationFrame(()=>{
      const card=[...(margin.current?.querySelectorAll('[data-annotation-id]') || [])].find(item=>item.dataset.annotationId===id);
      card?.scrollIntoView({block:'nearest'});card?.querySelector('textarea')?.focus({preventScroll:true});
    });
  }
  const belongs=row=>row.project_id===record.project_id && row.document_id===documentId;
  const saved=annotations.filter(belongs).map(row=>noteEditor.adopt(row,record.id).server).sort((a,b)=>a.start_pos-b.start_pos || a.end_pos-b.end_pos || a.id.localeCompare(b.id));
  const marked=document ? readingMarks(document,saved,highlight) : {runs:[],unanchored:[]};
  return <section className="source-reader" aria-labelledby="source-reader-heading"><h3 id="source-reader-heading">Read & annotate</h3>
    <p className="reader-help">Read a private text excerpt here, or use the source link above. Selecting a passage keeps its edition, location, and source version attached.</p>
    <details className="reader-import"><summary>Add text to read here</summary><form onSubmit={importText}>
      <label>Edition / version<input required value={importDraft.edition} disabled={importDraft.saving} maxLength={1000} onChange={e=>editImport({edition:e.target.value})} placeholder="Identify the edition or translation you are reading" /></label>
      <label>Location covered<input required value={importDraft.locator} disabled={importDraft.saving} maxLength={2000} onChange={e=>editImport({locator:e.target.value})} placeholder="Abstract, section, page, or verse" /></label>
      <label>Original source URL (optional)<input type="url" value={importDraft.representation_url} disabled={importDraft.saving} maxLength={2000} onChange={e=>editImport({representation_url:e.target.value})} /></label>
      <label>Plain-text excerpt<textarea required value={importDraft.text} disabled={importDraft.saving} maxLength={12000} rows={7} onChange={e=>editImport({text:e.target.value})} /></label>
      <small>Up to 12,000 characters. Imported text stays private and is not marked as verified scholarship.</small>
      <div><button disabled={importDraft.saving}>{importDraft.saving ? 'Saving…' : 'Save private excerpt'}</button><button type="button" disabled={importDraft.saving} onClick={()=>forget(importKey)}>Discard import draft</button></div>
    </form></details>
    {snapshots.length>0 && <label className="reader-version">Reading version<select value={documentId} onChange={e=>{requestedAnchor.current=null;setDocumentId(e.target.value);bookmark('',e.target.value);}}>{snapshots.map(d=><option key={d.id} value={d.id}>{d.edition} · {d.locator} · {d.text_sha256.slice(0,8)}{drafts.current.has(`capture:${d.id}`) ? ' · draft' : ''}</option>)}</select></label>}
    {cursor && <button onClick={moreSnapshots}>More saved excerpts</button>}
    {document && <><p className="reader-help">{document.edition} · {document.locator}<br/>{document.review_scope}</p>
      {document.source_notice && <details className="reader-source-notice"><summary>Source notice & attribution</summary><pre dir="auto">{document.source_notice}</pre></details>}
      <div className="reader-toolbar" role="group" aria-label="Passage annotation tools">
        <button className="reader-select" onPointerDown={e=>e.preventDefault()} onClick={()=>select('highlight')} disabled={capture?.saving}>Annotate selected text</button>
        <button className="reader-underline" onPointerDown={e=>e.preventDefault()} onClick={()=>select('underline')} disabled={capture?.saving}>Underline</button>
        <button className="reader-note-only" onPointerDown={e=>e.preventDefault()} onClick={()=>select('none')} disabled={capture?.saving}>Margin note</button>
        {onFocusChange && <button className="reader-focus" aria-pressed={focused} onClick={()=>onFocusChange(!focused)}>{focused ? 'Show library' : 'Focus on reading'}</button>}
        <button className="reader-margin-toggle" aria-expanded={marginOpen} aria-controls={marginId} onClick={()=>setMarginOpen(!marginOpen)}>{marginOpen ? 'Hide margin' : 'Show margin'}</button>
        <button className="reader-refresh" onClick={refreshAnnotations}>Refresh saved notes</button>
      </div>
      <p className="reader-help">Select text, then choose a mark. Click a saved mark to write beside it; click a note’s quotation to return. Keyboard: select text, then Alt + N.</p>
      {message && <p className="reader-message" role="status">{message}</p>}
      {marked.unanchored.length>0 && <p className="reader-message" role="status">{marked.unanchored.length} saved note(s) need anchor review. Their marks were not moved to other text.</p>}
      {annotations.some(row=>!belongs(row)) && <p className="reader-message" role="status">A returned note did not match this source version and was not displayed. Refresh saved notes to retry.</p>}
      <ResizablePanes className={`reader-desk${marginOpen ? '' : ' is-margin-collapsed'}`} storageKey="research:reader-margin-width" label="Resize source text and margin notes">
        <div className="reader-page"><div ref={textRoot} className="reader-text" dir="auto" tabIndex={0} aria-label="Source excerpt" onKeyDown={event=>{
          if(event.altKey && event.key.toLowerCase()==='n') {event.preventDefault();select('none');}
        }}>{marked.runs.map(run=>run.ids.length || run.selected ? <mark key={run.start} ref={run.selected && (!highlight || run.start===highlight.start) ? mark : null}
          className={`${run.highlight ? 'has-highlight ' : ''}${run.underline ? 'has-underline ' : ''}${run.selected ? 'is-selected ' : ''}${run.ids.length>1 ? 'has-overlap' : ''}`}
          {...(run.ids.length ? {role:'button',tabIndex:0,'aria-label':`${run.text} — ${run.ids.length===1 ? 'open margin note' : `${run.ids.length} margin notes; activate to cycle`}`,'aria-pressed':run.ids.includes(activeAnnotation),
            onClick:()=>openMargin(run.ids),onKeyDown:event=>{if(event.key==='Enter' || event.key===' ') {event.preventDefault();openMargin(run.ids);}}} : {})}>{run.text}</mark> : run.text)}</div></div>
        <aside ref={margin} id={marginId} hidden={!marginOpen} className="reader-margin" aria-label="Passage margin notes">
          {capture && <div className="reader-capture"><h4>In the margin</h4><blockquote dir="auto">{capture.exact}</blockquote>
            <label>Passage mark<select value={capture.mark_style || 'highlight'} disabled={capture.saving || !!capture.submitted} onChange={e=>remember(captureKey,{...capture,mark_style:e.target.value})}><option value="highlight">Highlight</option><option value="underline">Underline</option><option value="none">Margin note only</option></select></label>
            <label>My passage note<textarea ref={composer} value={capture.body} disabled={capture.saving || !!capture.submitted} rows={5} maxLength={10000} onChange={e=>remember(captureKey,{...capture,body:e.target.value})}
              placeholder="Your thought, question, or disagreement…" onKeyDown={event=>{if((event.metaKey || event.ctrlKey) && event.key==='Enter') {event.preventDefault();saveCapture();}}} /></label>
            <label>Capture as<select value={capture.capture_kind} disabled={capture.saving || !!capture.submitted} onChange={e=>remember(captureKey,{...capture,capture_kind:e.target.value})}><option value="comment">Reading note</option><option value="term_candidate">Term to investigate</option><option value="citation_candidate">Scripture reference to check</option></select></label>
            <div><button onClick={saveCapture} disabled={capture.saving}>{capture.saving ? 'Saving…' : capture.submitted ? 'Retry original save' : 'Save passage note'}</button><button disabled={capture.saving} onClick={()=>{forget(captureKey);setHighlight(null);}}>Discard selection draft</button></div>
            {capture.submitted && !capture.saving && <small>The response was not confirmed. Retry sends the original note and ID, so it cannot create a second note. Discarding removes this local draft; a committed note may still exist in the cloud. Refresh saved notes to check.</small>}
            <small>Your note stays attached to this exact source version. Capturing it does not create a reviewed claim.</small></div>}
          <div className="reader-annotations"><h4>Saved passage notes <span>{annotations.length}{annotationCursor ? '+' : ''}</span></h4>{!annotations.length && <p>Select a passage and write here. Your saved notes will stay beside this source.</p>}
            {saved.map(row=><SavedPassageNote key={row.id} row={row} sourceId={record.id} editor={noteEditor} reopen={reopen} api={api} drafts={drafts} changed={changed} navigate={navigate} active={activeAnnotation===row.id} />)}
            {annotationCursor && <><p className="reader-help">More notes exist. Load them to see their marks in the text.</p><button onClick={moreAnnotations}>More passage notes</button></>}</div>
        </aside>
      </ResizablePanes>
    </>}
    {!document && message && <p className="reader-message" role="status">{message}</p>}
  </section>;
}
