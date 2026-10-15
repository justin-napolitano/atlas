import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import GraphMap from './GraphMap.jsx';
import {parseProjects, parseGraph, parseRelease, publicJson, readPublicRoute, publicRouteUrl, publicTabs, safePublicLink} from './publicData.js';
import './style.css';

const tabs = publicTabs;
const pretty = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
const shortId = id => id?.split('/').at(-1)?.replaceAll('-', ' ') || 'Record';

function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111111' : '#ffffff');
    try { localStorage.setItem('research-theme', theme); } catch { /* Theme works for this session if storage is unavailable. */ }
  }, [theme]);
  const [graph, setGraph] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const projects = catalog?.projects || [];
  const [release, setRelease] = useState(null);
  const [route, setRoute] = useState(readPublicRoute);
  const projectId = route.project || projects[0]?.id || '';
  const project = projects.find(p => p.id === projectId);
  const approved = catalog?.approved || false;
  const tab = approved && route.tab === 'Discovery' ? 'Overview' : route.tab;
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    const restore = () => {
      const next = readPublicRoute(); setRoute(next);
      setMobilePanel(Boolean(next.record)); setSelectedCandidate(null);
    };
    addEventListener('popstate', restore); addEventListener('hashchange', restore);
    return () => { removeEventListener('popstate', restore); removeEventListener('hashchange', restore); };
  }, []);
  function navigate(patch) {
    const next = {...route, project: projectId, ...patch};
    history.pushState(null, '', publicRouteUrl(next)); setRoute(next);
  }
  const setTab = value => navigate({tab: value});
  const setSelected = value => navigate({record: value});
  const selected = route.record;
  function openProject(next) {
    if (!next) return;
    navigate({project: next.id, record: '', tab: tabs.includes(next.default_view) ? next.default_view : 'Map'});
  }
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [yearFilter, setYearFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [mapEntry, setMapEntry] = useState(null);
  const [reviews, setReviews] = useState(() => {
    try { return JSON.parse(localStorage.getItem('islam-research:candidate-reviews:v1') || '{}'); }
    catch { return {}; }
  });
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [mobilePanel, setMobilePanel] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    publicJson('/data/projects.json', controller.signal).then(parseProjects).then(async value => {
      const health = value.approved ? parseRelease(await publicJson('/data/release.json', controller.signal), value) : null;
      if (!controller.signal.aborted) { setCatalog(value); setRelease(health); }
    }).catch(() => { if (!controller.signal.aborted) setLoadError('The current public release could not be loaded.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setQuery(''); setKind('all'); setProviderFilter('all'); setYearFilter('all'); setReviewFilter('all');
    setSelectedCandidate(null); setMapEntry(null); setMobilePanel(Boolean(route.record));
    if (!catalog) return;
    setGraph(null); setLoadError('');
    if (!project) {
      if (catalog.projects.length) setLoadError('This project is not in the current public release. Choose another project.');
      return;
    }
    const controller = new AbortController();
    publicJson(`/data/${project.graph_data}`, controller.signal).then(data => parseGraph(data, project, approved))
      .then(data => { if (!controller.signal.aborted) setGraph({projectId: project.id, data}); })
      .catch(() => { if (!controller.signal.aborted) setLoadError('This project’s current public snapshot could not be loaded.'); });
    return () => controller.abort();
  }, [catalog, projectId]);
  // Never render the previous project's graph, even before effect cleanup runs.
  const data = graph?.projectId === projectId ? graph.data : null;
  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const candidates = data?.candidates || [];
  const types = [...new Set(nodes.map(node => node.type))].sort();
  useEffect(() => {
    if (data && tab === 'Map' && route.record) setMapEntry({id: route.record, at: Date.now()});
  }, [data, tab, route.record]);
  const filtered = useMemo(() => nodes.filter(n => {
    const matchesType = kind === 'all' || n.type === kind;
    const haystack = `${n.label} ${n.type} ${n.status} ${n.summary} ${n.people?.join(' ')}`.toLowerCase();
    return matchesType && haystack.includes(query.toLowerCase());
  }), [kind, query, nodes]);
  const filteredCandidates = useMemo(() => candidates.filter(c => {
    const text = `${c.title} ${c.venue} ${c.work_type} ${c.providers.join(' ')} ${c.authors.join(' ')} ${c.queries.join(' ')}`.toLowerCase();
    const providerMatch = providerFilter === 'all' || c.providers.includes(providerFilter);
    const yearMatch = yearFilter === 'all' || String(c.year || 'unknown') === yearFilter;
    const reviewMatch = reviewFilter === 'all' || (reviews[c.id] || 'unreviewed') === reviewFilter;
    return text.includes(query.toLowerCase()) && providerMatch && yearMatch && reviewMatch;
  }), [query, providerFilter, yearFilter, reviewFilter, reviews, candidates]);
  const candidateProviders = [...new Set(candidates.flatMap(c => c.providers))].sort();
  const candidateYears = [...new Set(candidates.map(c => c.year).filter(Boolean))].sort((a, b) => b - a);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const selectedNode = selected ? nodeMap.get(selected) : null;
  const related = selected ? edges.filter(e => e.from === selected || e.to === selected) : [];

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
  function saveCandidateReview(candidateId, decision) {
    setReviews(current => {
      const next = { ...current };
      if (!decision || next[candidateId] === decision) delete next[candidateId];
      else next[candidateId] = decision;
      try { localStorage.setItem('islam-research:candidate-reviews:v1', JSON.stringify(next)); } catch { /* Keep the current decision in memory when storage is unavailable. */ }
      return next;
    });
  }
  function clearCandidateReviews() {
    try { localStorage.removeItem('islam-research:candidate-reviews:v1'); } catch { /* State still clears for this session. */ }
    setReviews({});
  }
  const reviewCounts = candidates.reduce((counts, candidate) => {
    const status = reviews[candidate.id] || 'unreviewed';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});

  const header = <header className="topbar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setTab('Overview'); }}>Research notes</a>
      <nav aria-label="Main navigation">{tabs.filter(item => !approved || item !== 'Discovery').map(item => <button key={item} aria-current={tab === item ? 'page' : undefined} className={tab === item ? 'active' : ''} onClick={() => { setTab(item); setMobilePanel(false); }}>{item === 'Overview' ? 'Contents' : item}</button>)}</nav>
      <div className="header-tools"><button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? 'Dark mode' : 'Light mode'}</button><a className="repo-link" href="https://github.com/justin-napolitano/islam-research" target="_blank" rel="noreferrer">Repository ↗</a></div>
    </header>;
  const projectPicker = projects.length > 0 && <div className="public-project-picker"><label>Project <select aria-label="Choose research project" value={project?.id || ''} onChange={event => openProject(projects.find(p => p.id === event.target.value))}>
    {!project && <option value="" disabled>Choose a published project</option>}{projects.map(p => <option value={p.id} key={p.id}>{p.title}</option>)}</select></label>
    {approved && <span>Public · read only</span>}</div>;

  if (!data) return <main className="shell">{header}{projectPicker}<section className="loading-state" aria-live="polite">
    <h1>{loadError ? 'Snapshot unavailable' : catalog && !projects.length ? 'Nothing is published right now' : 'Loading public research…'}</h1>
    <p>{loadError || (catalog && !projects.length ? 'There are no active projects in this release.' : 'Opening the selected project’s current snapshot.')}</p>
    {loadError && <button onClick={() => location.reload()}>Try again</button>}
  </section></main>;

  return <main className="shell">
    <a className="skip-link" href="#research-content">Skip to content</a>
    {header}{projectPicker}
    <section className="intro">
      <h1>{tab === 'Overview' ? 'Research index' : project?.title || 'Research atlas'}</h1>
      <p className="index-meta">{nodes.length} {approved ? 'published' : 'curated'} records · {edges.length} relationships{!approved && ` · ${candidates.length} unreviewed discovery leads`}</p>
    </section>
    <section className="workbench">
      <div className="toolbar">
        {tab !== 'Overview' && tab !== 'Map' && <div className="searchbox"><span>⌕</span><input aria-label={tab === 'Discovery' ? 'Search discovery leads' : 'Search research records'} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sources, concepts, claims…"/></div>}
        {tab === 'Discovery' ? <><select aria-label="Filter by provider" value={providerFilter} onChange={e => setProviderFilter(e.target.value)}><option value="all">All providers</option>{candidateProviders.map(p => <option key={p}>{p}</option>)}</select><select aria-label="Filter candidates by year" value={yearFilter} onChange={e => setYearFilter(e.target.value)}><option value="all">All years</option>{candidateYears.map(y => <option key={y}>{y}</option>)}</select><select aria-label="Filter by review status" value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}><option value="all">All review states</option><option value="unreviewed">Unreviewed ({reviewCounts.unreviewed || 0})</option><option value="relevant">Relevant ({reviewCounts.relevant || 0})</option><option value="not_relevant">Not relevant ({reviewCounts.not_relevant || 0})</option><option value="read_later">Read later ({reviewCounts.read_later || 0})</option></select></> : tab !== 'Overview' && tab !== 'Map' && <select aria-label="Filter by record type" value={kind} onChange={e => setKind(e.target.value)}><option value="all">All record types</option>{types.map(t => <option key={t} value={t}>{pretty(t)}</option>)}</select>}
        {tab !== 'Overview' && tab !== 'Map' && <span className="result-count">{tab === 'Discovery' ? `${filteredCandidates.length} discovery leads` : `${filtered.length} of ${nodes.length} records`}</span>}
      </div>
      <div className={`workspace ${tab === 'Overview' ? 'overview-workspace' : tab === 'Map' ? 'map-workspace' : ''}`}>
        <div className="mainview" id="research-content" tabIndex={-1}>
          {tab === 'Overview' && <Overview projects={projects} nodes={nodes} candidates={candidates} buildSummary={data.build_summary} generatedAt={data.generated_at} release={release} onOpenProject={openProject} onOpen={setTab} onOpenQuestion={node => { setMapEntry({ id: node.id, at: Date.now() }); setTab('Map'); }}/>}
          <div hidden={tab !== 'Map'}><GraphMap key={projectId} nodes={nodes} edges={edges} active={tab === 'Map'} entryRequest={mapEntry}
            renderNotes={(node, inspect) => <Detail node={node} related={edges.filter(e => e.from === node.id || e.to === node.id)} nodeMap={nodeMap} onSelect={id => inspect(nodeMap.get(id))}/>}/></div>
          {tab === 'Records' && <div className="list-view"><div className="view-heading"><h2>All records</h2><span>{filtered.length} visible</span></div><div className="source-list">{filtered.map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}{!filtered.length && <p>No records match these filters.</p>}</div></div>}
          {tab === 'Sources' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">BIBLIOGRAPHY</span><h2>Sources in the graph</h2></div><span>{filtered.filter(n => ['source','work','edition'].includes(n.type)).length} visible</span></div><div className="source-list">{filtered.filter(n => ['source','work','edition'].includes(n.type)).map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}</div></div>}
          {tab === 'Arguments' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">ATTRIBUTED RECORDS</span><h2>Interpretations & questions</h2></div><span>Claims stay attached to their sources</span></div><div className="source-list">{filtered.filter(n => ['claim', 'evidence', 'question', 'hypothesis'].includes(n.type)).map(n => <RecordRow key={n.id} node={n} onClick={() => openNode(n)}/>)}</div></div>}
          {tab === 'Discovery' && <div className="list-view"><div className="view-heading"><div><span className="eyebrow">LITERATURE DISCOVERY</span><h2>Review discovery leads</h2><small className="private-review-note">Screening decisions are saved only in this browser. They are not uploaded or published.</small></div><div className="discovery-heading-actions"><span>{filteredCandidates.length} of {candidates.length} leads</span>{Object.keys(reviews).length > 0 && <button onClick={clearCandidateReviews}>Clear local reviews</button>}</div></div><div className="discovery-note"><b>Discovery is not evaluation.</b> These {candidates.length.toLocaleString()} records are bibliographic leads returned by literature discovery services. Search matching and rank are provenance only; they do not establish relevance, scholarly quality, support for a claim, or consensus.</div><div className="source-list">{filteredCandidates.map(c => <CandidateRow key={c.id} candidate={c} reviewStatus={reviews[c.id] || 'unreviewed'} onClick={() => openCandidate(c)}/>)}</div></div>}
        </div>
        <aside id="record-notes" hidden={tab === 'Map'} className={`details ${mobilePanel ? 'mobile-open' : ''}`}>
          <button className="close-panel" onClick={() => setMobilePanel(false)} aria-label="Close details">×</button>
          {selectedNode ? <Detail node={selectedNode} related={related} nodeMap={nodeMap} onSelect={id => setSelected(id)}/> : selectedCandidate ? <CandidateDetail candidate={candidates.find(c => c.id === selectedCandidate)} reviewStatus={reviews[selectedCandidate] || 'unreviewed'} onReview={decision => saveCandidateReview(selectedCandidate, decision)}/> : <><h2>{selected ? 'Record unavailable' : 'Record details'}</h2><p className="body-copy">{selected ? 'This record is not in the selected public snapshot.' : 'Select a record to read its description, source references, and connections.'}</p></>}
        </aside>
      </div>
    </section>
    <footer><span>{approved ? 'Explicitly approved public snapshot · Visibility approval is not a new scholarly review.' : <>Built from the project’s curated RDF graph · Snapshot generated from <code>graph/research.ttl</code></>}</span><span>Islam is approached here as historically and intellectually diverse.</span></footer>
  </main>;
}

function RecordRow({ node, onClick }) {
  return <button className="record-row" onClick={onClick}><span className="type-mark">{pretty(node.type)}</span><span className="row-main"><strong>{node.label}</strong><small>{node.summary || node.people?.join(', ') || 'Open record details'}</small></span><span className="badge">{pretty(node.status || 'not stated')}</span><span className="arrow">↗</span></button>;
}

function Overview({ projects, nodes, candidates, buildSummary, generatedAt, release, onOpenProject, onOpen, onOpenQuestion }) {
  const questions = nodes.filter(node => node.type === 'question');
  const latest = buildSummary?.generated_at || generatedAt;
  const latestLabel = latest ? new Date(latest).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable';
  const chapters = [
    ['Records', 'All records', 'Browse concepts, sources, people, and other recorded material.'],
    ['Arguments', 'Questions & interpretations', 'Attributed claims, evidence, and open questions.'],
    ['Sources', 'Bibliography', 'Sources recorded in the curated graph.'],
    ['Map', 'Relationship map', 'Recorded links between concepts, sources, and claims.'],
    ['Discovery', 'Literature discovery', `${candidates.length} unreviewed bibliographic leads.`],
  ].filter(([view]) => !release || view !== 'Discovery');
  return <div className="overview-page">
    <section aria-labelledby="projects-heading"><h2 id="projects-heading">Projects</h2>
      <ol className="project-index">{projects.map(project => <li key={project.id}><button onClick={() => onOpenProject(project)}><strong>{project.title}</strong><span>{project.description}</span><small>{pretty(project.status)}</small></button></li>)}</ol>
    </section>
    <section aria-labelledby="contents-heading"><h2 id="contents-heading">Contents</h2>
      <ol className="contents-list">{chapters.map(([view, title, description]) => <li key={view}><button onClick={() => onOpen(view)}><span>{title}</span><small>{description}</small></button></li>)}</ol>
    </section>
    <section aria-labelledby="questions-heading"><h2 id="questions-heading">Open questions</h2>
      <ol className="question-list">{questions.map(node => <li key={node.id}><button onClick={() => onOpenQuestion(node)}>{node.label}</button></li>)}</ol>
    </section>
    {release ? <details className="pipeline-details"><summary>Public export details</summary><dl><dt>Exported</dt><dd>{new Date(release.exported_at).toLocaleString()}</dd><dt>Projects</dt><dd>{release.active_projects} published</dd><dt>Source review</dt><dd>Each record retains its own review status and limitations.</dd></dl></details> : <details className="pipeline-details"><summary>Snapshot & harvest log <span>{latestLabel}</span></summary>
      <dl><dt>Latest run</dt><dd>{pretty(buildSummary?.latest_run_status || 'unknown')}</dd><dt>Queries</dt><dd>{buildSummary?.query_complete ?? '—'} of {buildSummary?.query_total ?? '—'} valid · {buildSummary?.query_attempted ?? '—'} attempted</dd><dt>New leads</dt><dd>{buildSummary?.new_leads ?? '—'}</dd><dt>Previously seen</dt><dd>{buildSummary?.repeated_leads ?? '—'}</dd><dt>Last full run</dt><dd>{buildSummary?.last_successful_at ? new Date(buildSummary.last_successful_at).toLocaleString() : 'Not recorded'}</dd></dl>
      {Object.entries(buildSummary?.provider_counts || {}).length > 0 && <div className="provider-table"><table><caption>Provider results</caption><thead><tr><th scope="col">Provider</th><th scope="col">Complete</th><th scope="col">Empty</th><th scope="col">Errors</th></tr></thead><tbody>{Object.entries(buildSummary.provider_counts).map(([provider, counts]) => <tr key={provider}><th scope="row">{pretty(provider)}</th><td>{counts.successful}/{counts.total}</td><td>{counts.no_results}</td><td>{counts.errors}</td></tr>)}</tbody></table></div>}
    </details>}
  </div>;
}

function CandidateRow({ candidate, reviewStatus, onClick }) {
  return <button className="record-row candidate-row" onClick={onClick}><span className="row-main"><strong>{candidate.title}</strong><small>{[candidate.authors.slice(0, 3).join(', '), candidate.year, candidate.venue].filter(Boolean).join(' · ')}</small></span><span className={`badge review-badge review-${reviewStatus}`}>{pretty(reviewStatus)}</span><span className="arrow">↗</span></button>;
}

function CandidateDetail({ candidate, reviewStatus, onReview }) {
  if (!candidate) return null;
  return <><span className="eyebrow">DISCOVERY CANDIDATE</span><h2>{candidate.title}</h2><span className={`badge detail-badge review-${reviewStatus}`}>{pretty(reviewStatus)}</span>
    <p className="body-copy">This record was surfaced by a literature search. Its presence and rank are discovery provenance only; a human review is needed to assess relevance, source role, edition, and quality.</p>
    <section className="screening-box"><h3>YOUR PRIVATE SCREEN</h3><p>Saved in this browser only. It is not shared, uploaded, or added to the public graph.</p><div>{[['relevant', 'Relevant'], ['not_relevant', 'Not relevant'], ['read_later', 'Read later']].map(([decision, label]) => <button key={decision} className={reviewStatus === decision ? 'active' : ''} aria-pressed={reviewStatus === decision} onClick={() => onReview(decision)}>{label}</button>)}</div>{reviewStatus !== 'unreviewed' && <button className="clear-screening" onClick={() => onReview(null)}>Clear decision</button>}</section>
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
    {node.citation && <section className="detail-section"><h3>Citation</h3><p>{node.citation}</p></section>}
    {node.review_limits?.length > 0 && <section className="detail-section review-limits"><h3>Review limits</h3>{node.review_limits.map((limit,index) => <p key={index}>{limit}</p>)}</section>}
    {node.origin && <section className="detail-section"><h3>Record provenance</h3><p>{pretty(node.origin)} · Source revision {node.source_revision}</p></section>}
    {node.links?.some(link => safePublicLink(link.url)) && <section className="detail-section"><h3>Source links</h3>{node.links.filter(link => safePublicLink(link.url)).map(link => <a key={link.url} className="source-link" href={safePublicLink(link.url)} target="_blank" rel="noreferrer">{link.label || new URL(link.url).hostname} ↗</a>)}</section>}
    {related.length > 0 && <section className="detail-section"><h3>Recorded connections <small>{related.length}</small></h3><div className="connection-list">{related.map((edge, i) => {const otherId = edge.from === node.id ? edge.to : edge.from; const other = nodeMap.get(otherId); return other ? <button key={i} onClick={() => onSelect(otherId)}><span>{pretty(edge.label)}</span><b>{other.label}</b></button> : null})}</div></section>}
  </>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
