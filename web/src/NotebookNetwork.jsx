import React,{useMemo} from 'react';
import GraphMap from './GraphMap.jsx';
import NotebookMarkdown from './NotebookMarkdown.jsx';

export default function NotebookNetwork({network,graph,selected,onOpen,onOpenPassage}){
  const root=useMemo(()=>({id:graph.nodes.some(node=>node.id===selected)?selected:graph.nodes[0]?.id}),[graph,selected]);
  if(!graph.nodes.length)return <div className="notebook-welcome"><h3>A graph starts with a note.</h3><p>Save notes, then connect them with wiki links or explained connections.</p></div>;
  return <div className="notebook-network"><p>Saved notes and deliberate links. Node proximity does not imply agreement or evidence. {network.truncated?'Showing the most recent 200 active notes; backlinks and title resolution are incomplete.':'All active notes in this project are loaded.'}</p>
    <GraphMap searchLabel="Find a note" entryLabel="Notes" notesLabel="Note preview" key={network.project_id} nodes={graph.nodes} edges={graph.edges} active entryRequest={root} renderNotes={node=>{const note=network.items.find(row=>row.id===node.id);return <><button className="notebook-new" onClick={()=>onOpen(node.id)}>Open note ↗</button><NotebookMarkdown complete={!network.truncated} body={note?.body || ''} notes={network.items} onOpen={onOpen} onOpenPassage={onOpenPassage}/></>;}}/>
    {!!graph.unresolved.length && <details><summary>{graph.unresolved.length} unresolved or ambiguous wiki links</summary>{graph.unresolved.map((item,i)=><p key={i}>{network.items.find(row=>row.id===item.from)?.title} → [[{item.target}]] · {item.state}</p>)}</details>}
  </div>;
}
