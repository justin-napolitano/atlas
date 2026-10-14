const EPSILON = 1e-9;
const sortedEdges = edges => [...edges].sort((a, b) =>
  a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || String(a.label || '').localeCompare(String(b.label || '')));

/**
 * Deterministic, unweighted Louvain-style local moving for small research graphs.
 * RDF predicates are treated as undirected for community discovery only; the
 * displayed edge retains its original direction and relation label.
 */
export function detectCommunities(nodes, edges) {
  const ids = nodes.map(node => node.id).sort();
  const known = new Set(ids);
  const adjacency = new Map(ids.map(id => [id, new Map()]));
  const stableEdges = sortedEdges(edges);
  for (const edge of stableEdges) {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) continue;
    adjacency.get(edge.from).set(edge.to, (adjacency.get(edge.from).get(edge.to) || 0) + 1);
    adjacency.get(edge.to).set(edge.from, (adjacency.get(edge.to).get(edge.from) || 0) + 1);
  }
  const degree = new Map(ids.map(id => [id, [...adjacency.get(id).values()].reduce((sum, count) => sum + count, 0)]));
  const community = new Map(ids.map(id => [id, id]));
  const communityDegree = new Map(ids.map(id => [id, degree.get(id)]));
  const twoM = [...degree.values()].reduce((sum, value) => sum + value, 0);

  if (twoM > 0) {
    for (let pass = 0; pass < 50; pass++) {
      let moved = false;
      for (const id of ids) {
        const nodeDegree = degree.get(id);
        if (!nodeDegree) continue;
        const old = community.get(id);
        communityDegree.set(old, communityDegree.get(old) - nodeDegree);
        const weights = new Map();
        for (const [neighbor, weight] of adjacency.get(id)) {
          const neighborCommunity = community.get(neighbor);
          weights.set(neighborCommunity, (weights.get(neighborCommunity) || 0) + weight);
        }
        const choices = [...new Set([...weights.keys(), old])].sort();
        let best = old;
        let bestScore = (weights.get(old) || 0) - nodeDegree * (communityDegree.get(old) || 0) / twoM;
        for (const candidate of choices) {
          const score = (weights.get(candidate) || 0) - nodeDegree * (communityDegree.get(candidate) || 0) / twoM;
          if (score > bestScore + EPSILON) {
            best = candidate;
            bestScore = score;
          }
        }
        community.set(id, best);
        communityDegree.set(best, (communityDegree.get(best) || 0) + nodeDegree);
        if (best !== old) moved = true;
      }
      if (!moved) break;
    }
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const groups = new Map();
  for (const id of ids) {
    const key = community.get(id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(nodeById.get(id));
  }
  return [...groups.values()]
    .map(members => members.sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => b.length - a.length || a[0].id.localeCompare(b[0].id))
    .map((members, index) => {
      const memberIds = new Set(members.map(node => node.id));
      const links = stableEdges.filter(edge => memberIds.has(edge.from) && memberIds.has(edge.to));
      const hub = [...members].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.label.localeCompare(b.label))[0];
      return { id: `community-${index + 1}`, label: hub.label, nodes: members, edges: links, degree };
    });
}

export function layoutCommunities(nodes, edges, width = 1050, height = 650) {
  const groups = detectCommunities(nodes, edges);
  const stableNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const stableEdges = sortedEdges(edges);
  const positions = new Map();
  const groupById = new Map();
  const cols = Math.max(1, Math.ceil(Math.sqrt(groups.length * width / height)));
  const rows = Math.max(1, Math.ceil(groups.length / cols));
  const cellWidth = width / cols;
  const cellHeight = height / rows;

  groups.forEach((group, groupIndex) => {
    const col = groupIndex % cols;
    const row = Math.floor(groupIndex / cols);
    const center = { x: cellWidth * (col + .5), y: cellHeight * (row + .5) };
    const spread = Math.max(24, Math.min(cellWidth, cellHeight) * .31, Math.sqrt(group.nodes.length) * 26);
    group.nodes.forEach((node, index) => {
      const angle = index * 2.399963 + groupIndex * .71;
      const distance = index === 0 ? 0 : spread * Math.sqrt(index / Math.max(1, group.nodes.length - 1));
      positions.set(node.id, { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance });
      groupById.set(node.id, group.id);
    });
  });

  const nodeIds = stableNodes.map(node => node.id);
  for (let step = 0; step < 100; step++) {
    const forces = new Map(nodeIds.map(id => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < nodeIds.length; i++) for (let j = i + 1; j < nodeIds.length; j++) {
      const a = positions.get(nodeIds[i]), b = positions.get(nodeIds[j]);
      const dx = a.x - b.x, dy = a.y - b.y, distance = Math.max(1, Math.hypot(dx, dy));
      const push = 900 / (distance * distance);
      forces.get(nodeIds[i]).x += dx / distance * push;
      forces.get(nodeIds[i]).y += dy / distance * push;
      forces.get(nodeIds[j]).x -= dx / distance * push;
      forces.get(nodeIds[j]).y -= dy / distance * push;
    }
    for (const edge of stableEdges) {
      const a = positions.get(edge.from), b = positions.get(edge.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const pull = (distance - 72) * .006;
      forces.get(edge.from).x += dx / distance * pull;
      forces.get(edge.from).y += dy / distance * pull;
      forces.get(edge.to).x -= dx / distance * pull;
      forces.get(edge.to).y -= dy / distance * pull;
    }
    for (const id of nodeIds) {
      const point = positions.get(id), force = forces.get(id);
      const groupIndex = Number(groupById.get(id).split('-')[1]) - 1;
      const center = { x: cellWidth * (groupIndex % cols + .5), y: cellHeight * (Math.floor(groupIndex / cols) + .5) };
      point.x = Math.max(32, Math.min(width - 32, point.x + force.x + (center.x - point.x) * .018));
      point.y = Math.max(28, Math.min(height - 28, point.y + force.y + (center.y - point.y) * .018));
    }
  }

  const degree = new Map(nodeIds.map(id => [id, 0]));
  edges.forEach(edge => {
    if (degree.has(edge.from)) degree.set(edge.from, degree.get(edge.from) + 1);
    if (degree.has(edge.to)) degree.set(edge.to, degree.get(edge.to) + 1);
  });
  return { groups, positions, groupById, degree };
}
