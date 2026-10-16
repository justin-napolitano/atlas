import React,{useLayoutEffect,useRef,useState} from 'react';
import {readingPointRect} from './readingPosition.js';

/** Point markers live outside source text so selecting/copying it stays exact. */
export default function ReadingNoteMarkers({textRoot,notes,documentId,activeId,onOpen}){
  const layer=useRef(null),[groups,setGroups]=useState([]);
  useLayoutEffect(()=>{
    const root=textRoot.current,container=layer.current?.parentElement;if(!root||!container)return;
    let frame;const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const box=container.getBoundingClientRect(),viewport=root.getBoundingClientRect(),found=[];
      for(const note of notes){const rect=readingPointRect(root,note.reading_position);if(!rect||rect.bottom<viewport.top||rect.top>viewport.bottom)continue;
        const top=Math.max(0,rect.top-box.top),group=found.find(g=>Math.abs(g.top-top)<20);
        if(group)group.ids.push(note.id);else found.push({top,ids:[note.id]});}
      setGroups(old=>JSON.stringify(old)===JSON.stringify(found)?old:found);
    });};
    const observer=new ResizeObserver(measure);observer.observe(root);root.addEventListener('scroll',measure);window.addEventListener('resize',measure);measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();root.removeEventListener('scroll',measure);window.removeEventListener('resize',measure);};
  },[textRoot,documentId,notes]);
  return <div ref={layer} className="reading-point-markers">{groups.map(group=><button key={group.ids.join(':')} style={{top:group.top}} className="reading-point-marker" aria-label={`Open ${group.ids.length===1?'location note':group.ids.length+' location notes'}`} aria-pressed={group.ids.includes(activeId)} onClick={()=>onOpen(group.ids)}><span aria-hidden="true">{group.ids.length>1?group.ids.length:'•'}</span></button>)}</div>;
}
