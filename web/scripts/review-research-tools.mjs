// Exercise compiled real search and research-brief components with a synthetic API boundary.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-tools-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/research-tools-harness.html')}}});
const preview=await startPreview({root,configFile:false,logLevel:'silent',build:{outDir:join(temporary,'dist')},preview:{host:'127.0.0.1',port:0,strictPort:true}});
const origin=`http://127.0.0.1:${preview.httpServer.address().port}`;
const chromePath=process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const chrome=spawn(chromePath,['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0',`--user-data-dir=${join(temporary,'profile')}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let diagnostics='',failure,socket,serial=0;const pending=new Map(),problems=[];
chrome.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-4000);});
chrome.on('error',error=>{failure=error;});chrome.on('exit',(code,signal)=>{failure=new Error(`Owned research tools Chrome exited (${code ?? signal})`);});
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
  await call('Runtime.enable');await call('Page.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/research-tools-harness.html'});
  await until(()=>evaluate('!!document.querySelector("#research-search-query")'),'search mounted');
  assert.equal(await evaluate('window.__researchTools.queries.length'),0,'no per-keystroke or eager search');
  await evaluate('document.querySelector("#research-search-query").focus()');await call('Input.insertText',{text:'broad'});
  assert.equal(await evaluate('window.__researchTools.queries.length'),0);
  await click('Search →');await until(()=>evaluate('document.querySelectorAll(".owner-research-search-results article").length===4'),'bounded search results');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".owner-research-search-results")).position'),'static','public dropdown CSS cannot position owner results');
  assert.ok(await evaluate('document.querySelector(".owner-research-search-results").getBoundingClientRect().bottom<=document.querySelector(".owner-research-search footer").getBoundingClientRect().top'),'footer follows result list');
  assert.equal(await evaluate('document.body.textContent.includes("first 50 matches")'),true);
  await evaluate('document.querySelector(".owner-research-search-result-title").click()');
  assert.deepEqual(await evaluate('window.__researchTools.opened'),['synthetic:source','synthetic:project','','synthetic:document']);
  await click('Passages');assert.equal(await evaluate('document.querySelectorAll(".owner-research-search-results article").length'),2);
  await evaluate('[...document.querySelectorAll(".owner-research-search-result-title")].find(b=>b.textContent.includes("My exact passage note")).click()');
  assert.deepEqual(await evaluate('window.__researchTools.opened'),['synthetic:source','synthetic:project','synthetic:annotation','synthetic:document']);
  await click('Questions');assert.equal(await evaluate('document.querySelectorAll(".owner-research-search-results article").length'),1);
  await evaluate('document.querySelector(".owner-research-search-result-title").click()');assert.deepEqual(await evaluate('window.__researchTools.opened'),['notebook','synthetic:question']);
  await click('Concepts');await evaluate('document.querySelector(".owner-research-search-result-title").click()');assert.equal(await evaluate('window.__researchTools.opened[0]'),'synthetic:concept');
  await evaluate('document.querySelector("#research-search-query").focus();document.querySelector("#research-search-query").select()');await call('Input.insertText',{text:'stale'});await click('Search →');
  await until(()=>evaluate('typeof window.__researchTools.releaseSearch==="function"'),'held old-project search');
  await evaluate('window.__researchTools.project("synthetic:other")');await until(()=>evaluate('document.querySelector("#research-search-query").value===""'),'project changed');
  await evaluate('window.__researchTools.releaseSearch()');await sleep(180);assert.equal(await evaluate('document.querySelectorAll(".owner-research-search-results article").length'),0,'old-project response discarded');
  await evaluate('window.__researchTools.brief("normal")');await until(()=>evaluate('document.body.textContent.includes("Synthetic p. 2")'),'verified Unicode passage context');
  assert.equal(await evaluate('window.__researchTools.drafts.current.size'),0,'opening blank brief does not create dirty state');
  assert.equal(await evaluate('document.querySelector(".research-brief-save").disabled'),true);
  await evaluate('document.querySelector("#research-brief-question").focus()');await call('Input.insertText',{text:'What does tafsīr mean in this located passage?'});
  assert.equal(await evaluate('document.querySelector(".research-brief-save").disabled'),true,'owner confirmation required');
  await checkbox('Save this as my private');await click('Export for an agent ↗');await until(()=>evaluate('!!window.__researchTools.exported'),'explicit JSON brief export');
  assert.equal(await evaluate('window.__researchTools.exported.context.selected_quote'),'التفسير');
  assert.equal(await evaluate('window.__researchTools.exported.context.annotation_id'),'synthetic:annotation');
  assert.equal(await evaluate('window.__researchTools.exported.context.source_notice'),'Synthetic provider notice retained verbatim.');
  assert.equal(await evaluate('window.__researchTools.exported.read_only_search.method'),'GET');
  assert.equal(await evaluate('window.__researchTools.exported.read_only_operations.path'),'/v1/research-operations');
  assert.ok(await evaluate('window.__researchTools.exported.read_only_search.path.startsWith("/v1/research/search?")'));
  assert.equal(await evaluate('window.__researchTools.requests.length'),0,'export does not save or run an agent');
  await click('Save research brief');await until(()=>evaluate('document.body.textContent.includes("save response was lost")'),'lost creation acknowledgement');
  assert.equal(await evaluate('window.__researchTools.entries.size'),1);assert.equal(await evaluate('document.querySelector("#research-brief-question").disabled'),true);
  await evaluate('window.__researchTools.remount()');await until(()=>evaluate('document.body.textContent.includes("Retry original brief save")'),'retained UUID after remount');
  await click('Retry original brief save');await until(()=>evaluate('document.body.textContent.includes("Saved to your private notebook")'),'verified saved question');
  assert.equal(await evaluate('JSON.stringify(window.__researchTools.requests[0])===JSON.stringify(window.__researchTools.requests[1])'),true,'retry exact original request');
  assert.equal(await evaluate('window.__researchTools.entries.size'),1,'no duplicate question');
  assert.equal(await evaluate('[...window.__researchTools.drafts.current.values()].every(d=>!!d.saved && !d.sent && !d.saving)'),true,'completed brief marked saved');
  await click('Open saved question →');await until(()=>evaluate('document.body.textContent.includes("Your notes") && document.body.textContent.includes("What does tafsīr mean")'),'saved question in real notebook');
  for(const scenario of ['wrong-project','wrong-hash','wrong-document-hash']){
    await evaluate(`window.__researchTools.brief(${JSON.stringify(scenario)})`);await until(()=>evaluate('!!document.querySelector(".research-brief [role=alert]")'),'invalid context rejected');
    assert.equal(await evaluate('document.querySelector(".research-brief-save").disabled'),true);
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent==="Export for an agent ↗").disabled'),true);
  }
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'brief 390px no overflow');
  await evaluate('window.__researchTools.search()');await until(()=>evaluate('!!document.querySelector("#research-search-query")'),'mobile search');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'search 390px no overflow');
  await writeFile(join(artifacts,'owner-research-search-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({researchToolsPassed:true,checks:['explicit literal search','bounded scope filters','exact passage and concept navigation','notebook destination','stale project response rejected','blank brief creates no dirty state','Unicode source anchor verified','owner-confirmed save','lost response exact retry across remount','one verified saved question','real notebook readback','explicit structured agent export','wrong-project/hash refuse save and export','390px no overflow'],artifacts}));
}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Research tools review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
