import React,{useState} from 'react';
import NotebookMarkdown from './NotebookMarkdown.jsx';
import {TrashAction} from './PrivateTrash.jsx';
import {finishReadingRecovery} from './useWritingRecovery.js';
import ScriptureCitations from './ScriptureCitations.jsx';
import LexiconCapture from './LexiconCapture.jsx';
import VerseLinks from './VerseLinks.jsx';
import RecoverableDraft from './RecoverableDraft.jsx';
import {recoverPassageWriting} from './recoverIntoEditor.js';

const statuses={saved:'Saved to your workspace',unsaved:'Unsaved changes',saving:'Saving…',conflict:'Changed on another device',error:'Save failed. Your draft is still here.'};
/** A revisioned margin note; source selection and note identity remain immutable. */
export default function SavedPassageNote({ row,sourceId,document,editor,reopen,api,drafts,changed,navigate,onOpenVerse,active=false,onTrashChange=()=>{} }) {
  const entry=editor.adopt(row,sourceId), value=entry.server;
  const [trash,setTrash]=useState(null);
  const action=<TrashAction api={api} projectId={value.project_id} kind="annotation" id={value.id} revision={value.revision} trashRevision={trash?.revision ?? row.trash_revision ?? 0} trashed={trash?trash.state==='trashed':row.trashed} disabled={entry.status!=='saved'} onChanged={result=>{setTrash(result);onTrashChange(result);}}/>;
  if(trash?trash.state==='trashed':row.trashed)return <article className="saved-passage-note"><p>Margin writing moved to Trash. Its exact source anchor is retained.</p>{action}</article>;
  return <article className={`saved-passage-note${active ? ' is-active' : ''}`} data-annotation-id={value.id} tabIndex={-1} aria-label={active ? 'Selected passage note' : 'Passage note'}>
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
      <button disabled={!!entry.pending} onClick={()=>{finishReadingRecovery(drafts.current,{projectId:value.project_id,recordId:sourceId,documentId:value.document_id,annotationId:value.id});editor.close(value.id);}}>{entry.status==='saved' ? 'Close editor' : 'Discard my changes'}</button>
      {document && <RecoverableDraft dirty={entry.body!==value.body || entry.markStyle!==(value.mark_style || 'highlight')} key={value.id+':drafts'} api={api} projectId={value.project_id} recordId={sourceId} contextKind="annotation" document={document} annotation={value} body={entry.body} markStyle={entry.markStyle} baseRevision={entry.server.revision} drafts={drafts} changed={changed} onRecover={recovered=>recoverPassageWriting(editor,{id:sourceId,project_id:value.project_id},recovered)}/>}
      <small>Your saved note stays private. Editing it keeps the selected text, source version, and revision history attached.</small>
    </div> : <>{value.body && <NotebookMarkdown body={value.body} notes={[]} complete={false}/>}<button className="passage-note-open" onClick={()=>editor.open(value.id)}>Edit note</button></>}
    {action}<details className="passage-research-tools"><summary>Explore this passage</summary>
    <button onClick={()=>reopen(value,true)}>Export private annotation</button>
    <ScriptureCitations annotation={value} sourceId={sourceId} api={api} drafts={drafts} changed={changed} navigate={navigate} />
    <VerseLinks api={api} projectId={value.project_id} annotation={value} drafts={drafts} changed={changed} onOpenVerse={onOpenVerse} />
    <LexiconCapture annotation={value} sourceId={sourceId} api={api} drafts={drafts} changed={changed} navigate={navigate} />
    </details>
  </article>;
}
