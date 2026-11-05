import React,{useEffect,useRef,useState} from 'react';
import {inSearchScope,searchDestination,searchResultLabel,searchScopes,verifySearch} from './researchSearch.js';
import './researchSearch.css';

export default function ResearchSearch({api,projectId,onOpen,onOpenNotebook,onClose,initialQuery=''}){
  const [query,setQuery]=useState(initialQuery),[scope,setScope]=useState('all'),[page,setPage]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const generation=useRef(0),activeProject=useRef(projectId),input=useRef(null);activeProject.current=projectId;
  useEffect(()=>{generation.current++;setQuery(initialQuery);setPage(null);setError('');setLoading(false);input.current?.focus();return()=>{generation.current++;};},[projectId,initialQuery]);
  async function search(event){event.preventDefault();const q=query.trim();if(!q)return;const token=++generation.current;setLoading(true);setError('');setPage(null);
    try{const result=verifySearch(await api.request('research/search',{project_id:projectId,q,limit:50}),projectId);if(generation.current===token && activeProject.current===projectId)setPage({...result,projectId,searched:q});}
    catch(err){if(generation.current===token && activeProject.current===projectId)setError(err.message || 'Search could not finish. Your query is still here.');}
    finally{if(generation.current===token && activeProject.current===projectId)setLoading(false);}}
  function open(row){if(row.project_id!==projectId)return;const target=searchDestination(row);if(target?.kind==='notebook')onOpenNotebook?.(target.entryId,page?.searched || '');else if(target)onOpen?.(target.recordId,projectId,target.annotationId,target.documentId);}
  const visiblePage=page?.projectId===projectId?page:null,rows=visiblePage?.items.filter(row=>inSearchScope(row,scope)) || [];
  return <section className="owner-research-search" aria-label="Search research" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose?.();}}}>
    <header><div><span className="owner-research-search-kicker">Your research, connected</span><h2>Find the thread.</h2></div>{onClose && <button type="button" onClick={onClose} aria-label="Close research search">×</button>}</header>
    <form onSubmit={search}><label htmlFor="research-search-query">Search sources, passages, notes, and concepts</label><div className="owner-research-search-input"><span aria-hidden="true">⌕</span><input ref={input} id="research-search-query" value={query} maxLength={300} onChange={event=>setQuery(event.target.value)} placeholder="A word, a question, a passage…" autoComplete="off"/><button disabled={loading || !query.trim()}>{loading?'Searching…':'Search →'}</button></div></form>
    <div className="owner-research-search-scopes" aria-label="Search result types">{searchScopes.map(([key,label])=><button key={key} type="button" aria-pressed={scope===key} onClick={()=>setScope(key)}>{label}</button>)}</div>
    <p className="owner-research-search-status" role="status">{loading?'Looking through this project…':error || (visiblePage?`${rows.length} ${rows.length===1?'result':'results'} shown for “${visiblePage.searched}”`:'Enter a phrase and press Search. Results stay within this project.')}</p>
    {visiblePage && !rows.length && <div className="owner-research-search-empty"><h3>No matching {scope==='all'?'results':searchScopes.find(([id])=>id===scope)?.[1].toLowerCase()} here.</h3><p>Try a shorter phrase or another result type. This searches saved text literally; it does not infer a source’s meaning.</p></div>}
    <div className="owner-research-search-results">{rows.map(row=><article key={`${row.kind}:${row.id}`}><div className="owner-research-search-result-meta"><span>{searchResultLabel(row)}</span>{row.channel && <span>{row.channel==='private'?'Private research':row.channel==='curated'?'Curated record':String(row.channel).replaceAll('_',' ')}</span>}</div><button type="button" className="owner-research-search-result-title" disabled={!searchDestination(row)} onClick={()=>open(row)}>{row.title || 'Untitled research item'} <span aria-hidden="true">↗</span></button>{row.excerpt && <p dir="auto">{row.excerpt}</p>}{(row.edition || row.locator) && <small>{[row.edition,row.locator].filter(Boolean).join(' · ')}</small>}</article>)}</div>
    {visiblePage?.truncated && <p className="owner-research-search-limit">This search returned its first 50 matches. Narrow your phrase to find more specific material; filters apply to these returned matches.</p>}
    <footer>Exact titles appear first, followed by literal text matches. Order is a finding aid, not a judgment of scholarly quality.</footer>
  </section>;
}
