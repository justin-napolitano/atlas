import React,{useEffect,useRef,useState} from 'react';
import './researchDestinations.css';
import GutenbergSearch from './GutenbergSearch.jsx';
import './gutenberg.css';

const sourceKinds=['source','work','edition'];
export default function ResearchSources({api,projectId,readings=[],onOpen,onAdd,onQuestion,onMoreReadings,onOpenGutenberg}){
  const [rows,setRows]=useState([]),[cursors,setCursors]=useState({}),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  async function load(append=false){const token=++generation.current;setLoading(true);setError('');
    try{const kinds=append?sourceKinds.filter(kind=>cursors[kind]):sourceKinds;
      const pages=await Promise.all(kinds.map(async kind=>({kind,page:await api.request('records',{project_id:projectId,kind,limit:50,...(append?{cursor:cursors[kind]}:{})})})));
      if(pages.some(({page})=>!Array.isArray(page.items)||page.items.some(row=>row.project_id!==projectId)))throw new Error('The source list did not match this project.');
      if(token!==generation.current)return;
      setRows(old=>[...new Map([...(append?old:[]),...pages.flatMap(({page})=>page.items.filter(row=>sourceKinds.includes(row.kind)))].map(row=>[row.id,row])).values()]);
      setCursors(Object.fromEntries(pages.map(({kind,page})=>[kind,page.next_cursor || null])));
    }catch(err){if(token===generation.current)setError(err.message || 'Could not load sources.');}finally{if(token===generation.current)setLoading(false);}}
  useEffect(()=>{setRows([]);setCursors({});setQuery('');load();return()=>{generation.current++;};},[projectId]);
  const versions=id=>readings.filter(row=>row.record_id===id);
  const visible=rows.filter(row=>(row.title+' '+(row.summary || '')).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())&&(filter==='all'||versions(row.id).length));
  return <section className="research-sources" aria-label="Source library"><header className="research-destination-heading"><div><span>Your references and readings</span><h2>Sources</h2><p>Keep the reference. Read the text. Follow a question.</p></div><button className="research-primary-action" onClick={onAdd}>Add source</button></header>
    {onOpenGutenberg&&<GutenbergSearch api={api} onOpen={onOpenGutenberg}/>}
    <div className="research-source-controls"><label>Find a source<input value={query} maxLength={300} onChange={event=>setQuery(event.target.value)} placeholder="Title or description"/></label><div role="group" aria-label="Source view"><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All sources</button><button aria-pressed={filter==='text'} onClick={()=>setFilter('text')}>With saved text</button></div></div>
    <p role="status">{loading?'Loading your sources…':error || `${visible.length} sources shown`}{query.trim()?' · matching loaded titles and descriptions':''}</p>
    {!loading&&!rows.length&&!error&&<div className="research-destination-empty"><h3>Start your library.</h3><p>Add a reference now; bring in a permitted reading excerpt whenever you have one.</p><button onClick={onAdd}>Add your first source</button></div>}
    {error&&<button onClick={()=>load()}>Retry sources</button>}
    <div className="research-source-list">{visible.map(row=>{const documents=versions(row.id);return <article key={row.id}><div><small>{row.kind} · {row.review_state || 'Review not stated'}{documents.some(item=>item.reading==='read')?' · Read by you':''}</small><button className="research-source-title" onClick={()=>onOpen(row.id,projectId,'',documents[0]?.document_id || '')}>{row.title}</button>{row.summary&&<p>{row.summary}</p>}<span>{documents.length?`${documents.length} loaded reading ${documents.length===1?'excerpt':'excerpts'}`:'Reference · open to view or add text'}</span></div><div className="research-source-actions"><button onClick={()=>onOpen(row.id,projectId,'',documents[0]?.document_id || '')}>{documents.length?'Read source':'Open source'}</button><button onClick={()=>onQuestion(row)}>Ask a question</button></div>{documents.length>1&&<div className="research-source-editions">{documents.map(item=><button key={item.document_id} onClick={()=>onOpen(row.id,projectId,'',item.document_id)}>{item.locator || item.edition}</button>)}</div>}</article>;})}</div>
    {Object.values(cursors).some(Boolean)&&<button disabled={loading} onClick={()=>load(true)}>More sources</button>}
    {onMoreReadings&&<button onClick={onMoreReadings}>More saved readings</button>}
    <footer>Source records and saved excerpts are separate. Reading progress does not establish scholarly review.</footer>
  </section>;
}
