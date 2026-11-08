// Real-stack browser acceptance, not a mocked fetch adapter. Supply one private
// JSON line on stdin with the disposable MU fixture's signed test identities.
// Dependencies/executable paths are injected; no package/lock mutation is needed.
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })[Symbol.asyncIterator]();
let stage = 'configuration', directory, bridge, browser;
const wait = ms => new Promise(done => setTimeout(done, ms));
const poll = async (read, accept, message) => { for (let i = 0; i < 160; i++) { const value = await read().catch(() => undefined); if (accept(value)) return value; await wait(100); } throw Error(message); };
const handshake = async (name, reply) => { process.stdout.write(`${name}\n`); const line = await lines.next(); assert.equal(line.value, reply); };
try {
  const initial = await lines.next(); const fixture = JSON.parse(initial.value);
  const base = new URL(fixture.base_url); assert.equal(base.protocol, 'http:'); assert(['127.0.0.1', '[::1]'].includes(base.hostname));
  for (const name of ['organization_id', 'brain_id', 'alice_user_id', 'bob_user_id', 'alice_token', 'bob_token']) assert.equal(typeof fixture[name], 'string');
  const binary = process.env.ATLAS_WORKSPACE_BINARY, assets = process.env.ATLAS_WORKSPACE_ASSETS;
  assert(binary && assets);
  const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
  const browserTools = playwright.chromium ? playwright : playwright.default;
  directory = await mkdtemp(join(tmpdir(), 'atlas-workspace-browser-')); await chmod(directory, 0o700);
  // Resolve the macOS /var alias before passing private paths to the replica.
  const { realpath } = await import('node:fs/promises'); directory = await realpath(directory);
  const launchFile = join(directory, 'launch.json'), configFile = join(directory, 'config.json');
  const config = { listen: '127.0.0.1:0', assets_dir: resolve(assets), launch_file: launchFile, accounts: ['alice', 'bob'].map((name, index) => ({ id: name, name: name === 'alice' ? 'Alice synthetic' : 'Bob synthetic', db_path: join(directory, `${name}.sqlite`), organization_id: fixture.organization_id, user_id: fixture[`${name}_user_id`], device_id: `90000000-0000-4000-8000-00000000002${index}`, origin: fixture.base_url, token_env: `ATLAS_CREDENTIAL_${name.toUpperCase()}`, create: true, upgrade_snapshot: '', research_enabled: fixture.research_handshake === true })) };
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  bridge = spawn(binary, ['-config', configFile], { env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR || tmpdir(), ATLAS_CREDENTIAL_ALICE: fixture.alice_token, ATLAS_CREDENTIAL_BOB: fixture.bob_token }, stdio: ['ignore', 'pipe', 'pipe'] });
  let bridgeOutput = ''; for (const stream of [bridge.stdout, bridge.stderr]) stream.on('data', data => { bridgeOutput = (bridgeOutput + data).slice(-65536); });
  stage = 'bridge startup'; const launch = await poll(async () => JSON.parse(await readFile(launchFile, 'utf8')), value => !!value?.code, 'private launch unavailable');
  stage = 'sandboxed browser launch';
  browser = await browserTools.chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1480, height: 1000 } });
  let leakedCredential = false, ownerRequest = false;
  context.on('request', request => { if (request.headers().authorization || request.url().includes(fixture.alice_token) || request.url().includes(fixture.bob_token)) leakedCredential = true; if (request.url().includes('/api/') && !request.url().includes('/api/collaboration/')) ownerRequest = true; });
  const alice = await context.newPage(); await alice.goto(launch.url); await alice.waitForLoadState('networkidle');
  stage = 'one-time setup'; await alice.getByLabel('Local setup code').fill(launch.code); await alice.getByRole('button', { name: 'Open workspace', exact: true }).click(); await alice.getByRole('group',{name:'Accounts',exact:true}).waitFor();
  const bob = await context.newPage(); await bob.goto(launch.url); await bob.waitForLoadState('networkidle');
  const choose = async (page, account) => { await page.getByRole('button',{name:account==='alice'?'Alice synthetic':'Bob synthetic',exact:true}).click(); await page.getByRole('button', { name: 'Load my brains', exact: true }).click(); await page.locator(`[data-brain-id="${fixture.brain_id}"]`).click(); await page.getByRole('button', { name: 'Sync now', exact: true }).waitFor(); };
  const sync = async page => { await page.getByRole('button', { name: 'Sync now', exact: true }).click(); await poll(() => page.getByRole('button', { name: 'Sync now', exact: true }).isEnabled(), Boolean, 'sync did not settle'); };
  const saved = async page => poll(() => page.locator('.federation-editor header').innerText(), value => value?.includes('Saved locally'), 'local save not acknowledged');
  stage = 'explicit selection and bootstrap'; await choose(alice, 'alice'); await sync(alice);
  stage = 'CRLF render does not create an edit';
  const rawCRLF = 'Synthetic CRLF preservation\r\nالعربية 日本語\nMixed ending\r\n';
  // Fixture setup uses the real protected bridge, not a mocked response. Then
  // normal UI navigation/rendering must leave the durable raw text untouched.
  const crlfPageID = await alice.evaluate(async ({ brain, body }) => {
    const session = await (await fetch('/api/collaboration/session', { credentials: 'same-origin' })).json(); const id = crypto.randomUUID();
    const response = await fetch(`/api/collaboration/accounts/alice/brains/${brain}/pages/${id}/edit`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Atlas-CSRF': session.csrf }, body: JSON.stringify({ edit_id: crypto.randomUUID(), expected_version: 0, content: { title: 'Synthetic exact CRLF note', body, state: 'active' } }) });
    if (!response.ok) throw Error('protected fixture seed failed'); return id;
  }, { brain: fixture.brain_id, body: rawCRLF });
  await sync(alice); await alice.locator(`[data-page-id="${crlfPageID}"]`).click(); await poll(() => alice.getByLabel('Page title', { exact: true }).inputValue(), value => value === 'Synthetic exact CRLF note', 'CRLF page not opened');
  assert.equal(await alice.getByLabel('Page body', { exact: true }).inputValue(), rawCRLF.replace(/\r\n?/g, '\n')); await wait(800);
  const untouched = await alice.evaluate(async ({ brain, id }) => { const state = await (await fetch(`/api/collaboration/accounts/alice/brains/${brain}/state`, { credentials: 'same-origin' })).json(); return state.pages.find(page => page.page_id === id); }, { brain: fixture.brain_id, id: crlfPageID });
  assert.equal(untouched.content.body, rawCRLF); assert.equal(untouched.version, 1);
  stage = 'create shared incident in UI';
  const beforeNew = await alice.locator('.federation-pages [aria-current="page"]').getAttribute('data-page-id').catch(() => null);
  let lostCreate='';await alice.route('**/api/collaboration/accounts/alice/brains/*/pages/*/edit',async route=>{const body=route.request().postDataJSON();if(!lostCreate&&body.expected_version===0){lostCreate=route.request().url().split('/').at(-2);await route.fetch();await route.abort('failed');}else await route.continue();});
  await alice.getByRole('button', { name: 'New note', exact: true }).click();await alice.getByRole('button',{name:'Retry new note',exact:true}).waitFor();await alice.unroute('**/api/collaboration/accounts/alice/brains/*/pages/*/edit');await alice.getByRole('button',{name:'Retry new note',exact:true}).click(); await poll(() => alice.locator('.federation-pages [aria-current="page"]').getAttribute('data-page-id'), value => !!value && value !== beforeNew, 'new page was not selected'); await alice.getByLabel('Page title', { exact: true }).fill('Synthetic browser incident');
  const marker = fixture.content_marker || 'synthetic-browser-collaboration'; const initialBody = `---\ntype: incident\nservice: payments\n---\n\n${marker}\nالعربية 日本語 👩🏽‍💻 é`;
  await alice.getByLabel('Page body', { exact: true }).fill(initialBody); await saved(alice); await sync(alice);
  const pageID = await alice.locator('.federation-pages [aria-current="page"]').getAttribute('data-page-id'); assert(pageID);assert.equal(pageID,lostCreate);
  stage = 'second real replica'; await choose(bob, 'bob'); await sync(bob); await bob.locator(`[data-page-id="${pageID}"]`).click(); assert.equal(await bob.getByLabel('Page body', { exact: true }).inputValue(), initialBody);
  const bobBody = `${initialBody}\nBob local edit`, aliceBody = `${initialBody}\nAlice concurrent edit`;
  await bob.getByLabel('Page body', { exact: true }).fill(bobBody); await saved(bob);
  await alice.getByLabel('Page body', { exact: true }).fill(aliceBody); await saved(alice); await sync(alice);
  stage = 'three-way conflict'; await sync(bob); await bob.getByRole('region', { name: 'Review conflicting versions' }).waitFor(); assert.equal(await bob.getByLabel('Page body', { exact: true }).inputValue(), bobBody);
  const conflict = await bob.locator('.federation-conflict').innerText(); assert(conflict.includes(initialBody) && conflict.includes(aliceBody) && conflict.includes(bobBody));
  const merged = `${initialBody}\nReviewed merge: Alice and Bob`;
  await bob.getByLabel('Page body', { exact: true }).fill(merged); await saved(bob); await bob.getByRole('button', { name: 'Queue reviewed merge', exact: true }).click(); await poll(() => bob.locator('.federation-conflict').count(), value => value === 0, 'conflict not resolved locally'); await sync(bob); await sync(alice); assert.equal(await alice.getByLabel('Page body', { exact: true }).inputValue(), merged);
  stage = 'native undo typing'; const editor = alice.getByLabel('Page body', { exact: true }); await editor.focus(); await editor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End'); await editor.press('End'); await editor.type(' undo-sentinel');
  assert.equal(await editor.inputValue(), `${merged} undo-sentinel`);
  stage = 'native undo restoration'; await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await poll(() => editor.inputValue(), value => value === merged, 'native undo did not restore writing');
  stage = 'simulated composition defers save'; await editor.dispatchEvent('compositionstart'); await editor.fill(`${merged}\n仮入力`); await wait(700); assert((await alice.locator('.federation-editor header').innerText()).includes('Composing'));
  stage = 'simulated composition local commit'; await editor.dispatchEvent('compositionend'); await saved(alice);
  const composed = `${merged}\n仮入力`; assert.equal(await editor.inputValue(), composed);
  if (fixture.offline_handshake) { stage = 'offline local save'; await handshake('READY_FOR_OFFLINE', 'OFFLINE'); await editor.fill(`${composed}\nOffline retained`); await saved(alice); await sync(alice); assert((await alice.locator('.federation-error').allTextContents()).length > 0); assert.equal(await editor.inputValue(), `${composed}\nOffline retained`); await handshake('READY_FOR_RECONNECT', 'ONLINE'); }
  await sync(alice); await sync(bob);
  stage = 'permitted wiki projections'; await alice.getByLabel('Search across my permitted brains').fill(marker); await alice.getByRole('button', { name: 'Search notes', exact: true }).click(); await alice.getByRole('region', { name: 'Note search results' }).waitFor(); assert((await alice.locator('.federation-search-results').innerText()).includes('Synthetic browser incident'));
  stage='maintained frontmatter and brain filters';await alice.getByLabel('Search across my permitted brains').fill('type:decision '+marker);await alice.getByRole('button',{name:'Search notes',exact:true}).click();await alice.getByRole('heading',{name:'0 permitted matches',exact:true}).waitFor();
  await alice.getByLabel('Search across my permitted brains').fill('type:incident service:payments brain:"Synthetic cross-team incident" '+marker);await alice.getByRole('button',{name:'Search notes',exact:true}).click();await alice.getByRole('heading',{name:'1 permitted matches',exact:true}).waitFor();
  stage='exact local brain Markdown archive';const pendingDownload=alice.waitForEvent('download');await alice.getByRole('button',{name:'Export brain',exact:true}).click();const archive=await pendingDownload;const archiveBytes=await readFile(await archive.path());assert(archiveBytes.includes(Buffer.from(rawCRLF)));assert(archiveBytes.includes(Buffer.from('manifest.json')));
  stage='quiet attributed history';await alice.getByRole('button',{name:'History',exact:true}).click();await poll(()=>alice.locator('.notes-history').innerText(),value=>value?.includes('Alice synthetic'),'attributed history missing');
  stage='private and team brains share one note layout';await alice.locator('[data-brain-id="30000000-0000-0000-0000-000000000001"]').click();await sync(alice);assert((await alice.locator('.notes-scope-header').innerText()).includes('Private'));await alice.locator(`[data-brain-id="${fixture.brain_id}"]`).click();await sync(alice);await alice.locator(`[data-page-id="${pageID}"]`).click();assert.equal(await editor.inputValue(),composed+'\nOffline retained');
  stage='stable note target survives rename and explicit reopen';await alice.getByLabel('Page title',{exact:true}).fill('Renamed synthetic browser note');await saved(alice);await sync(alice);const linked=await context.newPage();const linkedURL=new URL(launch.url);linkedURL.searchParams.set('brain',fixture.brain_id);linkedURL.searchParams.set('page',pageID);await linked.goto(linkedURL.href);await linked.waitForLoadState('networkidle');await choose(linked,'alice');await sync(linked);await poll(()=>linked.getByLabel('Page title',{exact:true}).inputValue(),value=>value==='Renamed synthetic browser note','stable target did not reopen renamed note');await linked.close();
  assert.equal(await alice.locator('select,[role=menu],.source-reader,.federation-evidence,.federation-gold,.federation-chat').count(),0);
  stage = 'tombstone'; await alice.getByRole('button',{name:'Move to Trash',exact:true}).click(); await saved(alice); await sync(alice); await sync(bob); await bob.getByRole('button',{name:'Restore note',exact:true}).waitFor();
  if (fixture.research_handshake) {
    const desk = page => page.getByRole('region', { name: 'Research in this brain', exact: true });
    const researchState = (page, account) => page.evaluate(async ({ account, brain }) => {
      const response = await fetch(`/api/collaboration/accounts/${account}/brains/${brain}/research/state`, { credentials: 'same-origin' });
      if (!response.ok) throw Error('protected research fixture read failed');
      return response.json();
    }, { account, brain: fixture.brain_id });
    const researchSettled = page => poll(() => desk(page).getByRole('button', { name: 'Load research', exact: true }).isEnabled(), Boolean, 'research save did not settle');
    stage = 'explicit shared research loading';
    await desk(alice).getByRole('button', { name: 'Load research', exact: true }).click();
    await desk(alice).getByLabel('Research group', { exact: true }).waitFor();
    await desk(alice).getByLabel('Research group', { exact: true }).fill('Synthetic reading group');
    await desk(alice).getByRole('button', { name: 'Create group', exact: true }).click();
    await desk(alice).getByRole('button', { name: 'Synthetic reading group', exact: true }).waitFor();
    const sourceTitle = 'Synthetic exact research text';
    const passage = 'العربية 日本語 👩🏽‍💻';
    const sourceText = `Synthetic research marker\n${passage} é\n\nSecond exact paragraph\n`;
    stage = 'exact selected research source';
    await desk(alice).getByLabel('Source title', { exact: true }).fill(sourceTitle);
    await desk(alice).getByLabel('Text excerpt', { exact: true }).fill(sourceText);
    await desk(alice).getByRole('button', { name: 'Share selected excerpt', exact: true }).click();
    await desk(alice).getByRole('heading', { name: sourceTitle, exact: true }).waitFor();
    assert.equal(await desk(alice).locator('.research-reading-text pre').textContent(), sourceText);
    await desk(alice).getByRole('button', { name: 'Add source to selected group', exact: true }).click();
    await researchSettled(alice);
    const annotate = async (page, body, shared = false) => {
      await desk(page).locator('.research-reading-text pre').evaluate((node, exact) => {
        const text = node.firstChild, start = node.textContent.indexOf(exact), selection = window.getSelection();
        if (!text || start < 0 || !selection) throw Error('synthetic source selection unavailable');
        const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + exact.length);
        selection.removeAllRanges(); selection.addRange(range);
      }, passage);
      await desk(page).getByRole('button', { name: 'Annotate selected passage', exact: true }).click();
      await desk(page).getByLabel('Passage note', { exact: true }).fill(body);
      if (shared) await desk(page).getByLabel('Share this annotation with brain members', { exact: true }).check();
      await desk(page).getByRole('button', { name: 'Save passage note', exact: true }).click();
      await desk(page).getByRole('paragraph').filter({ hasText: body }).waitFor();
      await researchSettled(page);
    };
    stage = 'source bound private annotation and reading place';
    const privateAlice = 'Synthetic Alice private passage note', privateBob = 'Synthetic Bob private passage note';
    await annotate(alice, privateAlice);
    await desk(alice).getByRole('button', { name: 'Save my reading place', exact: true }).click();
    await researchSettled(alice);
    const aliceState = await researchState(alice, 'alice');
    const source = aliceState.items.find(row => row.kind === 'source' && row.title === sourceTitle);
    const annotation = aliceState.items.find(row => row.kind === 'annotation' && row.body === privateAlice);
    assert(source && annotation); assert.equal(source.document, sourceText);
    assert.equal(annotation.visibility, 'private'); assert.equal(annotation.source_id, source.id);
    assert.equal(annotation.document_version, source.document_version); assert.equal(annotation.sha256, source.sha256);
    assert.equal(annotation.selector.exact, passage);
    assert(aliceState.items.some(row => row.kind === 'progress' && row.source_id === source.id && row.visibility === 'private'));
    stage = 'second actor private research isolation';
    await desk(bob).getByRole('button', { name: 'Load research', exact: true }).click();
    await desk(bob).getByRole('button', { name: 'Synthetic reading group', exact: true }).click();
    await desk(bob).getByRole('button', { name: sourceTitle, exact: true }).click();
    assert.equal(await desk(bob).locator('.research-reading-text pre').textContent(), sourceText);
    let bobState = await researchState(bob, 'bob');
    assert(bobState.items.some(row => row.kind === 'membership' && row.source_id === source.id));
    assert.equal(bobState.items.some(row => row.kind === 'progress' || row.body === privateAlice), false);
    assert.equal(await desk(bob).getByText(privateAlice, { exact: true }).count(), 0);
    await annotate(bob, privateBob);
    await desk(bob).getByRole('button', { name: 'Save my reading place', exact: true }).click();
    await researchSettled(bob);
    stage = 'explicit shared research annotation';
    const sharedBody = 'Synthetic explicitly shared annotation';
    await annotate(alice, sharedBody, true);
    await desk(bob).getByRole('button', { name: 'Load research', exact: true }).click();
    await desk(bob).getByText(sharedBody, { exact: true }).waitFor();
    bobState = await researchState(bob, 'bob');
    assert(bobState.items.some(row => row.kind === 'annotation' && row.body === privateBob));
    assert(bobState.items.some(row => row.kind === 'annotation' && row.body === sharedBody && row.visibility === 'shared'));
    assert.equal(bobState.items.some(row => row.body === privateAlice), false);
    assert.equal((await researchState(alice, 'alice')).items.some(row => row.body === privateBob), false);
  }
  if (fixture.revocation_handshake) { stage = 'revocation retains pending writing'; await bob.getByLabel('Page body', { exact: true }).fill(`${merged}\nUnsent before revocation`); await saved(bob); await handshake('READY_FOR_REVOCATION', 'REVOKED'); await bob.getByRole('button', { name: 'Sync now', exact: true }).click(); await poll(() => bob.locator('.federation-status').innerText(), value => value?.includes('Access revoked'), 'revocation did not settle'); assert.equal(await bob.getByRole('button', { name: 'Sync now', exact: true }).isEnabled(), false); assert.equal(await bob.getByLabel('Page body', { exact: true }).inputValue(), `${merged}\nUnsent before revocation`); }
  stage = 'browser credential boundary'; assert.equal(leakedCredential, false); assert.equal(ownerRequest, false); assert(!bridgeOutput.includes(fixture.alice_token) && !bridgeOutput.includes(fixture.bob_token));
  const storage = await context.storageState(); assert.equal(storage.origins.some(origin => origin.localStorage.length > 0), false);
  if (process.env.ATLAS_WORKSPACE_SCREENSHOT) await alice.screenshot({ path: process.env.ATLAS_WORKSPACE_SCREENSHOT, fullPage: true });
  stage = 'mobile workspace layout'; await alice.setViewportSize({ width: 390, height: 844 }); await alice.waitForLoadState('networkidle');
  if (process.env.ATLAS_WORKSPACE_SCREENSHOT) await alice.screenshot({ path: `${process.env.ATLAS_WORKSPACE_SCREENSHOT}.mobile.png`, fullPage: true });
  if (process.env.ATLAS_WORKSPACE_SCREENSHOT) await writeFile(`${process.env.ATLAS_WORKSPACE_SCREENSHOT}.layout.json`, JSON.stringify(await alice.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('*')].map(node => { const box = node.getBoundingClientRect(); return { tag: node.tagName, class: typeof node.className === 'string' ? node.className : '', left: box.left, right: box.right, width: box.width }; }).filter(node => node.right > innerWidth + 1 || node.left < -1) }))), { mode: 0o600 });
  assert(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  process.stdout.write('collaboration browser fixture: passed\n');
} catch { process.stderr.write(`collaboration browser fixture: failed at ${stage}\n`); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  if (bridge && bridge.exitCode === null && bridge.signalCode === null) {
    const exited = new Promise(done => bridge.once('exit', done)); bridge.kill('SIGTERM');
    const timeout = await Promise.race([exited.then(() => false), wait(5000).then(() => true)]);
    if (timeout) { bridge.kill('SIGKILL'); await exited; }
  }
  if (directory) await rm(directory, { recursive: true, force: true }); process.stdin.destroy();
}
