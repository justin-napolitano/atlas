import React, { useMemo, useState } from 'react';
import { graphMetrics, pathSegments, shortestPath } from './graphAlgorithms.js';

const words=label=>String(label||'related').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
export default function GraphAnalysis({ nodes, edges, selectedId, path, onTrace, onInspect, onClear }) {
  const [tab,setTab]=useState('path');
  const [from,setFrom]=useState(()=>nodes.some(n=>n.id===selectedId)?selectedId:nodes[0]?.id||'');
  const [to,setTo]=useState('');
  const [directed,setDirected]=useState(false);
  const nodeMap=useMemo(()=>new Map(nodes.map(n=>[n.id,n])),[nodes]);
  const metrics=useMemo(()=>graphMetrics(nodes,edges),[nodes,edges]);
  const ranking=[...nodes].sort((a,b)=>{
    const x=metrics.get(a.id),y=metrics.get(b.id);
    return (tab==='bridges'?y.betweenness-x.betweenness:y.degree-x.degree)||a.label.localeCompare(b.label);
  }).slice(0,6);
  const effectiveFrom=nodeMap.has(from)?from:nodes[0]?.id||'';
  return <section className="graph-analysis" aria-label="Graph analysis">
    <div className="analysis-tabs" aria-label="Analysis tools">{[['path','Trace a path'],['hubs','Most connected'],['bridges','Bridges']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
    {tab==='path'?<>
      <form className="path-form" onSubmit={event=>{event.preventDefault();onTrace({from:effectiveFrom,to,directed,ids:shortestPath(nodes,edges,effectiveFrom,to,directed)});}}>
        <label>From<select aria-label="Path start" value={effectiveFrom} onChange={event=>setFrom(event.target.value)}>{nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
        <label>To<select aria-label="Path destination" required value={to} onChange={event=>setTo(event.target.value)}><option value="">Choose a record</option>{nodes.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
        <label>Traversal<select aria-label="Path direction" value={String(directed)} onChange={event=>setDirected(event.target.value==='true')}><option value="false">Either direction</option><option value="true">Follow arrows only</option></select></label>
        <button type="submit" disabled={!effectiveFrom||!nodeMap.has(to)}>Find shortest path</button>
      </form>
      {path&&<div className="path-result" aria-live="polite">{path.ids?<><p><b>{path.ids.length-1} {path.ids.length===2?'link':'links'}</b> · {path.directed?'following recorded arrows':'traversing links either way'} <button onClick={onClear}>Clear path</button></p><ol className="path-steps">{path.ids.map((id,index)=><li key={id}><button onClick={()=>onInspect(nodeMap.get(id))}>{nodeMap.get(id)?.label||id}</button>{index<path.ids.length-1&&<small>{pathSegments(path.ids,edges)[index].links.filter(e=>!path.directed||e.from===id).map((e,i)=><span key={i}>{e.from===id?'→':'←'} {words(e.label)}{e.from===id?'':' (reverse)'}</span>)}</small>}</li>)}</ol></>:<p>No path connects these records {path.directed?'following the recorded arrows':'in this graph'}. <button onClick={onClear}>Clear</button></p>}</div>}
      <p className="analysis-note">A path shows recorded connections, not logical support or proof. “Either direction” allows walking backwards along a link; its original direction is shown in the trail.</p>
    </>:<>
      <p className="analysis-note">{tab==='bridges'?'Betweenness finds records lying on shortest paths between other records. This is structural connectivity, not a measure of scholarly importance.':'Degree counts distinct connected records. Parallel relationship types count once; the score does not measure source quality.'}</p>
      <ol className="metric-ranking">{ranking.map(n=><li key={n.id}><button onClick={()=>onInspect(n)}><span><small>{n.type}</small>{n.label}</span><b>{tab==='bridges'?metrics.get(n.id).betweenness.toFixed(3):metrics.get(n.id).degree}<small>{tab==='bridges'?'normalized betweenness':'neighbors'}</small></b></button></li>)}</ol>
      {tab==='bridges'&&ranking.every(n=>metrics.get(n.id).betweenness===0)&&<p className="analysis-note">No record has a positive bridge score in this graph.</p>}
    </>}
    <p className="analysis-scope">Full filtered graph: {nodes.length} records and {edges.length} recorded links, including records outside a local neighborhood. Structural scores use an unweighted, undirected graph and exclude self-links.</p>
  </section>;
}
