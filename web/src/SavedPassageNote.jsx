import React from 'react';
import ScriptureCitations from './ScriptureCitations.jsx';

const statuses={saved:'Saved to your workspace',unsaved:'Unsaved changes',saving:'Saving…',conflict:'Changed on another device',error:'Save failed. Your draft is still here.'};
export default function SavedPassageNote({ row,sourceId,editor,reopen,api,drafts,changed,navigate }) {
  const entry=editor.adopt(row,sourceId), value=entry.server;
  return <article className="saved-passage-note">
    <button className="reader-reopen" onClick={()=>reopen(value)}>{value.exact}</button>
    <small>{value.capture_kind.replaceAll('_',' ')} · captured, unreviewed · revision {value.revision}</small>
    {entry.open ? <div className="passage-note-edit">
      <label>My saved passage note<textarea value={entry.body} rows={4} maxLength={10000}
        onChange={event=>editor.edit(value.id,event.target.value)}
        onKeyDown={event=>{if((event.metaKey||event.ctrlKey) && event.key==='Enter') {event.preventDefault();editor.save(value.id);}}} /></label>
      <p role="status">{statuses[entry.status]}</p>
      {entry.current && <div className="passage-note-conflict" role="region" aria-label="Passage note conflict">
        <p>The cloud note is revision {entry.current.revision}. Compare it with your draft above.</p>
        <pre>{entry.current.body || '(Empty note)'}</pre>
        <button onClick={()=>editor.resolve(value.id,'cloud')}>Use cloud note</button>
        <button onClick={()=>editor.resolve(value.id,'draft')}>Save my version</button>
      </div>}
      <button className="passage-note-save" disabled={!!entry.pending || entry.status==='conflict' || entry.status==='saved'} onClick={()=>editor.save(value.id)}>Save changes</button>
      <button disabled={!!entry.pending} onClick={()=>editor.close(value.id)}>{entry.status==='saved' ? 'Close editor' : 'Discard my changes'}</button>
      <small>Your saved note stays private. Editing it keeps the selected text, source version, and revision history attached.</small>
    </div> : <>{value.body && <p>{value.body}</p>}<button className="passage-note-open" onClick={()=>editor.open(value.id)}>Edit note</button></>}
    <button onClick={()=>reopen(value,true)}>Export private annotation</button>
    <ScriptureCitations annotation={value} sourceId={sourceId} api={api} drafts={drafts} changed={changed} navigate={navigate} />
  </article>;
}
