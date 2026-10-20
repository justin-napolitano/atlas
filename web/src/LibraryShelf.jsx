import React,{useContext,useEffect,useRef,useState} from 'react';
import {useModalFocus} from './useModalFocus.js';
import {SurfaceActivity} from './surfaceActivity.js';
import {itemUpdate,shelfTarget} from './libraryClient.js';
import {withQuranBook} from './quranShelf.js';
import GutenbergSearch from './GutenbergSearch.jsx';
import './libraryShelf.css';
const states=[['','All'],['reading','Reading'],['want_to_read','Want to read'],['finished','Finished']];
export default function LibraryShelf({api,projects,projectId,onOpen,onOpenNote,onFindBook,includeQuran=false}){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState(''),[scope,setScope]=useState(''),[rows,setRows]=useState([]),[recent,setRecent]=useState([]),[cursor,setCursor]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[discovery,setDiscovery]=useState(false),[detail,setDetail]=useState(null),[choices,setChoices]=useState([]),[notes,setNotes]=useState(null),[noteCursor,setNoteCursor]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const active=useContext(SurfaceActivity),detailPane=useRef(null);
  useModalFocus(detailPane,active&&!!detail);
  const generation=useRef(0),detailGeneration=useRef(0),search=useRef(null),scroll=useRef(0),pending=useRef(null),membershipPending=useRef(null);
  const books=includeQuran?withQuranBook(rows,{query,state:filter,scope}):rows;
  async function load(append=false){const token=++generation.current;setLoading(true);setError('');
    try{const [page,cont]=await Promise.all([api.request('library/shelf',{q:query,state:filter,...(scope?{project_id:scope}:{}),...(append&&cursor?{cursor}:{}),limit:30}),api.request('library/continue',scope?{project_id:scope}:{})]);
      if(token!==generation.current)return;
      setRows(old=>append?[...new Map([...old,...page.items].map(row=>[row.id,row])).values()]:page.items);setCursor(page.next_cursor);setRecent(cont.items);
    }catch(err){if(token===generation.current)setError(err.message);}finally{if(token===generation.current)setLoading(false);}}
  useEffect(()=>{const timer=setTimeout(()=>load(),200);return()=>{clearTimeout(timer);generation.current++;};},[query,filter,scope,active]);
  useEffect(()=>()=>{detailGeneration.current++;},[]);
  async function inspect(row,tab='details',append=false){const token=++detailGeneration.current;setError('');if(!append){setDetail({...row,tab});setChoices([]);setNotes(null);setNoteCursor(null);pending.current=null;membershipPending.current=null;}setBusy(true);
    try{if(tab==='notes'){const page=await api.request('library/notes',{item_id:row.id,...(append&&noteCursor?{cursor:noteCursor}:{}),limit:30});if(token===detailGeneration.current){setNotes(old=>append?[...(old||[]),...page.items]:page.items);setNoteCursor(page.next_cursor);}}
      else{const [editions,item]=await Promise.all([api.request('library/editions',{item_id:row.id,limit:50}),api.request('library/item',{item_id:row.id})]);if(token===detailGeneration.current){setChoices(editions.items);setDetail({...row,...item,tab,moreEditions:!!editions.next_cursor});}}
    }catch(err){if(token===detailGeneration.current)setError(err.message);}finally{if(token===detailGeneration.current)setBusy(false);}}
  async function update(patch){if(busy)return;setBusy(true);setError('');
    pending.current ||= itemUpdate(detail,patch);
    try{const value=await api.request('library/item',{},pending.current);if(value.id!==detail.id || value.revision!==pending.current.expected_revision+1)throw new Error('The library change was not confirmed.');pending.current=null;setMessage(value.on_shelf?'Library updated.':'Removed from shelf. Your writing is still in Notes.');setDetail(null);await load();}
    catch(err){setError(err.status===409?'This book changed on another device. Close these details and reopen them to review the current state.':err.message);}
    finally{setBusy(false);}}
  async function associate(project){
    if(busy)return;setBusy(true);setError('');
    const old=detail.project_associations?.find(row=>row.project_id===project.id);
    membershipPending.current ||= {item_id:detail.id,project_id:project.id,state:old&&old.state!=='removed'?'removed':'active',expected_revision:old?.revision||0,owner_confirmed:true};
    try{const expected=membershipPending.current;const row=await api.request('library/project-membership',{},expected);
      if(row.item_id!==detail.id||row.project_id!==expected.project_id||row.state!==expected.state||row.revision!==expected.expected_revision+1)throw new Error('The project association was not confirmed.');
      membershipPending.current=null;await load();await inspect(detail);
    }catch(err){setError(err.status===409?'Project membership changed elsewhere. Close and reopen these details to review it.':err.message);}
    finally{setBusy(false);}
  }
  function open(row){if(row.builtin&&row.quran_book){onOpen({reader:'quran'});return;}if(row.availability==='choose_edition'){inspect(row);return;}if(row.availability!=='read'){inspect(row);return;}onOpen(shelfTarget(row));}
  function close(){detailGeneration.current++;setDetail(null);setNotes(null);setError('');setBusy(false);pending.current=null;membershipPending.current=null;requestAnimationFrame(()=>document.querySelector(`[data-shelf-id="${CSS.escape(detail.id)}"]`)?.focus());}
  function rowView(row){return <article key={row.id} className="library-book"><span className="library-book-icon" aria-hidden="true">▤</span><div className="library-book-copy"><button data-shelf-id={row.id} className="library-book-title" onClick={()=>open(row)}>{row.title}</button>{row.creators?.length>0&&<p>{Array.isArray(row.creators)?row.creators.join(' · '):row.creators}</p>}<small>{row.edition_label || 'Edition not chosen'}{row.locator?' · '+row.locator:''}{row.reader==='quran'&&!row.builtin?` · Q ${row.resume_chapter}:${row.resume_ayah}`:row.reader==='gutenberg'?` · Section ${row.book_section+1}`:''}</small>{row.availability!=='read'&&<small>{row.availability==='choose_edition'?'Choose an edition':row.availability==='unavailable'?'Source unavailable':'Reference · no reading text'}</small>}</div>{!row.builtin&&<div className="library-book-actions"><button aria-label={`Notes for ${row.title}`} onClick={()=>inspect(row,'notes')}>Notes {row.note_count}</button><button aria-label={`Details for ${row.title}`} onClick={()=>inspect(row)}>···</button></div>}</article>;}
  return <section className="library-shelf" aria-label="Personal library">
    <header className="library-heading"><h1>{discovery?'Find books':'Library'}</h1>{discovery?<button onClick={()=>{setDiscovery(false);requestAnimationFrame(()=>{search.current?.focus();document.querySelector('.workspace-reader')?.scrollTo(0,scroll.current);});}}>← Your library</button>:<button onClick={()=>{scroll.current=document.querySelector('.workspace-reader')?.scrollTop||0;setDiscovery(true);}}>Find books</button>}</header>
    <div hidden={!discovery}><GutenbergSearch api={api} onOpen={onFindBook}/></div>
    <div hidden={discovery}>
      <div className="library-controls"><label className="library-search"><span className="sr-only">Search saved books</span><input ref={search} type="search" value={query} maxLength={300} onChange={event=>setQuery(event.target.value)} placeholder="Search saved books…"/></label><button aria-pressed={scope===projectId} disabled={!projectId} onClick={()=>setScope(scope?'':projectId)}>{scope?projects.find(p=>p.id===scope)?.title || 'This project':'All projects'}</button></div>
      {!query&&!filter&&recent.length>0&&<section className="library-continue"><h2>Continue reading</h2>{recent.map(rowView)}<button onClick={()=>setFilter('reading')}>Show all reading</button></section>}
      <nav className="library-filters" aria-label="Reading state">{states.map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</nav>
      {message&&<p role="status">{message}</p>}{loading&&<p role="status">Loading library…</p>}{error&&!detail&&<p role="alert">{error} <button onClick={()=>load()}>Retry library</button></p>}
      {!loading&&!error&&!books.length&&<p className="library-empty">{query||filter||scope?'No saved books match this view.':'Your shelf is empty. Find a book, or save an existing source to your library.'}</p>}
      <div className="library-book-list">{books.map(rowView)}</div>{cursor&&<button disabled={loading} onClick={()=>load(true)}>More saved books</button>}
      {detail&&<><button className="library-detail-scrim" aria-label="Close book details" onClick={close}/><section ref={detailPane} role="dialog" aria-modal="true" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}} className="library-detail" aria-label={`${detail.tab==='notes'?'Notes':'Details'} for ${detail.title}`}><header><h2>{detail.title}</h2><button onClick={close} aria-label="Close book details">Close</button></header>
        {error&&<p role="alert">{error}{!pending.current&&!membershipPending.current&&<button disabled={busy} onClick={()=>inspect(detail,detail.tab)}>Retry loading</button>}</p>}
        {detail.tab==='notes'?<>{notes===null?<p role="status">Loading notes…</p>:!notes.length?<p>No written notes yet. Open the text and write in the margin.</p>:notes.map(note=><button className="library-note-link" key={note.note_key} onClick={()=>{setDetail(null);onOpenNote(note);}}><strong>{note.title || 'Reading note'}</strong><span>{note.body.slice(0,140)}</span><small>{note.locator || note.edition || projects.find(p=>p.id===note.origin_project_id)?.title || 'Reading note'} · {note.thought_type}</small></button>)}{noteCursor&&<button disabled={busy} onClick={()=>inspect(detail,'notes',true)}>More notes</button>}</>:<>
          <p>{detail.edition_label || 'Choose an edition before reading.'}</p><div className="library-editions" role="group" aria-label="Reading edition">{choices.map(edition=><button disabled={busy||!!pending.current||!!membershipPending.current} key={edition.id} aria-pressed={detail.preferred_edition_id===edition.id} onClick={()=>update({preferred_edition_id:edition.id})}>{edition.label}</button>)}{detail.moreEditions&&<p>More editions exist. Open the source to inspect them before choosing.</p>}</div>
          <div role="group" aria-label="Update reading state">{states.filter(([v])=>v).map(([value,label])=><button disabled={busy||!!pending.current||!!membershipPending.current} aria-pressed={detail.reading_status===value} key={value} onClick={()=>update({reading_status:value})}>{label}</button>)}</div>
          <div className="library-project-links" role="group" aria-label="Project associations">{projects.map(project=>{const linked=detail.project_associations?.some(row=>row.project_id===project.id&&row.state!=='removed');return <button key={project.id} disabled={busy||!!pending.current||!!membershipPending.current} aria-pressed={!!linked} onClick={()=>associate(project)}>{linked?'✓ ': '+ '}{project.title}</button>;})}</div>
          {membershipPending.current&&error&&<button disabled={busy} onClick={()=>associate(projects.find(p=>p.id===membershipPending.current.project_id))}>Retry project change</button>}
          <button disabled={busy||!!pending.current||!!membershipPending.current} onClick={()=>update({on_shelf:false})}>Remove from shelf</button><p className="library-scope">Notes keep their original project and edition. Reading state does not change scholarly review.</p>
          {error&&pending.current&&<button disabled={busy} onClick={()=>update({})}>Retry exact change</button>}
        </>}
      </section></>}
    </div>
  </section>;
}
