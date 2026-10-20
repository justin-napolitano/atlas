import React,{useEffect,useMemo,useRef,useState} from 'react';
import SourceReader from './SourceReader.jsx';
import SaveReadingToLibrary from './SaveReadingToLibrary.jsx';
import {DocumentNavigation} from './WorkspaceNavigation.jsx';
import {SurfaceActivity} from './surfaceActivity.js';
import {useContext} from 'react';
import {gutenbergReaderAPI,gutenbergPlaceWriter,bookPlaceSession} from './gutenbergClient.js';
import {readingPosition} from './readingPosition.js';
import './gutenberg.css';

export default function GutenbergReader({api,projectId,bookId,version='',drafts,changed,noteEditor,onOpen,onOpenNotebook,onBack,onTitle}){
  const [book,setBook]=useState(null),[section,setSection]=useState(0),[initialPosition,setInitialPosition]=useState(0),[doc,setDoc]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[placeState,setPlaceState]=useState(null);
  const root=useRef(null),alive=useRef(true),queue=useRef(null),sectionRef=useRef(0),active=useContext(SurfaceActivity),activeRef=useRef(active);
  activeRef.current=active;sectionRef.current=section;
  useEffect(()=>{if(book?.title)onTitle?.(book.title);},[book?.title]);
  const placeKey='gutenberg-place:'+JSON.stringify([projectId,bookId]);
  const notify=value=>{if(!value)return;if(value.sent||value.next||value.busy||value.error||value.current)drafts.current.set(placeKey,{...value,projectId,workspaceMode:'gutenberg',saving:value.busy});else drafts.current.delete(placeKey);changed();if(alive.current)setPlaceState({...value});};
  async function load(){
    setError('');setDoc(null);
    try{
      const [value,place]=await Promise.all([api.request('catalog/gutenberg/book',{project_id:projectId,book_id:bookId,...(version?{version}:{})}),api.request('catalog/gutenberg/place',{project_id:projectId,book_id:bookId}).catch(err=>{if(err.status===404)return null;throw err;})]);
      if(!alive.current)return;
      if(value.book_id!==bookId)throw new Error('The catalog returned another book.');
      setBook(value);
      if(value.availability!=='read')return;
      queue.current=bookPlaceSession(drafts.current,placeKey,()=>gutenbergPlaceWriter(api,{project_id:projectId,book_id:bookId},place));
      queue.current.subscribe(notify);
      const held=queue.current.state(),saved=held.next || held.sent || held.cloud;
      if(saved && saved.version!==value.version)throw new Error('Your saved place belongs to another book version. Open the original saved source from Notes.');
      setSection(saved?.section || 0);setInitialPosition(saved?.position || 0);setPlaceState({...held});
    }catch(err){if(alive.current)setError(err.message);}
  }
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;};},[projectId,bookId,version]);
  useEffect(()=>{
    let live=true;setDoc(null);
    if(!book?.sections?.length)return;
    api.request('catalog/gutenberg/section',{project_id:projectId,book_id:bookId,version:book.version,section}).then(value=>{if(live)setDoc(value);}).catch(err=>{if(live)setError(err.message);});
    return()=>{live=false;};
  },[book,section,projectId,bookId]);
  const binding=useMemo(()=>book?.version?{project_id:projectId,book_id:bookId,version:book.version,section}:null,[projectId,bookId,book?.version,section]);
  const readerAPI=useMemo(()=>doc?gutenbergReaderAPI(api,binding,doc):null,[api,binding,doc]);
  const record=useMemo(()=>doc?{id:doc.source_record_id,project_id:projectId,kind:'source',title:book.title}:null,[doc,projectId,book?.title]);
  function move(index){if(!book || index<0 || index>=book.sections.length || index===section)return;setInitialPosition(0);setSection(index);setMessage('');queue.current?.move({version:book.version,section:index,position:0});}
  useEffect(()=>{
    if(!doc)return;
    const container=root.current?.closest('.workspace-reader') || window;
    let timer;
    const save=()=>{if(!activeRef.current)return;clearTimeout(timer);timer=setTimeout(()=>{const text=root.current?.querySelector('.reader-text');if(text&&sectionRef.current===section)queue.current?.move({version:book.version,section,position:readingPosition(text)});},1200);};
    container.addEventListener('scroll',save,{passive:true});
    return()=>{clearTimeout(timer);container.removeEventListener('scroll',save);};
  },[doc?.id,section]);
  async function saveBook(){try{await readerAPI.ensure();setMessage('Saved to this project.');changed();}catch(err){setMessage(err.message);}}
  if(error)return <section className="gutenberg-reader"><p role="alert">{error}</p><button onClick={load}>Retry book</button><a href={`https://www.gutenberg.org/ebooks/${bookId}`} target="_blank" rel="noopener noreferrer">Open on Gutenberg ↗</a><button onClick={onBack}>Back to sources</button></section>;
  if(!book)return <p role="status">Opening book…</p>;
  return <section ref={root} className="gutenberg-reader" aria-label={book.title}>
    <header className="gutenberg-book-heading"><div><h1>{book.title}</h1><p>{book.creators.join(' · ')}{book.translators.length?' · Translated by '+book.translators.join(', '):''}</p></div>{doc&&<><SaveReadingToLibrary key={bookId+book.version} api={api} prepare={async()=>{await readerAPI.ensure();return {record_id:doc.source_record_id,document_id:doc.id};}}/></>}</header>
    {message&&<p role="status">{message}</p>}
    <details className="gutenberg-provenance"><summary>Gutenberg #{bookId} · {book.languages.join(', ')} · Digital edition</summary><p>{book.edition}</p>{doc&&<button onClick={saveBook}>Save to project</button>}<p>{book.rights_notice}</p><p>Digital release: {book.release_date || 'Not stated'} · Retrieved: {book.retrieved_at || 'Not yet acquired'}</p><a href={book.source_url} target="_blank" rel="noopener noreferrer">Provider record ↗</a>{book.version&&<p>Text version: {book.version.slice(0,16)}</p>}{book.source_notice&&<details><summary>Original source header and license</summary><pre>{book.source_notice}</pre></details>}</details>
    {book.availability!=='read'?<p>This edition has no supported public-domain UTF-8 text in this reader yet. <a href={book.source_url} target="_blank" rel="noopener noreferrer">See available formats on Gutenberg ↗</a></p>:<>
      <DocumentNavigation><div className="gutenberg-contents"><strong>{book.title}</strong><nav aria-label="Book contents">{book.sections.map(item=><button key={item.index} aria-current={section===item.index?'location':undefined} onClick={()=>move(item.index)}>{item.index+1}. {item.label}</button>)}</nav></div></DocumentNavigation>
      <nav className="gutenberg-section-nav" aria-label="Reading sections"><button disabled={!section} onClick={()=>move(section-1)}>← Previous</button><span>{section+1} / {book.sections.length} · {book.sections[section]?.label}</span><button disabled={section===book.sections.length-1} onClick={()=>move(section+1)}>Next →</button></nav>
      {placeState?.error&&<div role="alert">Reading place not saved: {placeState.error} {placeState.current?<><button onClick={()=>{queue.current.keepRemote();load();}}>Use saved place</button><button onClick={()=>queue.current.replace()}>Keep my place</button></>:<button onClick={()=>queue.current.retry()}>Retry reading place</button>}</div>}
      {doc?<SourceReader key={doc.id} record={record} api={readerAPI} drafts={drafts} changed={changed} noteEditor={noteEditor} navigate={onOpen} initialDocumentId={doc.id} initialReadingPosition={initialPosition} initialMarginOpen={false} onBookmark={()=>{}} onOpenNotebook={onOpenNotebook} catalogReading/>:<p role="status">Opening reading section…</p>}
      <small className="gutenberg-resume-status">{placeState?.busy?'Saving place…':placeState?.cloud&&!placeState.error?'Reading place saved':''}</small>
    </>}
  </section>;
}
