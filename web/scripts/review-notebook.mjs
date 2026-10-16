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
async function click(text){await evaluate(`{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)});if(!button)throw new Error('Missing button');for(let p=button.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;button.click();}`);}
async function fill(name,text){await evaluate(`document.querySelector('[name="${name}"]').focus()`);await call('Input.insertText',{text});}
async function fillLabel(label,text){await evaluate(`{const labelNode=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)}));for(let p=labelNode.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;labelNode.querySelector('input,textarea').focus();}`);await call('Input.insertText',{text});}
async function select(label,value){await evaluate(`{const input=[...document.querySelectorAll('label')].filter(label=>label.textContent.startsWith(${JSON.stringify(label)})).at(-1).querySelector('select');for(let p=input.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
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
  await writeFile(join(artifacts,'01-notebook-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('Original record note');assert.equal(await evaluate('window.__notebookTest.opened[2]'),'');
  await click('Original passage note');assert.equal(await evaluate('window.__notebookTest.opened[2]'),'synthetic:annotation');
  await click('New thought at this passage');
  await fillLabel('Title','My contextual question');await fillLabel('Thought (Markdown','😀 التفسير **tafsīr** <script>unsafe</script>');
  await select('Thought type','question');await fillLabel('Target ID','synthetic:source');await fillLabel('Why connect','Context for my reading question');await click('Add explained connection');
  await click('Save note');await until(()=>evaluate('document.body.textContent.includes("Notebook save could not be confirmed")'),'uncertain creation');
  assert.equal(await evaluate('window.__notebookTest.entries.size'),1);assert.equal(await evaluate('document.querySelector("textarea").matches(":disabled")'),true);
  await evaluate('window.__notebookTest.remount()');await until(()=>evaluate('document.body.textContent.includes("Retry original notebook save")'),'retained creation after remount');
  await click('Retry original notebook save');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0 && document.body.textContent.includes("Thought ID:")'),'created thought acknowledged');
  assert.equal(await evaluate('JSON.stringify(window.__notebookTest.requests[0])===JSON.stringify(window.__notebookTest.requests[1])'),true);
  assert.equal(await evaluate('document.querySelector("script:not([src])")'),null);
  await click('Return to anchored source');assert.equal(await evaluate('window.__notebookTest.opened[3]'),'synthetic:document');
  await evaluate(`{const input=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Thought (Markdown')).querySelector('textarea');input.focus();input.select();}`);
  await call('Input.insertText',{text:'My revised reading'});await evaluate('window.__notebookTest.remote()');await click('Save note');
  await until(()=>evaluate('document.body.textContent.includes("Another revision needs comparison")'),'two-device correction conflict');
  assert.equal(await evaluate('document.body.textContent.includes("Cloud thought from another device")'),true);
  await click('Keep my draft for explicit save');await click('Save note');
  await until(()=>evaluate('document.body.textContent.includes("Correction save could not be confirmed")'),'lost correction acknowledgement');
  await click('Retry original notebook save');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0 && [...window.__notebookTest.entries.values()][0].revision===3'),'same correction acknowledged');
  await click('View thought history');await until(()=>evaluate('document.body.textContent.includes("Revision 3")'),'correction history');
  await click('Older thought revisions');await until(()=>evaluate('document.body.textContent.includes("Revision 2")'),'paged earlier thought');
  await select('State','withdrawn');await click('Save note');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0 && [...window.__notebookTest.entries.values()][0].state==="withdrawn"'),'withdraw without deleting');
  await evaluate(`{const input=document.querySelector('.notebook-filters select:last-of-type');}`);
  await evaluate(`{const input=[...document.querySelectorAll('.notebook-filters label')].find(label=>label.textContent.startsWith('State')).querySelector('select');input.value='withdrawn';input.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await click('Apply filters');await until(()=>evaluate("document.querySelectorAll('.notebook-layout > section:first-child article').length===1"),'withdrawn filter');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px no overflow');
  await writeFile(join(artifacts,'notebook-mobile-dark.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.__notebookTest.search("No matching routed thought")');await until(()=>evaluate('document.body.textContent.includes("No matching entries")'),'routed notebook search');
  assert.equal(await evaluate('document.querySelector(".notebook-filters input").value'),'No matching routed thought');
  await evaluate('window.__notebookTest.search("")');await until(()=>evaluate('document.body.textContent.includes("My contextual question")'),'routed query cleared');
  await click('My contextual question');await until(()=>evaluate('document.body.textContent.includes("Thought ID:")'),'reopen correction target');
  await evaluate(`{const input=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Thought (Markdown')).querySelector('textarea');input.focus();input.select();}`);
  await call('Input.insertText',{text:'Late saved correction'});await evaluate('window.__notebookTest.hold=true');await click('Save note');
  await until(()=>evaluate('typeof window.__notebookTest.release==="function"'),'held save');await click('New note');await fillLabel('Title','Another unfinished thought');
  await evaluate('window.__notebookTest.release()');await until(()=>evaluate('[...window.__notebookTest.entries.values()][0].body==="Late saved correction"'),'old thought saved');
  assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith('Title')).querySelector('input').value`),'Another unfinished thought');
  await evaluate('window.__notebookTest.wrong(true)');await click('Apply filters');await until(()=>evaluate('document.body.textContent.includes("Notebook list did not match this project")'),'foreign project refused');
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("My revised reading"))'),false);assert.deepEqual(problems,[]);
  await evaluate('window.__notebookTest.wrong(false)');
  await fillLabel('Thought (Markdown','My independent notes, before reading any source.');
  await click('Save note');await until(()=>evaluate('window.__notebookTest.entries.size===2 && window.__notebookTest.drafts.current.size===0'),'independent note persisted');
  const independent=await evaluate('[...window.__notebookTest.entries.values()][1]');
  assert.equal(independent.record_id,null);assert.equal(independent.document_id,null);assert.equal(independent.annotation_id,null);
  await evaluate(`document.querySelector('.notebook-links').open=true`);
  await fillLabel('Find something to link','authority');await click('Find connections');
  await until(()=>evaluate('document.querySelectorAll(".notebook-connection-results button").length===2'),'searchable source and concept connections');
  await evaluate('document.querySelector(".notebook-connection-results button").click()');
  await evaluate(`[...document.querySelectorAll('.notebook-connection-confirm textarea')][0].focus()`);await call('Input.insertText',{text:'Useful background for this independent idea'});
  await evaluate('document.querySelector(".notebook-connection-confirm button").click()');await click('Save note');
  await until(()=>evaluate('[...window.__notebookTest.entries.values()][1].links.length===1 && window.__notebookTest.drafts.current.size===0'),'explained connection saved');
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][1].links[0].id'),'synthetic:source');
  await writeFile(join(artifacts,'02-independent-note-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('← All notes');assert.equal(await evaluate('getComputedStyle(document.querySelector(".notebook-writing")).display'),'none');
  await click('Another unfinished thought');await until(()=>evaluate('document.querySelector(".research-notebook").classList.contains("is-editing")'),'mobile reopen independent note');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await writeFile(join(artifacts,'03-independent-note-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate('window.__notebookTest.seed()');
  await evaluate(`{const input=document.querySelector('.notebook-note-body textarea');input.focus();input.select();}`);
  await call('Input.insertText',{text:'## A working idea\n\n**Important** and ~~revised~~. See [[synthetic:linked-note|a related idea]].\n\n- [x] Read\n- [ ] Compare\n\n| Concept | Question |\n| --- | --- |\n| Authority | Which kind? |\n\n> A distinction to investigate.\n\n```js\nconst safe = "[[not a link]]";\n```\n\n<script>window.__markdownExecuted=true</script>\n\n[unsafe](javascript:alert(1))\n\nA footnote[^1].\n\n[^1]: A located observation.\n\n![external image](https://example.invalid/tracking.png)'});
  await click('Save note');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'Markdown save');
  await click('Preview');await until(()=>evaluate('!!document.querySelector(".notebook-markdown table")'),'GFM table preview');
  assert.equal(await evaluate('document.querySelectorAll(".notebook-markdown input[type=checkbox]").length'),2);
  assert.equal(await evaluate('document.querySelectorAll(".notebook-markdown pre code").length'),1);
  assert.equal(await evaluate('document.querySelector(".notebook-markdown h2").textContent'),'A working idea');
  assert.equal(await evaluate('!!window.__markdownExecuted'),false);
  assert.equal(await evaluate('document.querySelectorAll(".notebook-markdown img").length'),0);
  assert.ok(await evaluate('[...document.querySelectorAll(".notebook-markdown a")].some(a=>a.getAttribute("href").startsWith("#"))'));
  await writeFile(join(artifacts,'04-markdown-preview.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.equal(await evaluate('document.querySelector(".notebook-markdown a[href^=javascript]")'),null);
  await until(()=>evaluate('!!document.querySelector(".notebook-wikilink")'),'resolved wiki link');
  await evaluate('document.querySelector(".notebook-wikilink").click()');
  await until(()=>evaluate('document.querySelector(".notebook-note-title input").value==="A related idea"'),'wiki to actual note');
  await evaluate('document.querySelector(".notebook-backlinks").open=true');
  await until(()=>evaluate('document.querySelector(".notebook-backlinks").textContent.includes("Another unfinished thought")'),'saved backlink');
  await click('Note graph');await until(()=>evaluate('document.querySelectorAll("[data-network-node]").length===2'),'actual saved note graph');
  await writeFile(join(artifacts,'05-note-graph.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'mobile graph no overflow');
  await writeFile(join(artifacts,'06-note-graph-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({notebookPassed:true,checks:['compiled owner notebook','live passage note backlink','anchored thought and explained connection','Unicode Markdown inert text','retained creation UUID and exact lost-response retry','source context readback','two-device correction comparison','CAS lost acknowledgement retry','paged revision history','withdrawal filter','wrong-project refusal','independent note without source','searchable explained connection saved','mobile list to editor','CommonMark and GFM preview','inert script and unsafe links','wiki link to saved note','saved backlinks','actual saved note graph','dark390px','no private localStorage'],artifacts}));
}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Notebook review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
