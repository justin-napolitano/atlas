import React from 'react';
import ScriptureCitations from './ScriptureCitations.jsx';
import LexiconCapture from './LexiconCapture.jsx';
import VerseLinks from './VerseLinks.jsx';
import RecoverableDraft from './RecoverableDraft.jsx';
import {recoverPassageWriting} from './recoverIntoEditor.js';

const statuses={saved:'Saved to your workspace',unsaved:'Unsaved changes',saving:'Saving…',conflict:'Changed on another device',error:'Save failed. Your draft is still here.'};
/** A revisioned margin note; source selection and note identity remain immutable. */
export default function SavedPassageNote({ row,sourceId,document,editor,reopen,api,drafts,changed,navigate,onOpenVerse,active=false }) {
  const entry=editor.adopt(row,sourceId), value=entry.server;
  return <article className={`saved-passage-note${active ? ' is-active' : ''}`} data-annotation-id={value.id} aria-label={active ? 'Selected passage note' : 'Passage note'}>
    <a className="reader-reopen" dir="auto" href={`?${new URLSearchParams({project:value.project_id,record:sourceId,document:value.document_id,annotation:value.id})}`} onClick={event=>{
      if(event.button===0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {event.preventDefault();reopen(value);}
    }}>{value.exact}</a>
    <small>{(value.mark_style || 'highlight')==='none' ? 'Margin note' : value.mark_style==='underline' ? 'Underlined' : 'Highlighted'} · {value.capture_kind.replaceAll('_',' ')} · captured, unreviewed · revision {value.revision}</small>
    {entry.open ? <div className="passage-note-edit">
      <label>Passage mark<select value={entry.markStyle} onChange={event=>editor.editStyle(value.id,event.target.value)}><option value="highlight">Highlight</option><option value="underline">Underline</option><option value="none">Margin note only</option></select></label>
      <label>My saved passage note<textarea value={entry.body} rows={4} maxLength={10000}
        onChange={event=>editor.edit(value.id,event.target.value)}
        onKeyDown={event=>{if((event.metaKey||event.ctrlKey) && event.key==='Enter') {event.preventDefault();editor.save(value.id);}}} /></label>
      <p role="status">{statuses[entry.status]}</p>
      {entry.current && <div className="passage-note-conflict" role="region" aria-label="Passage note conflict">
        <p>The cloud note is revision {entry.current.revision}, {(entry.current.mark_style || 'highlight').replaceAll('_',' ')}. Compare it with your draft above.</p>
        <pre>{entry.current.body || '(Empty note)'}</pre>
        <button onClick={()=>editor.resolve(value.id,'cloud')}>Use cloud note</button>
        <button onClick={()=>editor.resolve(value.id,'draft')}>Save my version</button>
      </div>}
      <button className="passage-note-save" disabled={!!entry.pending || entry.status==='conflict' || entry.status==='saved'} onClick={()=>editor.save(value.id)}>Save changes</button>
      <button disabled={!!entry.pending} onClick={()=>editor.close(value.id)}>{entry.status==='saved' ? 'Close editor' : 'Discard my changes'}</button>
      {document && <RecoverableDraft key={value.id+':drafts'} api={api} projectId={value.project_id} recordId={sourceId} contextKind="annotation" document={document} annotation={value} body={entry.body} markStyle={entry.markStyle} baseRevision={entry.server.revision} drafts={drafts} changed={changed} onRecover={recovered=>recoverPassageWriting(editor,{id:sourceId,project_id:value.project_id},recovered)}/>}
      <small>Your saved note stays private. Editing it keeps the selected text, source version, and revision history attached.</small>
    </div> : <>{value.body && <p>{value.body}</p>}<button className="passage-note-open" onClick={()=>editor.open(value.id)}>Edit note</button></>}
    <button onClick={()=>reopen(value,true)}>Export private annotation</button>
    <ScriptureCitations annotation={value} sourceId={sourceId} api={api} drafts={drafts} changed={changed} navigate={navigate} />
    <VerseLinks api={api} projectId={value.project_id} annotation={value} drafts={drafts} changed={changed} onOpenVerse={onOpenVerse} />
    <LexiconCapture annotation={value} sourceId={sourceId} api={api} drafts={drafts} changed={changed} navigate={navigate} />
  </article>;
}
