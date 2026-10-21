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

const ExplorerContext=createContext(null);
function TreeLevel({api,parentId,folderId,activeId,expanded,toggle,onOpen,epoch,path,titles,depth=0}){
 const explorer=React.useContext(ExplorerContext),[page,setPage]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0),serial=useRef(0);
 const params={...(parentId?{parent_id:parentId}:{}),...(folderId?{folder_id:folderId}:{}),limit:15};
 useEffect(()=>{const key=++serial.current;setError('');api.request('desktop/tree',params).then(row=>{if(serial.current===key)setPage(row);}).catch(err=>{if(serial.current===key)setError(err.message);});return()=>{serial.current++;};},[parentId,folderId,epoch,version]);
 async function more(){const key=serial.current;try{const row=await api.request('desktop/tree',{...params,cursor:page.next_cursor});if(serial.current===key)setPage(old=>({...row,items:[...new Map([...old.items,...row.items].map(item=>[item.id,item])).values()]}));}catch(err){if(serial.current===key)setError(err.message);}}
 const container=parentId||folderId,desiredIndex=container?path.findIndex(row=>row.id===container)+1:0,desired=desiredIndex>=0?path[desiredIndex]:null;
 const rows=page?.items||[],raw=desired&&!rows.some(row=>row.id===desired.id)?[...rows,{...desired,has_children:desiredIndex<path.length-1}]:rows,items=raw.map(row=>({...row,kind:row.kind||'page',title:titles.get(row.id)||row.title}));
 return <div className="page-tree-level" role="group">{items.map(row=><div key={row.id}><div className={'page-tree-row'+(explorer.over===row.id?' page-tree-drop':'')} style={{paddingInlineStart:Math.min(depth,20)*10}}
 draggable={!explorer.busy} onDragStart={e=>explorer.startDrag(e,row)} onDragEnd={explorer.endDrag} onDragOver={e=>explorer.dragOver(e,row)} onDrop={e=>explorer.drop(e,row)} onContextMenu={e=>{e.preventDefault();explorer.openMenu(row);}}>
 {(row.has_children||row.kind==='folder')?<button className="page-tree-expand" aria-label={`${expanded.has(row.id)?'Collapse':'Expand'} ${row.title}`} aria-expanded={expanded.has(row.id)} onClick={()=>toggle(row.id)}>{expanded.has(row.id)?'⌄':'›'}</button>:<span className="page-tree-leaf" aria-hidden="true">·</span>}
 <button className="page-tree-title" aria-current={activeId===row.id?'page':undefined} onClick={()=>row.kind==='folder'?toggle(row.id):onOpen({kind:'entry',id:row.id})} title={row.title}>{row.kind==='folder'&&<span className="page-folder-icon" aria-hidden="true">▱ </span>}{row.title}</button>
 <button className="page-tree-actions" aria-label={'Actions for '+row.title} aria-expanded={explorer.menu?.id===row.id} onClick={()=>explorer.openMenu(row)}>···</button></div>
 {explorer.menu?.id===row.id&&explorer.renderMenu(row)}
 {row.has_children&&expanded.has(row.id)&&depth<48&&<TreeLevel api={api} parentId={row.kind==='page'?row.id:null} folderId={row.kind==='folder'?row.id:null} activeId={activeId} expanded={expanded} toggle={toggle} onOpen={onOpen} epoch={epoch} path={path} titles={titles} depth={depth+1}/>}</div>)}
 {!page&&!error&&<small role="status">Loading pages…</small>}{error&&<small role="alert">{error} <button onClick={()=>setVersion(n=>n+1)}>Retry</button></small>}{page?.next_cursor&&<button className="page-tree-more" onClick={more}>More pages</button>}</div>;
}

export function PageTree({api,activeId,onOpen,onCapture,onChanged,epoch,drafts=[],titles=new Map()}){
 const [expanded,setExpanded]=useState(new Set()),[path,setPath]=useState([]),[version,setVersion]=useState(0),[editing,setEditing]=useState(null),[name,setName]=useState(''),[menu,setMenu]=useState(null),[moving,setMoving]=useState(null),[query,setQuery]=useState(''),[results,setResults]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[over,setOver]=useState(null),drag=useRef(null),pending=useRef(null),input=useRef(null);
 const treeEpoch=epoch+':'+version;
 useEffect(()=>{let live=true;if(!activeId){setPath([]);return;}api.request('desktop/page',{entry_id:activeId}).then(row=>{if(!live)return;const ancestors=row.ancestors.filter(item=>!item.unavailable);setPath([...ancestors,...(row.current?[{...row.current,kind:'page',placement_revision:row.placement_revision}]:[])]);setExpanded(old=>new Set([...old,...ancestors.map(item=>item.id)]));}).catch(()=>{if(live)setPath([]);});return()=>{live=false;};},[activeId,treeEpoch]);
 useEffect(()=>{if(editing)requestAnimationFrame(()=>{input.current?.focus();input.current?.select();});},[editing]);
 useEffect(()=>{let live=true;if(!moving)return;const timer=setTimeout(()=>api.request('desktop/tree',{q:query,all_items:true,limit:20}).then(row=>{if(live)setResults(row.items.filter(item=>item.id!==moving.id&&(moving.kind!=='folder'||item.kind==='folder')));}).catch(err=>{if(live)setError(err.message);}),120);return()=>{live=false;clearTimeout(timer);};},[moving,query]);
 const toggle=id=>setExpanded(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;});
 async function mutate(endpoint,payload,after){
  if(busy)return;setBusy(true);setError('');pending.current??={endpoint,payload,after};const request=pending.current;
  try{const row=await api.post(request.endpoint,request.payload);pending.current=null;setVersion(n=>n+1);onChanged();setMenu(null);setMoving(null);setEditing(null);request.after?.(row);}
  catch(err){if([400,409,422].includes(err.status)){pending.current=null;setVersion(n=>n+1);setError(err.status===409?'This item changed. Choose it again to use its current placement.':'Cannot make that change. Check for a cycle, nesting limit, or a folder that still contains notes.');}else setError(err.message);}
  finally{setBusy(false);}
 }
 function editFolder(row=null,parent_id=null){if(pending.current)return;setMenu(null);setName(row?.title||'');setEditing({row,parent_id});}
 function saveFolder(){if(!name.trim())return;const row=editing.row;mutate('desktop/folders',{request_uuid:crypto.randomUUID(),action:row?'rename':'create',folder_id:row?.id||null,title:name.trim(),parent_id:editing.parent_id,expected_revision:row?.placement_revision||0,owner_confirmed:true},value=>{if(value.parent_id)setExpanded(old=>new Set([...old,value.parent_id]));});}
 function createNote(folder){mutate('desktop/pages/prepare',{request_uuid:crypto.randomUUID(),folder_id:folder.id,owner_confirmed:true},row=>{setExpanded(old=>new Set([...old,folder.id]));onCapture(row.request_uuid);});}
 async function move(row,target){
  if(pending.current||busy)return;
  let revision=row.placement_revision;
  try{if(revision==null&&row.kind!=='folder')revision=(await api.request('desktop/page',{entry_id:row.id})).placement_revision;}
  catch(err){setError(err.message);return;}
  const folder=row.kind==='folder';
  const payload={request_uuid:crypto.randomUUID(),expected_revision:revision||0,owner_confirmed:true,...(folder?{action:'move',folder_id:row.id,parent_id:target?.id||null}:{entry_id:row.id,parent_id:target?.kind==='page'?target.id:null,folder_id:target?.kind==='folder'?target.id:null})};
  mutate(folder?'desktop/folders':'desktop/pages/parent',payload,()=>{if(target)setExpanded(old=>new Set([...old,target.id]));});
 }
 function openMenu(row){if(pending.current)return;setMenu(old=>old?.id===row.id?null:row);setEditing(null);setMoving(null);}
 function renderMenu(row){return <div className="page-tree-menu" role="group" aria-label={'Actions for '+row.title}>{row.kind==='folder'&&<><button disabled={busy} onClick={()=>createNote(row)}>New note</button><button disabled={busy} onClick={()=>editFolder(null,row.id)}>New folder</button><button disabled={busy} onClick={()=>editFolder(row)}>Rename</button></>}<button disabled={busy} onClick={()=>{setMoving(row);setQuery('');setMenu(null);}}>Move…</button>{row.kind==='folder'&&<button disabled={busy||row.has_children} onClick={()=>mutate('desktop/folders',{request_uuid:crypto.randomUUID(),action:'remove',folder_id:row.id,expected_revision:row.placement_revision,owner_confirmed:true})}>Remove empty folder</button>}<button onClick={()=>setMenu(null)}>Close</button></div>;}
 function allowed(target){const row=drag.current;return row&&!busy&&!pending.current&&row.id!==target?.id&&(!target||target.kind==='folder'||row.kind!=='folder');}
 function startDrag(event,row){if(busy||pending.current){event.preventDefault();return;}drag.current=row;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-atlas-page',row.id);setMenu(null);}
 function endDrag(){drag.current=null;setOver(null);}
 function dragOver(event,target){if(!allowed(target))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';setOver(target?.id||'root');}
 function drop(event,target){if(!allowed(target))return;event.preventDefault();event.stopPropagation();const row=drag.current;endDrag();move(row,target);}
 const explorer={menu,openMenu,renderMenu,busy,over,startDrag,endDrag,dragOver,drop};
 return <ExplorerContext.Provider value={explorer}><section className="connected-page-tree" aria-label="Pages"><header className={'page-tree-heading'+(over==='root'?' page-tree-drop':'')} onDragOver={e=>dragOver(e,null)} onDrop={e=>drop(e,null)}><h2>Notes</h2><button disabled={busy||!!pending.current} aria-label="New folder" title="New folder" onClick={()=>editFolder()}>＋ ▱</button></header>
 {editing&&<div className="page-folder-name"><input ref={input} aria-label={editing.row?'Rename folder':'Folder name'} placeholder="Folder name" value={name} disabled={busy||!!pending.current} maxLength={300} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveFolder();}if(e.key==='Escape'&&!pending.current)setEditing(null);}}/><button disabled={!name.trim()||busy||!!pending.current} onClick={saveFolder}>✓</button><button disabled={busy||!!pending.current} aria-label="Cancel folder name" onClick={()=>setEditing(null)}>×</button></div>}
 {moving&&<section className="page-tree-move" aria-label={'Move '+moving.title}><input autoFocus aria-label="Find destination" placeholder="Find destination…" value={query} disabled={busy||!!pending.current} onChange={e=>setQuery(e.target.value)}/><button disabled={busy||!!pending.current} onClick={()=>move(moving,null)}>Top level</button>{results.map(row=><button className="page-search-result" disabled={busy||!!pending.current} key={row.id} onClick={()=>move(moving,row)}>{row.kind==='folder'?'▱ ':''}{row.title}</button>)}<button disabled={busy||!!pending.current} onClick={()=>setMoving(null)}>Cancel</button></section>}
 {drafts.map(row=><button className="page-tree-draft" key={row.id} onClick={()=>onOpen({kind:'entry',id:row.id})}>{row.title} <small>Unsaved</small></button>)}
 <TreeLevel api={api} activeId={activeId} expanded={expanded} toggle={toggle} onOpen={onOpen} epoch={treeEpoch} path={path} titles={titles}/>
 {over&&<small className="page-drop-hint">Drop onto a folder or page. Drop on “Notes” for top level.</small>}{error&&<p role="alert">{error}{pending.current&&<button disabled={busy} onClick={()=>mutate()}>Retry exact change</button>}</p>}
 </section></ExplorerContext.Provider>;
}

export function PageHeader({api,session,onOpen,onCapture,onChanged,epoch}){
 const [data,setData]=useState(null),[moving,setMoving]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),pending=useRef(null),child=useRef(null),uncertain=useRef(false);
 useSurfaceResume(()=>setVersion(n=>n+1));
 useEffect(()=>{let live=true;api.request('desktop/page',{entry_id:session.id}).then(row=>{if(live)setData(row);}).catch(err=>{if(live&&session.row)setError(err.message);});return()=>{live=false;};},[session.id,session.row?.id,epoch,version]);
 useEffect(()=>{let live=true;if(!moving)return;const timer=setTimeout(()=>api.request('desktop/tree',{q:query,all_items:true,limit:12}).then(row=>{if(live)setResults(row.items.filter(item=>item.id!==session.id));}).catch(err=>{if(live)setError(err.message);}),120);return()=>{live=false;clearTimeout(timer);};},[moving,query,session.id]);
 async function newChild(){setBusy(true);setError('');try{await session.flush();if(!session.saved)throw Error('Save this page before adding a subpage.');child.current??={request_uuid:crypto.randomUUID(),parent_id:session.id,owner_confirmed:true};const row=await api.post('desktop/pages/prepare',child.current);if(row.entry_id!=='urn:research:notebook:'+child.current.request_uuid||row.parent_id!==session.id)throw Error('Subpage preparation was not confirmed. Retry this exact action.');const requestUUID=child.current.request_uuid;child.current=null;onCapture(requestUUID);}catch(err){setError(err.message);}finally{setBusy(false);}}
 async function move(parent_id,folder_id=null){setBusy(true);setError('');try{pending.current??={request_uuid:crypto.randomUUID(),entry_id:session.id,parent_id,folder_id,expected_revision:data?.placement_revision||0,owner_confirmed:true};const row=await api.post('desktop/pages/parent',pending.current);if(row.entry_id!==session.id||row.revision!==pending.current.expected_revision+1)throw Error('Page move was not confirmed. Retry the same move.');pending.current=null;uncertain.current=false;setMoving(false);setVersion(n=>n+1);onChanged();}
  catch(err){if([400,422].includes(err.status)&&!uncertain.current){pending.current=null;setError('Choose another parent. Cycles and nesting beyond 32 levels are not allowed.');}else{uncertain.current=true;setError(err.status===409?'This page moved elsewhere. Refresh its placement before choosing another parent.':err.message);}}finally{setBusy(false);}}
 return <div className="local-page-header"><nav className="page-breadcrumbs" aria-label="Page breadcrumbs"><button onClick={()=>onOpen({view:'notes'})}>Notes</button>{data?.ancestors.map(row=><React.Fragment key={row.id}><span aria-hidden="true">/</span><button disabled={row.unavailable||row.kind==='folder'} onClick={()=>onOpen({kind:'entry',id:row.id})}>{row.kind==='folder'?'▱ ':''}{row.title}</button></React.Fragment>)}</nav>
 {session.row&&!session.row.trashed&&<div className="page-header-actions"><button disabled={busy||!session.saved} onClick={newChild}>{child.current?'Retry subpage':'＋ Subpage'}</button><button aria-expanded={moving} disabled={busy||!!pending.current} onClick={()=>setMoving(!moving)}>Move</button></div>}
 {moving&&<section className="page-move-picker" aria-label="Move page"><input autoFocus aria-label="Find parent page" placeholder="Move under a page…" value={query} disabled={busy||!!pending.current} onChange={e=>setQuery(e.target.value)}/><button disabled={busy||!!pending.current} onClick={()=>move(null)}>Top level</button>{results.map(row=><button className="page-search-result" disabled={busy||!!pending.current} key={row.id} onClick={()=>move(row.kind==='folder'?null:row.id,row.kind==='folder'?row.id:null)}><span>{row.kind==='folder'?'▱ ':''}{row.title}</span><small>{row.parent_title||'Top level'}</small></button>)}</section>}
 {error&&<p role="alert">{error}{pending.current&&<><button disabled={busy} onClick={()=>move(pending.current.parent_id,pending.current.folder_id)}>Retry exact move</button><button disabled={busy} onClick={()=>{pending.current=null;uncertain.current=false;setVersion(n=>n+1);setMoving(false);setError('');onChanged();}}>Refresh placement</button></>}</p>}</div>;
}

export function PageRelationships({api,entryId,onOpen,epoch}){
 const [children,setChildren]=useState(null),[backlinks,setBacklinks]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useSurfaceResume(()=>setVersion(n=>n+1));
 useEffect(()=>{let live=true;Promise.all([api.request('desktop/pages',{parent_id:entryId,limit:20}),api.request('desktop/pages/backlinks',{entry_id:entryId,limit:20})]).then(([child,back])=>{if(live){setChildren(child);setBacklinks(back);setError('');}}).catch(err=>{if(live)setError(err.message);});return()=>{live=false;};},[entryId,epoch,version]);
 async function more(kind){const page=kind==='children'?children:backlinks;try{const next=await api.request(kind==='children'?'desktop/pages':'desktop/pages/backlinks',{...(kind==='children'?{parent_id:entryId}:{entry_id:entryId}),cursor:page.next_cursor,limit:20});(kind==='children'?setChildren:setBacklinks)(old=>({...next,items:[...new Map([...old.items,...next.items].map(row=>[row.id,row])).values()]}));}catch(err){setError(err.message);}}
 return <section className="page-relationships">{[['children',children,'Subpages'],['backlinks',backlinks,'Linked from']].map(([kind,page,label])=>!!page?.items.length&&<div key={kind}><h2>{label}</h2>{page.items.map(row=><button className="page-related-link" key={row.id} onClick={()=>onOpen({kind:'entry',id:row.id})}>↗ {row.title}</button>)}{page.next_cursor&&<button onClick={()=>more(kind)}>More {label.toLowerCase()}</button>}</div>)}{error&&<p role="alert">{error}</p>}</section>;
}
