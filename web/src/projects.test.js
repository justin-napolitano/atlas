import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('public project index contains the synthetic example only', async () => {
  const source = new URL('../public/data/projects.json', import.meta.url);
  const manifest = JSON.parse(await readFile(source, 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(manifest.projects.map(project => project.id), ['atlas-example']);
  assert.equal(manifest.projects[0].graph_data, 'public-graph.json');
  assert.equal(manifest.projects[0].status, 'example');
});
