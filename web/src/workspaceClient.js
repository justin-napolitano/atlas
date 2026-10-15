// Same-origin signed-owner requests. Identity belongs to IAP, never localStorage.
export class WorkspaceError extends Error {
  constructor(status, current = null) {
    super(status === 409 ? 'This record changed on another device.' : status === 401 || status === 403 ? 'Owner sign-in is required.' : 'Could not reach the research workspace. Your draft is still here.');
    this.status = status;
    this.current = current;
  }
}

export function workspaceAPI(fetcher = globalThis.fetch) {
  async function request(path, params = {}, value) {
    const response = await fetcher(`/v1/${path}?${new URLSearchParams(params)}`, {
      credentials: 'same-origin', headers: { Accept: 'application/json', ...(value ? { 'Content-Type': 'application/json', 'X-Research-Write': '1' } : {}) },
      ...(value ? { method: 'PUT', body: JSON.stringify(value) } : {}),
    });
    if (!response.headers.get('content-type')?.includes('json')) throw new WorkspaceError(401);
    const data = await response.json();
    if (!response.ok) throw new WorkspaceError(response.status, response.status === 409 ? data.current : null);
    return data;
  }
  return { request, save: value => request('personal-states', {}, value) };
}

const fields = ['record_id', 'project_id', 'reading', 'decision', 'note'];
const values = row => Object.fromEntries(fields.map(key => [key, row[key]]));
const same = (a, b) => fields.every(key => a?.[key] === b?.[key]);
export const blankState = (record_id, project_id) => ({ record_id, project_id, reading: 'unread', decision: 'unreviewed', note: '', revision: 0, read_at: null });

export class ReadingWorkspace {
  constructor(api, changed = () => {}) { this.api = api; this.changed = changed; this.entries = new Map(); }
  adopt(row) {
    if (!this.entries.has(row.record_id)) this.entries.set(row.record_id, { server: row, draft: values(row), status: 'saved', current: null, pending: null, again: false });
    this.changed();
    return this.entries.get(row.record_id);
  }
  edit(id, patch) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Load the reading state before editing.');
    entry.draft = { ...entry.draft, ...patch };
    if (!entry.pending && entry.status !== 'conflict') entry.status = same(entry.draft, entry.server) ? 'saved' : 'unsaved';
    this.changed();
  }
  async save(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.status === 'conflict') return;
    if (entry.pending) { entry.again = true; return entry.pending; }
    const sent = { ...entry.draft };
    entry.status = 'saving';
    entry.pending = Promise.resolve().then(() => this.api.save({ ...sent, expected_revision: entry.server.revision }))
      .then(row => { entry.server = row; entry.status = same(entry.draft, row) ? 'saved' : 'unsaved'; })
      .catch(error => {
        // A lost response can follow a successful commit. Matching current state confirms it.
        if (error.status === 409 && error.current && same(error.current, sent)) {
          entry.server = error.current; entry.status = same(entry.draft, entry.server) ? 'saved' : 'unsaved';
        } else if (error.status === 409 && error.current) { entry.current = error.current; entry.status = 'conflict'; }
        else { entry.status = 'error'; }
      }).finally(() => {
        entry.pending = null;
        const again = entry.again; entry.again = false; this.changed();
        if (again && entry.status === 'unsaved') this.save(id);
      });
    this.changed();
    return entry.pending;
  }
  resolve(id, choice) {
    const entry = this.entries.get(id);
    if (!entry?.current || !['cloud', 'draft'].includes(choice)) return;
    entry.server = entry.current; entry.current = null;
    if (choice === 'cloud') { entry.draft = values(entry.server); entry.status = 'saved'; }
    else { entry.status = 'unsaved'; this.save(id); }
    this.changed();
  }
  hasDrafts() { return [...this.entries.values()].some(e => e.status !== 'saved'); }
}

export function markdownDraft(record, entry) {
  return ['---', `research_id: ${JSON.stringify(record.id)}`, `project_id: ${JSON.stringify(entry.draft.project_id)}`,
    `base_revision: ${entry.server.revision}`, `reading: ${JSON.stringify(entry.draft.reading)}`,
    `screening: ${JSON.stringify(entry.draft.decision)}`, '---', '', `# ${record.title.replaceAll('\n', ' ')}`, '', entry.draft.note, ''].join('\n');
}
