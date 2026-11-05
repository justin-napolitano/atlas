// Exercise compiled AddSource with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-pilot-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/pilot-reading-harness.html')}}});
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
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/pilot-reading-harness.html'});
  await until(()=>evaluate('document.querySelectorAll(".pilot-arabic").length===2'),'two validated Arabic pilot verses');
  assert.equal(await evaluate('[...document.querySelectorAll(".pilot-verses form button")].every(b=>b.disabled)'),true);
  await evaluate('document.querySelector(".pilot-notice summary").click()');
  assert.ok(await evaluate('document.querySelector(".pilot-notice pre").textContent.includes("<b>Plain text only</b>")'));
  assert.equal(await evaluate('document.querySelector(".pilot-notice pre b")'),null);
  await evaluate('document.querySelector(".pilot-verses textarea").focus()');
  await call('Input.insertText',{text:'Synthetic project reading rationale'});
  await evaluate('window.__pilotTest.setProject("other-project")');
  await until(()=>evaluate('document.querySelector(".pilot-verses textarea")?.value===""'),'project draft isolation');
  await evaluate('window.__pilotTest.setProject("synthetic-project")');
  await until(()=>evaluate('document.querySelector(".pilot-verses textarea")?.value==="Synthetic project reading rationale"'),'retained project rationale');
  await evaluate('document.querySelector(".pilot-verses input[type=checkbox]").click()');
  await click('Add verse & read');
  await until(()=>evaluate('document.body.textContent.includes("The save was not confirmed")'),'lost import response');
  assert.equal(await evaluate('window.__pilotTest.receipts.size'),1);
  assert.equal(await evaluate('document.querySelector(".pilot-verses textarea").disabled'),true);
  await click('Retry original verse import');
  await until(()=>evaluate('!!document.querySelector("#pilot-opened")'),'verified imported source navigation');
  assert.equal(await evaluate('JSON.stringify(window.__pilotTest.requests[0])===JSON.stringify(window.__pilotTest.requests[1])'),true);
  assert.equal(await evaluate('window.__pilotTest.drafts.current.size'),0);
  const opened=await evaluate('JSON.parse(document.querySelector("#pilot-opened pre").textContent)');
  assert.deepEqual(opened,['synthetic:imported','synthetic-project','synthetic:import-annotation','synthetic:import-document']);
  await click('Back to pilot');await until(()=>evaluate('document.querySelectorAll(".pilot-arabic").length===2'),'reopen pilot');
  await click('Show linked reading material');
  await until(()=>evaluate('!!document.querySelector(".pilot-related blockquote")'),'located commentary');
  assert.ok(await evaluate('document.querySelector(".pilot-related").textContent.includes("needs review")'));
  assert.ok(await evaluate('document.querySelector(".pilot-related").textContent.includes("No translation appears")'));
  await click('More linked material');await until(()=>evaluate('document.querySelectorAll(".pilot-related > article").length===2'),'related material pagination');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('document.documentElement.dataset.theme="dark"');await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px Arabic and linked sources fit');
  await writeFile(join(artifacts,'pilot-reader-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('Open exact source passage →');await until(()=>evaluate('!!document.querySelector("#pilot-opened")'),'commentary exact source navigation');
  assert.deepEqual(await evaluate('JSON.parse(document.querySelector("#pilot-opened pre").textContent)'),['synthetic:source','synthetic-project','synthetic:annotation','synthetic:document']);
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("Synthetic project reading rationale"))'),false);
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({pilotReaderChecksPassed:true,checks:['compiled pilot UI','both bounded Arabic text digests','full source notice and escaped labels','explicit private import','retained project drafts','lost-response exact retry','document and annotation readback before navigation','located commentary and changed-citation warning','missing coverage labelled','related-source pagination','exact source navigation','390px dark RTL layout','no private localStorage'],artifacts}));
}finally{
  socket?.close();chrome.kill();await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Pilot review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
