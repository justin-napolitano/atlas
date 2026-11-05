// Public-file loading only. Publication authorization belongs to the exporter;
// hiding a field in React would not protect JSON already served to a browser.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\x00-\x1f\x7f]/.test(value);
export const publicTabs = ['Overview', 'Map', 'Records', 'Sources', 'Arguments', 'Discovery'];

export function parseProjects(value) {
  if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.projects) || value.projects.length > 100)
    throw new Error('Invalid public project index.');
  const approved = value.delivery === 'approved_snapshot_release';
  if (value.delivery !== undefined && !approved) throw new Error('Unsupported public delivery format.');
  if (!approved && !value.projects.length) throw new Error('No public project index is available.');
  const seen = new Set();
  for (const project of value.projects) {
    if (!object(project) || !id(project.id) || seen.has(project.id) || typeof project.title !== 'string' ||
        !project.title.trim() || project.title.length > 2000 || typeof project.graph_data !== 'string' ||
        !(approved ? /^graph-[a-f0-9]{64}\.json$/ : /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/).test(project.graph_data) ||
        approved && project.privacy !== 'explicit_approved_projection') throw new Error('Invalid public project entry.');
    seen.add(project.id);
  }
  return { projects: value.projects, approved };
}

export function parseGraph(value, project, approved) {
  if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !Array.isArray(value.candidates))
    throw new Error('Invalid public graph.');
  if (approved && (value.format_version !== 1 || value.project?.id !== project.id ||
      !/^publication-[a-f0-9]{32}$/.test(value.snapshot_id) ||
      value.publication?.policy !== 'explicit_owner_selection_v1' || value.candidates.length ||
      value.nodes.length < 1 || value.nodes.length > 100 || value.edges.length > 300))
    throw new Error('Public graph does not match the selected approved project.');
  const ids = new Set(), edges = new Set();
  for (const node of value.nodes) {
    if (!object(node) || !id(node.id) || ids.has(node.id) || typeof node.label !== 'string' || typeof node.type !== 'string')
      throw new Error('Invalid public record identity.');
    ids.add(node.id);
  }
  for (const edge of value.edges) {
    if (!object(edge) || !ids.has(edge.from) || !ids.has(edge.to) || approved && (!id(edge.id) || edges.has(edge.id)))
      throw new Error('Invalid public relation identity.');
    edges.add(edge.id);
  }
  return value;
}

export function parseRelease(value, catalog) {
  if (!object(value) || value.format_version !== 1 || value.status !== 'exported' ||
      value.delivery !== 'immutable_approved_snapshot' || value.deployed !== false ||
      value.active_projects !== catalog.projects.length || !Number.isInteger(value.withdrawn_projects) || value.withdrawn_projects < 0 ||
      !validDate(value.exported_at) || value.last_successful_export_at !== value.exported_at)
    throw new Error('Invalid public export metadata.');
  return value;
}

function validDate(value) {
  return typeof value === 'string' && value.length <= 100 && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
}

export async function publicJson(path, signal, fetcher = fetch) {
  const response = await fetcher(path, { signal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('The current public snapshot could not be loaded.');
  return response.json();
}

export function readPublicRoute(href = location.href) {
  const url = new URL(href);
  return { project: url.searchParams.get('project') || '', record: url.searchParams.get('record') || '',
    tab: publicTabs.find(tab => tab.toLowerCase() === url.hash.slice(1)) || 'Overview' };
}

export function publicRouteUrl(route, href = location.href) {
  const url = new URL(href);
  for (const key of ['project', 'record']) {
    if (route[key]) url.searchParams.set(key, route[key]); else url.searchParams.delete(key);
  }
  url.hash = (publicTabs.includes(route.tab) ? route.tab : 'Overview').toLowerCase();
  return url.pathname + url.search + url.hash;
}

export function safePublicLink(value) {
  if (typeof value !== 'string' || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search) return null;
    return url.href;
  } catch { return null; }
}
