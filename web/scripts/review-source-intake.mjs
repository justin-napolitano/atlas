// Exercise compiled AddSource with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-intake-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/source-intake-harness.html')}}});
const preview=await startPreview({root,configFile:false,logLevel:'silent',build:{outDir:join(temporary,'dist')},preview:{host:'127.0.0.1',port:0,strictPort:true}});
const origin=`http://127.0.0.1:${preview.httpServer.address().port}`;
const chromePath=process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const chrome=spawn(chromePath,['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0',`--user-data-dir=${join(temporary,'profile')}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let diagnostics='',failure,socket,serial=0;const pending=new Map(),problems=[];
chrome.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4000);});
chrome.on('error',error=>{failure=error;});chrome.on('exit',(code,signal)=>{failure=new Error(`Owned intake Chrome exited (${code ?? signal})`);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(failure)throw failure;try{const value=await fn();if(value)return value;}catch{}await sleep(100);}throw new Error(`Timed out: ${label}`);}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},20000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function click(text){await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)})?.click()`);}
async function fill(name,text){await evaluate(`document.querySelector('[name="${name}"]').focus()`);await call('Input.insertText',{text});}
async function fillLabel(label,text){await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)})).querySelector('input,textarea').focus()`);await call('Input.insertText',{text});}
async function select(label,value){await evaluate(`{const input=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)})).querySelector('select');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function checkbox(label){await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').click()`);}
async function sourceFields(title='Synthetic article <script>inert</script>'){
  await fill('title',title);await fill('source_url','https://example.invalid/article');await fill('identifier','doi:10.1234/synthetic');await fill('edition','Synthetic edition');await fill('rationale','Synthetic bounded question');
}
try{
  await until(()=>diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'owned debug port');
  const endpoint=new URL(diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
  const targets=await (await fetch(`http://${endpoint.host}/json/list`)).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result);}}else if(value.method==='Runtime.exceptionThrown')problems.push(value.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/source-intake-harness.html'});
  await until(()=>evaluate('!!document.querySelector("#source-intake-heading")'),'source intake mount');
  await sourceFields();await click('Check identity & continue');await until(()=>evaluate('document.body.textContent.includes("Check your library")'),'identity step');
  await click('Review source');await until(()=>evaluate('document.body.textContent.includes("Metadata only. You can add")'),'metadata review');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="Save source").disabled'),true);
  await checkbox('I reviewed these declarations');await click('Save source');
  await until(()=>evaluate('document.body.textContent.includes("The save could not be confirmed")'),'retained unknown response');
  assert.equal(await evaluate('window.__intakeTest.records.size'),1);assert.equal(await evaluate('window.__intakeTest.receipts.size'),1);
  await click('Retry exact save');await until(()=>evaluate('!!document.querySelector("#intake-created")'),'metadata saved after retry');
  assert.equal(await evaluate('JSON.stringify(window.__intakeTest.requests[0])===JSON.stringify(window.__intakeTest.requests[1])'),true);
  assert.equal(await evaluate('window.__intakeTest.drafts.current.size'),0);
  assert.equal(await evaluate('window.__intakeTest.documents.size'),0);
  await evaluate('window.__intakeTest.reset()');await until(()=>evaluate('!!document.querySelector("[name=title]")'),'new intake');
  await fill('title','Project-scoped draft');await evaluate('window.__intakeTest.setProject("other-project")');
  await until(()=>evaluate('document.querySelector("[name=title]")?.value===""'),'other project has separate draft');
  await evaluate('window.__intakeTest.setProject("synthetic-project")');
  await until(()=>evaluate('document.querySelector("[name=title]")?.value==="Project-scoped draft"'),'return preserves original project draft');
  await evaluate('document.querySelector("[name=title]").focus();document.querySelector("[name=title]").select()');
  await call('Input.insertText',{text:'Different proposed title; existing source remains unchanged'});
  await fill('source_url','https://example.invalid/article');await fill('identifier','doi:10.1234/synthetic');await fill('edition','Synthetic edition');await fill('rationale','Read a located passage from the existing source');
  await click('Check identity & continue');await until(()=>evaluate('document.body.textContent.includes("These sources share")'),'duplicate identity hints');
  await click('Reuse this source');await until(()=>evaluate('document.body.textContent.includes("Its bibliography will stay unchanged")'),'explicit existing source');
  await checkbox('Bring a permitted excerpt');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="Review source").disabled'),true,'metadata-only rights cannot import text');
  await select('Text reuse status','permitted_excerpt');await fillLabel('Permission / license','Synthetic fixture authored for this browser test');
  await fill('locator','Synthetic section 2');await fillLabel('Plain-text excerpt','😀 tafsīr and التفسير. Synthetic evidence.');
  await click('Review source');await until(()=>evaluate('document.body.textContent.includes("Located excerpt: Synthetic section 2")'),'located review');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px intake has no horizontal overflow');
  await writeFile(join(artifacts,'source-intake-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await checkbox('I reviewed these declarations');await click('Save & start reading');await until(()=>evaluate('document.querySelector("#intake-created blockquote")?.textContent.includes("التفسير")'),'saved exact source excerpt');
  assert.equal(await evaluate('window.__intakeTest.records.size'),1,'reuse does not create a duplicate source');
  assert.equal(await evaluate('[...window.__intakeTest.records.values()][0].title'),'Synthetic article <script>inert</script>','reuse preserves bibliography');
  assert.equal(await evaluate('window.__intakeTest.documents.size'),1);
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("Synthetic evidence"))'),false);
  const requestsBeforePreset=await evaluate('window.__intakeTest.requests.length');
  await evaluate('window.__intakeTest.startPilot()');
  await until(()=>evaluate('document.querySelector("[name=identifier]")?.value==="doi:10.3390/rel12070483"'),'real article descriptive preset');
  assert.equal(await evaluate('window.__intakeTest.requests.length'),requestsBeforePreset,'preset mount cannot import');
  assert.equal(await evaluate('document.body.textContent.includes("manual transcription")'),true);
  await click('Check identity & continue');
  await until(()=>evaluate('document.body.textContent.includes("Existing canonical bibliography fixture")'),'canonical source offered without overwriting');
  await click('Reuse this source');await click('Review source');
  await until(()=>evaluate('document.body.textContent.includes("Located excerpt: Abstract, sentences 1–4")'),'bounded abstract review');
  assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="Save & start reading").disabled'),true,'preset still requires explicit acknowledgement');
  await checkbox('I reviewed these declarations');await click('Save & start reading');
  await until(()=>evaluate('document.querySelector("#intake-created blockquote")?.textContent.includes("verses 59 and 83 of chapter 4")'),'real provided abstract saved');
  assert.equal(await evaluate('window.__intakeTest.requests.at(-1).existing_source_record_id'),'https://islam-research.local/id/sirry-2021-ulul-amr');
  assert.equal(await evaluate('window.__intakeTest.requests.at(-1).coverage_scope'),'abstract');
  assert.equal(await evaluate('window.__intakeTest.requests.at(-1).intake_context.includes("No full-argument verification")'),true);
  assert.equal(await evaluate('window.__intakeTest.records.get("https://islam-research.local/id/sirry-2021-ulul-amr").title'),'Existing canonical bibliography fixture');
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({sourceIntakeChecksPassed:true,checks:['compiled AddSource component','metadata-only fallback','explicit review before save','lost-response exact retry','one durable source receipt','project-scoped page-memory drafts','existing-source identity choice','rights gate before excerpt','located Unicode/Arabic excerpt readback','reuse without bibliography overwrite','390px layout','no private localStorage'],artifacts}));
}finally{
  socket?.close();chrome.kill();await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Intake review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
