// Exercise compiled VerseLinks with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-verse-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/verse-links-harness.html')}}});
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
try{
  await until(()=>diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'owned debug port');
  const endpoint=new URL(diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
  const targets=await (await fetch(`http://${endpoint.host}/json/list`)).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result);}}else if(value.method==='Runtime.exceptionThrown')problems.push(value.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/verse-links-harness.html'});
  await until(()=>evaluate('document.body.textContent.includes("Link to verse")'),'widget mounted');
  assert.equal(await evaluate('window.__verseTest.requests.length'),0);
  await click('Link to verse');await until(()=>evaluate('!!document.querySelector("[name=ayah_start]")'),'connection form');
  await fill('ayah_start','59');await fill('attribution','Synthetic Arabic source author');await fill('source_scope','Only this selected paragraph, not all traditions');await fill('rationale','Compare its stated discussion with Q 4:59');
  await checkbox('I checked the verse');await click('Save verse connection');
  await until(()=>evaluate('document.body.textContent.includes("The save could not be confirmed")'),'lost save retains exact request');
  assert.equal(await evaluate('window.__verseTest.materials.size'),1);
  assert.equal(await evaluate('document.querySelector("[name=ayah_start]").matches(":disabled")'),true);
  await evaluate('window.__verseTest.remount()');await until(()=>evaluate('document.body.textContent.includes("Link to verse")'),'remount retained draft');
  await evaluate('document.querySelector(".verse-links > button").click()');await until(()=>evaluate('document.body.textContent.includes("Retry exact connection save")'),'retained request reopened');
  await click('Retry exact connection save');await until(()=>evaluate('document.body.textContent.includes("Connection saved privately")'),'acknowledged exact readback');
  assert.equal(await evaluate('window.__verseTest.materials.size'),1);
  assert.equal(await evaluate('JSON.stringify(window.__verseTest.requests[0])===JSON.stringify(window.__verseTest.requests[1])'),true);
  assert.equal(await evaluate('window.__verseTest.drafts.current.size'),0);
  await click('Q 4:59');assert.equal(await evaluate('window.__verseTest.opened.ayah_start'),59);
  await fill('ayah_start','83');await select('Connection type','interpretive_claim');await select('Interpretation wording','quotation');
  assert.equal(await evaluate('document.querySelector("[name=assertion_text]").value===window.__verseTest.annotation.exact'),true);
  await fill('attribution','Synthetic author');await fill('source_scope','Exact whole captured paragraph');await fill('rationale','Record the source’s scoped interpretation');
  await checkbox('I checked the verse');await click('Save verse connection');await until(()=>evaluate('window.__verseTest.materials.size===2 && window.__verseTest.drafts.current.size===0'),'quotation interpretation saved');
  await until(()=>evaluate('document.body.textContent.includes("More verse connections")'),'paged source connections');
  await click('More verse connections');await until(()=>evaluate('document.body.textContent.includes("Q 4:83")'),'second page visible');
  assert.equal(await evaluate('document.body.textContent.includes("Attributed interpretation")'),true);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px no horizontal overflow');
  await writeFile(join(artifacts,'verse-links-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.__verseTest.wrong(true)');await click('Refresh verse connections');
  await until(()=>evaluate('document.body.textContent.includes("Verse connection did not match this exact source passage")'),'wrong-project list refused');
  await evaluate('window.__verseTest.wrong(false)');await click('Refresh verse connections');
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("Synthetic Arabic source"))'),false);
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({verseLinksPassed:true,checks:['compiled owner component','no automatic writes','retained UUID lost-response retry','reopen draft','source-bound readback','discussion versus attributed quotation','Arabic and emoji preserved','paged connections','verse navigation callback','wrong-project refusal','390px overflow','no private localStorage'],artifacts}));
}finally{
  socket?.close();chrome.kill();await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Verse review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
