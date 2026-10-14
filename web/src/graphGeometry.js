import { detectCommunities } from './graphLayout.js';

export const CARD_WIDTH = 224;
export const CARD_HEIGHT = 104;
const stable = nodes => [...nodes].sort((a, b) => a.id.localeCompare(b.id));

export function wrapLabel(label, limit = 27, maxLines = 3) {
  const words = String(label || 'Untitled record').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ''; }
    line += `${line ? ' ' : ''}${word}`;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].slice(0, limit - 1).trimEnd()}…`];
  return lines;
}

export function graphBounds(positions, padding = 50) {
  if (!positions.size) return { x: 0, y: 0, width: 900, height: 600 };
  const cards = [...positions.values()];
  const x = Math.min(...cards.map(p => p.x - p.width / 2)) - padding;
  const y = Math.min(...cards.map(p => p.y - p.height / 2)) - padding;
  return { x, y, width: Math.max(...cards.map(p => p.x + p.width / 2)) - x + padding, height: Math.max(...cards.map(p => p.y + p.height / 2)) - y + padding };
}

export function buildGraphView(nodes, edges, rootId, mode = 'focus') {
  const known = new Set(nodes.map(n => n.id));
  const validEdges = edges.filter(e => known.has(e.from) && known.has(e.to));
  const root = nodes.find(n => n.id === rootId) || stable(nodes)[0];
  const positions = new Map();
  if (!root) return { nodes: [], edges: [], positions, groups: [], bounds: graphBounds(positions), root: null };
  let shownNodes, shownEdges;
  const groups = [];
  if (mode === 'focus') {
    shownEdges = validEdges.filter(e => e.from === root.id || e.to === root.id);
    const neighbors = new Set(shownEdges.flatMap(e => [e.from, e.to]));
    neighbors.delete(root.id);
    shownNodes = [root, ...stable(nodes.filter(n => neighbors.has(n.id)))];
    positions.set(root.id, { x: 0, y: 0, width: 264, height: 120 });
    const count = shownNodes.length - 1;
    shownNodes.slice(1).forEach((node, i) => {
      const angle = count === 1 ? 0 : -Math.PI / 2 + i * Math.PI * 2 / count + (count === 4 ? Math.PI / 4 : 0);
      positions.set(node.id, { x: Math.cos(angle) * Math.max(430, count * 53), y: Math.sin(angle) * Math.max(260, count * 36), width: CARD_WIDTH, height: CARD_HEIGHT });
    });
  } else {
    shownNodes = stable(nodes);
    shownEdges = validEdges;
    const communities = detectCommunities(nodes, validEdges);
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(communities.length))));
    const cellWidth = 530;
    let rowTop = 0;
    for (let start = 0; start < communities.length; start += columns) {
      const row = communities.slice(start, start + columns);
      const rowHeight = Math.max(...row.map(g => Math.ceil(g.nodes.length / 2) * 140 + 76));
      row.forEach((group, col) => {
        const x = col * (cellWidth + 80);
        groups.push({ id: group.id, x, y: rowTop, width: cellWidth, height: rowHeight, count: group.nodes.length, label: group.label, nodeIds: group.nodes.map(n => n.id), internalCount: group.edges.length });
        stable(group.nodes).forEach((node, i) => positions.set(node.id, { x: x + 140 + (i % 2) * 250, y: rowTop + 106 + Math.floor(i / 2) * 140, width: CARD_WIDTH, height: CARD_HEIGHT }));
      });
      rowTop += rowHeight + 90;
    }
  }
  return { nodes: shownNodes, edges: shownEdges, positions, groups, root, bounds: graphBounds(positions, mode === 'network' ? 90 : 60) };
}

// Clip connectors to the visible card boundaries so arrowheads remain readable.
export function edgeGeometry(from, to, lane = 0) {
  if (from.x === to.x && from.y === to.y) {
    return { path: `M ${from.x - 35} ${from.y - from.height / 2} C ${from.x - 100} ${from.y - 150}, ${from.x + 100} ${from.y - 150}, ${from.x + 35} ${from.y - from.height / 2}`, label: { x: from.x, y: from.y - 132 } };
  }
  const dx = to.x - from.x, dy = to.y - from.y;
  const startT = 1 / Math.max(Math.abs(dx) / (from.width / 2 + 5), Math.abs(dy) / (from.height / 2 + 5));
  const endT = 1 / Math.max(Math.abs(dx) / (to.width / 2 + 10), Math.abs(dy) / (to.height / 2 + 10));
  const start = { x: from.x + dx * startT, y: from.y + dy * startT };
  const end = { x: to.x - dx * endT, y: to.y - dy * endT };
  const distance = Math.max(1, Math.hypot(dx, dy));
  const control = { x: (start.x + end.x) / 2 - dy / distance * lane * 32, y: (start.y + end.y) / 2 + dx / distance * lane * 32 };
  return { path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, label: { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 } };
}

export function aggregateLinks(groups, edges) {
  const owner = new Map(groups.flatMap(g => g.nodeIds.map(id => [id, g.id])));
  const links = new Map();
  for (const e of edges) {
    const from = owner.get(e.from), to = owner.get(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}`;
    if (!links.has(key)) links.set(key, { from, to, count: 0 });
    links.get(key).count++;
  }
  return [...links.values()];
}
