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
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || await mkdtemp(join(tmpdir(),'research-connected-review-'));
await mkdir(artifacts,{recursive:true});
const fixture=execFileSync('python3',['-c',"import json; from islam_research.quran_reader import catalog,chapter; print(json.dumps(dict(catalog=catalog(),chapters={str(c):chapter(c) for c in (1,4,5,114)})))"],{cwd:join(root,'..'),env:{...process.env,PYTHONPATH:'src'},maxBuffer:4*1024*1024}).toString();
await build({define:{__QURAN_TEST_DATA__:fixture},root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/connected-harness.html')}}});
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
async function click(text){await evaluate(`{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)}&&button.getClientRects().length);if(!button)throw new Error('Missing button');for(let p=button.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;button.click();}`);}
async function fill(name,text){await evaluate(`document.querySelector('[name="${name}"]').focus()`);await call('Input.insertText',{text});}
async function fillLabel(label,text){await evaluate(`{const labelNode=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)}));for(let p=labelNode.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;labelNode.querySelector('input,textarea').focus();}`);await call('Input.insertText',{text});}
async function select(label,value){await evaluate(`{const input=[...document.querySelectorAll('label')].filter(label=>label.textContent.startsWith(${JSON.stringify(label)})).at(-1).querySelector('select');for(let p=input.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function checkbox(label){await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').click()`);}try{
 const port=await until(async()=>Number((await readFile(join(temporary,'profile','DevToolsActivePort'),'utf8')).split('\n')[0]),'owned debug port',300);
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}}else if(value.method==='Runtime.exceptionThrown')problems.push(JSON.stringify(value.params.exceptionDetails));};
 await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/connected-harness.html'});
 await until(()=>evaluate('!!document.querySelector(".connected-nav")'),'single global sidebar');
 assert.equal(await evaluate('document.querySelectorAll(".connected-nav").length'),1);
 assert.equal(await evaluate('document.querySelector(".atlas-library").textContent.includes("Projects")'),false);
 await evaluate('document.querySelector(".workspace-sidebar-new").click()');
 await until(()=>evaluate('document.activeElement?.getAttribute("aria-label")==="Note body"'),'body-first capture focus');
 await evaluate('window.__connectedTest.hold()');await call('Input.insertText',{text:'## A loose idea العربية 😀\n\nMy independent Markdown thought.'});
 await until(()=>evaluate('window.__connectedTest.entries.size===1'),'first global note exists');
 await call('Input.insertText',{text:' Newer typing during the acknowledgement.'});await evaluate('window.__connectedTest.release()');
 await until(()=>evaluate('[...window.__connectedTest.entries.values()][0].body.endsWith("Newer typing during the acknowledgement.")'),'newer typing survives held create');
 await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .connected-document-tools [role=status]").textContent==="Saved"'),'exact current revision saved');
 await evaluate('document.querySelector(".connected-nav button").click()');
 await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .connected-document h1")?.textContent==="Continue"'),'global continue');
 await click('A loose idea العربية 😀');
 await until(()=>evaluate('!!document.querySelector(".connected-note .cm-content")'),'open original note');
 await evaluate('document.querySelector(".cm-content").focus()');
 const first=await evaluate('[...window.__connectedTest.entries.keys()][0]');
 await call('Input.dispatchKeyEvent',{type:'keyDown',key:'>',code:'Period',modifiers:process.platform==='darwin'?9:3});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'>',code:'Period',modifiers:process.platform==='darwin'?9:3});await until(()=>evaluate('document.activeElement?.getAttribute("aria-label")==="Note body"'),'second capture focus');
 await call('Input.insertText',{text:'A second unrelated thought.'});await until(()=>evaluate('window.__connectedTest.entries.size===2'),'independent second note');
 assert.equal(await evaluate('[...window.__connectedTest.entries.values()].every(row=>row.project_id===null&&row.record_id===null&&row.document_id===null)'),true);
 await evaluate('document.querySelector(`[aria-label="New collection"]`).click()');
 await evaluate('document.querySelector(`[aria-label="Collection name"]`).focus()');await call('Input.insertText',{text:'Ideas about authority'});await click('Create');
 await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .connected-document h1")?.textContent==="Ideas about authority"'),'optional collection');
 await evaluate(`document.querySelector('.connected-recent button').click()`);await until(()=>evaluate('!!document.querySelector(".connected-note")'),'note from recent');await click('Connections');
 await until(()=>evaluate('!!document.querySelector(".connected-context")'),'bounded context opens');
 await evaluate('document.querySelector(`[aria-label="Resize document and context"]`).focus()');
 const before=await evaluate('document.querySelector(`[aria-label="Resize document and context"]`).getAttribute("aria-valuenow")');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft'});
 assert.notEqual(await evaluate('document.querySelector(`[aria-label="Resize document and context"]`).getAttribute("aria-valuenow")'),before);
 await evaluate('document.querySelector(`[aria-label="Close connections"]`).click()');
 await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(async value=>writeFile(join(artifacts,'connected-notes-desktop.png'),Buffer.from(value.data,'base64')));
 // The assembled shell uses the same complete Qur’an reader, then returns to its
 // current verse after independent capture without resetting its selected text.
 await evaluate('history.pushState(null,"","?view=quran&chapter=4&ayah_start=59");dispatchEvent(new PopStateEvent("popstate"))');
 await until(()=>evaluate('document.querySelectorAll("[data-ayah]").length===176'),'Quran in global shell');
 await evaluate('(()=>{const text=document.querySelector(`[data-ayah="59"] .quran-translation`).firstChild;const r=document.createRange();r.setStart(text,0);r.setEnd(text,8);const s=getSelection();s.removeAllRanges();s.addRange(r)})()');
 const selected=await evaluate('getSelection().toString()');await evaluate('document.querySelector(".workspace-sidebar-new").click()');await until(()=>evaluate('document.activeElement?.getAttribute("aria-label")==="Note body"'),'capture from Quran');await call('Input.insertText',{text:'A loose thought while reading.'});
 await until(()=>evaluate('window.__connectedTest.entries.size===3'),'unlinked reading-time capture');
 await evaluate('history.back()');
 await until(()=>evaluate('document.querySelectorAll(`.working-surface:not([hidden]) [data-ayah]`).length===176'),'return to same mounted Quran reading');
 await until(()=>evaluate('getSelection().toString()==='+JSON.stringify(selected)),'exact selected text restored after independent capture');
 await call('Page.navigate',{url:origin+'/scripts/fixtures/connected-harness.html?view=quran&chapter=4&ayah_start=59'});
 await until(()=>evaluate('document.querySelectorAll("[data-ayah]").length===176'),'fresh global reading');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await until(()=>evaluate('innerWidth===390'),'mobile viewport');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'no horizontal overflow at 390px');
 await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(async value=>writeFile(join(artifacts,'connected-reader-mobile.png'),Buffer.from(value.data,'base64')));
 assert.deepEqual(problems,[]);console.log('Connected workspace browser flow passed: project-free capture, held-save typing, independent notes, collections, resize, complete Quran and mobile layout.');console.log('Synthetic artifacts: '+artifacts);
}catch(error){if(socket?.readyState===1){console.error('Synthetic page:',await evaluate('document.body.innerText').catch(()=>'(unavailable)'));console.error('Browser errors:',JSON.stringify(problems));}throw error;}finally{socket?.close();chrome.kill('SIGTERM');await preview.httpServer.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);setTimeout(resolve,3000);});await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
