// Headless Chrome checks with synthetic API responses. Never bypasses production auth.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = await mkdtemp(join(tmpdir(),'research-browser-'));
const artifacts = process.env.RESEARCH_BROWSER_ARTIFACT_DIR || await mkdtemp(join(tmpdir(),'research-workspace-artifacts-'));
await mkdir(artifacts,{ recursive:true });
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const preview = spawn('npm',['run','preview','--','--port','5187','--strictPort'],{ cwd:root, stdio:'ignore' });
const chrome = spawn(chromePath,['--headless=new','--disable-background-networking','--disable-component-update',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=9338',`--user-data-dir=${profile}`,
  '--window-size=1440,1000','about:blank'],{ stdio:'ignore' });
let socket;
let processFailure;
preview.on('error',error => { processFailure = error; });
chrome.on('error',error => { processFailure = error; });
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn, label) {
  for (let i=0;i<100;i++) { if (processFailure) throw processFailure; try { const value=await fn(); if (value) return value; } catch {} await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
let serial=0; const pending=new Map(); const problems=[]; const saved=new Map(); let conflict=false, authenticated=true;
const records = [
  { id:'synthetic:question',project_id:'synthetic',kind:'question',title:'Synthetic question about authority',summary:'A bounded synthetic question.',revision:1,review_state:'pending',attributes:{} },
  { id:'synthetic:source',project_id:'synthetic',kind:'source',title:'Synthetic source <script>not HTML</script>',summary:'Synthetic source summary.',revision:1,review_state:'pending',attributes:{} },
];
const claim={ ...records[0],id:'synthetic:claim',kind:'claim',title:'Synthetic attributed finding',summary:'Synthetic finding about authority' };
const evidence={ ...records[0],id:'synthetic:evidence',kind:'evidence',title:'Synthetic located evidence',summary:'Synthetic fair paraphrase',attributes:{ rdf_properties:{ 'https://islam-research.local/vocab/locator':['"Synthetic section 2, paragraph 3"'] } } };
function call(method,params={}) { return new Promise((resolve,reject) => {
  const id=++serial; const timeout=setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); },8000);
  pending.set(id,{ resolve,reject,timeout }); socket.send(JSON.stringify({ id,method,params }));
}); }
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{ expression,returnByValue:true,awaitPromise:true });
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  return result.result.value;
}
async function fixture(event) {
  const url=new URL(event.request.url), path=url.pathname;
  let status=200,data;
  if (!authenticated) { status=401; data={ detail:'Owner sign-in required' }; }
  else if (path==='/v1/me') data={ mode:'owner',can_edit:true };
  else if (path==='/v1/projects') data={ items:[{ id:'synthetic',title:'Synthetic research project' }] };
  else if (path==='/v1/records' || path==='/v1/search') data={ items:records,next_cursor:null };
  else if (path==='/v1/record') data=[...records,claim,evidence].find(r => r.id===url.searchParams.get('record_id'));
  else if (path==='/v1/personal-state') { data=saved.get(url.searchParams.get('record_id')); if (!data) { status=404; data={}; } }
  else if (path==='/v1/personal-states') {
    const value=JSON.parse(event.request.postData);
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    const current=saved.get(value.record_id);
    if (conflict) { conflict=false; status=409; data={ current:{ ...value,note:'Cloud edit from another synthetic machine',revision:9 } }; saved.set(value.record_id,data.current); }
    else if (value.expected_revision !== (current?.revision || 0)) { status=409; data={ current }; }
    else { data={ ...value,revision:(current?.revision || 0)+1,read_at:value.reading==='read' ? '2026-10-15T00:00:00Z' : null }; saved.set(value.record_id,data); }
  } else if (path==='/v1/evidence-path') data={ nodes:[...records,claim,evidence],edges:[],paths:[{ records:[records[0].id,claim.id,evidence.id,records[1].id],edges:['1','2','3'] }],truncated:false };
  else { status=404; data={}; }
  await call('Fetch.fulfillRequest',{ requestId:event.requestId,responseCode:status,
    responseHeaders:[{ name:'Content-Type',value:'application/json' }],body:Buffer.from(JSON.stringify(data || {})).toString('base64') });
}
try {
  await until(async () => (await fetch('http://127.0.0.1:5187/workspace.html')).ok,'preview server');
  const pages=await until(async () => { const p=await (await fetch('http://127.0.0.1:9338/json/list')).json(); return p.find(x => x.type==='page'); },'Chrome CDP');
  socket=new WebSocket(pages.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{ once:true }); socket.addEventListener('error',reject,{ once:true }); });
  socket.addEventListener('message',event => {
    const message=JSON.parse(event.data);
    if (message.id) { const item=pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    else if (message.method==='Fetch.requestPaused') fixture(message.params).catch(error => problems.push(error.message));
    else if (message.method==='Runtime.exceptionThrown') problems.push('Unexpected browser runtime exception');
  });
  await call('Runtime.enable'); await call('Page.enable'); await call('Fetch.enable',{ patterns:[{ urlPattern:'*/v1/*' }] });
  await call('Page.navigate',{ url:'http://127.0.0.1:5187/workspace.html' });
  await until(() => evaluate('document.querySelectorAll(".workspace-row").length===2'),'project record list');
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(() => evaluate('document.querySelector(".workspace-trails")?.textContent.includes("Synthetic section 2, paragraph 3")'),'located question evidence trail');
  assert.match(await evaluate('document.querySelector(".workspace-trails").textContent'),/Synthetic finding about authority/);
  await evaluate('[...document.querySelectorAll(".workspace-trails li button")].at(-1).click()');
  await until(() => evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic source")'),'open source from evidence trail');
  await until(() => evaluate('!!document.querySelector("#my-note")'),'source reading notes');
  assert.equal(await evaluate('document.querySelectorAll(".workspace-record-heading script").length'),0);
  await evaluate('document.querySelector("#my-note").focus()');
  await call('Input.insertText',{ text:'Synthetic browser note <img src=x onerror=alert(1)>' });
  await evaluate('document.querySelector(".workspace-note-actions button").click()');
  await until(() => evaluate('document.querySelector(".workspace-note-actions").textContent.includes("Saved to your workspace")'),'note save');
  assert.match(saved.get('synthetic:source').note,/Synthetic browser note/);
  await evaluate('document.querySelector(".workspace-decisions button:nth-child(2)").click()');
  await until(() => saved.get('synthetic:source')?.decision==='not_relevant','skip persisted');
  await evaluate(`const reading=document.querySelector('.workspace-notes select'); reading.value='read'; reading.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until(() => saved.get('synthetic:source')?.reading==='read','read persisted');
  await call('Page.reload');
  await until(() => evaluate('document.querySelector("#my-note")?.value.includes("Synthetic browser note")'),'reload retains cloud note');
  assert.equal(await evaluate('document.querySelector(".workspace-notes select").value'),'read');
  assert.equal(await evaluate('document.querySelector(".workspace-decisions button:nth-child(2)").getAttribute("aria-pressed")'),'true');
  const width=await evaluate('document.querySelector(".owner-panes").style.getPropertyValue("--list-width")');
  await evaluate('document.querySelector(".pane-divider").focus()');
  await call('Input.dispatchKeyEvent',{ type:'keyDown',key:'ArrowRight',code:'ArrowRight' });
  assert.notEqual(await evaluate('document.querySelector(".owner-panes").style.getPropertyValue("--list-width")'),width);
  conflict=true;
  await evaluate('document.querySelector("#my-note").focus()'); await call('Input.insertText',{ text:' New draft.' });
  await evaluate('document.querySelector(".workspace-note-actions button").click()');
  await until(() => evaluate('!!document.querySelector(".workspace-conflict")'),'revision conflict');
  assert.match(await evaluate('document.querySelector("#my-note").value'),/New draft/);
  assert.match(await evaluate('document.querySelector(".workspace-conflict pre").textContent'),/Cloud edit/);
  await evaluate('document.querySelector(".workspace-conflict button").click()');
  await until(() => evaluate('document.querySelector("#my-note").value.startsWith("Cloud edit")'),'explicit cloud resolution');
  await evaluate('document.querySelector(".header-tools button").click()');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  const desktop=await call('Page.captureScreenshot',{ format:'png' }); await writeFile(join(artifacts,'desktop.png'),Buffer.from(desktop.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{ width:390,height:844,deviceScaleFactor:1,mobile:true });
  await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'mobile horizontal overflow');
  const mobile=await call('Page.captureScreenshot',{ format:'png' }); await writeFile(join(artifacts,'mobile.png'),Buffer.from(mobile.data,'base64'));
  assert.equal(await evaluate('Object.values(localStorage).some(v=>v.includes("Synthetic browser note")||v.includes("Cloud edit"))'),false);
  authenticated=false; await call('Page.reload');
  await until(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("Owner sign-in")'),'anonymous sign-in boundary');
  assert.equal(await evaluate('!!document.querySelector("#my-note")'),false);
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({ passed:true,checks:['question findings to located evidence to source','read/skip/note save and reload','inert untrusted text','keyboard pane resize','revision conflict comparison','dark mode','390px overflow','no private localStorage','anonymous boundary'],artifacts }));
} finally {
  socket?.close(); chrome.kill(); preview.kill();
  for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Review finished')); }
  await sleep(200); await rm(profile,{ recursive:true,force:true });
}
