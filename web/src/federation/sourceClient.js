// Separate projections: a failed source read never turns note matches into a
// false zero, and source fields never enter an editable DraftSession.
export async function searchWorkspace(client, account, query, sourcesEnabled) {
  const requests = [client.request(`${client.profile(account)}/search`, { query })];
  if (sourcesEnabled) requests.push(client.request(`${client.profile(account)}/sources/search`, { query, brain_id: null, limit: 20, offset: 0 }));
  const [notes, sources] = await Promise.allSettled(requests);
  return {
    notes: notes.status === 'fulfilled' ? notes.value : null,
    noteError: notes.status === 'rejected' ? 'Note search is unavailable. Retry to check current matches.' : '',
    sources: sources?.status === 'fulfilled' ? sources.value : null,
    sourceError: sources?.status === 'rejected' ? 'Source search is unavailable. Its permitted matches have not been checked.' : '',
  };
}
