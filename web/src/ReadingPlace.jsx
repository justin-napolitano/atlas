import React,{useEffect,useRef,useState} from 'react';
import {saveReadingPlace,verifyReadingPlace} from './readingPlace.js';
import {useSurfaceResume} from './surfaceActivity.js';

/** Explicit durable bookmark; drafts and viewport scrolling are not synchronized. */
export default function ReadingPlace({api,projectId,place,drafts,changed,onResume}) {
  const [cloud,setCloud]=useState(null),[ready,setReady]=useState(false),[message,setMessage]=useState('');
  const alive=useRef(true),busy=useRef(false),key=`reading-place:${JSON.stringify(projectId)}`;
  const draft=drafts.current.get(key);
  useSurfaceResume(load);
  function remember(value){drafts.current.set(key,value);changed();}
  function clear(){drafts.current.delete(key);changed();}
  async function load(){setReady(false);setMessage('');try{const row=await api.request('reading/desk',{project_id:projectId});verifyReadingPlace(row,projectId);if(alive.current){setCloud(row);setReady(true);}}
    catch(err){if(alive.current){if(err.status===404){setCloud(null);setReady(true);}else setMessage(err.message);}}}
  useEffect(()=>{alive.current=true;setCloud(null);load();return()=>{alive.current=false;};},[projectId]);
  async function save(overrideDraft=draft){
    if(busy.current || !ready || (!place && !overrideDraft?.sent))return;busy.current=true;
    const result=await saveReadingPlace({api,projectId,place,revision:cloud?.revision || 0,draft:overrideDraft,update:remember});
    busy.current=false;if(result){clear();if(alive.current){setCloud(result);setMessage('Reading place saved across devices.');}}
  }
  return <section className="reading-place" aria-label="Saved reading place"><div>
    <button disabled={!ready || !!draft?.saving || (!place && !draft?.sent) || !!draft?.current} onClick={()=>save()}>{draft?.saving ? 'Saving place…' : draft?.sent ? 'Retry original bookmark' : place?.annotation_id ? 'Bookmark this passage' : 'Bookmark start of excerpt'}</button>
    <button disabled={!cloud} onClick={()=>onResume(cloud.record_id,projectId,cloud.annotation_id || '',cloud.document_id)}>{cloud && !cloud.annotation_id && cloud.end_pos!==0 ? 'Open bookmarked excerpt' : 'Resume saved reading'}</button>
    {!ready && <button onClick={load}>Load saved place</button>}
    <small>{cloud ? `One bookmark for this project · revision ${cloud.revision}` : ready ? 'No saved bookmark for this project yet.' : 'Loading saved reading place…'}</small>
    </div><p role="status">{draft?.error || message}</p>
    {draft?.current && <div className="reading-place-conflict"><p>Cloud bookmark: {draft.current.record_id} · {draft.current.annotation_id ? 'saved passage' : 'excerpt start'} · revision {draft.current.revision}.</p><p>Your requested bookmark: {draft.sent.record_id} · {draft.sent.annotation_id ? 'saved passage' : 'excerpt start'}.</p>
      <button onClick={()=>{setCloud(draft.current);clear();setMessage('Kept the cloud bookmark.');}}>Keep cloud bookmark</button>
      <button onClick={()=>{const next={...draft,sent:{...draft.sent,expected_revision:draft.current.revision},current:null};setCloud(draft.current);remember(next);save(next);}}>Replace with my requested bookmark</button></div>}
    {cloud && !cloud.annotation_id && cloud.end_pos!==0 && <p>This bookmark contains a range without a saved annotation. Opening it here shows the excerpt start; the range is retained on the server.</p>}
    <small>Bookmarks reopen a saved passage, or the start of an excerpt. Unsaved notes and scroll position stay in this tab.</small>
  </section>;
}
