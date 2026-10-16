// Exercise compiled ResearchNotebook with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
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
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/notebook-harness.html?margin=1'});
  await until(()=>evaluate('!!document.querySelector(".location-margin-composer textarea")'),'free margin mounted');
  await evaluate('window.__notebookTest.normal();window.getSelection().removeAllRanges();document.querySelector(".location-margin-composer textarea").focus()');
  await call('Input.insertText',{text:'😀 A thought without a selected quote. **Markdown**'});
  await until(()=>evaluate('window.__notebookTest.entries.size===1&&window.__notebookTest.drafts.current.size===0'),'actual automatic notebook save');
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].body'),'😀 A thought without a selected quote. **Markdown**');
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].annotation_id'),null);
  assert.ok(Number.isInteger(await evaluate('[...window.__notebookTest.entries.values()][0].reading_position')));
  assert.equal(await evaluate('!!document.querySelector(".reader-capture")'),false);
  assert.equal(await evaluate('document.activeElement===document.querySelector(".location-margin-composer textarea")'),true);
  await writeFile(join(artifacts,'margin-writing.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Input.insertText',{text:' Still thinking.'});
  await until(()=>evaluate('[...window.__notebookTest.entries.values()][0].revision===2&&window.__notebookTest.drafts.current.size===0'),'automatic correction');
  await evaluate('document.querySelector(".reader-text").focus()');
  await until(()=>evaluate('!!document.querySelector(".location-margin-composer > textarea")'),'fresh margin after leaving saved note');
  assert.equal(await evaluate('document.querySelectorAll(".location-margin-note").length'),1);
  await evaluate('window.__notebookTest.losePageMemory()');
  await until(()=>evaluate('document.querySelector(".location-margin-note textarea")?.value.includes("Still thinking.")'),'confirmed note survives loss of page memory');
  await evaluate('window.__notebookTest.hold=true;document.querySelector(".location-margin-note textarea").focus()');
  await call('Input.insertText',{text:' Older pending.'});
  await until(()=>evaluate('!!window.__notebookTest.release'),'correction in flight');
  await call('Input.insertText',{text:' Newer typing.'});
  await evaluate('window.__notebookTest.release()');
  await until(()=>evaluate('[...window.__notebookTest.entries.values()][0].body.includes("Newer typing.")&&window.__notebookTest.drafts.current.size===0'),'newer typing preserved through older acknowledgement');
  assert.equal(await evaluate('window.__notebookTest.entries.size'),1);
  await click('Move to Trash');await until(()=>evaluate('!!document.querySelector(".location-margin-note")&&document.querySelector(".location-margin-notes").textContent.includes("Undo trash")'),'margin trash acknowledgement');
  await click('Undo trash');await until(()=>evaluate('!!document.querySelector(".location-margin-note textarea")'),'inline margin restore');
  assert.equal(await evaluate('window.__notebookTest.entries.size'),1);
  await evaluate('window.__notebookTest.remote();document.querySelector(".location-margin-note textarea").focus()');
  await call('Input.insertText',{text:' My local version.'});
  await until(()=>evaluate('!!document.querySelector(".location-save-error")'),'another device conflict');
  assert.equal(await evaluate('document.querySelector(".location-margin-note textarea").value.includes("My local version.")'),true);
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].body'),'Cloud thought from another device');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  assert.deepEqual(problems,[]);
  process.stdout.write('Free margin: no selection or Save button, autosave, editing, reload, serialized typing, conflict retention, Trash/Undo and mobile passed.\n');
}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Notebook review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
