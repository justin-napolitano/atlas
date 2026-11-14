import React,{useEffect,useRef,useState} from 'react';
import {parseResearchQuery,matchesResearchProperties} from './personalResearch.js';

/** Ordinary search retains its cross-research scope; metadata searches page notes. */
export default function PersonalResearchSearch({api,query,onOpen,onSaveView,tasks=false}){
 const [state,setState]=useState({items:[],loading:true}),generation=useRef(0);
 let parsed,error;try{parsed=parseResearchQuery(query);}catch(err){error=err.message;}
 const filtered=!!parsed?.filters.length;
 async function load(append=false){
  const token=++generation.current;setState(old=>({...old,loading:true,error:''}));
  try{
   let page;
   if(filtered){
    const notes=await api.request('workspace/notes',{q:parsed.text,limit:30,...(append&&state.cursor?{cursor:state.cursor}:{})});
    page={...notes,items:notes.items.filter(row=>matchesResearchProperties(row,parsed.filters)).map(row=>({...row,kind:'entry'}))};
   }else{
    const [result,taskRows]=await Promise.all([api.request('workspace/search',{q:parsed.text}),tasks?api.request('desktop/tasks',{q:parsed.text.slice(0,300)}):Promise.resolve({items:[]})]);
    page={...result,items:[...result.items,...taskRows.items.map(row=>({...row,kind:'task'}))]};
   }
   if(token!==generation.current)return;
   setState(old=>({items:append?[...new Map([...old.items,...page.items].map(row=>[row.kind+row.id,row])).values()]:page.items,cursor:page.next_cursor,truncated:page.truncated,loading:false}));
  }catch(err){if(token===generation.current)setState(old=>({...old,error:err.message,loading:false}));}
 }
 useEffect(()=>{setState({items:[],loading:true});if(error){setState({items:[],error,loading:false});return;}const timer=setTimeout(()=>load(),220);return()=>{clearTimeout(timer);generation.current++;};},[query,tasks]);
 return <section className="connected-document"><header className="connected-section-title"><h1>Search</h1>{!filtered&&!error&&query.trim()&&<button onClick={onSaveView}>Save this search</button>}</header><details className="connected-search-help"><summary>Search by frontmatter</summary><p>Try <code>type:essay tag:reading</code> or <code>property.status:"in progress"</code>. Filters inspect notebook Markdown, including custom types. Plain text searches all research.</p></details>{filtered&&<p>Notebook property matches in loaded results.{state.cursor?' Load more notes to continue checking.':''}</p>}{state.error&&<p role="alert">{state.error}{!error&&<button onClick={()=>load()}>Retry</button>}</p>}{state.loading&&<p role="status">Searching…</p>}{state.items.map(row=><button key={row.kind+row.id} className="connected-result" onClick={()=>onOpen(row)}><span>{row.title||'Untitled note'}</span><small>{row.thought_type||row.record_kind||row.kind}</small>{row.excerpt&&<p>{row.excerpt}</p>}</button>)}{!state.loading&&!state.error&&!state.items.length&&<p>{state.cursor?'No matches in these notes. Load more to continue.':'No current writing or records match.'}</p>}{state.cursor&&<button disabled={state.loading} onClick={()=>load(true)}>Check more notes</button>}{state.truncated&&<p>Narrow the search to see more precise results.</p>}</section>;
}
