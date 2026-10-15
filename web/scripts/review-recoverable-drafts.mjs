// Exercise compiled AddSource with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-draft-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/recoverable-draft-harness.html')}}});
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
const rows=new Map(),histories=new Map(),writes=[];let savedCapture=null,lose=true,cloudNote={project_id:'synthetic',record_id:'synthetic:source',revision:1,note:'Original saved record note'},cloudAnnotation={id:'synthetic:annotation',project_id:'synthetic',document_id:'synthetic:document',text_sha256:'a'.repeat(64),start_pos:2,end_pos:8,exact:'tafsīr',revision:1,body:'Original saved margin note',mark_style:'highlight'};
async function fixture(event){const url=new URL(event.request.url),path=url.pathname;let status=200,data;
  if(path==='/v1/reading/draft' && event.request.method==='PUT'){
    const value=JSON.parse(event.request.postData);writes.push(value);assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    const id='urn:research:draft:'+value.draft_uuid,previous=rows.get(id);
    if(previous && previous.revision===value.expected_revision+1 && ['body','mark_style','state'].every(key=>previous[key]===value[key]))data=previous;
    else if(value.expected_revision!==(previous?.revision || 0)){status=409;data={current:previous};}
    else {data={...value,id,start_pos:value.start,end_pos:value.end,base_snapshot:value.context_kind==='record_note' ? {note:'',revision:0} : value.context_kind==='annotation' ? {body:'Original saved margin note',mark_style:'highlight',revision:1} : {},revision:value.expected_revision+1,record_title:'Synthetic source',edition:'Synthetic edition',locator:'Synthetic section'};rows.set(id,data);histories.set(id,[...(histories.get(id) || []),structuredClone(data)]);if(lose){lose=false;status=503;data={detail:'Synthetic response lost after commit'};}}
  }else if(path==='/v1/reading/draft')data=rows.get(url.searchParams.get('draft_id'));
  else if(path==='/v1/reading/drafts'){const matches=[...rows.values()].filter(row=>row.project_id===url.searchParams.get('project_id') && row.record_id===url.searchParams.get('record_id') && row.context_kind===url.searchParams.get('context_kind') && row.state===url.searchParams.get('state') && row.id>(url.searchParams.get('cursor') || '')).sort((a,b)=>a.id.localeCompare(b.id));data={items:matches.slice(0,1),next_cursor:matches.length>1 ? matches[0].id : null};}
  else if(path==='/v1/reading/draft-history'){const versions=[...(histories.get(url.searchParams.get('draft_id')) || [])].reverse().filter(row=>row.revision<Number(url.searchParams.get('before_revision') || 2147483647));data={items:versions.slice(0,1).map(snapshot=>({revision:snapshot.revision,snapshot})),next_before_revision:versions.length>1 ? versions[0].revision : null};}
  else if(path==='/v1/personal-state')data=cloudNote;
  else if(path==='/v1/reading/annotation'){if(savedCapture && url.searchParams.get('annotation_id')===savedCapture.id)data={annotation:savedCapture,anchor:{anchored:true}};else if(url.searchParams.get('annotation_id')===cloudAnnotation.id)data={annotation:cloudAnnotation,anchor:{anchored:true}};else {status=404;data={};}}
  else {status=404;data={};}
  await call('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(data || {})).toString('base64')});
}
async function edit(text){await evaluate('document.querySelector("#draft-editor").focus();document.querySelector("#draft-editor").select()');await call('Input.insertText',{text});}
async function reload(){await call('Page.reload');await until(()=>evaluate('!!document.querySelector("#draft-editor") && document.querySelector("#draft-editor").value===""'),'new browser session has empty editor');}
try{
  await until(()=>diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1],'owned debug port');
  const endpoint=new URL(diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);
  const targets=await (await fetch(`http://${endpoint.host}/json/list`)).json();socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result);}}else if(value.method==='Fetch.requestPaused')fixture(value.params).catch(error=>problems.push(error.message));else if(value.method==='Runtime.exceptionThrown')problems.push(value.params.exceptionDetails.text);};
  await call('Runtime.enable');await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*/v1/*'}]});await call('Page.navigate',{url:origin+'/scripts/fixtures/recoverable-draft-harness.html'});
  await until(()=>evaluate('!!document.querySelector("#draft-editor")'),'recovery controls mounted');assert.equal(writes.length,0);
  await edit('Original unfinished thought 😀');await click('Save recoverable draft');await until(()=>evaluate('document.body.textContent.includes("not confirmed")'),'unknown commit retained');
  assert.equal(rows.size,1);await edit('Newer typing must remain in the editor');await click('Retry original draft save');
  await until(()=>evaluate('document.body.textContent.includes("Draft saved privately across sessions")'),'exact draft retry confirmed');assert.deepEqual(writes[0],writes[1]);assert.equal(rows.size,1);
  assert.equal(await evaluate('document.querySelector("#draft-editor").value'),'Newer typing must remain in the editor');
  const first=[...rows.values()][0];rows.set(first.id,{...first,body:'Other device unfinished thought',revision:2});histories.get(first.id).push(structuredClone(rows.get(first.id)));
  await click('Save recoverable draft');await until(()=>evaluate('!!document.querySelector(".draft-conflict")'),'cloud draft conflict compared');
  assert.ok(await evaluate('document.querySelector(".draft-conflict").textContent.includes("Other device unfinished thought")'));
  assert.ok(await evaluate('document.querySelector(".draft-conflict").textContent.includes("Newer typing must remain")'));
  await click('Keep both as separate drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===1 && document.body.textContent.includes("More saved drafts")'),'first page of both durable versions');await click('More saved drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===2'),'both versions persisted independently');assert.equal(rows.size,2);
  cloudNote={...cloudNote,revision:2,note:'Changed saved note on another device'};
  await reload();assert.equal(await evaluate('document.querySelector("#draft-editor").value'),'');
  await click('Find saved drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===1'),'first server page after reload');await click('More saved drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===2'),'reloaded copies read from server');
  await evaluate('[...document.querySelectorAll(".recoverable-draft > article")].find(row=>row.textContent.includes("Other device unfinished thought")).querySelector("button").click()');
  await until(()=>evaluate('!!document.querySelector(".draft-preview [role=alert]")'),'changed real note compared before recovery');await edit('My current unsaved editor must be compared');assert.ok(await evaluate('document.querySelector(".draft-preview").textContent.includes("My current unsaved editor must be compared")'));await evaluate('window.__draftTest.setRejectRecovery(true)');await click('Recover after comparing both versions');assert.ok(await evaluate('!!document.querySelector(".draft-preview")'));assert.equal(await evaluate('document.querySelector("#draft-editor").value'),'My current unsaved editor must be compared');await evaluate('window.__draftTest.setRejectRecovery(false)');await click('Recover after comparing both versions');
  await until(()=>evaluate('document.querySelector("#draft-editor").value==="Other device unfinished thought"'),'explicit editor recovery');assert.equal(cloudNote.note,'Changed saved note on another device','draft recovery never commits actual note');
  await evaluate('document.querySelector(".recoverable-draft > article .draft-actions button:nth-child(2)").click()');
  await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===1'),'discard removes only active recovery copy');
  await click('Show discarded drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===1 && document.querySelector(".recoverable-draft > article").textContent.includes("discarded")'),'discarded copy remains explicitly recoverable');
  await click('Restore recovery copy');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===0'),'restored copy leaves discarded filter');
  await click('Show active drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===1'),'active first page');await click('More saved drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===2'),'restored copy appears active');
  await evaluate('document.querySelector(".recoverable-draft > article .draft-actions button:nth-child(3)").click()');await until(()=>evaluate('!!document.querySelector(".recoverable-draft details")'),'private draft revision history');await click('Earlier draft revisions');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft details > section").length===2'),'paged earlier draft history');
  await evaluate('window.__draftTest.setMode("capture")');await edit('Arabic selection unfinished note 😀');await click('Save recoverable draft');
  await until(()=>evaluate('document.body.textContent.includes("Draft saved privately across sessions")'),'new selected-passage draft saved');
  await evaluate('window.__draftTest.setFinder()');await reload();assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button=>button.textContent==="Save recoverable draft").disabled'),true);await click('Find saved drafts');await until(()=>evaluate('document.querySelector(".recoverable-draft blockquote")?.textContent==="التفسير"'),'exact Arabic selector recovered after reload');
  await click('Inspect & recover');await until(()=>evaluate('!!document.querySelector(".draft-preview")'),'inspect unsaved capture');await click('Recover into editor');
  const capture=await evaluate('JSON.parse(document.querySelector("#recovered-payload").textContent)');assert.equal(capture.exact,'التفسير');assert.equal(capture.start,13);assert.equal(capture.end,20);assert.equal(capture.annotation_uuid,'12345678-1234-4123-8123-123456789012');assert.equal(capture.existing_annotation,null);
  savedCapture={id:'urn:research:annotation:'+capture.annotation_uuid,project_id:'synthetic',document_id:'synthetic:document',text_sha256:'a'.repeat(64),start_pos:13,end_pos:20,exact:'التفسير',revision:1,body:'Committed source note',mark_style:'underline'};
  await reload();await click('Find saved drafts');await until(()=>evaluate('!!document.querySelector(".recoverable-draft > article")'),'previously committed capture draft available');await click('Inspect & recover');
  await until(()=>evaluate('document.querySelector(".draft-preview")?.textContent.includes("already has a saved annotation")'),'committed capture detected without duplication');await click('Recover after comparing both versions');
  assert.equal(await evaluate('JSON.parse(document.querySelector("#recovered-payload").textContent).existing_annotation.id'),savedCapture.id);
  await evaluate('window.__draftTest.setMode("annotation")');await edit('Unfinished edit to saved margin note');await click('Save recoverable draft');await until(()=>evaluate('document.body.textContent.includes("Draft saved privately across sessions")'),'saved annotation editing draft persisted');
  cloudAnnotation={...cloudAnnotation,revision:2,body:'Changed actual margin note from another device'};
  await reload();await click('Find saved drafts');await until(()=>evaluate('document.querySelectorAll(".recoverable-draft > article").length===1'),'saved-note draft recovered');await click('Inspect & recover');
  await until(()=>evaluate('document.querySelector(".draft-preview")?.textContent.includes("Changed actual margin note")'),'both actual note and unfinished edit compared');await click('Recover after comparing both versions');
  assert.equal(await evaluate('document.querySelector("#draft-editor").value'),'Unfinished edit to saved margin note');assert.equal(cloudAnnotation.body,'Changed actual margin note from another device');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await evaluate('document.documentElement.dataset.theme="dark"');await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'390px recovery controls fit');await writeFile(join(artifacts,'recoverable-draft-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("unfinished") || value.includes("margin note"))'),false);assert.deepEqual(problems,[]);
  console.log(JSON.stringify({recoverableDraftsPassed:true,checks:['compiled owner component','no automatic writes','frozen original retry after committed lost response','new typing retained','both conflicting drafts persisted','reload and cross-session recovery','actual note and unsaved editor compared before recovery','caller refusal keeps recovery preview','discard and restore explicit history retention','paged draft and revision history','already committed capture becomes existing annotation edit','capture finder without an in-memory selection','Arabic exact capture and original source annotation UUID','saved annotation editing baseline comparison','no note or mark commit','390px dark layout','no private localStorage'],artifacts}));
}finally{socket?.close();chrome.kill();await preview.close();for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Draft review finished'));}await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});}
