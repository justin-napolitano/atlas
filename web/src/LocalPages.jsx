import React,{createContext,useEffect,useRef,useState} from 'react';
import {useModalFocus} from './useModalFocus.js';
import {useSurfaceResume} from './surfaceActivity.js';
import './localPages.css';

export const PageLinkContext=createContext({enabled:false});

export function PageLinksProvider({enabled,api,onOpen,onCreate,children}){
 const [lookup,setLookup]=useState(null),serial=useRef(0),modal=useRef(null);
 useModalFocus(modal,!!lookup);
 async function openWiki(target){
  const key=++serial.current;setLookup({target,loading:true});
  try{const value=await api.request('desktop/pages/resolve',{target});if(serial.current!==key)return;
   if(value.state==='resolved'){setLookup(null);onOpen({kind:'entry',id:value.items[0].id});}
   else setLookup({target,...value});
  }catch(error){if(serial.current===key)setLookup({target,error:error.message});}
 }
 function close(){serial.current++;setLookup(null);}
 return <PageLinkContext.Provider value={{enabled,api,openWiki}}>{children}{lookup&&<div className="page-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section ref={modal} className="page-link-dialog" role="dialog" aria-modal="true" aria-label="Follow page link" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}}>
 <header><strong>{lookup.target.startsWith('urn:')?'Linked page':lookup.target}</strong><button aria-label="Close page link" onClick={close}>×</button></header>
 {lookup.loading?<p role="status">Finding page…</p>:lookup.error?<p role="alert">{lookup.error} <button onClick={()=>openWiki(lookup.target)}>Retry</button></p>:lookup.items?.length?<><p>Which page?</p>{lookup.items.map(page=><button className="page-search-result" key={page.id} onClick={()=>{close();onOpen({kind:'entry',id:page.id});}}><span>{page.title}</span><small>{page.parent_title||page.id.slice(-8)}</small></button>)}{lookup.truncated&&<small>More matches exist. Use search or insert a stable page link.</small>}</>:<><p>{lookup.state==='unavailable'?'The original page is unavailable or in Trash.':'No active page has this exact title.'}</p>{!lookup.target.startsWith('urn:')&&<button onClick={()=>{const title=lookup.target.slice(0,300);close();onCreate(title);}}>Create this page</button>}</>}
 </section></div>}</PageLinkContext.Provider>;
}

function TreeLevel({api,parentId,activeId,expanded,toggle,onOpen,epoch,path,titles,depth=0}){
 const [page,setPage]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0),serial=useRef(0);
 useEffect(()=>{const key=++serial.current;setError('');api.request('desktop/pages',{...(parentId?{parent_id:parentId}:{}),limit:15}).then(row=>{if(serial.current===key)setPage(row);}).catch(err=>{if(serial.current===key)setError(err.message);});return()=>{serial.current++;};},[parentId,epoch,version]);
 async function more(){const key=serial.current;try{const row=await api.request('desktop/pages',{...(parentId?{parent_id:parentId}:{}),limit:15,cursor:page.next_cursor});if(serial.current===key)setPage(old=>({...row,items:[...new Map([...old.items,...row.items].map(item=>[item.id,item])).values()]}));}catch(err){if(serial.current===key)setError(err.message);}}
 const desiredIndex=parentId?path.findIndex(row=>row.id===parentId)+1:0,desired=desiredIndex>=0?path[desiredIndex]:null;
 const rows=page?.items||[],raw=desired&&!rows.some(row=>row.id===desired.id)?[...rows,{...desired,has_children:desiredIndex<path.length-1}]:rows,items=raw.map(row=>({...row,title:titles.get(row.id)||row.title}));
 return <div className="page-tree-level" role="group">{items.map(row=><div key={row.id}><div className="page-tree-row" style={{paddingInlineStart:Math.min(depth,12)*10}}>
 {row.has_children?<button className="page-tree-expand" aria-label={`${expanded.has(row.id)?'Collapse':'Expand'} ${row.title}`} aria-expanded={expanded.has(row.id)} onClick={()=>toggle(row.id)}>{expanded.has(row.id)?'⌄':'›'}</button>:<span className="page-tree-leaf" aria-hidden="true">·</span>}
 <button className="page-tree-title" aria-current={activeId===row.id?'page':undefined} onClick={()=>onOpen({kind:'entry',id:row.id})} title={row.title}>{row.title}</button></div>
 {row.has_children&&expanded.has(row.id)&&depth<32&&<TreeLevel api={api} parentId={row.id} activeId={activeId} expanded={expanded} toggle={toggle} onOpen={onOpen} epoch={epoch} path={path} titles={titles} depth={depth+1}/>}</div>)}
 {!page&&!error&&<small role="status">Loading pages…</small>}{error&&<small role="alert">{error} <button onClick={()=>setVersion(n=>n+1)}>Retry</button></small>}{page?.next_cursor&&<button className="page-tree-more" onClick={more}>More pages</button>}</div>;
}

export function PageTree({api,activeId,onOpen,epoch,drafts=[],titles=new Map()}){
 const [expanded,setExpanded]=useState(new Set()),[path,setPath]=useState([]);
 useEffect(()=>{let live=true;if(!activeId){setPath([]);return;}api.request('desktop/page',{entry_id:activeId}).then(row=>{if(!live)return;const ancestors=row.ancestors.filter(item=>!item.unavailable);setPath([...ancestors,...(row.current?[row.current]:[])]);setExpanded(old=>new Set([...old,...ancestors.map(item=>item.id)]));}).catch(()=>{if(live)setPath([]);});return()=>{live=false;};},[activeId,epoch]);
 return <section className="connected-page-tree" aria-label="Pages"><h2>Pages</h2>{drafts.map(row=><button className="page-tree-draft" key={row.id} onClick={()=>onOpen({kind:'entry',id:row.id})}>{row.title} <small>Unsaved</small></button>)}<TreeLevel api={api} activeId={activeId} expanded={expanded} toggle={id=>setExpanded(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;})} onOpen={onOpen} epoch={epoch} path={path} titles={titles}/></section>;
}

export function PageHeader({api,session,onOpen,onCapture,onChanged,epoch}){
 const [data,setData]=useState(null),[moving,setMoving]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),pending=useRef(null),child=useRef(null),uncertain=useRef(false);
 useSurfaceResume(()=>setVersion(n=>n+1));
 useEffect(()=>{let live=true;api.request('desktop/page',{entry_id:session.id}).then(row=>{if(live)setData(row);}).catch(err=>{if(live&&session.row)setError(err.message);});return()=>{live=false;};},[session.id,session.row?.id,epoch,version]);
 useEffect(()=>{let live=true;if(!moving)return;const timer=setTimeout(()=>api.request('desktop/pages',{q:query,all_pages:true,limit:12}).then(row=>{if(live)setResults(row.items.filter(item=>item.id!==session.id));}).catch(err=>{if(live)setError(err.message);}),120);return()=>{live=false;clearTimeout(timer);};},[moving,query,session.id]);
 async function newChild(){setBusy(true);setError('');try{await session.flush();if(!session.saved)throw Error('Save this page before adding a subpage.');child.current??={request_uuid:crypto.randomUUID(),parent_id:session.id,owner_confirmed:true};const row=await api.post('desktop/pages/prepare',child.current);if(row.entry_id!=='urn:research:notebook:'+child.current.request_uuid||row.parent_id!==session.id)throw Error('Subpage preparation was not confirmed. Retry this exact action.');const requestUUID=child.current.request_uuid;child.current=null;onCapture(requestUUID);}catch(err){setError(err.message);}finally{setBusy(false);}}
 async function move(parent_id){setBusy(true);setError('');try{pending.current??={request_uuid:crypto.randomUUID(),entry_id:session.id,parent_id,expected_revision:data?.placement_revision||0,owner_confirmed:true};const row=await api.post('desktop/pages/parent',pending.current);if(row.entry_id!==session.id||row.revision!==pending.current.expected_revision+1)throw Error('Page move was not confirmed. Retry the same move.');pending.current=null;uncertain.current=false;setMoving(false);setVersion(n=>n+1);onChanged();}
  catch(err){if([400,422].includes(err.status)&&!uncertain.current){pending.current=null;setError('Choose another parent. Cycles and nesting beyond 32 levels are not allowed.');}else{uncertain.current=true;setError(err.status===409?'This page moved elsewhere. Refresh its placement before choosing another parent.':err.message);}}finally{setBusy(false);}}
 return <div className="local-page-header"><nav className="page-breadcrumbs" aria-label="Page breadcrumbs"><button onClick={()=>onOpen({view:'notes'})}>Notes</button>{data?.ancestors.map(row=><React.Fragment key={row.id}><span aria-hidden="true">/</span><button disabled={row.unavailable} onClick={()=>onOpen({kind:'entry',id:row.id})}>{row.title}</button></React.Fragment>)}</nav>
 {session.row&&!session.row.trashed&&<div className="page-header-actions"><button disabled={busy||!session.saved} onClick={newChild}>{child.current?'Retry subpage':'＋ Subpage'}</button><button aria-expanded={moving} disabled={busy||!!pending.current} onClick={()=>setMoving(!moving)}>Move</button></div>}
 {moving&&<section className="page-move-picker" aria-label="Move page"><input autoFocus aria-label="Find parent page" placeholder="Move under a page…" value={query} disabled={busy||!!pending.current} onChange={e=>setQuery(e.target.value)}/><button disabled={busy||!!pending.current} onClick={()=>move(null)}>Top level</button>{results.map(row=><button className="page-search-result" disabled={busy||!!pending.current} key={row.id} onClick={()=>move(row.id)}><span>{row.title}</span><small>{row.parent_title||'Top level'}</small></button>)}</section>}
 {error&&<p role="alert">{error}{pending.current&&<><button disabled={busy} onClick={()=>move(pending.current.parent_id)}>Retry exact move</button><button disabled={busy} onClick={()=>{pending.current=null;uncertain.current=false;setVersion(n=>n+1);setMoving(false);setError('');onChanged();}}>Refresh placement</button></>}</p>}</div>;
}

export function PageRelationships({api,entryId,onOpen,epoch}){
 const [children,setChildren]=useState(null),[backlinks,setBacklinks]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useSurfaceResume(()=>setVersion(n=>n+1));
 useEffect(()=>{let live=true;Promise.all([api.request('desktop/pages',{parent_id:entryId,limit:20}),api.request('desktop/pages/backlinks',{entry_id:entryId,limit:20})]).then(([child,back])=>{if(live){setChildren(child);setBacklinks(back);setError('');}}).catch(err=>{if(live)setError(err.message);});return()=>{live=false;};},[entryId,epoch,version]);
 async function more(kind){const page=kind==='children'?children:backlinks;try{const next=await api.request(kind==='children'?'desktop/pages':'desktop/pages/backlinks',{...(kind==='children'?{parent_id:entryId}:{entry_id:entryId}),cursor:page.next_cursor,limit:20});(kind==='children'?setChildren:setBacklinks)(old=>({...next,items:[...new Map([...old.items,...next.items].map(row=>[row.id,row])).values()]}));}catch(err){setError(err.message);}}
 return <section className="page-relationships">{[['children',children,'Subpages'],['backlinks',backlinks,'Linked from']].map(([kind,page,label])=>!!page?.items.length&&<div key={kind}><h2>{label}</h2>{page.items.map(row=><button className="page-related-link" key={row.id} onClick={()=>onOpen({kind:'entry',id:row.id})}>↗ {row.title}</button>)}{page.next_cursor&&<button onClick={()=>more(kind)}>More {label.toLowerCase()}</button>}</div>)}{error&&<p role="alert">{error}</p>}</section>;
}
