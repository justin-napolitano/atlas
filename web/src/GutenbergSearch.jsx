import React,{useEffect,useRef,useState} from 'react';

export default function GutenbergSearch({api,onOpen}){
  const [query,setQuery]=useState(''),[result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  async function search(page=1){
    if(!query.trim())return;
    const token=++generation.current;setLoading(true);setError('');
    try{
      const value=await api.request('catalog/gutenberg/search',{q:page===1?query.trim():result.query,page});
      if(token!==generation.current)return;
      setResult(old=>({...value,items:page===1?value.items:[...old.items,...value.items]}));
    }catch(err){if(token===generation.current)setError(err.message || 'Gutenberg search is unavailable.');}
    finally{if(token===generation.current)setLoading(false);}
  }
  return <section className="gutenberg-search" aria-label="Find books"><form onSubmit={e=>{e.preventDefault();search();}}><label htmlFor="gutenberg-query">Find a book to read</label><div><input id="gutenberg-query" value={query} maxLength={200} onChange={e=>setQuery(e.target.value)} placeholder="Search Gutenberg by title or author…"/><button disabled={loading||!query.trim()}>{loading?'Searching…':'Search'}</button></div></form>
    <p className="gutenberg-catalog-caption">Project Gutenberg · Open a book, highlight, and write in the margin.</p>
    {error&&<p role="alert">{error} <button onClick={()=>search()}>Retry</button></p>}
    {result&&<><p role="status">{result.items.length} catalog results{result.next_page?' · more available':''}</p><div className="gutenberg-results">{result.items.map(row=><article key={row.book_id}><button className="gutenberg-book-title" onClick={()=>onOpen(row.book_id)}>{row.title}</button><p>{row.creators}</p><small>Gutenberg #{row.book_id} · Check available reading text</small></article>)}</div>{!result.items.length&&<p>No books found. Try another title or author.</p>}{result.next_page&&<button disabled={loading} onClick={()=>search(result.next_page)}>More books</button>}</>}
  </section>;
}
