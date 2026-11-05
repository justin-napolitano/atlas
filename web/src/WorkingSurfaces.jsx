import React,{forwardRef,useImperativeHandle,useLayoutEffect,useRef} from 'react';
import {SurfaceActivity} from './surfaceActivity.js';
import {warmKeys} from './workingCache.js';

// Keep open work mounted. Saved content remains owned by the existing APIs;
// this cache holds only the current browser session's interface state.
const WorkingSurfaces=forwardRef(function WorkingSurfaces({activeKey,ready=true,openKeys,protectedKeys=new Set(),limit=4,transientKey,children},ref){
  const pages=useRef(new Map()),nodes=useRef(new Map()),places=useRef(new Map()),active=useRef(activeKey),transient=useRef(null);
  if(activeKey && ready){pages.current.delete(activeKey);pages.current.set(activeKey,children);}
  for(const key of pages.current.keys())if(!openKeys.includes(key) && key!==activeKey){pages.current.delete(key);places.current.delete(key);}
  const warm=warmKeys([...pages.current.keys()],activeKey,protectedKeys,limit);
  for(const key of pages.current.keys())if(!warm.has(key))pages.current.delete(key);
  function path(root,node){const result=[];while(node&&node!==root){result.unshift([...node.parentNode.childNodes].indexOf(node));node=node.parentNode;}return node===root?result:null;}
  function resolve(root,route){if(!route)return null;return route.reduce((node,index)=>node?.childNodes[index],root);}
  function capture(){
    const key=active.current,node=nodes.current.get(key);if(!node)return;
    const outer=node.closest('.workspace-reader');
    const scroll=[outer,...node.querySelectorAll('*')].filter(el=>el && (el===outer || el.scrollHeight>el.clientHeight || el.scrollWidth>el.clientWidth)).map(el=>({outer:el===outer,path:el===outer?null:path(node,el),top:el.scrollTop,left:el.scrollLeft}));
    const selection=window.getSelection();let range=places.current.get(key)?.range || null;
    if(selection?.rangeCount && node.contains(selection.anchorNode) && node.contains(selection.focusNode)){const selected=selection.getRangeAt(0);range={start:path(node,selected.startContainer),startOffset:selected.startOffset,end:path(node,selected.endContainer),endOffset:selected.endOffset,text:selected.toString()};}
    places.current.set(key,{scroll,range});
  }
  useImperativeHandle(ref,()=>({capture}),[]);
  useLayoutEffect(()=>{if(!activeKey){const outer=transient.current?.closest('.workspace-reader');if(outer)outer.scrollTop=0;}},[activeKey,transientKey]);
  useLayoutEffect(()=>{
    active.current=activeKey;const place=places.current.get(activeKey);
    if(!place)return;
    const frame=requestAnimationFrame(()=>{const node=nodes.current.get(activeKey);if(!node)return;for(const item of place.scroll){const el=item.outer?node.closest('.workspace-reader'):resolve(node,item.path);if(el){el.scrollTop=item.top;el.scrollLeft=item.left;}}
      if(place.range){try{const range=document.createRange();range.setStart(resolve(node,place.range.start),place.range.startOffset);range.setEnd(resolve(node,place.range.end),place.range.endOffset);if(range.toString()===place.range.text){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}}catch{/* Changed DOM: exact reading anchors remain owned by the reader. */}}
    });return()=>cancelAnimationFrame(frame);
  },[activeKey,ready]);
  return <><small className="working-cache-status" data-mounted-pages={pages.current.size}>{pages.current.size>limit?`${pages.current.size} pages kept open to protect unfinished work. Save or discard changes to free memory.`:''}</small>{[...pages.current].map(([key,page])=><div className="working-surface" data-work-key={key} key={key} hidden={key!==activeKey || !ready} ref={node=>{if(node)nodes.current.set(key,node);else nodes.current.delete(key);}}><SurfaceActivity.Provider value={key===activeKey && ready}>{page}</SurfaceActivity.Provider></div>)}{activeKey && !ready?<p role="status">Opening your work…</p>:(!activeKey || !pages.current.has(activeKey)) && <div ref={transient} className="working-transient">{children}</div>}</>;
});
export default WorkingSurfaces;

export function WorkingTabs({items,activeKey,onChoose,onClose,statuses={}}){
  const bar=useRef(null);
  useLayoutEffect(()=>{const reveal=()=>{const selected=bar.current?.querySelector('[aria-current=page]')?.parentElement;if(selected && bar.current){const bounds=selected.getBoundingClientRect(),container=bar.current.getBoundingClientRect();const left=bar.current.scrollLeft+bounds.left-container.left-(bar.current.clientWidth-bounds.width)/2;bar.current.scrollLeft=Math.max(0,left);}};reveal();if(!bar.current)return;const observer=new ResizeObserver(reveal);observer.observe(bar.current);return()=>observer.disconnect();},[activeKey,items.length]);
  if(!items.length)return null;
  return <nav ref={bar} className="working-tabs" aria-label="Open work">{items.map(item=><div className="working-tab" key={item.key} data-active={item.key===activeKey || undefined}><button aria-current={item.key===activeKey?'page':undefined} title={item.title} onClick={()=>onChoose(item)}><small>{item.kind}</small><span>{item.title}</span>{statuses[item.key]&&<em className="working-tab-status">{statuses[item.key]}</em>}</button><button className="working-tab-close" aria-label={'Close '+item.title} title={statuses[item.key]?'Save, export, or discard unfinished changes before closing':'Close tab'} onClick={()=>onClose(item)}>×</button></div>)}</nav>;
}
