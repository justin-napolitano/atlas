import React, { useEffect } from 'react';
import './sources.css';

const date = value => value ? new Date(value).toLocaleString() : 'Not available';
export function SourceResults({ value, error, onOpen }) {
  if (!value && !error) return null;
  return <section className="federation-source-results" aria-label="Source search results">
    <h2>{value ? `${value.total} permitted source matches` : 'Source search unavailable'}</h2>
    {error && <p role="status">{error}</p>}
    {value && <><p>Read-only source index. Coverage is partial and reflects only matches permitted for this account.</p>
      <dl className="federation-source-freshness"><dt>Latest visible observation</dt><dd>{date(value.coverage?.latest_observed_at)}</dd><dt>Latest visible source update</dt><dd>{date(value.coverage?.latest_source_modified_at)}</dd></dl>
      {value.coverage?.clock_skew && <p>Source and observation times differ. Freshness needs review.</p>}
      {value.items.map(item => <article key={`${item.connection_id}/${item.source.source_id}/${item.source_version}`}><h3>{item.title || item.source.source_id}</h3><p>{item.snippet}</p><small>{item.source.table} · Source version {item.source_version}</small><button onClick={() => onOpen(item)}>Read source record</button></article>)}
      {value.total > value.items.length && <p>Showing the first {value.items.length} matches. Refine your search to narrow the results.</p>}</>}
  </section>;
}
export function SourceRecordView({ value, onClose }) {
  useEffect(() => {
    const remaining = new Date(value.acl_valid_until).getTime() - Date.now();
    if (remaining <= 0) { onClose(); return; }
    const timer = setTimeout(onClose, Math.min(remaining, 2147483647));
    return () => clearTimeout(timer);
  }, [value, onClose]);
  return <section className="federation-source-record" aria-label="Read-only source record">
    <header><div><p>Read-only source evidence</p><h2>{value.fields.short_description || value.fields.name || value.fields.number || value.source.source_id}</h2></div><button onClick={onClose}>Close source record</button></header>
    <p>This exact source version is separate from your notes. Access was checked for this account; reopen it to check current permission.</p>
    <dl><dt>Instance</dt><dd>{value.source.instance}</dd><dt>Table</dt><dd>{value.source.table}</dd><dt>Record</dt><dd>{value.source.source_id}</dd><dt>Source version</dt><dd>{value.source_version}</dd><dt>Source ordinal</dt><dd>{value.ordinal}</dd><dt>Source updated</dt><dd>{date(value.source_modified_at)}</dd><dt>Observed</dt><dd>{date(value.observed_at)}</dd><dt>Ingested</dt><dd>{date(value.ingested_at)}</dd><dt>Access proof expires</dt><dd>{date(value.acl_valid_until)}</dd><dt>Content checksum</dt><dd>{value.content_sha256}</dd></dl>
    <div className="federation-source-fields">{Object.entries(value.fields).sort(([a], [b]) => a.localeCompare(b)).map(([name, body]) => <section key={name}><h3>{name}</h3><pre data-source-field={name}>{body}</pre></section>)}</div>
  </section>;
}
