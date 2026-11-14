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
  rollupOptions:{input:join(root,'scripts/fixtures/general-workspace-harness.html')}}});
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
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/general-workspace-harness.html?view=library'});
  await until(()=>evaluate('!!document.querySelector(".library-shelf")'),'general library');
  await until(()=>evaluate('!document.body.textContent.includes("Opening…")'),'library ready');
  assert.equal(await evaluate('/Qur[’\\x27]?an|Tanzil|ClearQuran/i.test(document.body.textContent)'),false);
  assert.equal(await evaluate('document.querySelectorAll(".library-book").length'),0,'empty library must not inject a built-in book');
  await click('Notebook');
  await until(()=>evaluate('!!document.querySelector(".connected-document")'),'notebook navigation');
  await call('Page.navigate',{url:origin+'/scripts/fixtures/general-workspace-harness.html?view=quran'});
  await until(()=>evaluate('!!document.querySelector(".library-shelf")'),'retired deep link returns to library');
  assert.equal(await evaluate('window.__workspaceRequests.some(path=>/quran|verses|scripture/.test(path))'),false);
  await click('＋ New note');
  await until(()=>evaluate('!!document.querySelector(".cm-content")'),'connected editor');
  const exact='---\ntype: essay\ntags: [reading, العربية]\n---\n\n# Synthetic writing\n\nExact 😀 text';
  await evaluate('document.querySelector(".cm-content").focus()');
  await call('Input.insertText',{text:exact});
  await until(()=>evaluate('document.querySelector(".connected-document-tools [role=status]")?.textContent==="Saved"'),'confirmed note save');
  assert.equal(await evaluate('[...window.__syntheticWriting.notes.values()][0].body'),exact);
  assert.equal(await evaluate('[...window.__syntheticWriting.notes.values()][0].thought_type'),'note','freeform type stays in Markdown');
  await evaluate('document.querySelector(".cm-content").focus()');
  await call('Input.insertText',{text:'\nAnother paragraph'});
  await until(()=>evaluate('[...window.__syntheticWriting.history.values()][0].length===2'),'second revision');
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')==='Note properties').click()`);
  await click('Revision history');
  await until(()=>evaluate('document.querySelectorAll(".connected-revision-history details").length===2'),'revision inspection');
  await evaluate('document.querySelectorAll(".connected-revision-history details")[1].open=true');
  assert.equal(await evaluate('document.querySelectorAll(".connected-revision-history pre")[1].textContent'),exact);
  await evaluate('document.querySelectorAll(".connected-revision-history details")[1].querySelector("button").click()');
  await until(()=>evaluate('[...window.__syntheticWriting.history.values()][0].length===3'),'restore creates new revision');
  assert.equal(await evaluate('[...window.__syntheticWriting.notes.values()][0].body'),exact);
  await evaluate('document.querySelector(".connected-search").focus()');
  await call('Input.insertText',{text:'type:essay tag:العربية'});
  await until(()=>evaluate('document.querySelectorAll(".connected-document-slot>.connected-document .connected-result").length===1'),'frontmatter search result');
  await click('Synthetic writing');
  await until(()=>evaluate('!!document.querySelector(".connected-note:not([hidden])")'),'stable result opens writing');
  assert.equal(await evaluate('document.querySelector(".cm-content").textContent.includes("Exact 😀 text")'),true);
  await writeFile(join(artifacts,'personal-writing-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px library has no overflow');
  await writeFile(join(artifacts,'personal-writing-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({generalWorkspacePassed:true,builtinReaderAbsent:true,emptyLibrary:true,retiredDeepLink:'library',exactWriting:true,inspectedRevisionRestore:true,freeformPropertySearch:true}));
}finally{
  socket?.close();chrome.kill();await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Intake review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
