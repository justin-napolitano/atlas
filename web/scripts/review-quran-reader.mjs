// Exercise the compiled Markdown notes sidebar through an explicit synthetic boundary.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-notebook-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
const fixture=execFileSync('python3',['-c',"import json; from islam_research.quran_reader import catalog,chapter; print(json.dumps(dict(catalog=catalog(),chapters={str(c):chapter(c) for c in (1,4,114)})))"],{cwd:join(root,'..'),env:{...process.env,PYTHONPATH:'src'},maxBuffer:4*1024*1024}).toString();
await build({define:{__QURAN_TEST_DATA__:fixture},root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/quran-harness.html')}}});
const preview=await startPreview({root,configFile:false,logLevel:'silent',build:{outDir:join(temporary,'dist')},preview:{host:'127.0.0.1',port:0,strictPort:true}});
const origin=`http://127.0.0.1:${preview.httpServer.address().port}`;
const chromePath=process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const chrome=spawn(chromePath,['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0',`--user-data-dir=${join(temporary,'profile')}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let diagnostics='',failure,socket,serial=0;const pending=new Map(),problems=[];
chrome.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4000);});
chrome.on('error',error=>{failure=error;});chrome.on('exit',(code,signal)=>{failure=new Error(`Owned intake Chrome exited (${code ?? signal})`);});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,attempts=100){for(let i=0;i<attempts;i++){if(failure)throw failure;try{const value=await fn();if(value)return value;}catch{}await sleep(100);}throw new Error(`Timed out: ${label}; ${diagnostics}`);}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},20000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function click(text){await evaluate(`{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)});if(!button)throw new Error('Missing button');for(let p=button.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;button.click();}`);}
async function fill(name,text){await evaluate(`document.querySelector('[name="${name}"]').focus()`);await call('Input.insertText',{text});}
async function fillLabel(label,text){await evaluate(`{const labelNode=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)}));for(let p=labelNode.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;labelNode.querySelector('input,textarea').focus();}`);await call('Input.insertText',{text});}
async function select(label,value){await evaluate(`{const input=[...document.querySelectorAll('label')].filter(label=>label.textContent.startsWith(${JSON.stringify(label)})).at(-1).querySelector('select');for(let p=input.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function checkbox(label){await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').click()`);}
try{
  const port=await until(async()=>Number((await readFile(join(temporary,'profile','DevToolsActivePort'),'utf8')).split('\n')[0]),'owned debug port',300);
  const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}}else if(value.method==='Runtime.exceptionThrown')problems.push(value.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/quran-harness.html?view=quran&project=synthetic'});
  await until(()=>evaluate('document.querySelectorAll("[data-ayah]").length===176'),'complete An-Nisa');
  assert.equal(await evaluate('document.querySelector(`[data-ayah="59"] .quran-translation`).textContent.length>30'),true);
  const before=await evaluate('getComputedStyle(document.querySelector(".quran-translation")).fontSize');
  await click('Larger');
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".quran-translation")).fontSize'),before);
  await evaluate('document.querySelector(".reading-appearance-panel").open=false');
  await evaluate('document.querySelector(`[data-ayah="59"] .quran-ayah-number`).click()');
  await until(()=>evaluate('!!document.querySelector(`[aria-label="Write a verse note"]`)'),'note without import');
  await evaluate('window.__quranTest.lost();document.querySelector(`[aria-label="Write a verse note"]`).focus()');
  await call('Input.insertText',{text:'**An initial thought**'});
  await until(()=>evaluate('window.__quranTest.entries.size===1'),'first atomic note exists');
  await call('Input.insertText',{text:' with newer typing'});
  await evaluate('window.__quranTest.release()');
  await until(()=>evaluate('!!document.querySelector(".quran-writing [role=alert]")'),'lost response is explicit');
  await click('Retry original save');
  await until(()=>evaluate('[...window.__quranTest.entries.values()][0]?.body==="**An initial thought** with newer typing"'),'retry retains newer writing');
  assert.equal(await evaluate('window.__quranTest.entries.size'),1);
  await evaluate('document.querySelector(`[aria-label="Write a verse note"]`).blur()');
  await until(()=>evaluate('!!document.querySelector(".location-note-body strong")'),'saved Markdown note');
  await click('Arabic notes');
  await until(()=>evaluate('document.querySelectorAll(".quran-notes [data-margin-note-id]").length===0'),'Arabic note context');
  await click('English notes');
  await until(()=>evaluate('document.querySelectorAll(".quran-notes [data-margin-note-id]").length===1'),'original translation note remains');
  await evaluate('document.querySelector(`[data-ayah="59"] .quran-ayah-number`).click();const node=document.querySelector(`[data-ayah="59"] .quran-translation`);const range=document.createRange();range.setStart(node.firstChild,0);range.setEnd(node.firstChild,18);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new MouseEvent("mouseup",{bubbles:true}))');
  await until(()=>evaluate('!!document.querySelector(".quran-selection-actions button")'),'selection action');
  await click('Highlight & note');
  await until(()=>evaluate('window.__quranTest.annotations.size===1&&!!document.querySelector(".quran-text mark")'),'persisted inline highlight');
  await evaluate('document.querySelector(".quran-text mark").click()');
  await until(()=>evaluate('!!document.querySelector(".saved-passage-note.is-active")'),'highlight opens exact note');
  await click('Arabic notes');
  assert.equal(await evaluate('document.querySelectorAll(".quran-arabic mark").length'),0);
  await click('English notes');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),true);
  await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(result=>writeFile(join(artifacts,'quran-mobile.png'),Buffer.from(result.data,'base64')));
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate('document.querySelector(`[aria-label="Close notes"]`).click()');
  await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(result=>writeFile(join(artifacts,'quran-reader.png'),Buffer.from(result.data,'base64')));
  assert.deepEqual(problems,[]);console.log(JSON.stringify({inlineHighlight:true,completeSurah:176,atomicNote:true,lostResponseRetry:true,newerTyping:true,markdown:true,resourceIsolation:true,mobileNoOverflow:true,artifacts}));
}finally{socket?.close();chrome.kill('SIGTERM');await preview.httpServer.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);setTimeout(resolve,3000);});await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
