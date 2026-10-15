// Exercise compiled ResearchNotebook with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-notebook-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/notebook-harness.html')}}});
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
async function select(label,value){await evaluate(`{const input=[...document.querySelectorAll('label')].filter(label=>label.textContent.startsWith(${JSON.stringify(label)})).at(-1).querySelector('select');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function checkbox(label){await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').click()`);}
try{
  await until(()=>diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'owned debug port');
  const endpoint=new URL(diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
  const targets=await (await fetch(`http://${endpoint.host}/json/list`)).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}}else if(value.method==='Runtime.exceptionThrown')problems.push(value.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/notebook-harness.html'});
  await until(()=>evaluate('document.body.textContent.includes("Original passage note")'),'notebook mounted');
  assert.equal(await evaluate('window.__notebookTest.requests.length'),0);
  await click('Original passage note');assert.equal(await evaluate('window.__notebookTest.opened[2]'),'synthetic:annotation');
  await click('New thought at this passage');
  await fillLabel('Title','My contextual question');await fillLabel('Thought (Markdown','😀 التفسير **tafsīr** <script>unsafe</script>');
  await select('Thought type','question');await fillLabel('Target ID','synthetic:source');await fillLabel('Why connect','Context for my reading question');await click('Add explained connection');
  await click('Save thought');await until(()=>evaluate('document.body.textContent.includes("Notebook save could not be confirmed")'),'uncertain creation');
  assert.equal(await evaluate('window.__notebookTest.entries.size'),1);assert.equal(await evaluate('document.querySelector("textarea").matches(":disabled")'),true);
  await evaluate('window.__notebookTest.remount()');await until(()=>evaluate('document.body.textContent.includes("Retry original notebook save")'),'retained creation after remount');
  await click('Retry original notebook save');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0 && document.body.textContent.includes("Thought ID:")'),'created thought acknowledged');
  assert.equal(await evaluate('JSON.stringify(window.__notebookTest.requests[0])===JSON.stringify(window.__notebookTest.requests[1])'),true);
  assert.equal(await evaluate('document.querySelector("script:not([src])")'),null);
  await click('Return to anchored source');assert.equal(await evaluate('window.__notebookTest.opened[3]'),'synthetic:document');
  await evaluate(`{const input=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Thought (Markdown')).querySelector('textarea');input.focus();input.select();}`);
  await call('Input.insertText',{text:'My revised reading'});await evaluate('window.__notebookTest.remote()');await click('Save thought');
  await until(()=>evaluate('document.body.textContent.includes("Another revision needs comparison")'),'two-device correction conflict');
  assert.equal(await evaluate('document.body.textContent.includes("Cloud thought from another device")'),true);
  await click('Keep my draft for explicit save');await click('Save thought');
  await until(()=>evaluate('document.body.textContent.includes("Correction save could not be confirmed")'),'lost correction acknowledgement');
  await click('Retry original notebook save');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0 && [...window.__notebookTest.entries.values()][0].revision===3'),'same correction acknowledged');
  await click('View thought history');await until(()=>evaluate('document.body.textContent.includes("Revision 3")'),'correction history');
  await click('Older thought revisions');await until(()=>evaluate('document.body.textContent.includes("Revision 2")'),'paged earlier thought');
  await select('State','withdrawn');await click('Save thought');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0 && [...window.__notebookTest.entries.values()][0].state==="withdrawn"'),'withdraw without deleting');
  await evaluate(`{const input=document.querySelector('.notebook-filters select:last-of-type');}`);
  await evaluate(`{const input=[...document.querySelectorAll('.notebook-filters label')].find(label=>label.textContent.startsWith('State')).querySelector('select');input.value='withdrawn';input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await click('Apply filters');await until(()=>evaluate("document.querySelectorAll('.notebook-layout > section:first-child article').length===1"),'withdrawn filter');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px no overflow');
  await writeFile(join(artifacts,'notebook-mobile-dark.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.__notebookTest.wrong(true)');await click('Apply filters');await until(()=>evaluate('document.body.textContent.includes("Notebook list did not match this project")'),'foreign project refused');
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("My revised reading"))'),false);assert.deepEqual(problems,[]);
  console.log(JSON.stringify({notebookPassed:true,checks:['compiled owner notebook','live passage note backlink','anchored thought and explained connection','Unicode Markdown inert text','retained creation UUID and exact lost-response retry','source context readback','two-device correction comparison','CAS lost acknowledgement retry','paged revision history','withdrawal filter','wrong-project refusal','dark390px','no private localStorage'],artifacts}));
}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Notebook review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
