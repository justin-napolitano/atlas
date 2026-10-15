import React, { useEffect, useRef, useState } from 'react';
import { selectedPassage } from './passageSelection.js';
import SavedPassageNote from './SavedPassageNote.jsx';
import './sourceReader.css';

export default function SourceReader({ record, api, drafts, changed, noteEditor, navigate, initialAnnotationId = '' }) {
  const [snapshots,setSnapshots]=useState([]), [cursor,setCursor]=useState(null), [documentId,setDocumentId]=useState('');
  const [document,setDocument]=useState(null), [annotations,setAnnotations]=useState([]), [annotationCursor,setAnnotationCursor]=useState(null);
  const [message,setMessage]=useState(''), [highlight,setHighlight]=useState(null);
  const textRoot=useRef(null), mark=useRef(null), alive=useRef(true), currentDocument=useRef('');
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
      setDocumentId(requested?.annotation.document_id || retained?.documentId || noteEditor.documentForSource(record.project_id,record.id) || data.items[0]?.id || '');
    }).catch(error=>{ if(alive.current) setMessage(error.message); });
    return ()=>{ alive.current=false; };
  },[record.id]);
  useEffect(()=>{
    let active=true; currentDocument.current=documentId; setDocument(null); setAnnotations([]); setHighlight(null);
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
        if(requested.anchor.anchored) { setHighlight(requested.anchor); setMessage('Opened the saved source version and exact passage.'); requestAnimationFrame(()=>mark.current?.scrollIntoView({block:'nearest'})); }
        else setMessage('The requested passage needs anchor review. Its position was not changed.');
      } else if(retained) setHighlight(retained);
    }).catch(error=>{ if(active) setMessage(error.message); });
    return ()=>{ active=false; };
  },[documentId]);
  function remember(key,value) { drafts.current.set(key,value); changed(); }
  function forget(key) { drafts.current.delete(key); changed(); }
  function editImport(patch) { remember(importKey,{...importDraft,...patch}); }
  async function importText(event) {
    event.preventDefault(); if(importDraft.saving) return;
    const sent={...importDraft}; remember(importKey,{...sent,saving:true}); setMessage('Saving private excerpt…');
    try {
      const value=await api.post('reading/documents',{ project_id:record.project_id,source_record_id:record.id,
        edition:sent.edition,locator:sent.locator,representation_url:sent.representation_url,text:sent.text });
      forget(importKey);
      if(alive.current) { setSnapshots(rows=>[value,...rows.filter(r=>r.id!==value.id)]); setDocumentId(value.id); setMessage('Private reading excerpt saved.'); }
    } catch(error) { remember(importKey,{...sent,saving:false}); if(alive.current) setMessage(error.message); }
  }
  function select() {
    if(!document || document.id!==documentId || capture?.saving) return;
    try {
      const selected=selectedPassage(textRoot.current,window.getSelection());
      if(!selected) { setMessage('Select a word or passage in the excerpt first.'); return; }
      const value={...selected,annotation_uuid:crypto.randomUUID(),body:capture?.body || '',capture_kind:capture?.capture_kind || 'comment',
        documentId:document.id,sourceRecordId:record.id,saving:false};
      remember(captureKey,value); setHighlight(value); setMessage('Selection ready. Add a note or label it as a term/reference candidate.');
    } catch(error) { setMessage(error.message); }
  }
  async function saveCapture() {
    if(!capture || capture.saving || !document || document.id!==documentId) return;
    const key=captureKey,sent={...capture},snapshot=document;
    remember(key,{...sent,saving:true}); setMessage('Saving selected passage…');
    try {
      const value=await api.post('reading/annotations',{ annotation_uuid:sent.annotation_uuid,project_id:record.project_id,
        document_id:snapshot.id,text_sha256:snapshot.text_sha256,start:sent.start,end:sent.end,exact:sent.exact,
        capture_kind:sent.capture_kind,body:sent.body });
      forget(key);
      if(alive.current && currentDocument.current===snapshot.id) { setAnnotations(rows=>[value,...rows.filter(r=>r.id!==value.id)]); setMessage('Passage saved privately · captured, unreviewed.'); }
    } catch(error) {
      remember(key,{...sent,saving:false});
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
      } else if(value.anchor.anchored) { setHighlight(value.anchor); requestAnimationFrame(()=>mark.current?.scrollIntoView({block:'nearest'})); }
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
  const characters=document ? Array.from(document.text_body) : [];
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
    {snapshots.length>0 && <label className="reader-version">Reading version<select value={documentId} onChange={e=>setDocumentId(e.target.value)}>{snapshots.map(d=><option key={d.id} value={d.id}>{d.edition} · {d.locator} · {d.text_sha256.slice(0,8)}{drafts.current.has(`capture:${d.id}`) ? ' · draft' : ''}</option>)}</select></label>}
    {cursor && <button onClick={moreSnapshots}>More saved excerpts</button>}
    {document && <><p className="reader-help">{document.edition} · {document.locator}<br/>{document.review_scope}</p>
      <div ref={textRoot} className="reader-text" dir="auto" tabIndex={0} aria-label="Source excerpt">{highlight ? <>{characters.slice(0,highlight.start).join('')}<mark ref={mark}>{characters.slice(highlight.start,highlight.end).join('')}</mark>{characters.slice(highlight.end).join('')}</> : document.text_body}</div>
      <button className="reader-select" onPointerDown={e=>e.preventDefault()} onClick={select} disabled={capture?.saving}>Annotate selected text</button>
      <button className="reader-refresh" onClick={refreshAnnotations}>Refresh saved notes</button>
      {capture && <div className="reader-capture"><blockquote>{capture.exact}</blockquote><label>Capture as<select value={capture.capture_kind} disabled={capture.saving} onChange={e=>remember(captureKey,{...capture,capture_kind:e.target.value})}><option value="comment">Reading note</option><option value="term_candidate">Term to investigate</option><option value="citation_candidate">Scripture reference to check</option></select></label>
        <label>My passage note<textarea value={capture.body} disabled={capture.saving} rows={4} maxLength={10000} onChange={e=>remember(captureKey,{...capture,body:e.target.value})} /></label>
        <div><button onClick={saveCapture} disabled={capture.saving}>{capture.saving ? 'Saving…' : 'Save passage note'}</button><button disabled={capture.saving} onClick={()=>{forget(captureKey);setHighlight(null);}}>Discard selection draft</button></div><small>Captured text and a candidate label do not establish a definition, citation resolution, or reviewed claim.</small></div>}
      <div className="reader-annotations"><h4>Saved passage notes</h4>{!annotations.length && <p>No passage notes yet. Select a word or passage above.</p>}{annotations.map(row=><SavedPassageNote key={row.id} row={row} sourceId={record.id} editor={noteEditor} reopen={reopen} api={api} drafts={drafts} changed={changed} navigate={navigate} />)}{annotationCursor && <button onClick={moreAnnotations}>More passage notes</button>}</div>
    </>}
    {message && <p className="reader-message" role="status">{message}</p>}
  </section>;
}
