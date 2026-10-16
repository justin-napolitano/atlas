import React,{useEffect,useRef,useState} from 'react';
import {newThought,notebookKey,notebookMetadata,saveThought,thoughtLabel,thoughtTypes,verifyThought} from './notebookClient.js';
import './researchNotebook.css';

/** Running project notebook. Passage bodies are a live server projection, never copied here. */
export default function ResearchNotebook({api,projectId,drafts,changed=()=>{},onOpenSource,anchor=null,initialQuery='',initialEntryId=''}){
  const [rows,setRows]=useState([]),[cursor,setCursor]=useState(null),[query,setQuery]=useState(initialQuery),[kind,setKind]=useState(''),[state,setState]=useState('active');
  const [selected,setSelected]=useState(null),[cloud,setCloud]=useState(null),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[history,setHistory]=useState(null);
  const [link,setLink]=useState({kind:'record',id:'',rationale:''});
  const [,render]=useState(0),generation=useRef(0),mounted=useRef(true),busy=useRef(false),selection=useRef(null),activeProject=useRef(projectId);
  activeProject.current=projectId;
  const key=notebookKey(projectId,selected || 'new'),draft=drafts.current.get(key);
  function remember(value,at=key){drafts.current.set(at,value);changed();render(v=>v+1);}
  function clear(at=key){drafts.current.delete(at);changed();render(v=>v+1);}
  async function load(after='',queryValue=query){
    const token=++generation.current;setLoading(true);setMessage('');
    try{const page=await api.request('notebook/items',{project_id:projectId,q:queryValue,thought_type:kind,state,cursor:after,limit:25});
      if(!Array.isArray(page.items) || page.items.some(r=>r.project_id!==projectId))throw new Error('Notebook list did not match this project.');
      if(mounted.current && token===generation.current){setRows(old=>after?[...old,...page.items]:page.items);setCursor(page.next_cursor);}}
    catch(error){if(mounted.current && token===generation.current)setMessage(error.message);}
    finally{if(mounted.current && token===generation.current)setLoading(false);}
  }
  useEffect(()=>{let active=true;mounted.current=true;selection.current=null;setQuery(initialQuery);setSelected(null);setCloud(null);setRows([]);setHistory(null);load('',initialQuery).then(()=>{if(active && initialEntryId)open({id:initialEntryId,item_kind:'entry'});});return()=>{active=false;mounted.current=false;generation.current++;};},[projectId,initialQuery,initialEntryId]);
  function start(useAnchor){selection.current=null;setSelected(null);setCloud(null);setHistory(null);const at=notebookKey(projectId);
    if(drafts.current.has(at)){setMessage('Your unfinished new thought is retained. Save it before starting another.');return;}
    remember({value:newThought(useAnchor || {}),base:null,sent:null,saving:false,error:'',current:null},at);
  }
  async function open(row){
    if(row.item_kind==='passage_note' || row.item_kind==='record_note'){onOpenSource?.(row.record_id,projectId,row.annotation_id || '',row.document_id || '');return;}
    selection.current=row.id;setSelected(row.id);setCloud(null);setHistory(null);setMessage('');
    const token=++generation.current;
    try{const result=verifyThought(await api.request('notebook/entry',{project_id:projectId,entry_id:row.id}),projectId,row.id);
      if(mounted.current && token===generation.current && selection.current===row.id && activeProject.current===projectId)setCloud(result);}
    catch(error){if(mounted.current && token===generation.current)setMessage(error.message);}
  }
  function edit(patch){const next=draft || {value:notebookMetadata(cloud),base:cloud,sent:null,saving:false,error:'',current:null};remember({...next,value:{...next.value,...patch}});}
  async function save(){if(!draft || busy.current || draft.current)return;busy.current=true;const at=key,id=selected;
    const row=await saveThought({api,projectId,id,draft,update:value=>remember(value,at)});busy.current=false;
    if(row){clear(at);if(mounted.current && activeProject.current===projectId && selection.current===id){selection.current=row.id;setSelected(row.id);setCloud(row);setHistory(null);setMessage('Notebook thought saved across devices.');load();}}}
  function resolve(choice){const current=draft.current;verifyThought(current,projectId,current.id);clear();selection.current=current.id;setSelected(current.id);setCloud(current);
    if(choice==='draft')remember({...draft,base:current,value:{...draft.value},sent:null,current:null,error:'',saving:false},notebookKey(projectId,current.id));}
  async function revisions(before){try{const page=await api.request('notebook/history',{project_id:projectId,entry_id:selected,limit:10,...(before?{before_revision:before}:{})});
    if(page.items.some(r=>r.snapshot.project_id!==projectId || r.snapshot.id!==selected))throw new Error('History did not match this thought.');
    if(mounted.current && activeProject.current===projectId && selection.current===selected)setHistory(old=>({items:before?[...(old?.items || []),...page.items]:page.items,next:page.next_before_revision}));}catch(error){setMessage(error.message);}}
  async function follow(item){try{
    if(item.kind==='entry'){await open({id:item.id,item_kind:'entry'});return;}
    if(item.kind==='record'){onOpenSource?.(item.id,projectId,'','');return;}
    const bundle=await api.request('reading/annotation',{project_id:projectId,annotation_id:item.id});
    if(bundle.annotation?.project_id!==projectId || bundle.annotation.id!==item.id || !bundle.anchor?.anchored)throw new Error('Connection did not resolve to its exact saved passage.');
    const document=await api.request('reading/document',{project_id:projectId,document_id:bundle.annotation.document_id});
    if(document.project_id!==projectId || document.id!==bundle.annotation.document_id || document.text_sha256!==bundle.annotation.text_sha256)throw new Error('Connection source document did not match.');
    if(mounted.current && activeProject.current===projectId)onOpenSource?.(document.source_record_id,projectId,item.id,document.id);
  }catch(error){setMessage(error.message);}}
  const value=draft?.value || (cloud?notebookMetadata(cloud):null),locked=!!draft?.saving || !!draft?.sent;
  const context=selected?cloud:draft?.value;
  return <section className="research-notebook" aria-label="Research notebook">
    <header><h2>Research notebook</h2><p>Your thoughts and existing passage notes, with exact source links. Private, pending review.</p>
      <button onClick={()=>start(null)}>New thought</button>{anchor?.record_id && <button onClick={()=>start(anchor)}>New thought at this passage</button>}
    </header>
    <form className="notebook-filters" onSubmit={event=>{event.preventDefault();load();}}><label>Search notebook<input value={query} maxLength={300} onChange={event=>setQuery(event.target.value)}/></label>
      <label>Thought type<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">All thoughts and reading notes</option>{[...thoughtTypes,'passage_note','record_note'].map(type=><option key={type} value={type}>{thoughtLabel(type)}</option>)}</select></label>
      <label>State<select value={state} onChange={event=>setState(event.target.value)}><option value="active">Active</option><option value="withdrawn">Withdrawn thoughts</option></select></label><button disabled={loading}>Apply filters</button>
    </form><p role="status">{message}</p>
    <div className="notebook-layout"><section aria-label="Notebook entries"><h3>Collected thoughts</h3>{!rows.length && !loading && <p>No matching entries. New notes will appear here after saving.</p>}
      {rows.map(row=><article key={`${row.item_kind}:${row.id}`}><small>{thoughtLabel(row.thought_type)} · revision {row.revision}</small><button className="notebook-title" onClick={()=>open(row)}>{row.title}</button>
        <p>{row.body.slice(0,220)}{row.body.length>220?'…':''}</p>{row.selected_quote && <blockquote dir="auto">{row.selected_quote}</blockquote>}
        {row.record_id && <button onClick={()=>onOpenSource?.(row.record_id,projectId,row.annotation_id || '',row.document_id || '')}>Open exact source</button>}
        {['passage_note','record_note'].includes(row.item_kind) && <small>Edited in the reader; this list uses its current saved note body.</small>}</article>)}
      {cursor && <button disabled={loading} onClick={()=>load(cursor)}>More notebook entries</button>}
    </section><section aria-label="Notebook editor"><h3>{selected?'Your thought':'New thought'}</h3>
      {!value && <p>Choose a thought to read or edit, or start a new one. Passage notes open directly in the reader.</p>}
      {value && <><p>{context?.annotation_id?'Anchored to an exact saved passage.':context?.record_id?'Linked to a source record.':'Unanchored personal thought.'} Anchors stay fixed after creation.</p>
        {context?.record_id && <button onClick={()=>onOpenSource?.(context.record_id,projectId,context.annotation_id || '',context.document_id || '')}>Return to anchored source</button>}
        {cloud?.selected_quote && <blockquote dir="auto">{cloud.selected_quote}<footer>{cloud.source_title} · {cloud.edition} · {cloud.locator}</footer></blockquote>}
        <fieldset disabled={locked}><label>Thought type<select value={value.thought_type} onChange={event=>edit({thought_type:event.target.value})}>{thoughtTypes.map(type=><option key={type} value={type} disabled={type==='source_claim' && !context?.annotation_id}>{thoughtLabel(type)}</option>)}</select></label>
          <label>Title<input value={value.title} maxLength={300} onChange={event=>edit({title:event.target.value})}/></label>
          <label>Thought (Markdown source)<textarea value={value.body} maxLength={20000} rows={10} onChange={event=>edit({body:event.target.value})}/></label>
          <p>Markdown is stored as text. “Source claim to check” records your reading of a located passage; it does not verify the author's claim.</p>
          <label>State<select disabled={!selected} value={value.state} onChange={event=>edit({state:event.target.value})}><option value="active">Active</option><option value="withdrawn">Withdrawn — retain history</option></select></label>
          <h4>Explicit connections</h4>{value.links.map((item,index)=><div key={`${item.kind}:${item.id}`}><p>{item.kind}: {item.id}<br/>{item.rationale}</p><button onClick={()=>follow(item)}>Follow connection</button><button onClick={()=>edit({links:value.links.filter((_,i)=>i!==index)})}>Remove connection</button></div>)}
          <label>Connection target type<select value={link.kind} onChange={event=>setLink({...link,kind:event.target.value})}><option value="record">Record</option><option value="annotation">Saved passage</option><option value="entry">Notebook thought</option></select></label>
          <label>Target ID<input value={link.id} maxLength={500} onChange={event=>setLink({...link,id:event.target.value})}/></label><label>Why connect these?<textarea value={link.rationale} maxLength={2000} rows={2} onChange={event=>setLink({...link,rationale:event.target.value})}/></label>
          <button disabled={!link.id.trim() || !link.rationale.trim() || value.links.length>=25} onClick={()=>{edit({links:[...value.links,link]});setLink({kind:'record',id:'',rationale:''});}}>Add explained connection</button>
        </fieldset><button disabled={!draft || draft.saving || !!draft.current || !value.title.trim() || !value.body.trim()} onClick={save}>{draft?.saving?'Saving…':draft?.sent?'Retry original notebook save':'Save thought'}</button>
        <p role="status">{draft?.error}</p>{draft?.sent && <p>The original request is retained until the outcome is confirmed. Other edits stay locked.</p>}
        {draft?.current && <aside className="notebook-conflict"><h4>Another revision needs comparison</h4><p>Your draft</p><pre>{draft.value.body}</pre><p>Cloud · revision {draft.current.revision} · {draft.current.state}</p><pre>{draft.current.body}</pre>
          <button onClick={()=>resolve('cloud')}>Use cloud thought</button><button onClick={()=>resolve('draft')}>Keep my draft for explicit save</button></aside>}
        {selected && <><small>Thought ID: {selected}</small><button onClick={()=>revisions()}>View thought history</button></>}
        {history && <section aria-label="Thought history">{history.items.map(row=><article key={row.revision}><h4>Revision {row.revision} · {thoughtLabel(row.snapshot.thought_type)} · {row.snapshot.state}</h4><strong>{row.snapshot.title}</strong><pre>{row.snapshot.body}</pre></article>)}{history.next && <button onClick={()=>revisions(history.next)}>Older thought revisions</button>}</section>}
      </>}
    </section></div>
  </section>;
}
