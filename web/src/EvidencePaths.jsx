import React,{useState} from 'react';
import {ContextSource} from './RecordContext.jsx';
import {contextProperties} from './readingContext.js';
const ir='https://islam-research.local/vocab/';

/** Read directed evidence paths as inspectable steps with real source-version choices. */
export default function EvidencePaths({api,trail,onOpen,onCompare}){
  const [selected,setSelected]=useState(0);
  if(!trail)return <p role="status">Following recorded evidence trails…</p>;
  if(trail.failed)return <p role="status">Evidence trails could not load. Reopen this question to retry.</p>;
  const nodes=new Map(trail.nodes.map(node=>[node.id,node])),edges=new Map((trail.edges || []).map(edge=>[edge.id,edge]));
  const path=trail.paths[Math.min(selected,trail.paths.length-1)];
  return <section className="workspace-trails"><h3>Follow the evidence</h3><p>Question → attributed claim → located evidence → source. Arrows below preserve the actual relationship direction.</p>
    {trail.truncated && <p>Some trails were omitted by the search limits.</p>}
    {!path ? <p>No complete source trail is recorded in this graph yet.</p> : <>
      <label>Evidence trail<select value={Math.min(selected,trail.paths.length-1)} onChange={event=>setSelected(Number(event.target.value))}>{trail.paths.map((row,i)=><option key={row.edges.join('|')} value={i}>{i+1}. {nodes.get(row.records.at(-1))?.title || 'Recorded source'}</option>)}</select></label>
      <ol>{path.records.map((id,i)=>{const node=nodes.get(id),edge=edges.get(path.edges[i-1]);if(!node)return null;
        return <li key={id} className="evidence-step">{edge && <details><summary className="evidence-direction">{nodes.get(edge.from_id)?.kind || 'Record'} → {edge.predicate.split('/').pop()} → {nodes.get(edge.to_id)?.kind || 'record'} · {edge.review_state}</summary><pre>{JSON.stringify(edge.provenance,null,2)}</pre></details>}
          <small>{node.kind} · {node.review_state} · revision {node.revision}</small><button onClick={()=>onOpen(id,trail.project_id)}>{node.title}</button>{node.summary && <p>{node.summary}</p>}
          {contextProperties(node,ir+'locator').map((text,j)=><p key={j}>Location: {text}</p>)}
          {(node.attributes?.recorded_review_status || []).map((text,j)=><p key={j}>{text}</p>)}
          {['source','work','edition'].includes(node.kind) && <ContextSource key={node.id} api={api} projectId={trail.project_id} record={node} onOpen={onOpen} onCompare={onCompare}/>}
        </li>;})}</ol>
    </>}
    <small>Links and source locations retain their recorded review limits. Unavailable saved text is shown as a gap; these trails do not establish consensus.</small>
  </section>;
}
