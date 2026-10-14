import { detectCommunities } from './graphLayout.js';
import { adjacencyFor, neighborhood } from './graphAlgorithms.js';
import { graphBounds } from './graphGeometry.js';

// A bounded deterministic layout, computed once per graph change, with no animation timer.
export function layoutNetwork(nodes, edges) {
  const stable=[...nodes].sort((a,b)=>a.id.localeCompare(b.id));
  const known=new Set(stable.map(n=>n.id));
  const links=edges.filter(e=>known.has(e.from)&&known.has(e.to)&&e.from!==e.to);
  const groups=detectCommunities(stable,links);
  const owner=new Map(groups.flatMap((g,index)=>g.nodes.map(n=>[n.id,index])));
  const adjacency=adjacencyFor(stable,links);
  const n=stable.length;
  const points=stable.map((node,index)=>{
    const group=owner.get(node.id)||0, angle=group*Math.PI*2/Math.max(1,groups.length)-Math.PI/2;
    return {id:node.id,x:Math.cos(angle)*270+Math.cos(index*2.39996)*65,y:Math.sin(angle)*230+Math.sin(index*2.39996)*65};
  });
  const indexById=new Map(points.map((p,index)=>[p.id,index]));
  const simpleLinks=[];
  for(const [id,neighbors] of adjacency) for(const neighbor of neighbors) if(id<neighbor)simpleLinks.push([indexById.get(id),indexById.get(neighbor)]);
  for(let step=0;step<320;step++) {
    const forces=points.map(()=>({x:0,y:0}));
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
      const dx=points[i].x-points[j].x,dy=points[i].y-points[j].y;
      const distance=Math.max(1,Math.hypot(dx,dy));
      const strength=6500/(distance*distance);
      forces[i].x+=dx/distance*strength;forces[i].y+=dy/distance*strength;
      forces[j].x-=dx/distance*strength;forces[j].y-=dy/distance*strength;
    }
    for(const [i,j] of simpleLinks) {
      const dx=points[j].x-points[i].x,dy=points[j].y-points[i].y;
      const distance=Math.max(1,Math.hypot(dx,dy));
      const same=owner.get(points[i].id)===owner.get(points[j].id);
      const force=(distance-(same?110:210))*.025;
      forces[i].x+=dx/distance*force;forces[i].y+=dy/distance*force;
      forces[j].x-=dx/distance*force;forces[j].y-=dy/distance*force;
    }
    const cooling=1-step/400;
    for(let i=0;i<n;i++) {
      const angle=(owner.get(points[i].id)||0)*Math.PI*2/Math.max(1,groups.length)-Math.PI/2;
      forces[i].x+=(Math.cos(angle)*330-points[i].x)*.005;
      forces[i].y+=(Math.sin(angle)*270-points[i].y)*.005;
      points[i].x+=Math.max(-12,Math.min(12,forces[i].x))*cooling;
      points[i].y+=Math.max(-12,Math.min(12,forces[i].y))*cooling;
    }
  }
  const positions=new Map(points.map(p=>{const radius=6+Math.min(7,Math.sqrt(adjacency.get(p.id).length)*2);return[p.id,{...p,radius,width:radius*2,height:radius*2,group:owner.get(p.id)||0}];}));
  return {positions,groups,owner};
}

export function networkView(nodes, edges, layout, rootId, mode='network', depth=1, pins={}) {
  const known=new Set(nodes.map(n=>n.id));
  const valid=edges.filter(e=>known.has(e.from)&&known.has(e.to));
  const distances=neighborhood(nodes,valid,rootId,depth);
  const shown=mode==='focus'?nodes.filter(n=>distances.has(n.id)):nodes;
  const ids=new Set(shown.map(n=>n.id));
  const positions=new Map(shown.map(n=>[n.id,{...layout.positions.get(n.id),...pins[n.id]}]));
  const bounds=graphBounds(positions,90);
  return {nodes:shown,edges:valid.filter(e=>ids.has(e.from)&&ids.has(e.to)),positions,groups:[],root:nodes.find(n=>n.id===rootId)||shown[0],bounds,distances};
}

export function networkEdge(from,to,lane=0) {
  if(from.id===to.id)return {path:`M ${from.x-6} ${from.y-8} C ${from.x-45} ${from.y-65}, ${from.x+45} ${from.y-65}, ${from.x+6} ${from.y-8}`};
  const dx=to.x-from.x,dy=to.y-from.y,d=Math.max(1,Math.hypot(dx,dy));
  const sx=from.x+dx/d*(from.radius+3),sy=from.y+dy/d*(from.radius+3);
  const tx=to.x-dx/d*(to.radius+7),ty=to.y-dy/d*(to.radius+7);
  const offset=lane*28;
  return {path:`M ${sx} ${sy} Q ${(sx+tx)/2-dy/d*offset} ${(sy+ty)/2+dx/d*offset} ${tx} ${ty}`};
}

export function placeNetworkLabels(nodes, positions, scale = 1, bounds = null) {
  const placed=[], labels=new Map();
  const intersects=(a,b)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
  const marks=[...positions.values()].map(p=>({x:p.x-p.radius-4,y:p.y-p.radius-4,width:p.radius*2+8,height:p.radius*2+8}));
  for(const node of [...nodes].sort((a,b)=>(positions.get(b.id).radius-positions.get(a.id).radius)||a.id.localeCompare(b.id))) {
    const p=positions.get(node.id), text=node.label.length>33?`${node.label.slice(0,31)}…`:node.label;
    const width=text.length*6.8/scale,height=18/scale;
    const candidates=[{x:p.x+p.radius+8,y:p.y-9},{x:p.x-p.radius-8-width,y:p.y-9},{x:p.x-width/2,y:p.y+p.radius+8},{x:p.x-width/2,y:p.y-p.radius-8-height}];
    const scores=candidates.map(c=>{
      const outside=bounds?Math.max(0,bounds.x-c.x)+Math.max(0,c.x+width-bounds.x-bounds.width)+Math.max(0,bounds.y-c.y)+Math.max(0,c.y+height-bounds.y-bounds.height):0;
      return {...c,width,height,score:outside*100+[...placed,...marks].reduce((sum,b)=>sum+intersects({...c,width,height},b),0)};
    });
    scores.sort((a,b)=>a.score-b.score);
    const best=scores[0]; placed.push(best);labels.set(node.id,{...best,text,unobstructed:best.score===0});
  }
  return labels;
}
