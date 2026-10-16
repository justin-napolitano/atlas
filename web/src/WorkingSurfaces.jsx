import React,{forwardRef,useImperativeHandle,useLayoutEffect,useRef} from 'react';

// Keep open work mounted. Saved content remains owned by the existing APIs;
// this cache holds only the current browser session's interface state.
const WorkingSurfaces=forwardRef(function WorkingSurfaces({activeKey,ready=true,openKeys,children},ref){
  const pages=useRef(new Map()),nodes=useRef(new Map()),places=useRef(new Map()),active=useRef(activeKey);
  if(activeKey && ready)pages.current.set(activeKey,children);
  for(const key of pages.current.keys())if(!openKeys.includes(key) && key!==activeKey){pages.current.delete(key);places.current.delete(key);}
  function capture(){
    const key=active.current,node=nodes.current.get(key);if(!node)return;
    const scroll=[node.closest('.workspace-reader'),...node.querySelectorAll('*')].filter(el=>el && (el.scrollTop || el.scrollLeft)).map(el=>({el,top:el.scrollTop,left:el.scrollLeft}));
    const selection=window.getSelection();let range=places.current.get(key)?.range || null;
    if(selection?.rangeCount && node.contains(selection.anchorNode) && node.contains(selection.focusNode))range=selection.getRangeAt(0).cloneRange();
    places.current.set(key,{scroll,range});
  }
  useImperativeHandle(ref,()=>({capture}),[]);
  useLayoutEffect(()=>{
    active.current=activeKey;const place=places.current.get(activeKey);
    if(!place)return;
    const frame=requestAnimationFrame(()=>{for(const {el,top,left} of place.scroll)if(el.isConnected){el.scrollTop=top;el.scrollLeft=left;}
      if(place.range?.startContainer.isConnected && !place.range.collapsed){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(place.range);}
    });return()=>cancelAnimationFrame(frame);
  },[activeKey]);
  return <>{[...pages.current].map(([key,page])=><div className="working-surface" data-work-key={key} key={key} hidden={key!==activeKey} ref={node=>{if(node)nodes.current.set(key,node);else nodes.current.delete(key);}}>{page}</div>)}{(!activeKey || !pages.current.has(activeKey)) && (activeKey && !ready?<p role="status">Opening your work…</p>:children)}</>;
});
export default WorkingSurfaces;

export function WorkingTabs({items,activeKey,onChoose,onClose}){
  if(!items.length)return null;
  return <nav className="working-tabs" aria-label="Open work">{items.map(item=><div className="working-tab" key={item.key} data-active={item.key===activeKey || undefined}><button aria-current={item.key===activeKey?'page':undefined} title={item.title} onClick={()=>onChoose(item)}><small>{item.kind}</small><span>{item.title}</span></button><button className="working-tab-close" aria-label={'Close '+item.title} title="Close tab; unfinished writing stays in this session" onClick={()=>onClose(item)}>×</button></div>)}</nav>;
}
