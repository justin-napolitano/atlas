import React, { useMemo } from 'react';
import { networkEdge, placeNetworkLabels } from './networkLayout.js';

export default function NetworkLayer({ view, selectedId, hovered, rootId, marker, path, showLabels, scale = 1, bounds, onInspect, onHover, onNodeDown, suppressClick }) {
  const labels=useMemo(()=>placeNetworkLabels(view.nodes,view.positions,scale,bounds),[view.nodes,view.positions,scale,bounds]);
  const pathIds=new Set(path?.ids||[]);
  const pathPairs=new Set((path?.ids||[]).slice(1).map((id,i)=>[path.ids[i],id].sort().join('|')));
  const active=hovered||selectedId;
  const lanes=new Map();
  return <g className="network-layer">
    <g>{view.edges.map((edge,index)=>{
      const a=view.positions.get(edge.from),b=view.positions.get(edge.to),pair=[edge.from,edge.to].sort().join('|');
      const lane=lanes.get(pair)||0;lanes.set(pair,lane+1);
      const curve=networkEdge(a,b,lane);
      const traced=pathPairs.has(pair)&&(!path?.directed||path.ids.some((id,i)=>id===edge.from&&path.ids[i+1]===edge.to)),near=edge.from===active||edge.to===active;
      return <path key={`${index}-${pair}`} data-network-edge="true" className={`network-edge ${traced?'path-edge':''} ${near?'near-edge':''} ${pathIds.size&&!traced?'outside-path':''}`} d={curve.path} markerEnd={`url(#${marker}-arrow)`}><title>{`${edge.from.split('/').at(-1)} → ${edge.label} → ${edge.to.split('/').at(-1)}`}</title></path>;
    })}</g>
    <g>{view.nodes.map(node=>{
      const p=view.positions.get(node.id),label=labels.get(node.id),selected=node.id===selectedId;
      const highlighted=selected||node.id===hovered||pathIds.has(node.id);
      const visible=showLabels==='all'||label.unobstructed||highlighted;
      return <g key={node.id} data-record={node.id} data-network-node="true" transform={`translate(${p.x} ${p.y})`} className={`network-node ${selected?'inspected':''} ${node.id===rootId?'root':''} ${pathIds.has(node.id)?'on-path':''} ${pathIds.size&&!pathIds.has(node.id)?'outside-path':''}`} style={{'--node-color':`var(--group-${p.group%8})`}} role="button" tabIndex={0} aria-label={`${node.type}: ${node.label}. Read notes.`} aria-pressed={selected}
        onPointerDown={event=>onNodeDown(event,node,p)}
        onMouseEnter={()=>onHover(node.id)} onMouseLeave={()=>onHover(null)} onFocus={()=>onHover(node.id)} onBlur={()=>onHover(null)}
        onClick={()=>{if(!suppressClick.current)onInspect(node);suppressClick.current=false;}}
        onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onInspect(node);}}}>
        <title>{`${node.label}\n${node.type} · drag to reposition; click to read`}</title>
        <circle className="network-hit" r={Math.max(22/scale,p.radius+8)}/>
        {(selected||pathIds.has(node.id))&&<circle className="network-ring" r={p.radius+7}/>}
        <circle className="network-dot" r={p.radius}/>
        {visible&&<text className={`network-label ${highlighted?'prominent':''}`} x={label.x-p.x} y={label.y-p.y+13/scale} style={{fontSize:`${12/scale}px`}}>{label.text}</text>}
      </g>;
    })}</g>
  </g>;
}
