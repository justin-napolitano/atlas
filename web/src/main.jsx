import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import graph from './data/public-graph.json';
import './style.css';

const tabs = ['Map', 'Sources', 'Arguments', 'Discovery'];
const colors = { concept: '#1b806b', source: '#5776a5', evidence: '#a47a36', claim: '#ad614b', question: '#655a91', hypothesis: '#a64f6b', person: '#68747c', project: '#64736a', record: '#777' };
const types = ['concept', 'source', 'evidence', 'claim', 'question', 'hypothesis', 'person', 'project', 'record'];
const pretty = value => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const shortId = id => id?.split('/').at(-1)?.replaceAll('-', ' ') || 'Record';

function App() {
  const [tab, setTab] = useState('Map');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [mobilePanel, setMobilePanel] = useState(false);
  const filtered = useMemo(() => graph.nodes.filter(n => {
    const matchesType = kind === 'all' || n.type === kind;
    const haystack = `${n.label} ${n.type} ${n.status} ${n.summary} ${n.people?.join(' ')}`.toLowerCase();
    return matchesType && haystack.includes(query.toLowerCase());
  }), [kind, query]);
  const filteredCandidates = useMemo(() => graph.candidates.filter(c => {
    const text = `${c.title} ${c.venue} ${c.work_type} ${c.providers.join(' ')} ${c.authors.join(' ')} ${c.queries.join(' ')}`.toLowerCase();
    const providerMatch = providerFilter === 'all' || c.providers.includes(providerFilter);
    const yearMatch = yearFilter === 'all' || String(c.year || 'unknown') === yearFilter;
    return text.includes(query.toLowerCase()) && providerMatch && yearMatch;
  }), [query, providerFilter, yearFilter]);
  const candidateProviders = [...new Set(graph.candidates.flatMap(c => c.providers))].sort();
  const candidateYears = [...new Set(graph.candidates.map(c => c.year).filter(Boolean))].sort((a, b) => b - a);
  const visibleIds = new Set(filtered.map(n => n.id));
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const selectedNode = selected ? nodeMap.get(selected) : null;
  const related = selected ? graph.edges.filter(e => e.from === selected || e.to === selected) : [];
  const connected = new Set(related.flatMap(e => [e.from, e.to]));
  const width = 960, height = 660, cx = width / 2, cy = height / 2, radius = Math.min(width, height) * .39;
  const positions = useMemo(() => {
    const map = new Map();
    graph.nodes.forEach((n, i) => {
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2 - Math.PI / 2;
      map.set(n.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    });
    return map;
  }, []);

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

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#" aria-label="Islam Research Atlas home"><span className="brand-mark">IR</span><span>Islam Research Atlas<small>Evidence, interpretation, open questions</small></span></a>
      <nav aria-label="Main navigation">{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <a className="repo-link" href="https://github.com/justin-napolitano/islam-research" target="_blank" rel="noreferrer">Project repo ↗</a>
    </header>
    <section className="intro">
      <div><div className="eyebrow">A living research project <span className="status-dot"/> public snapshot</div><h1>Follow the evidence.<br/><em>See where it leads.</em></h1><p>Explore a developing map of sources, interpretations, and questions. Every record keeps its scope and review status visible.</p></div>
      <div className="stats"><div><b>{graph.nodes.length}</b><span>curated records</span></div><div><b>{graph.edges.length}</b><span>relationships</span></div><div><b>{graph.nodes.filter(n => n.type === 'source').length}</b><span>reviewed sources</span></div><div><b>{graph.candidates.length}</b><span>discovery leads</span></div></div>
    </section>
    <section className="workbench">
      <div className="toolbar">
        <div className="searchbox"><span>⌕</span><input aria-label="Search graph" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sources, concepts, claims…"/></div>
        {tab === 'Discovery' ? <><select aria-label="Filter by provider" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}><option value="all">All providers</option>{candidateProviders.map(p => <option key={p}>{p}</option>)}</select><select aria-label="Filter candidates by year" value={yearFilter} onChange={e => setYearFilter(e.target.value)}><option value="all">All years</option>{candidateYears.map(y => <option key={y}>{y}</option>)}</select></> : <select aria-label="Filter by record type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All record types</option>{types.map(t => <option key={t} value={t}>{pretty(t)}</option>)}</select>}
        <span className="result-count">{tab === 'Discovery' ? `${filteredCandidates.length} discovery leads` : `${filtered.length} of ${graph.nodes.length} records`}</span>
      </div>
      <div className="workspace">
        <div className="mainview">
          {tab === 'Map' && <div className="map-wrap">
            <div className="map-label"><span>RELATIONSHIP MAP</span><span>Connections show recorded links, not importance or consensus.</span></div>
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Interactive map of research records">
              <defs><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#d6d1c7"/></pattern></defs><rect width={width} height={height} fill="url(#dots)"/>
              <g>{graph.edges.map((edge, i) => { const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null; const visible = visibleIds.has(edge.from) && visibleIds.has(edge.to); const focus = !selected || connected.has(edge.from) && connected.has(edge.to); return <line key={`${i}-${edge.from}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`edge ${visible ? '' : 'hidden'} ${focus ? '' : 'faded'}`} />; })}</g>
              <g>{graph.nodes.map(n => { const p = positions.get(n.id); const active = visibleIds.has(n.id); const focus = !selected || connected.has(n.id); return <g key={n.id} transform={`translate(${p.x} ${p.y})`} className={`map-node ${active ? '' : 'hidden'} ${focus ? '' : 'faded'} ${selected === n.id ? 'chosen' : ''}`} tabIndex={active ? 0 : -1} role="button" aria-label={`${n.type}: ${n.label}`} onClick={() => openNode(n)} onKeyDown={e => e.key === 'Enter' && openNode(n)}><circle r={n.type === 'question' ? 10 : 7} fill={colors[n.type] || colors.record}/><text x="11" y="4">{n.label.length > 25 ? `${n.label.slice(0, 23)}…` : n.label}</text></g>; })}</g>
            </svg>
            <div className="legend">{types.filter(t => graph.nodes.some(n => n.type === t)).map(t => <span key={t}><i style={{background: colors[t]}}/>{pretty(t)}</span>)}</div>
          </div>}
          {tab === 'Sources' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">BIBLIOGRAPHY</span><h2>Sources in the graph</h2></div><span>{filtered.filter(n => n.type === 'source').length} visible</span></div><div className="source-list">{filtered.filter(n => n.type === 'source').map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}</div></div>}
          {tab === 'Arguments' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">ATTRIBUTED RECORDS</span><h2>Interpretations & questions</h2></div><span>Claims stay attached to their sources</span></div><div className="source-list">{filtered.filter(n => ['claim', 'evidence', 'question', 'hypothesis'].includes(n.type)).map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}</div></div>}
          {tab === 'Discovery' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">LITERATURE DISCOVERY</span><h2>Unreviewed source leads</h2></div><span>{filteredCandidates.length} of {graph.candidates.length} leads</span></div><div className="discovery-note"><b>Discovery is not evaluation.</b> These 196 records are bibliographic leads returned by OpenAlex, Crossref, or DataCite. Search matching and rank are provenance only; they do not establish relevance, scholarly quality, support for a claim, or consensus. Each record remains unreviewed.</div><div className="source-list">{filteredCandidates.map(c => <CandidateRow key={c.id} candidate={c} onClick={() => openCandidate(c)}/>)}</div></div>}
        </div>
        <aside className={`details ${mobilePanel ? 'mobile-open' : ''}`}>
          <button className="close-panel" onClick={() => setMobilePanel(false)} aria-label="Close details">×</button>
          {selectedNode ? <Detail node={selectedNode} related={related} nodeMap={nodeMap} onSelect={id => setSelected(id)}/> : selectedCandidate ? <CandidateDetail candidate={graph.candidates.find(c => c.id === selectedCandidate)}/> : <><span className="eyebrow">RECORD DETAILS</span><h2>Start exploring</h2><p className="body-copy">Select a point on the map, a source, or a discovery lead to inspect its description, provenance, and connections.</p><div className="callout"><b>How to read this map</b><p>Records distinguish primary texts, scholarship, attributed interpretations, and researcher questions. Links record the project’s current understanding; they do not prove a claim.</p></div><div className="snapshot-note"><span className="status-dot"/> Curated graph + sanitized metadata snapshot<br/><small>Private screening notes and local files are excluded.</small></div></>}
        </aside>
      </div>
    </section>
    <footer><span>Built from the project’s curated RDF graph · Snapshot generated from <code>graph/research.ttl</code></span><span>Islam is approached here as historically and intellectually diverse.</span></footer>
  </main>;
}

function RecordRow({ node, onClick }) {
  return <button className="record-row" onClick={onClick}><span className="type-mark" style={{background: colors[node.type]}}>{node.type[0]?.toUpperCase()}</span><span className="row-main"><strong>{node.label}</strong><small>{node.summary || node.people?.join(', ') || 'Open record details'}</small></span><span className="badge">{pretty(node.status || 'not stated')}</span><span className="arrow">↗</span></button>;
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
