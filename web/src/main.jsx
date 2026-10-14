import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const tabs = ['Overview', 'Map', 'Sources', 'Arguments', 'Discovery'];
const colors = { concept: '#1b806b', source: '#5776a5', evidence: '#a47a36', claim: '#ad614b', question: '#655a91', hypothesis: '#a64f6b', person: '#68747c', project: '#64736a', record: '#777' };
const types = ['concept', 'source', 'evidence', 'claim', 'question', 'hypothesis', 'person', 'project', 'record'];
const pretty = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const shortId = id => id?.split('/').at(-1)?.replaceAll('-', ' ') || 'Record';

function App() {
  const [graph, setGraph] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('Overview');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [hovered, setHovered] = useState(null);
  useEffect(() => {
    let active = true;
    fetch('/data/public-graph.json').then(response => {
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
      return response.json();
    }).then(data => { if (active) setGraph(data); }).catch(error => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, []);
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const candidates = graph?.candidates || [];
  const filtered = useMemo(() => nodes.filter(n => {
    const matchesType = kind === 'all' || n.type === kind;
    const haystack = `${n.label} ${n.type} ${n.status} ${n.summary} ${n.people?.join(' ')}`.toLowerCase();
    return matchesType && haystack.includes(query.toLowerCase());
  }), [kind, query, nodes]);
  const filteredCandidates = useMemo(() => candidates.filter(c => {
    const text = `${c.title} ${c.venue} ${c.work_type} ${c.providers.join(' ')} ${c.authors.join(' ')} ${c.queries.join(' ')}`.toLowerCase();
    const providerMatch = providerFilter === 'all' || c.providers.includes(providerFilter);
    const yearMatch = yearFilter === 'all' || String(c.year || 'unknown') === yearFilter;
    return text.includes(query.toLowerCase()) && providerMatch && yearMatch;
  }), [query, providerFilter, yearFilter]);
  const candidateProviders = [...new Set(candidates.flatMap(c => c.providers))].sort();
  const candidateYears = [...new Set(candidates.map(c => c.year).filter(Boolean))].sort((a, b) => b - a);
  const visibleIds = new Set(filtered.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const selectedNode = selected ? nodeMap.get(selected) : null;
  const related = selected ? edges.filter(e => e.from === selected || e.to === selected) : [];
  const connected = new Set(related.flatMap(e => [e.from, e.to]));
  const width = 1050, height = 650;
  const degree = useMemo(() => {
    const counts = new Map(nodes.map(node => [node.id, 0]));
    edges.forEach(edge => { counts.set(edge.from, (counts.get(edge.from) || 0) + 1); counts.set(edge.to, (counts.get(edge.to) || 0) + 1); });
    return counts;
  }, [nodes, edges]);
  const positions = useMemo(() => {
    const anchors = { concept: [220, 175], source: [790, 150], evidence: [820, 420], claim: [520, 505], question: [500, 150], hypothesis: [250, 455], person: [500, 325], project: [190, 320], record: [780, 300] };
    const points = new Map();
    const groups = new Map();
    nodes.forEach(node => { const group = groups.get(node.type) || []; group.push(node); groups.set(node.type, group); });
    for (const [type, group] of groups) {
      const [ax, ay] = anchors[type] || [width / 2, height / 2];
      group.forEach((node, index) => {
        const angle = index * 2.399963 + (type.length * .4);
        const spread = 17 + Math.sqrt(index) * 39;
        points.set(node.id, { x: ax + Math.cos(angle) * spread, y: ay + Math.sin(angle) * spread });
      });
    }
    // Small deterministic force relaxation: linked records settle together while
    // type anchors retain readable semantic neighborhoods across daily rebuilds.
    for (let step = 0; step < 90; step++) {
      const forces = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]));
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = points.get(nodes[i].id), b = points.get(nodes[j].id), dx = a.x - b.x, dy = a.y - b.y;
        const distance = Math.max(1, Math.hypot(dx, dy)), push = 1250 / (distance * distance);
        const fa = forces.get(nodes[i].id), fb = forces.get(nodes[j].id);
        fa.x += dx / distance * push; fa.y += dy / distance * push; fb.x -= dx / distance * push; fb.y -= dy / distance * push;
      }
      for (const edge of edges) {
        const a = points.get(edge.from), b = points.get(edge.to); if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy)), pull = (distance - 105) * .006;
        forces.get(edge.from).x += dx / distance * pull; forces.get(edge.from).y += dy / distance * pull;
        forces.get(edge.to).x -= dx / distance * pull; forces.get(edge.to).y -= dy / distance * pull;
      }
      for (const node of nodes) {
        const point = points.get(node.id), force = forces.get(node.id), [ax, ay] = anchors[node.type] || [width / 2, height / 2];
        point.x = Math.max(44, Math.min(width - 44, point.x + force.x + (ax - point.x) * .012));
        point.y = Math.max(35, Math.min(height - 35, point.y + force.y + (ay - point.y) * .012));
      }
    }
    return points;
  }, [nodes, edges]);
  const typeCounts = types.map(type => ({ type, count: nodes.filter(node => node.type === type).length })).filter(item => item.count);
  const hubs = [...nodes].sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0)).slice(0, 4);

  function openNode(node) {
    setSelected(node.id);
    setSelectedCandidate(null);
    setMobilePanel(true);
  }
  function openCandidate(candidate) {
    setSelected(null);
    setSelectedCandidate(candidate.id);
    setMobilePanel(true);
  }

  if (!graph && !loadError) return <main className="shell loading-state"><div className="brand-mark">IR</div><p>Loading the latest public research snapshot…</p></main>;
  if (!graph) return <main className="shell loading-state"><div className="brand-mark">IR</div><h1>Snapshot unavailable</h1><p>{loadError}</p><button onClick={() => location.reload()}>Try again</button></main>;

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setTab('Overview'); }} aria-label="Research studio home"><span className="brand-mark">IR</span><span>Research studio<small>Projects · evidence · ideas</small></span></a>
      <nav aria-label="Main navigation">{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <a className="repo-link" href="https://github.com/justin-napolitano/islam-research" target="_blank" rel="noreferrer">Project repo ↗</a>
    </header>
    <section className={`intro ${tab === 'Overview' ? 'overview-intro' : ''}`}>
      <div><div className="eyebrow">{tab === 'Overview' ? 'YOUR RESEARCH DESK' : 'A living research project'} <span className="status-dot"/> public snapshot</div><h1>{tab === 'Overview' ? <>A home for<br/><em>what you’re learning.</em></> : <>Follow the evidence.<br/><em>See where it leads.</em></>}</h1><p>{tab === 'Overview' ? 'Projects, reading trails, and connected ideas in one place. Each workspace can publish its own daily snapshot.' : 'Explore a developing map of sources, interpretations, and questions. Every record keeps its scope and review status visible.'}</p></div>
      <div className="stats"><div><b>{nodes.length}</b><span>curated records</span></div><div><b>{edges.length}</b><span>relationships</span></div><div><b>{nodes.filter(n => n.type === 'source').length}</b><span>reviewed sources</span></div><div><b>{candidates.length}</b><span>discovery leads</span></div></div>
    </section>
    <section className="workbench">
      <div className="toolbar">
        {tab !== 'Overview' && <div className="searchbox"><span>⌕</span><input aria-label="Search graph" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sources, concepts, claims…"/></div>}
        {tab === 'Discovery' ? <><select aria-label="Filter by provider" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}><option value="all">All providers</option>{candidateProviders.map(p => <option key={p}>{p}</option>)}</select><select aria-label="Filter candidates by year" value={yearFilter} onChange={e => setYearFilter(e.target.value)}><option value="all">All years</option>{candidateYears.map(y => <option key={y}>{y}</option>)}</select></> : tab !== 'Overview' && <select aria-label="Filter by record type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All record types</option>{types.map(t => <option key={t} value={t}>{pretty(t)}</option>)}</select>}
        {tab !== 'Overview' && <span className="result-count">{tab === 'Discovery' ? `${filteredCandidates.length} discovery leads` : `${filtered.length} of ${nodes.length} records`}</span>}
      </div>
      <div className={`workspace ${tab === 'Overview' ? 'overview-workspace' : ''}`}>
        <div className="mainview">
          {tab === 'Overview' && <Overview nodes={nodes} edges={edges} candidates={candidates} generatedAt={graph.generated_at} onOpen={setTab}/>}
          {tab === 'Map' && <div className="map-wrap">
            <div className="map-label"><div><span>CONNECTED RESEARCH LANDSCAPE</span><small>Clusters show record types · node size shows recorded connections</small></div><span>Links show recorded relationships, not consensus.</span></div>
            <div className="map-canvas"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Interactive network with ${nodes.length} records and ${edges.length} relationships`}>
              <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#d6d1c7"/></pattern></defs><rect width={width} height={height} fill="url(#dots)"/>
              <g>{edges.map((edge, i) => { const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null; const visible = visibleIds.has(edge.from) && visibleIds.has(edge.to); const focus = !selected || (connected.has(edge.from) && connected.has(edge.to)); return <line key={`${i}-${edge.from}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge ${visible ? '' : 'hidden'} ${focus ? '' : 'faded'} ${selected && (edge.from === selected || edge.to === selected) ? 'edge-selected' : ''}`} />; })}</g>
              <g>{nodes.map(n => { const p = positions.get(n.id); if (!p) return null; const active = visibleIds.has(n.id); const focus = !selected || connected.has(n.id); const degreeCount = degree.get(n.id) || 0; return <g key={n.id} transform={`translate(${p.x} ${p.y})`} className={`map-node ${active ? '' : 'hidden'} ${focus ? '' : 'faded'} ${selected === n.id ? 'chosen' : ''}`} tabIndex={active ? 0 : -1} role="button" aria-label={`${n.type}: ${n.label}, ${degreeCount} recorded connections`} onMouseEnter={() => setHovered(n.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(n.id)} onBlur={() => setHovered(null)} onClick={() => openNode(n)} onKeyDown={e => e.key === 'Enter' && openNode(n)}><circle r={6 + Math.min(7, degreeCount * 1.2)} fill={colors[n.type] || colors.record}/><text className={selected === n.id || hovered === n.id || degreeCount >= 3 ? 'label-on' : ''} x="12" y="4">{n.label.length > 31 ? `${n.label.slice(0, 29)}…` : n.label}</text></g>; })}</g>
            </svg></div>
            <div className="legend">{types.filter(t => nodes.some(n => n.type === t)).map(t => <span key={t}><i style={{background: colors[t]}}/>{pretty(t)}</span>)}</div>
            <section className="map-insights"><div className="concentration-card"><span className="eyebrow">RECORD MIX</span>{typeCounts.map(item => <div className="mix-row" key={item.type}><span>{pretty(item.type)}</span><div><i style={{width: `${Math.max(5, item.count / nodes.length * 100)}%`, background: colors[item.type]}}/></div><b>{item.count}</b></div>)}</div><div className="hub-card"><span className="eyebrow">MOST CONNECTED RECORDS</span>{hubs.map(node => <button key={node.id} onClick={() => openNode(node)}><span className="hub-dot" style={{background: colors[node.type]}}/><span>{node.label}</span><b>{degree.get(node.id) || 0}</b></button>)}</div></section>
          </div>}
          {tab === 'Sources' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">BIBLIOGRAPHY</span><h2>Sources in the graph</h2></div><span>{filtered.filter(n => n.type === 'source').length} visible</span></div><div className="source-list">{filtered.filter(n => n.type === 'source').map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}</div></div>}
          {tab === 'Arguments' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">ATTRIBUTED RECORDS</span><h2>Interpretations & questions</h2></div><span>Claims stay attached to their sources</span></div><div className="source-list">{filtered.filter(n => ['claim', 'evidence', 'question', 'hypothesis'].includes(n.type)).map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}</div></div>}
          {tab === 'Discovery' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">LITERATURE DISCOVERY</span><h2>Unreviewed source leads</h2></div><span>{filteredCandidates.length} of {candidates.length} leads</span></div><div className="discovery-note"><b>Discovery is not evaluation.</b> These {candidates.length.toLocaleString()} records are bibliographic leads returned by literature discovery services. Search matching and rank are provenance only; they do not establish relevance, scholarly quality, support for a claim, or consensus. Each record remains unreviewed.</div><div className="source-list">{filteredCandidates.map(c => <CandidateRow key={c.id} candidate={c} onClick={() => openCandidate(c)}/>)}</div></div>}
        </div>
        <aside className={`details ${mobilePanel ? 'mobile-open' : ''}`}>
          <button className="close-panel" onClick={() => setMobilePanel(false)} aria-label="Close details">×</button>
          {selectedNode ? <Detail node={selectedNode} related={related} nodeMap={nodeMap} onSelect={id => setSelected(id)}/> : selectedCandidate ? <CandidateDetail candidate={candidates.find(c => c.id === selectedCandidate)}/> : <><span className="eyebrow">RECORD DETAILS</span><h2>Start exploring</h2><p className="body-copy">Select a point on the map, a source, or a discovery lead to inspect its description, provenance, and connections.</p><div className="callout"><b>How to read this map</b><p>Records distinguish primary texts, scholarship, attributed interpretations, and researcher questions. Links record the project’s current understanding; they do not prove a claim.</p></div><div className="snapshot-note"><span className="status-dot"/> Curated graph + sanitized metadata snapshot<br/><small>Private screening notes and local files are excluded.</small></div></>}
        </aside>
      </div>
    </section>
    <footer><span>Built from the project’s curated RDF graph · Snapshot generated from <code>graph/research.ttl</code></span><span>Islam is approached here as historically and intellectually diverse.</span></footer>
  </main>;
}

function RecordRow({ node, onClick }) {
  return <button className="record-row" onClick={onClick}><span className="type-mark" style={{background: colors[node.type]}}>{node.type[0]?.toUpperCase()}</span><span className="row-main"><strong>{node.label}</strong><small>{node.summary || node.people?.join(', ') || 'Open record details'}</small></span><span className="badge">{pretty(node.status || 'not stated')}</span><span className="arrow">↗</span></button>;
}

function Overview({ nodes, edges, candidates, generatedAt, onOpen }) {
  const topics = nodes.filter(node => node.type === 'question').slice(0, 3);
  const degree = new Map(nodes.map(node => [node.id, 0]));
  edges.forEach(edge => { degree.set(edge.from, (degree.get(edge.from) || 0) + 1); degree.set(edge.to, (degree.get(edge.to) || 0) + 1); });
  const featured = [...nodes].sort((a, b) => degree.get(b.id) - degree.get(a.id)).slice(0, 11);
  const miniPoints = new Map(featured.map((node, index) => {
    const angle = (index / featured.length) * Math.PI * 2 - Math.PI / 2;
    const spread = index === 0 ? 0 : 66 + (index % 3) * 12;
    return [node.id, { x: 180 + Math.cos(angle) * spread, y: 120 + Math.sin(angle) * spread * .72 }];
  }));
  const miniEdges = edges.filter(edge => miniPoints.has(edge.from) && miniPoints.has(edge.to));
  const latest = generatedAt ? new Date(generatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Snapshot date not recorded yet';
  return <div className="overview-page">
    <div className="overview-heading"><div><span className="eyebrow">ACTIVE WORKSPACE · 01</span><h2>Islam Research Atlas</h2><p>A source-grounded map of texts, scholarship, arguments, and questions.</p></div><button className="primary-action" onClick={() => onOpen('Map')}>Open research map <span>↗</span></button></div>
    <div className="project-grid">
      <button className="project-card active-project" onClick={() => onOpen('Map')}><div className="project-art"><svg viewBox="0 0 360 240" role="img" aria-label="A preview of connected records in the research graph"><g>{miniEdges.map((edge, index) => {const a = miniPoints.get(edge.from), b = miniPoints.get(edge.to); return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>;})}</g><g>{featured.map(node => {const point = miniPoints.get(node.id); return <circle key={node.id} cx={point.x} cy={point.y} r={4 + Math.min(6, degree.get(node.id))} fill={colors[node.type] || colors.record}/>;})}</g></svg><span className="art-caption">{featured.length} connected records · live graph preview</span></div><div className="project-card-body"><div className="card-overline"><span className="live-dot"/> RESEARCH ATLAS <span className="card-arrow">↗</span></div><h3>Islam Research Atlas</h3><p>Follow the evidence across sources, interpretations, and open questions.</p><div className="project-metrics"><span><b>{nodes.length}</b> records</span><span><b>{edges.length}</b> links</span><span><b>{candidates.length}</b> leads</span></div></div></button>
      <div className="build-card"><div className="card-overline">DAILY HARVEST · NIGHTLY PUBLISH</div><h3>A research loop that keeps moving.</h3><div className="pipeline-steps"><span><i>01</i><b>Harvest</b><small>paced literature searches</small></span><span><i>02</i><b>Build</b><small>refresh public graph data</small></span><span><i>03</i><b>Publish</b><small>deploy the new snapshot</small></span></div><div className="build-status"><span className="status-ring">✓</span><span><b>Latest snapshot</b><small>{latest}</small></span><button onClick={() => onOpen('Discovery')}>Review {candidates.length.toLocaleString()} leads</button></div></div>
    </div>
    <div className="overview-lower"><section className="question-strip"><div className="section-topline"><div><span className="eyebrow">OPEN QUESTIONS</span><h3>Research trails to follow</h3></div><button onClick={() => onOpen('Arguments')}>View all ↗</button></div><div className="question-list">{topics.map((node, index) => <button key={node.id} onClick={() => onOpen('Arguments')}><span>0{index + 1}</span><b>{node.label}</b><i>↗</i></button>)}</div></section><section className="studio-note"><span className="eyebrow">A PERSONAL RESEARCH STUDIO</span><h3>One place for projects, ideas, and the paths between them.</h3><p>This is the first workspace. The studio shell is ready to grow as you bring in other data projects and a personal knowledge base.</p><button onClick={() => onOpen('Map')}>Explore this project ↗</button><small>Built from {nodes.length} curated records, {edges.length} recorded relationships, and {candidates.length} unreviewed discovery leads.</small></section></div>
  </div>;
}

function CandidateRow({ candidate, onClick }) {
  return <button className="record-row candidate-row" onClick={onClick}><span className="type-mark candidate-mark">↗</span><span className="row-main"><strong>{candidate.title}</strong><small>{[candidate.authors.slice(0, 3).join(', '), candidate.year, candidate.venue].filter(Boolean).join(' · ')}</small></span><span className="badge">unreviewed</span><span className="arrow">↗</span></button>;
}

function CandidateDetail({ candidate }) {
  if (!candidate) return null;
  return <><span className="eyebrow">DISCOVERY CANDIDATE</span><h2>{candidate.title}</h2><span className="badge detail-badge">Candidate · unreviewed</span>
    <p className="body-copy">This record was surfaced by a literature search. Its presence and rank are discovery provenance only; a human review is needed to assess relevance, source role, edition, and quality.</p>
    {candidate.authors.length > 0 && <section className="detail-section"><h3>Authors</h3><p>{candidate.authors.join('; ')}</p></section>}
    <section className="detail-section"><h3>Publication</h3><p>{[candidate.year, candidate.venue, pretty(candidate.work_type)].filter(Boolean).join(' · ') || 'Publication details unavailable'}</p></section>
    {candidate.doi && <section className="detail-section"><h3>DOI</h3><p>{candidate.doi}</p><a className="source-link" href={`https://doi.org/${encodeURI(candidate.doi).replaceAll('#', '%23')}`} target="_blank" rel="noreferrer">Open DOI landing page ↗</a>{candidate.landing_url && candidate.landing_url !== `https://doi.org/${candidate.doi}` && <a className="source-link" href={candidate.landing_url} target="_blank" rel="noreferrer">Open provider landing page ↗</a>}</section>}
    {!candidate.doi && candidate.landing_url && <section className="detail-section"><h3>Landing page</h3><a className="source-link" href={candidate.landing_url} target="_blank" rel="noreferrer">Open external record ↗</a></section>}
    <section className="detail-section"><h3>Discovery provenance</h3><p>Provider(s): {candidate.providers.join(', ') || 'unknown'}{candidate.provider_ids.length ? ` · ID: ${candidate.provider_ids.join(', ')}` : ''}</p>{Object.entries(candidate.provider_ranks_by_query || {}).map(([query, ranks]) => <p key={query}><b>“{query}”</b><br/>{Object.entries(ranks).map(([provider, rank]) => `${provider}: rank ${rank}`).join(' · ')}</p>)}{candidate.retrieved_at && <p>Retrieved: {candidate.retrieved_at}</p>}</section>
    {candidate.queries.length > 0 && <section className="detail-section"><h3>Search query provenance</h3>{candidate.queries.map(query => <p key={query}>“{query}”</p>)}</section>}
  </>;
}

function Detail({ node, related, nodeMap, onSelect }) {
  return <><span className="eyebrow">{pretty(node.type)} · {shortId(node.id)}</span><h2>{node.label}</h2><span className="badge detail-badge">{pretty(node.status || 'not stated')}</span>
    {node.summary && <p className="body-copy">{node.summary}</p>}
    {node.scope && <section className="detail-section"><h3>Scope</h3><p>{node.scope}</p></section>}
    {node.people?.length > 0 && <section className="detail-section"><h3>Author / attribution</h3><p>{node.people.join('; ')}</p></section>}
    {node.role && <section className="detail-section"><h3>Source role</h3><p>{node.role}</p></section>}
    {node.locator && <section className="detail-section"><h3>Location</h3><p>{node.locator}</p></section>}
    {node.links?.length > 0 && <section className="detail-section"><h3>Source links</h3>{node.links.map(link => <a key={link.url} className="source-link" href={link.url} target="_blank" rel="noreferrer">{link.label || new URL(link.url).hostname} ↗</a>)}</section>}
    {related.length > 0 && <section className="detail-section"><h3>Recorded connections <small>{related.length}</small></h3><div className="connection-list">{related.map((edge, i) => {const otherId = edge.from === node.id ? edge.to : edge.from; const other = nodeMap.get(otherId); return other ? <button key={i} onClick={() => onSelect(otherId)}><span>{pretty(edge.label)}</span><b>{other.label}</b></button> : null})}</div></section>}
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
