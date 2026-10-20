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
async function until(fn,label){for(let i=0;i<100;i++){if(failure)throw failure;try{const value=await fn();if(value){console.log("Verified: "+label);return value;}}catch{}await sleep(100);}throw new Error(`Timed out: ${label}`);}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},20000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function click(text){await evaluate(`{const button=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)});if(!button)throw new Error('Missing button '+${JSON.stringify(text)}+'; available '+[...document.querySelectorAll('.notebook-index button')].map(b=>b.textContent).join(', '));for(let p=button.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;button.click();}`);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
// Selecting a collection is distinct from deliberately collapsing its folder.
async function collection(text){const expanded=await evaluate(`[...document.querySelectorAll('.notebook-folder-toggle')].find(button=>button.textContent===${JSON.stringify(text)})?.getAttribute('aria-expanded')==='true'`);if(!expanded)await click(text);}
async function fill(name,text){await evaluate(`document.querySelector('[name="${name}"]').focus()`);await call('Input.insertText',{text});}
async function fillLabel(label,text){await evaluate(`{const labelNode=[...document.querySelectorAll('label')].find(label=>label.textContent.startsWith(${JSON.stringify(label)}));for(let p=labelNode.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;labelNode.querySelector('input,textarea').focus();}`);await call('Input.insertText',{text});}
async function select(label,value){await evaluate(`{const input=[...document.querySelectorAll('label')].filter(label=>label.textContent.startsWith(${JSON.stringify(label)})).at(-1).querySelector('select');for(let p=input.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function checkbox(label){await evaluate(`[...document.querySelectorAll('label')].find(label=>label.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=checkbox]').click()`);}
async function body(text){await until(()=>evaluate('!!document.querySelector(".cm-content")'),'editor ready');await evaluate('window.__notebookTest.editor().focus()');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:process.platform==='darwin'?4:2});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:process.platform==='darwin'?4:2});await call('Input.insertText',{text});}
async function append(text){await evaluate('(()=>{const editor=window.__notebookTest.editor();editor.dispatch({selection:{anchor:editor.state.doc.length}});editor.focus();})()');await call('Input.insertText',{text});}
const source=()=>evaluate('window.__notebookTest.editor().state.doc.toString()');
async function property(label,value){await evaluate('document.querySelector(".notebook-note-details").open=true');await select(label,value);}
async function tools(){await evaluate('document.querySelector(".notebook-tools").open=true');}
async function openNote(title){await click(title);await until(()=>evaluate('document.querySelector(".notebook-note-title input,.notebook-note-title textarea")?.value==='+JSON.stringify(title)),'note '+title);await until(()=>evaluate('!!document.querySelector(".cm-content")'),'inline editor');}
try{
 await until(()=>diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'owned debug port');
 const endpoint=new URL(diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
 const targets=await (await fetch(`http://${endpoint.host}/json/list`)).json();socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}}else if(value.method==='Runtime.exceptionThrown')problems.push(value.params.exceptionDetails.text);};
 await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/notebook-harness.html'});
 await until(()=>evaluate('document.body.textContent.includes("Original passage note")'),'notebook mounted');
 assert.equal(await evaluate('document.querySelectorAll(".workspace-reader .notebook-index").length'),0,'single sidebar owns note list');
 assert.equal(await evaluate('document.querySelectorAll(".notebook-page-footer,.notebook-editor-modes,.notebook-heading").length'),0);
 assert.equal(await evaluate('document.querySelector(".notebook-tools").open'),false);
 await click('Original record note');assert.equal(await evaluate('window.__notebookTest.opened[2]'),'');
 await click('Original passage note');assert.equal(await evaluate('window.__notebookTest.opened[2]'),'synthetic:annotation');
 await click('New thought at this passage');await fillLabel('Title','A contextual question');await body('😀 التفسير **tafsīr** <script>unsafe</script>');await property('Thought type','question');
 await evaluate('document.querySelector(".notebook-links").open=true;document.querySelector(".notebook-manual-link").open=true');
 await fillLabel('Target ID','synthetic:source');await fillLabel('Why connect','Context for this question');await click('Add explained connection');await click('Save note');
 await until(()=>evaluate('document.body.textContent.includes("Notebook save could not be confirmed")'),'uncertain creation');assert.equal(await evaluate('window.__notebookTest.entries.size'),1);
 await evaluate('window.__notebookTest.remount()');await until(()=>evaluate('document.body.textContent.includes("Retry original notebook save")'),'retained UUID after remount');await click('Retry original notebook save');
 await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'creation acknowledged');
 assert.equal(await evaluate('JSON.stringify(window.__notebookTest.requests[0])===JSON.stringify(window.__notebookTest.requests[1])'),true);
 assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].annotation_id'),'synthetic:annotation');
 await click('Return to anchored source');assert.equal(await evaluate('window.__notebookTest.opened[3]'),'synthetic:document');
 await body('My revised question');await evaluate('window.__notebookTest.remote()');await click('Save note');
 await until(()=>evaluate('!!document.querySelector(".notebook-conflict")'),'competing revisions');assert.ok(await evaluate('document.querySelector(".notebook-conflict").textContent.includes("Cloud thought from another device")'));
 await click('Keep my draft for explicit save');await click('Save note');await until(()=>evaluate('document.body.textContent.includes("Correction save could not be confirmed")'),'lost correction');await click('Retry original notebook save');
 await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'correction acknowledged');assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].body'),'My revised question');
 await click('View thought history');await until(()=>evaluate('document.body.textContent.includes("Revision 3")'),'history');await click('Older thought revisions');await until(()=>evaluate('document.body.textContent.includes("Revision 2")'),'earlier revision');
 await property('State','withdrawn');await click('Save note');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'withdrawal retained');
 await tools();await evaluate('document.querySelector(".notebook-tools .notebook-filters details").open=true');
 await evaluate('{const field=document.querySelector(".notebook-tools .notebook-filters label:last-of-type select");field.value="withdrawn";field.dispatchEvent(new Event("change",{bubbles:true}));}');await click('Apply filters');await until(()=>evaluate('document.querySelectorAll(".notebook-sidebar-items .notebook-title").length===1'),'withdrawn filter');
 await click('New note');await fillLabel('Title','Independent writing');await body('My independent notes.');await evaluate('window.__notebookTest.normal();window.__notebookTest.hold=true');

 // Creation can also be in flight: typing must remain possible during automatic saves.
 await until(()=>evaluate('window.__notebookTest.entries.size===2'),'independent note saved');
 await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'independent creation acknowledged');
 await body('First automatic correction');await until(()=>evaluate('typeof window.__notebookTest.release==="function"'),'held automatic correction');await append(' with newer typing');await evaluate('window.__notebookTest.release()');
 await until(()=>evaluate('[...window.__notebookTest.entries.values()][1].body==="First automatic correction with newer typing"&&window.__notebookTest.drafts.current.size===0'),'newer typing survived old acknowledgement');
 assert.equal(await source(),'First automatic correction with newer typing');assert.equal(await evaluate('[...window.__notebookTest.entries.values()][1].record_id'),null);
 await body('');await new Promise(resolve=>setTimeout(resolve,1700));assert.equal(await source(),'');assert.ok(await evaluate('document.querySelector(".notebook-editor-toolbar").textContent.includes("Start writing")'),'empty body is retained as unsaved, never false Saved');
 await body('A loose thought to keep.');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'resume writing after empty draft');
 const specimen='## A working idea\n\nEnglish and العَرَبِيَّة **important**, ~~revised~~ and [[synthetic:linked-note|a related idea]].\n\n- [x] Read\n- [ ] Compare\n\n| Concept | Question |\n| --- | --- |\n| Authority | Which kind? |\n\n> A distinction.\n\n```js\nconst safe = "[[not a link]]";\n```\n\n<script>window.__markdownExecuted=true</script>\n\n[unsafe](javascript:alert(1))\n\nA footnote[^1].\n\n[^1]: A located observation.\n\n![external image](https://example.invalid/tracking.png)';
 await evaluate('window.__notebookTest.seed()');await body(specimen);await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'complex Markdown autosave');
 await evaluate('window.__notebookTest.editor().dispatch({selection:{anchor:0}})');
 await until(()=>evaluate('!!document.querySelector(".live-markdown-editor table")'),'live table without preview button');
 assert.equal(await source(),specimen);assert.equal(await evaluate('document.querySelectorAll(".live-markdown-editor input[type=checkbox]").length'),2);assert.equal(await evaluate('document.querySelectorAll(".live-markdown-editor pre code").length'),1);
 assert.equal(await evaluate('!!window.__markdownExecuted'),false);assert.equal(await evaluate('document.querySelectorAll(".live-markdown-editor img,.live-markdown-editor a[href^=javascript]").length'),0);
 await until(()=>evaluate('!!document.querySelector(".notebook-wikilink")'),'resolved wiki link');
 await evaluate('document.documentElement.dataset.theme="dark";document.querySelector(".notebook-note-details").open=false;document.querySelector(".notebook-tools").open=false;document.activeElement.blur();document.querySelector(".workspace-reader").scrollTop=0');
 await writeFile(join(artifacts,'unified-live-markdown.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await evaluate('document.querySelector(".notebook-wikilink").click()');await until(()=>evaluate('document.querySelector(".notebook-note-title input").value==="A related idea"'),'wiki navigation');
 await evaluate('document.querySelector(".notebook-backlinks").open=true');await until(()=>evaluate('document.querySelector(".notebook-backlinks").textContent.includes("Independent writing")'),'saved backlink');
 await tools();await click('Note graph');await until(()=>evaluate('document.querySelectorAll("[data-network-node]").length===2'),'saved graph');await click('← Back to notes');
 await openNote('Independent writing');assert.equal(await source(),specimen);
 await evaluate('window.__notebookTest.inline(true)');await append('\n\nStill writing.');const before=await source(),route=await evaluate('location.href');
 await tools();await click('Reading notes');await click('Original passage note');await until(()=>evaluate('!!document.querySelector(".notebook-source-pane .reader-text mark.is-selected")'),'exact original source beside note');
 assert.equal(await source(),before);assert.equal(await evaluate('location.href'),route);
 assert.ok(await evaluate(`!!document.querySelector('[aria-label="Resize note and source"]')`));
 const widthBefore=await evaluate('document.querySelector(".notebook-source-pane").getBoundingClientRect().width');
 await evaluate('document.querySelector(".notebook-context-divider").focus()');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft'});
 assert.ok(await evaluate('document.querySelector(".notebook-source-pane").getBoundingClientRect().width')>widthBefore,'source pane resizes by keyboard');
 await evaluate('{const node=document.querySelector(".notebook-source-pane .reader-text mark");const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new Event("selectionchange"));}');
 await evaluate('window.__notebookTest.loseQuote=true');await click('Quote in notebook');await until(()=>evaluate('document.body.textContent.includes("Quote response lost")'),'quote uncertain response');await click('Retry original quote insertion');await until(()=>evaluate('window.__notebookTest.editor().state.doc.toString().includes("research-passage:")'),'exact citation insertion');
 assert.equal(await evaluate('JSON.stringify(window.__notebookTest.quoteRequests[0])===JSON.stringify(window.__notebookTest.quoteRequests[1])'),true);assert.ok((await source()).includes('Still writing.'));
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'mobile context fits');await click('Close source ×');assert.ok((await source()).includes('research-passage:'));
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await click('New note');await fillLabel('Title','Unfinished independent note');await body('A loose idea retained while researching.');
 await click('Sample sources');await until(()=>evaluate('document.querySelectorAll(".research-source-list article").length===3'),'source/work catalog');await click('With saved text');assert.equal(await evaluate('document.querySelectorAll(".research-source-list article").length'),1);await click('All sources');await click('Add source');assert.equal(await evaluate('window.__notebookTest.added'),true);
 await evaluate('{const row=[...document.querySelectorAll(".research-source-list article")].find(row=>row.textContent.includes("Synthetic Arabic source"));[...row.querySelectorAll(".research-source-actions button")].find(button=>button.textContent==="Ask a question").click();}');
 await until(()=>evaluate(`!!document.querySelector('[aria-label="Research question"]')`),'question creation');await fillLabel('Title','What does authority mean?');await body('An open question to investigate.');
 assert.equal(await evaluate('document.querySelector(".notebook-note-title textarea").value'),'What does authority mean?','body input preserves the newest title');
 await until(()=>evaluate('[...window.__notebookTest.entries.values()].some(row=>row.title==="What does authority mean?"&&row.thought_type==="question")'),'typed question persisted');assert.equal(await evaluate('[...window.__notebookTest.entries.values()].find(row=>row.title==="What does authority mean?").record_id'),'synthetic:source');
 await click('Sample notes');await click('New note');await until(()=>evaluate('document.querySelector(".notebook-note-title input")?.value==="Unfinished independent note"'),'retained independent writing');
 await until(()=>evaluate('[...window.__notebookTest.recoveryRows.values()].some(row=>row.state==="active"&&row.value.title==="Unfinished independent note")'),'server draft recovery');
 await evaluate('window.__notebookTest.losePageMemory()');await until(()=>evaluate('!document.querySelector(".cm-content")'),'lost page memory');await tools();await click('Unfinished work');await until(()=>evaluate('document.querySelector(".unfinished-writing").textContent.includes("Unfinished independent note")'),'durable recovery list');
 await evaluate('[...document.querySelectorAll(".unfinished-writing article button")].find(button=>button.textContent==="Unfinished independent note").click()');await click('Recover into editor');await until(()=>evaluate('window.__notebookTest.editor()?.state.doc.toString()==="A loose idea retained while researching."'),'exact recovered draft');
 await click('Save note');await until(()=>evaluate('window.__notebookTest.drafts.current.size===0'),'explicit recovered save');
 await evaluate('document.querySelector(".notebook-note-details").open=true;window.__notebookTest.loseTrash=true');await click('Move to Trash');await until(()=>evaluate('document.body.textContent.includes("Trash update was not confirmed")'),'lost trash acknowledgement');await click('Retry Trash update');await until(()=>evaluate('document.body.textContent.includes("This writing is in Trash")'),'trash state');await click('Undo trash');await until(()=>evaluate('!!document.querySelector(".cm-content")'),'restore actual document');
 assert.equal(await source(),'A loose idea retained while researching.');assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("A loose idea retained"))'),false);
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'mobile document fits');
 await writeFile(join(artifacts,'unified-notebook-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 assert.deepEqual(problems,[]);console.log(JSON.stringify({notebookPassed:true,checks:['single sidebar','live Markdown source round-trip','RTL Unicode','safe GFM tables/footnotes/code/wiki links','no remote images or executable HTML','frozen UUID create retry','CAS conflict and correction retry','typing during held save','empty body retained truthfully','history and withdrawal','independent writing','durable recovery','Trash retry and restore','source pane preserves draft and route','exact citation lost-ack retry','typed questions','mobile overflow'],artifacts}));
}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Notebook review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
