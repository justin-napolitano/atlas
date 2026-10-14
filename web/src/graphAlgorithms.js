/** Structural algorithms on explicit recorded links; parallel predicates count once. */
export function adjacencyFor(nodes, edges, directed = false) {
  const adjacency = new Map(nodes.map(n => [n.id, new Set()]));
  for (const edge of edges) {
    if (!adjacency.has(edge.from) || !adjacency.has(edge.to) || edge.from === edge.to) continue;
    adjacency.get(edge.from).add(edge.to);
    if (!directed) adjacency.get(edge.to).add(edge.from);
  }
  return new Map([...adjacency].sort(([a],[b]) => a.localeCompare(b)).map(([id, neighbors]) => [id, [...neighbors].sort()]));
}

export function neighborhood(nodes, edges, rootId, depth = 1) {
  const adjacency = adjacencyFor(nodes, edges);
  const distances = new Map();
  if (!adjacency.has(rootId)) return distances;
  const queue = [rootId]; distances.set(rootId, 0);
  for (let i=0; i<queue.length; i++) {
    const id=queue[i], distance=distances.get(id);
    if (distance >= depth) continue;
    for (const next of adjacency.get(id)) if (!distances.has(next)) { distances.set(next,distance+1); queue.push(next); }
  }
  return distances;
}

export function shortestPath(nodes, edges, from, to, directed = false) {
  const adjacency = adjacencyFor(nodes,edges,directed);
  if (!adjacency.has(from) || !adjacency.has(to)) return null;
  const parent = new Map([[from,null]]), queue=[from];
  for(let i=0;i<queue.length;i++) {
    const id=queue[i];
    if(id===to) { const path=[]; for(let n=id;n!==null;n=parent.get(n)) path.push(n); return path.reverse(); }
    for(const next of adjacency.get(id)) if(!parent.has(next)) {parent.set(next,id);queue.push(next);}
  }
  return null;
}

/** Brandes betweenness, unweighted undirected simple graph, normalized across all nodes. */
export function graphMetrics(nodes, edges) {
  const adjacency=adjacencyFor(nodes,edges), ids=[...adjacency.keys()];
  const centrality=new Map(ids.map(id=>[id,0]));
  for(const source of ids) {
    const stack=[], queue=[source];
    const predecessors=new Map(ids.map(id=>[id,[]]));
    const paths=new Map(ids.map(id=>[id,id===source?1:0]));
    const distance=new Map(ids.map(id=>[id,id===source?0:-1]));
    for(let i=0;i<queue.length;i++) {
      const v=queue[i]; stack.push(v);
      for(const w of adjacency.get(v)) {
        if(distance.get(w)<0) {queue.push(w);distance.set(w,distance.get(v)+1);}
        if(distance.get(w)===distance.get(v)+1) {paths.set(w,paths.get(w)+paths.get(v));predecessors.get(w).push(v);}
      }
    }
    const delta=new Map(ids.map(id=>[id,0]));
    while(stack.length) {
      const w=stack.pop();
      for(const v of predecessors.get(w)) delta.set(v,delta.get(v)+paths.get(v)/paths.get(w)*(1+delta.get(w)));
      if(w!==source) centrality.set(w,centrality.get(w)+delta.get(w));
    }
  }
  const denominator=ids.length>2?(ids.length-1)*(ids.length-2):1;
  return new Map(ids.map(id=>[id,{degree:adjacency.get(id).length,betweenness:centrality.get(id)/denominator}]));
}

export function pathSegments(path, edges) {
  if (!path) return [];
  return path.slice(1).map((to,index) => {
    const from=path[index];
    return {from,to,links:edges.filter(e=>(e.from===from&&e.to===to)||(e.from===to&&e.to===from))};
  });
}
