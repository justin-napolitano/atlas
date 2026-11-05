// Exercise the compiled Markdown notes sidebar through an explicit synthetic boundary.
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
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/notebook-harness.html?margin=1&appearance=1'});
  await until(()=>evaluate('!!document.querySelector(".location-margin-composer textarea")'),'free margin mounted');
  const sourceBefore=await evaluate('document.querySelector(".reader-text").textContent');
  await evaluate('window.__notebookTest.normal();window.getSelection().removeAllRanges();document.querySelector(".location-margin-composer textarea").focus()');
  const markdown=['# A thought','😀 A thought without a selected quote. **Markdown** and *emphasis*.','', '- [x] Read this','- [ ] Follow the thread','', '> A working interpretation','', '| Term | Meaning |','| --- | --- |','| tafsīr | commentary |','', '```js','const thought = true;','```','', 'A footnote[^1] and ~~reconsidered~~ text.','', '[^1]: A private note, not evidence.','', '[Unsafe](javascript:alert(1))','<script>window.__unsafeMargin=true</script>','',''].join('\n');
  await call('Input.insertText',{text:markdown});
  await until(()=>evaluate('window.__notebookTest.entries.size===1&&window.__notebookTest.drafts.current.size===0'),'actual automatic notebook save');
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].body'),markdown);
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].annotation_id'),null);
  assert.ok(Number.isInteger(await evaluate('[...window.__notebookTest.entries.values()][0].reading_position')));
  assert.equal(await evaluate('!!document.querySelector(".reader-capture")'),false);
  assert.equal(await evaluate('document.activeElement===document.querySelector(".location-margin-composer .cm-content")'),true);
  await writeFile(join(artifacts,'margin-writing.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Input.insertText',{text:' Still thinking.'});
  await until(()=>evaluate('[...window.__notebookTest.entries.values()][0].revision===2&&window.__notebookTest.drafts.current.size===0'),'automatic correction');
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].body'),markdown+' Still thinking.');
  await evaluate('document.querySelector(".reader-text").focus()');
  await until(()=>evaluate('!!document.querySelector(".location-margin-composer > textarea")'),'fresh margin after leaving saved note');
  assert.equal(await evaluate('document.querySelectorAll(".location-margin-note").length'),1);
  await until(()=>evaluate('!!document.querySelector(".location-note-body h1")'),'Markdown heading rendered');
  assert.equal(await evaluate('document.querySelector(".location-note-body h1")?.textContent'),'A thought');
  assert.equal(await evaluate('document.querySelector(".location-note-body strong")?.textContent'),'Markdown');
  for(const selector of ['table','pre code','blockquote','em','del','.footnotes','input[type=checkbox]'])assert.ok(await evaluate(`!!document.querySelector('.location-note-body ${selector}')`),selector);
  assert.equal(await evaluate('window.__unsafeMargin'),undefined);
  assert.equal(await evaluate('!!document.querySelector(".location-note-body a[href^=javascript]")'),false);
  assert.equal(await evaluate('document.querySelector(".reader-text").textContent'),sourceBefore);
  await until(()=>evaluate('!!document.querySelector(".reading-point-marker")'),'point marker appears beside reading');
  await evaluate('document.querySelector(".reading-point-marker").click()');
  await until(()=>evaluate('document.activeElement===document.querySelector(".location-note-body .cm-content")'),'location marker opens formatted note');
  await writeFile(join(artifacts,'markdown-sidebar.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));

  await evaluate('window.__notebookTest.losePageMemory()');
  await until(()=>evaluate('document.querySelector(".location-note-body")?.textContent.includes("Still thinking.")'),'confirmed note survives loss of page memory');
  await evaluate('window.__notebookTest.hold=true;document.querySelector(".location-note-body .cm-content").focus()');
  await until(()=>evaluate('document.activeElement===document.querySelector(".location-margin-note .cm-content")'),'click note enters inline editor');
  await call('Input.insertText',{text:' Older pending.'});
  await until(()=>evaluate('!!window.__notebookTest.release'),'correction in flight');
  await call('Input.insertText',{text:' Newer typing.'});
  await evaluate('window.__notebookTest.release()');
  await until(()=>evaluate('[...window.__notebookTest.entries.values()][0].body.includes("Newer typing.")&&window.__notebookTest.drafts.current.size===0'),'newer typing preserved through older acknowledgement');
  assert.equal(await evaluate('window.__notebookTest.entries.size'),1);
  await click('Move to Trash');await until(()=>evaluate('!!document.querySelector(".location-margin-note")&&document.querySelector(".location-margin-notes").textContent.includes("Undo trash")'),'margin trash acknowledgement');
  await click('Undo trash');await until(()=>evaluate('!!document.querySelector(".location-note-body")'),'inline margin restore');
  assert.equal(await evaluate('window.__notebookTest.entries.size'),1);
  await evaluate('window.__notebookTest.remote();document.querySelector(".location-note-body .cm-content").focus()');
  await until(()=>evaluate('document.activeElement===document.querySelector(".location-margin-note .cm-content")'),'restored note enters editor');
  await call('Input.insertText',{text:' My local version.'});
  await until(()=>evaluate('!!document.querySelector(".location-save-error")'),'another device conflict');
  assert.equal(await evaluate('document.querySelector(".location-margin-note .cm-content").textContent.includes("My local version.")'),true);
  assert.equal(await evaluate('[...window.__notebookTest.entries.values()][0].body'),'Cloud thought from another device');
  await evaluate('document.querySelector(".reader-text mark[role=button]").click()');
  await until(()=>evaluate('document.activeElement===document.querySelector(".saved-passage-note.is-active")'),'highlight reveals its note in sidebar');
  assert.equal(await evaluate('!!document.querySelector(".saved-passage-note.is-active .passage-note-edit")'),false);
  assert.equal(await evaluate('document.querySelector(".saved-passage-note.is-active .notebook-markdown")?.textContent'),'Original passage note');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize'),'22px');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-margin .notebook-markdown")).fontSize'),'17px');
  await evaluate(`document.querySelector('[aria-label="Increase source text size"]').click();document.querySelector(".reading-appearance-panel").open=true`);
  await until(()=>evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize==="24px"'),'source size control');
  await evaluate('document.querySelector(".reader-text").scrollTop=900;window.__appearancePoint=window.__notebookTest.readingPosition();window.__appearanceTop=window.__notebookTest.pointTop(window.__appearancePoint)');
  await click('System');
  assert.ok(Math.abs(await evaluate('window.__notebookTest.pointTop(window.__appearancePoint)-window.__appearanceTop'))<3,'font change preserves visible source position');
  await click('Paper');await click('narrow');await click('Airy');
  async function range(label,value){await evaluate(`{const input=document.querySelector('input[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${value});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}`);}
  await range('Notes text size',21);await range('Reading zoom',150);
  await until(()=>evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize==="36px"'),'reading magnification');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-margin .notebook-markdown")).fontSize'),'31.5px');
  assert.equal(await evaluate('document.querySelector(".source-reader").dataset.readingTheme'),'paper');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("research:reading-appearance:v1")).font'),'sans');
  assert.equal(await evaluate('document.querySelector(".reader-text").textContent'),sourceBefore);
  await click('Page steps');await until(()=>evaluate('!!document.querySelector(".reading-page-steps")'),'page controls');
  const pageBefore=await evaluate('document.querySelector(".reader-text").scrollTop');await click('Next screen →');
  assert.ok(await evaluate('document.querySelector(".reader-text").scrollTop')>pageBefore,'page step advances through long source');
  await evaluate('document.querySelector(".reading-appearance-panel").open=false;window.__notebookTest.remount()');
  await until(()=>evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize==="36px"'),'appearance survives reader reopen');
  assert.equal(await evaluate('document.querySelector(".source-reader").dataset.readingFlow'),'pages');
  // Large text uses responsive reflow, keeping browser zoom and source selectors intact.
  await evaluate('document.querySelector(".reading-appearance-panel").open=true');await range('Reading zoom',200);
  await click('Dark');await evaluate('document.querySelector(".reading-appearance-panel").open=false');
  await writeFile(join(artifacts,'reader-appearance-desktop.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.setDeviceMetricsOverride' ,{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  await evaluate('document.querySelector(".reading-appearance-panel").open=true');
  assert.equal(await evaluate('document.querySelector(".reading-options").getBoundingClientRect().right<=innerWidth'),true);
  await call('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true);
  await writeFile(join(artifacts,'reader-appearance-320px.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('Reset reading preferences');await evaluate('document.querySelector(".reading-appearance-panel").open=false');
  await until(()=>evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize==="22px"'),'reset reading appearance');
  assert.equal(await evaluate('Object.values(localStorage).some(v=>v.includes("My local version")||v.includes("Cloud thought"))'),false);
  assert.deepEqual(problems,[]);
  process.stdout.write('Appearance: source and notes size, font, zoom, themes, saved preferences, reading position, page steps and 320px reflow passed.\n');
  process.stdout.write('Free margin: no selection or Save button, autosave, editing, reload, serialized typing, conflict retention, Trash/Undo and mobile passed.\n');
}catch(error){await writeFile(join(artifacts,'sidebar-failure.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));process.stderr.write('Sidebar failure artifact: '+artifacts+'\n');throw error;}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Notebook review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
