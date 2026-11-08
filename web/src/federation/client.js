export class BridgeError extends Error {
  constructor(code, status) { super(messages[code] || 'The operation was not confirmed. Your writing is retained.'); this.code = code; this.status = status; }
}
const messages = {
  invalid_request: 'This request was rejected. Review the input and try again.',
  conversation_conflict: 'This conversation changed. Your draft is retained; start a new conversation to continue.',
  chat_message_invalid: 'Keep your message within 4096 UTF-8 bytes. Your draft remains editable.',
  local_session_required: 'Open this workspace with its one-time local setup code.',
  authentication_required: 'The configured account needs fresh credentials. Your local writing is retained.',
  access_revoked: 'Access changed. Transfers are stopped and your local writing is retained.',
  brain_not_selected: 'Select this brain before editing or syncing.',
  local_version_conflict: 'Another local session changed this page. Export your draft before reopening the current local version.',
  revision_conflict: 'Another version needs your review.',
  transfer_uncertain: 'The service could not confirm this transfer. Retry when connected; the same pending operation will be used.',
  chat_unavailable: 'Chat is not configured for this account.',
  resource_unavailable: 'This item is unavailable with your current access.',
  generation_review: 'The server was restored or replaced. Inspect the retained versions before queueing a new operation.',
  cursor_reset: 'The server checkpoint changed. Sync again to rebuild the permitted replica; old pending writing will require review.',
};
export class CollaborationClient {
  constructor(fetcher = (...args) => fetch(...args)) { this.fetcher = fetcher; this.csrf = ''; }
  async request(path, body) {
    const response = await this.fetcher(`/api/collaboration/${path}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-CSRF': this.csrf }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data; try { data = await response.json(); } catch { throw new BridgeError('transfer_uncertain', response.status); }
    if (!response.ok) throw new BridgeError(data.code, response.status);
    return data;
  }
  async open(code) { const value = await this.request('session', code === undefined ? undefined : { code }); this.csrf = value.csrf; return value; }
  profile(id) { return `accounts/${encodeURIComponent(id)}`; }
  brain(account, brain) { return `${this.profile(account)}/brains/${encodeURIComponent(brain)}`; }
  page(account, brain, page) { return `${this.brain(account, brain)}/pages/${encodeURIComponent(page)}`; }
}

export const normalizeNewlines = text => text.replace(/\r\n?/g, '\n');

// A textarea normalizes line endings. Map a native input delta back onto the
// exact saved writing so untouched CRLF/mixed-newline regions remain unchanged.
export function preserveLineEndings(previous, next) {
  const normalized = normalizeNewlines(previous);
  if (normalized === next) return previous;
  const boundaries = [0];
  for (let raw = 0; raw < previous.length;) { raw += previous[raw] === '\r' && previous[raw + 1] === '\n' ? 2 : 1; boundaries.push(raw); }
  let prefix = 0, suffix = 0;
  while (prefix < normalized.length && prefix < next.length && normalized[prefix] === next[prefix]) prefix++;
  while (suffix < normalized.length - prefix && suffix < next.length - prefix && normalized[normalized.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
  const ending = previous.match(/\r\n|\r|\n/)?.[0] || '\n';
  return previous.slice(0, boundaries[prefix]) + next.slice(prefix, next.length - suffix).replaceAll('\n', ending) + previous.slice(boundaries[normalized.length - suffix]);
}

const same = (a, b) => a.title === b.title && a.body === b.body && a.state === b.state;
export class DraftSession {
  constructor(client, account, brain, page, onChange = () => {}) {
    this.client = client; this.account = account; this.brain = brain; this.page = page;
    this.value = { ...page.content }; this.acknowledged = { ...page.content }; this.version = page.version;
    this.pending = null; this.saving = null; this.error = null; this.timer = null; this.composing = false;
    this.onChange = onChange; this.rawHistory = new Map([[normalizeNewlines(page.content.body), page.content.body]]);
  }
  get saved() { return !this.pending && same(this.value, this.acknowledged); }
  edit(patch, inputType) {
    if ('body' in patch) {
      const normalized = normalizeNewlines(patch.body);
      patch = { ...patch, body: inputType?.startsWith('history') && this.rawHistory.has(normalized) ? this.rawHistory.get(normalized) : preserveLineEndings(this.value.body, normalized) };
      this.rawHistory.set(normalizeNewlines(patch.body), patch.body);
      if (this.rawHistory.size > 80) this.rawHistory.delete(this.rawHistory.keys().next().value);
    }
    this.value = { ...this.value, ...patch }; this.onChange(); this.schedule();
  }
  schedule() { clearTimeout(this.timer); if (!this.composing && !this.error) this.timer = setTimeout(() => this.flush().catch(() => {}), 450); }
  composition(active) { this.composing = active; if (active) clearTimeout(this.timer); else this.schedule(); this.onChange(); }
  async flush() {
    clearTimeout(this.timer); if (this.composing) return;
    if (this.saving) { await this.saving; if (!this.saved) return this.flush(); return; }
    if (this.saved) return;
    if (!this.pending) this.pending = { edit_id: crypto.randomUUID(), expected_version: this.version, content: { ...this.value } };
    const pending = this.pending; this.error = null;
    this.saving = this.client.request(`${this.client.page(this.account, this.brain, this.page.page_id)}/edit`, pending)
      .then(page => {
        if (page.page_id !== this.page.page_id || page.version !== pending.expected_version + 1 || !same(page.content, pending.content)) { const error = new BridgeError('local_version_conflict', 409); error.current = page; throw error; }
        this.version = page.version; this.page = page; this.acknowledged = { ...pending.content }; this.pending = null;
      })
      .catch(error => { this.error = error; throw error; })
      .finally(() => { this.saving = null; this.onChange(); });
    this.onChange(); await this.saving;
    if (!this.saved) return this.flush();
  }
  adopt(page) {
    if (this.saved) { this.value = { ...page.content }; this.acknowledged = { ...page.content }; this.version = page.version; }
    this.page = page; this.onChange();
  }
  export() { return this.value.body; }
  async keepDraftAsNewLocalVersion() {
    if (this.saving) await this.saving;
    const current = await this.client.request(`${this.client.brain(this.account, this.brain)}/state`);
    const page = current.pages.find(item => item.page_id === this.page.page_id);
    if (!page) throw new BridgeError('resource_unavailable', 404);
    this.version = page.version; this.page = page; this.acknowledged = { ...page.content }; this.pending = null; this.error = null;
    await this.flush();
  }
}
