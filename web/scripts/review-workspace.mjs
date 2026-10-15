// Headless Chrome checks with synthetic API responses. Never bypasses production auth.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { preview as startPreview } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = await mkdtemp(join(tmpdir(),'research-browser-'));
const artifacts = process.env.RESEARCH_BROWSER_ARTIFACT_DIR || await mkdtemp(join(tmpdir(),'research-workspace-artifacts-'));
await mkdir(artifacts,{ recursive:true });
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const preview = await startPreview({ root,logLevel:'silent',preview:{ host:'127.0.0.1',port:0,strictPort:true } });
const testOrigin = `http://127.0.0.1:${preview.httpServer.address().port}`;
const chrome = spawn(chromePath,['--headless=new','--disable-background-networking','--disable-component-update',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,
  '--window-size=1440,1000','about:blank'],{ stdio:['ignore','ignore','pipe'] });
let socket;
let processFailure;
let chromeStartupDiagnostics='';
chrome.stderr.on('data',chunk=>{chromeStartupDiagnostics=(chromeStartupDiagnostics+chunk.toString()).slice(-4000);});
chrome.on('error',error => { processFailure = error; });
chrome.on('exit',(code,signal)=>{processFailure=new Error(`Owned test Chrome exited (${code ?? signal}): ${chromeStartupDiagnostics}`);});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn, label, attempts=100) {
  for (let i=0;i<attempts;i++) { if (processFailure) throw processFailure; try { const value=await fn(); if (value) return value; } catch {} await sleep(100); }
  const diagnostics=label==='owned Chrome debug port' ? ` · owned browser startup: ${chromeStartupDiagnostics || '(no stderr received)'}` : '';
  throw new Error(`Timed out: ${label}${diagnostics}`);
}
let serial=0, navigation=0; const pending=new Map(); const problems=[]; const saved=new Map(); let conflict=false, authenticated=true;
const records = [
  { id:'synthetic:question',project_id:'synthetic',kind:'question',title:'Synthetic question about authority',summary:'A bounded synthetic question.',revision:1,review_state:'pending',attributes:{} },
  { id:'synthetic:source',project_id:'synthetic',kind:'source',title:'Synthetic source <script>not HTML</script>',summary:'Synthetic source summary.',revision:1,review_state:'pending',attributes:{} },
];
const claim={ ...records[0],id:'synthetic:claim',kind:'claim',title:'Synthetic attributed finding',summary:'Synthetic finding about authority' };
const evidence={ ...records[0],id:'synthetic:evidence',kind:'evidence',title:'Synthetic located evidence',summary:'Synthetic fair paraphrase',attributes:{ rdf_properties:{ 'https://islam-research.local/vocab/locator':['"Synthetic section 2, paragraph 3"'] } } };
const readingDocument={ id:'synthetic:document',project_id:'synthetic',source_record_id:records[1].id,
  edition:'Synthetic edition',locator:'Abstract',representation_url:'https://example.invalid/source',
  text_body:'😀 Before tafsīr and التفسير; Q 4:59. After.',review_scope:'Synthetic private unverified excerpt' };
readingDocument.text_sha256=createHash('sha256').update(readingDocument.text_body).digest('hex');
const captures=[];
const scriptureResolutions=new Map();let scriptureLostResponse=false;
const publicationPreviews=new Map();let publicationHead={project_id:'synthetic',revision:0,status:'private',snapshot_id:null};
let publicationAttempts=0,publicationConflict=true;
const approvedRelease=JSON.parse(await readFile(join(root,'scripts/fixtures/approved-release.json'),'utf8'));
let publicScenario='approved',publicTesting=false;
const publicRequests=[];
function call(method,params={}) { return new Promise((resolve,reject) => {
  const id=++serial; const timeout=setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); },8000);
  pending.set(id,{ resolve,reject,timeout }); socket.send(JSON.stringify({ id,method,params }));
}); }
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{ expression,returnByValue:true,awaitPromise:true });
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  return result.result.value;
}
async function reload() {
  const previous=navigation;
  await call('Page.reload');
  await until(() => navigation>previous,'new document committed');
}
async function fixture(event) {
  const url=new URL(event.request.url), path=url.pathname;
  let status=200,data;
  if(path.startsWith('/data/')) {
    publicRequests.push({path,method:event.request.method});
    if(publicScenario==='legacy') return call('Fetch.continueRequest',{requestId:event.requestId});
    data=structuredClone(approvedRelease[path]);
    if(publicScenario==='withdrawn') {
      if(path==='/data/projects.json') data.projects=[];
      else if(path==='/data/release.json') {data.active_projects=0;data.withdrawn_projects=2;}
      else {data={};status=404;}
    } else if(publicScenario==='wrong-project' && path.includes('/graph-')) data.project.id='synthetic-unselected';
    else if(publicScenario==='unsafe-index' && path==='/data/projects.json') data.projects[0].graph_data='https://example.invalid/unselected.json';
    if(!data) {status=404;data={};}
  }
  else if(publicTesting) throw new Error('Public viewer attempted an owner API request');
  else if (!authenticated) { status=401; data={ detail:'Owner sign-in required' }; }
  else if (path==='/v1/me') data={ mode:'owner',can_edit:true };
  else if (path==='/v1/projects') data={ items:[{ id:'synthetic',title:'Synthetic research project' }] };
  else if (path==='/v1/records') data={ items:records,next_cursor:null };
  else if (path==='/v1/search') {
    const scope=url.searchParams.get('scope'), q=url.searchParams.get('q').toLowerCase();
    const matches=captures.filter(c=>(c.exact+' '+c.body).toLowerCase().includes(q)).map(c=>({ channel:'private_annotation',
      target_id:c.id,document_id:c.document_id,capture_kind:c.capture_kind,revision:c.revision,excerpt:c.exact+' · '+c.body }));
    data={ items:scope==='annotations' ? (matches.length ? [{...records[1],matches}] : []) : records,next_cursor:null };
  }
  else if (path==='/v1/reading/documents') data={ items:url.searchParams.get('source_record_id')===readingDocument.source_record_id ? [readingDocument] : [],next_cursor:null };
  else if (path==='/v1/reading/document') data=readingDocument;
  else if (path==='/v1/reading/annotations' && event.request.method==='POST') {
    const value=JSON.parse(event.request.postData), characters=Array.from(readingDocument.text_body);
    assert.equal(value.text_sha256,readingDocument.text_sha256);
    assert.equal(characters.slice(value.start,value.end).join(''),value.exact);
    assert.equal(value.start,Array.from(readingDocument.text_body.slice(0,readingDocument.text_body.indexOf(value.exact))).length);
    data={...value,id:'urn:research:annotation:'+value.annotation_uuid,start_pos:value.start,end_pos:value.end,
      prefix:characters.slice(Math.max(0,value.start-40),value.start).join(''),suffix:characters.slice(value.end,value.end+40).join(''),
      revision:1,created_at:'2026-10-15T00:00:00Z',changed_by:'synthetic-owner'};
    captures.push(data);
  }
  else if (path==='/v1/reading/annotations') data={ items:captures,next_cursor:null };
  else if (path==='/v1/reading/annotation' && event.request.method==='PUT') {
    const value=JSON.parse(event.request.postData), index=captures.findIndex(row=>row.id===value.annotation_id && row.project_id===value.project_id);
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    assert.ok(index>=0);
    if(value.expected_revision!==captures[index].revision) {status=409;data={current:captures[index]};}
    else {data={...captures[index],body:value.body,revision:captures[index].revision+1};captures[index]=data;}
  }
  else if (path==='/v1/reading/annotation') {
    const row=captures.find(c=>c.id===url.searchParams.get('annotation_id'));
    data={annotation:row,anchor:{anchored:true,start:row.start_pos,end:row.end_pos},web_annotation:{ id:row.id,type:'Annotation',
      'ir:scriptureReferences':[...scriptureResolutions.values()].filter(item=>item.annotation_id===row.id) }};
  }
  else if(path==='/v1/reading/scripture-candidates') {
    const row=captures.find(item=>item.id===url.searchParams.get('annotation_id'));
    data={annotation_id:row.id,structure_profile:{profile_id:'tanzil-structure-1.0'},
      candidates:row.exact==='Q 4:59' ? [{key:'c'.repeat(64),detector_kind:'explicit_numeric',matched_text:row.exact,status:'candidate',reason:'Owner confirmation required',reference:{chapter:4,ayah_start:59,ayah_end:59,label:'Q 4:59'}}] : [],
      resolutions:[...scriptureResolutions.values()].filter(item=>item.annotation_id===row.id)};
  }
  else if(path==='/v1/reading/scripture-citation' && event.request.method==='PUT') {
    const value=JSON.parse(event.request.postData),key=value.annotation_id+value.candidate_key,existing=scriptureResolutions.get(key);
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    assert.equal(value.owner_confirmed,true);assert.ok(value.rationale.trim());
    assert.ok(captures.some(row=>row.id===value.annotation_id && row.project_id===value.project_id));
    const same=existing && ['chapter','ayah_start','ayah_end','decision','rationale'].every(field=>existing[field]===value[field]);
    if(existing && value.expected_revision!==existing.revision && !(existing.revision===value.expected_revision+1 && same)) {status=409;data={current:existing};}
    else {
      data=existing && same && existing.revision===value.expected_revision+1 ? existing : {...value,
        detector_kind:value.candidate_key==='manual' ? 'owner_mapping' : 'explicit_numeric',
        id:'synthetic:citation:'+key,revision:(existing?.revision || 0)+1};
      scriptureResolutions.set(key,data);
      if(scriptureLostResponse) {scriptureLostResponse=false;status=503;data={detail:'Synthetic lost acknowledgement'};}
    }
  }
  else if(path==='/v1/reading/scripture-citations') {
    data={items:[...scriptureResolutions.values()].filter(row=>row.decision==='confirmed' && row.chapter===Number(url.searchParams.get('chapter')) && row.ayah_start<=Number(url.searchParams.get('ayah_end')) && row.ayah_end>=Number(url.searchParams.get('ayah_start')))
      .map(row=>({...row,source_record_id:records[1].id,source_title:'Synthetic source',edition:readingDocument.edition,locator:readingDocument.locator,selected_quote:captures.find(item=>item.id===row.annotation_id).exact})),next_cursor:null};
  }
  else if (path==='/v1/record') data=[...records,claim,evidence,{...records[1],id:'synthetic:other',title:'Another synthetic source'}].find(r => r.id===url.searchParams.get('record_id'));
  else if (path==='/v1/publication/head') data=publicationHead;
  else if (path==='/v1/publication/preview') data=publicationPreviews.get(url.searchParams.get('preview_id'));
  else if (path==='/v1/publication/relations') {
    const value=JSON.parse(event.request.postData);
    data={items:records.every(row=>value.record_ids.includes(row.id)) ? [{id:'synthetic:connection',from_id:records[0].id,to_id:records[1].id,
      source_title:records[0].title,target_title:records[1].title,predicate:'https://example.invalid/relatedSource',review_state:'pending'}] : [],truncated:false};
  }
  else if (path==='/v1/publication/previews') {
    const value=JSON.parse(event.request.postData),id='publication-'+String(publicationPreviews.size+1).padStart(32,'0');
    assert.equal(value.project_id,'synthetic');
    for(const selected of value.selections) assert.deepEqual(Object.keys(selected).sort(),['include_bibliography','include_summary','record_id']);
    const payload={format_version:1,snapshot_id:id,generated_at:'2026-10-15T00:00:00Z',curated_graph:'canonical_rdf',canonical_snapshot_sha256:[],
      project:{id:'synthetic',title:'Synthetic research project'},nodes:value.selections.map(selection=>{const row=records.find(r=>r.id===selection.record_id);return {
        id:row.id,label:row.title,type:row.kind,status:row.review_state,source_revision:row.revision,origin:'owner',
        summary:selection.include_summary ? row.summary : '',scope:'',people:[],role:'',locator:selection.include_bibliography ? 'Synthetic abstract' : '',
        citation:selection.include_bibliography ? 'Synthetic citation' : '',links:[],review_limits:['Synthetic visibility approval is not scholarly review']};}),
      edges:value.relation_ids.map(id=>({id,from:records[0].id,to:records[1].id,predicate:'https://example.invalid/relatedSource',label:'relatedSource',status:'pending'})),candidates:[],
      publication:{policy:'explicit_owner_selection_v1',review:'Visibility approval is not a new scholarly review'}};
    data={id,project_id:'synthetic',payload,payload_sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};publicationPreviews.set(id,data);status=201;
  }
  else if (path==='/v1/publication/approve') {
    const value=JSON.parse(event.request.postData),preview=publicationPreviews.get(value.preview_id);publicationAttempts++;
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    assert.equal(value.expected_sha256,preview.payload_sha256);assert.equal(value.rights_checked,true);
    assert.ok(value.rationale.trim());
    if(publicationConflict) {publicationConflict=false;publicationHead={...publicationHead,revision:1,status:'published',snapshot_id:'synthetic-concurrent'};status=409;data={current:{publication_changed:true}};}
    else {assert.equal(value.expected_revision,publicationHead.revision);publicationHead={...publicationHead,revision:publicationHead.revision+1,status:'published',snapshot_id:preview.id};data=publicationHead;}
  }
  else if (path==='/v1/publication/withdraw') {
    const value=JSON.parse(event.request.postData);assert.equal(value.expected_revision,publicationHead.revision);
    assert.ok(value.rationale.trim());publicationHead={...publicationHead,revision:publicationHead.revision+1,status:'withdrawn',snapshot_id:null};data=publicationHead;
  }
  else if (path==='/v1/personal-state') { data=saved.get(url.searchParams.get('record_id')); if (!data) { status=404; data={}; } }
  else if (path==='/v1/personal-states') {
    const value=JSON.parse(event.request.postData);
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    const current=saved.get(value.record_id);
    if (conflict) { conflict=false; status=409; data={ current:{ ...value,note:'Cloud edit from another synthetic machine',revision:9 } }; saved.set(value.record_id,data.current); }
    else if (value.expected_revision !== (current?.revision || 0)) { status=409; data={ current }; }
    else { data={ ...value,revision:(current?.revision || 0)+1,read_at:value.reading==='read' ? '2026-10-15T00:00:00Z' : null }; saved.set(value.record_id,data); }
  } else if (path==='/v1/evidence-path') data={ nodes:[...records,claim,evidence],edges:[],paths:[{ records:[records[0].id,claim.id,evidence.id,records[1].id],edges:['1','2','3'] }],truncated:false };
  else { status=404; data={}; }
  await call('Fetch.fulfillRequest',{ requestId:event.requestId,responseCode:status,
    responseHeaders:[{ name:'Content-Type',value:'application/json' }],body:Buffer.from(JSON.stringify(data || {})).toString('base64') });
}
try {
  await until(async () => (await fetch(testOrigin+'/workspace.html')).ok,'preview server');
  // Cold runner startup gets up to 30 seconds. Observe the same owned process;
  // no browser restart, test retry, or reduced sandbox/functional checks.
  const debugPort=await until(async () => Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]),'owned Chrome debug port',300);
  const pages=await until(async () => { const p=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); return p.find(x => x.type==='page'); },'Chrome CDP');
  socket=new WebSocket(pages.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{ once:true }); socket.addEventListener('error',reject,{ once:true }); });
  socket.addEventListener('message',event => {
    const message=JSON.parse(event.data);
    if (message.id) { const item=pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); }
    else if (message.method==='Fetch.requestPaused') fixture(message.params).catch(error => problems.push(error.message));
    else if (message.method==='Runtime.exceptionThrown') problems.push('Unexpected browser runtime exception');
    else if (message.method==='Page.frameNavigated' && !message.params.frame.parentId) navigation++;
  });
  await call('Runtime.enable'); await call('Page.enable'); await call('Fetch.enable',{ patterns:[{ urlPattern:'*/v1/*' }] });
  await call('Page.navigate',{ url:testOrigin+'/workspace.html' });
  await until(() => evaluate('document.querySelectorAll(".workspace-row").length===2'),'project record list');
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(() => evaluate('document.querySelector(".workspace-trails")?.textContent.includes("Synthetic section 2, paragraph 3")'),'located question evidence trail');
  assert.match(await evaluate('document.querySelector(".workspace-trails").textContent'),/Synthetic finding about authority/);
  await evaluate('[...document.querySelectorAll(".workspace-trails li button")].at(-1).click()');
  await until(() => evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic source")'),'open source from evidence trail');
  await until(() => evaluate('!!document.querySelector("#my-note")'),'source reading notes');
  assert.equal(await evaluate('document.querySelectorAll(".workspace-record-heading script").length'),0);
  await until(()=>evaluate('!!document.querySelector(".reader-text")'),'private passage reader');
  await evaluate(`const textRoot=document.querySelector('.reader-text'), range=document.createRange();
    const start=textRoot.textContent.indexOf('tafsīr'); range.setStart(textRoot.firstChild,start); range.setEnd(textRoot.firstChild,start+6);
    const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.querySelector('.reader-select').click();`);
  await until(()=>evaluate('!!document.querySelector(".reader-capture textarea")'),'passage selection form');
  await evaluate('document.querySelector(".reader-capture textarea").focus()');
  await call('Input.insertText',{text:'Synthetic anchored term note'});
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(()=>evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic question")'),'leave capture draft');
  await evaluate('document.querySelectorAll(".workspace-row")[1].click()');
  await until(()=>evaluate('document.querySelector(".reader-capture textarea")?.value.includes("Synthetic anchored term note")'),'capture draft retained through navigation');
  await evaluate('document.querySelector(".reader-capture button").click()');
  await until(()=>evaluate('document.querySelector(".reader-annotations")?.textContent.includes("Synthetic anchored term note")'),'persisted passage note');
  assert.equal(captures.length,1);
  await evaluate('document.querySelector(".reader-reopen").click()');
  await until(()=>evaluate('document.querySelector(".reader-text mark")?.textContent==="tafsīr"'),'reopen exact passage');
  await evaluate(`const scope=document.querySelector('.workspace-search label:nth-child(3) select');
    scope.value='annotations'; scope.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('.workspace-query input').focus();`);
  await call('Input.insertText',{text:'anchored'});
  await evaluate('document.querySelector(".workspace-search").requestSubmit()');
  await until(()=>evaluate('!!document.querySelector(".workspace-passage-hit")'),'private annotation search result');
  await evaluate('document.querySelector(".workspace-passage-hit").click()');
  await until(()=>evaluate('new URLSearchParams(location.search).has("annotation") && document.querySelector(".reader-text mark")?.textContent==="tafsīr"'),'search opens exact saved passage');
  await reload();
  await until(()=>evaluate('document.querySelector(".reader-text mark")?.textContent==="tafsīr"'),'annotation bookmark survives reload');
  await until(()=>evaluate('!!document.querySelector(".passage-note-open")'),'saved passage edit button');
  await evaluate('document.querySelector(".passage-note-open").click()');
  await until(()=>evaluate('!!document.querySelector(".passage-note-edit textarea")'),'saved passage editor');
  await evaluate('document.querySelector(".passage-note-edit textarea").focus()');
  await call('Input.insertText',{text:' Edited on this machine.'});
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(()=>evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic question")'),'leave existing passage edit');
  await evaluate('document.querySelectorAll(".workspace-row")[1].click()');
  await until(()=>evaluate('document.querySelector(".passage-note-edit textarea")?.value.includes("Edited on this machine")'),'existing passage draft retained');
  captures[0]={...captures[0],body:'Cloud passage edit from another machine',revision:2};
  await evaluate('document.querySelector(".passage-note-save").click()');
  await until(()=>evaluate('document.querySelector(".passage-note-conflict pre")?.textContent.includes("Cloud passage edit")'),'passage conflict comparison');
  assert.match(await evaluate('document.querySelector(".passage-note-edit textarea").value'),/Edited on this machine/);
  await evaluate('document.querySelectorAll(".passage-note-conflict button")[1].click()');
  await until(()=>evaluate('document.querySelector(".passage-note-edit [role=status]")?.textContent.includes("Saved to your workspace")'),'explicit passage draft resolution');
  assert.equal(captures[0].revision,3);assert.match(captures[0].body,/Edited on this machine/);assert.equal(captures[0].exact,'tafsīr');
  await reload();
  await until(()=>evaluate('document.querySelector(".saved-passage-note")?.textContent.includes("Edited on this machine")'),'edited passage persists after reload');
  // The detector itself is tested offline in Python. This checks the real reader
  // controls against synthetic authenticated storage responses and conflicts.
  await evaluate(`const walker=document.createTreeWalker(document.querySelector('.reader-text'),NodeFilter.SHOW_TEXT);
    let node;while((node=walker.nextNode()) && !node.textContent.includes('Q 4:59')) {}
    const range=document.createRange(),offset=node.textContent.indexOf('Q 4:59');range.setStart(node,offset);range.setEnd(node,offset+6);
    const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.querySelector('.reader-select').click();`);
  await until(()=>evaluate('document.querySelector(".reader-capture blockquote")?.textContent==="Q 4:59"'),'exact scripture selection');
  await evaluate('document.querySelector(".reader-capture button").click()');
  await until(()=>captures.length===2 && evaluate('document.querySelectorAll(".saved-passage-note").length===2'),'second saved passage');
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle").click()');
  const citationSelector='[data-candidate-key="'+'c'.repeat(64)+'"]';
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(citationSelector)})`),'located reference candidate');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' textarea')}).focus()`);
  await call('Input.insertText',{text:'Synthetic owner reference resolution'});
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(()=>evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic question")'),'leave reference draft');
  await evaluate('document.querySelectorAll(".workspace-row")[1].click()');
  await until(()=>evaluate('document.querySelectorAll(".scripture-toggle").length===2'),'return to reference source');
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle").click()');
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' textarea')})?.value==='Synthetic owner reference resolution'`),'reference draft retained');
  scriptureLostResponse=true;
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' [role=alert]')})?.textContent.includes('draft is still here')`),'lost acknowledgement keeps reference draft');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved')})?.textContent.includes('revision 1')`),'idempotent reference retry');
  assert.equal([...scriptureResolutions.values()][0].revision,1);
  await reload();
  await until(()=>evaluate('document.querySelectorAll(".scripture-toggle").length===2'),'saved reference reload');
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle").click()');
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved')})?.textContent.includes('Linked to Q 4:59')`),'reference decision survives reload');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' details')}).open=true;document.querySelector(${JSON.stringify(citationSelector+' textarea')}).focus()`);
  await call('Input.insertText',{text:' My newer draft.'});
  const citationEntry=[...scriptureResolutions.entries()][0];
  scriptureResolutions.set(citationEntry[0],{...citationEntry[1],revision:2,rationale:'Cloud reference correction'});
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate('document.querySelector(".scripture-conflict")?.textContent.includes("Cloud reference correction")'),'reference revision conflict');
  assert.match(await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' textarea')}).value`),/My newer draft/);
  await evaluate('document.querySelectorAll(".scripture-conflict button")[1].click()');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved')})?.textContent.includes('revision 3')`),'explicit reference conflict resolution');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved button')}).click()`);
  await until(()=>evaluate('document.querySelector(".scripture-related")?.textContent.includes("Synthetic edition · Abstract")'),'reverse verse lookup retains source location');
  await evaluate('document.querySelector(".scripture-related button").click()');
  await until(()=>evaluate('document.querySelector(".reader-text mark")?.textContent==="Q 4:59"'),'reverse lookup opens exact saved passage');
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle").click()');
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved')})`),'reference reopen');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' details')}).open=true;document.querySelector(${JSON.stringify(citationSelector)}).scrollIntoView({block:'start'})`);
  const referenceDesktop=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'scripture-desktop.png'),Buffer.from(referenceDesktop.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'reference controls fit mobile');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector)}).scrollIntoView({block:'start'})`);
  const referenceMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'scripture-mobile.png'),Buffer.from(referenceMobile.data,'base64'));
  await call('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' details')}).open=true;document.querySelector(${JSON.stringify(citationSelector+' .scripture-dismiss')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved')})?.textContent.includes('Dismissed')`),'dismissal persisted');
  assert.equal([...scriptureResolutions.values()][0].revision,4);
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="tafsīr").querySelector(".scripture-toggle").click()');
  const termManual='[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="tafsīr").querySelector("[data-candidate-key=manual]")';
  await until(()=>evaluate(`!!${termManual}`),'manual reference mapping for a selected term');
  await evaluate(`${termManual}.querySelector('details').open=true`);
  for(const [index,value] of [[0,'4'],[1,'59']]) {
    await evaluate(`{const field=${termManual}.querySelectorAll('input')[${index}];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  }
  await evaluate(`${termManual}.querySelector('textarea').focus()`);
  await call('Input.insertText',{text:'Synthetic manual connection, not a citation claim'});
  await evaluate(`${termManual}.querySelector('.scripture-confirm').click()`);
  await until(()=>evaluate(`${termManual}.querySelector('.scripture-saved')?.textContent.includes('Linked to Q 4:59')`),'manual verse connection persisted');
  assert.equal([...scriptureResolutions.values()].filter(row=>row.detector_kind==='owner_mapping').length,1);
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("Synthetic owner reference resolution") || value.includes("Cloud reference correction"))'),false);
  await evaluate('document.querySelector("#my-note").focus()');
  await call('Input.insertText',{ text:'Synthetic browser note <img src=x onerror=alert(1)>' });
  await evaluate('document.querySelector(".workspace-note-actions button").click()');
  await until(() => evaluate('document.querySelector(".workspace-note-actions").textContent.includes("Saved to your workspace")'),'note save');
  assert.match(saved.get('synthetic:source').note,/Synthetic browser note/);
  await evaluate('document.querySelector(".workspace-decisions button:nth-child(2)").click()');
  await until(() => saved.get('synthetic:source')?.decision==='not_relevant','skip persisted');
  await evaluate(`const reading=document.querySelector('.workspace-notes select'); reading.value='read'; reading.dispatchEvent(new Event('change',{bubbles:true}));`);
  await until(() => saved.get('synthetic:source')?.reading==='read','read persisted');
  await until(() => evaluate('document.querySelector(".workspace-note-actions").textContent.includes("Saved to your workspace")'),'read save acknowledged');
  await reload();
  await until(() => evaluate('document.querySelector("#my-note")?.value.includes("Synthetic browser note")'),'reload retains cloud note');
  assert.equal(await evaluate('document.querySelector(".workspace-notes select").value'),'read');
  assert.equal(await evaluate('document.querySelector(".workspace-decisions button:nth-child(2)").getAttribute("aria-pressed")'),'true');
  const width=await evaluate('document.querySelector(".owner-panes").style.getPropertyValue("--list-width")');
  await evaluate('document.querySelector(".pane-divider").focus()');
  await call('Input.dispatchKeyEvent',{ type:'keyDown',key:'ArrowRight',code:'ArrowRight' });
  assert.notEqual(await evaluate('document.querySelector(".owner-panes").style.getPropertyValue("--list-width")'),width);
  conflict=true;
  await evaluate('document.querySelector("#my-note").focus()'); await call('Input.insertText',{ text:' New draft.' });
  await evaluate('document.querySelector(".workspace-note-actions button").click()');
  await until(() => evaluate('!!document.querySelector(".workspace-conflict")'),'revision conflict');
  assert.match(await evaluate('document.querySelector("#my-note").value'),/New draft/);
  assert.match(await evaluate('document.querySelector(".workspace-conflict pre").textContent'),/Cloud edit/);
  await evaluate('document.querySelector(".workspace-conflict button").click()');
  await until(() => evaluate('document.querySelector("#my-note").value.startsWith("Cloud edit")'),'explicit cloud resolution');
  await evaluate('document.querySelector(".header-tools button").click()');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  const desktop=await call('Page.captureScreenshot',{ format:'png' }); await writeFile(join(artifacts,'desktop.png'),Buffer.from(desktop.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{ width:390,height:844,deviceScaleFactor:1,mobile:true });
  await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'mobile horizontal overflow');
  const mobile=await call('Page.captureScreenshot',{ format:'png' }); await writeFile(join(artifacts,'mobile.png'),Buffer.from(mobile.data,'base64'));
  assert.equal(await evaluate('Object.values(localStorage).some(v=>v.includes("Synthetic browser note")||v.includes("Cloud edit")||v.includes("Synthetic anchored term note"))'),false);
  const previousNavigation=navigation;
  await call('Page.navigate',{url:testOrigin+'/workspace.html?'+new URLSearchParams({project:'synthetic',record:'synthetic:other',annotation:captures[0].id})});
  await until(()=>navigation>previousNavigation,'mismatched source document committed');
  await until(()=>evaluate('document.querySelector(".reader-message")?.textContent.includes("belongs to another source")'),'mismatched source rejected');
  assert.equal(await evaluate('!!document.querySelector(".reader-text")'),false);
  authenticated=false; await reload();
  await until(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("Owner sign-in")'),'anonymous sign-in boundary');
  assert.equal(await evaluate('!!document.querySelector("#my-note")'),false);
  authenticated=true;
  await call('Emulation.clearDeviceMetricsOverride');
  await call('Page.navigate',{url:testOrigin+'/publish.html?project=synthetic'});
  await until(()=>evaluate('document.querySelectorAll(".publication-pick input").length===2'),'publication record picker');
  await evaluate('document.querySelectorAll(".publication-pick input").forEach(input=>input.click())');
  await until(()=>evaluate('document.querySelectorAll(".publication-selection").length===2'),'explicit publication selection');
  assert.equal(await evaluate('[...document.querySelectorAll(".publication-selection input")].some(input=>input.checked)'),false);
  await evaluate('document.querySelectorAll(".publication-selection")[1].querySelectorAll("input").forEach(input=>input.click())');
  await evaluate('document.querySelector(".publication-relations button").click()');
  await until(()=>evaluate('!!document.querySelector(".publication-edge input")'),'recorded relation picker');
  assert.equal(await evaluate('document.querySelector(".publication-edge input").checked'),false);
  await evaluate('document.querySelector(".publication-edge input").click();document.querySelector(".publication-preview-button").click()');
  await until(()=>evaluate('!!document.querySelector(".publication-preview")'),'sealed publication preview');
  assert.equal(publicationAttempts,0);
  assert.equal(await evaluate('document.querySelectorAll(".public-record-preview script").length'),0);
  assert.equal(await evaluate('document.querySelector(".publication-approve").disabled'),true);
  assert.ok(!JSON.stringify([...publicationPreviews.values()]).includes('Synthetic anchored term note'));
  assert.ok(!JSON.stringify([...publicationPreviews.values()]).includes('Cloud edit from another synthetic machine'));
  await evaluate('document.querySelector(".publication-approval textarea").focus()');await call('Input.insertText',{text:'Synthetic private publication rationale'});
  await evaluate('document.querySelector(".publication-approval .publication-ack input").click()');
  await until(()=>evaluate('!document.querySelector(".publication-approve").disabled'),'explicit publication acknowledgement');
  await evaluate('document.querySelector(".publication-approve").click()');
  await until(()=>evaluate('document.querySelector(".publication-message[role=status]")?.textContent.includes("research or public revision changed")'),'stale publication prevents approval');
  assert.equal(await evaluate('document.querySelector(".publication-approve").disabled'),true);
  await evaluate('document.querySelector(".publication-head button").click()');
  await until(()=>evaluate('document.querySelector(".publication-head")?.textContent.includes("revision 1")'),'refresh concurrent public head');
  await evaluate('document.querySelector(".publication-preview-button").click()');
  await until(()=>publicationPreviews.size===2 && evaluate('!document.querySelector(".publication-preview-button").disabled'),'fresh publication preview');
  await evaluate('document.querySelector(".publication-approval .publication-ack input").click()');
  await until(()=>evaluate('!document.querySelector(".publication-approve").disabled'),'fresh preview acknowledgement');
  await evaluate('document.querySelector(".publication-approve").click()');
  await until(()=>evaluate('!!document.querySelector(".publication-current")'),'explicit snapshot approval');
  assert.equal(publicationAttempts,2);assert.equal(publicationHead.revision,2);
  await reload();
  await until(()=>evaluate('!!document.querySelector(".publication-current")'),'sealed preview and current head survive reload');
  assert.equal(publicationAttempts,2);
  const publicationDesktop=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'publication-desktop.png'),Buffer.from(publicationDesktop.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'publication mobile horizontal overflow');
  const publicationMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'publication-mobile.png'),Buffer.from(publicationMobile.data,'base64'));
  await evaluate('document.querySelector(".publication-withdraw").open=true;document.querySelector(".publication-withdraw textarea").focus()');
  await call('Input.insertText',{text:'Synthetic private withdrawal rationale'});
  assert.equal(await evaluate('document.querySelector(".publication-withdraw-button").disabled'),true);
  await evaluate('document.querySelector(".publication-withdraw .publication-ack input").click()');
  await until(()=>evaluate('!document.querySelector(".publication-withdraw-button").disabled'),'explicit withdrawal acknowledgement');
  await evaluate('document.querySelector(".publication-withdraw-button").click()');
  await until(()=>evaluate('document.querySelector(".publication-head")?.textContent.includes("withdrawn")'),'explicit publication withdrawal');
  assert.equal(publicationHead.revision,3);
  assert.equal(await evaluate('Object.values(localStorage).some(v=>v.includes("private publication rationale")||v.includes("private withdrawal rationale"))'),false);
  authenticated=false;await reload();
  await until(()=>evaluate('document.querySelector("[role=alert]")?.textContent.includes("Owner sign-in")'),'anonymous publication boundary');
  assert.equal(await evaluate('!!document.querySelector(".publication-picker")'),false);
  // Anonymous public browsing uses the real exporter's synthetic data fixture.
  publicTesting=true;
  await call('Emulation.clearDeviceMetricsOverride');
  await call('Fetch.enable',{patterns:[{urlPattern:'*/v1/*'},{urlPattern:'*/data/*'}]});
  await call('Page.navigate',{url:testOrigin+'/?project=synthetic-islam&record=shared%3Asource#records'});
  await until(()=>evaluate('document.querySelector(".details")?.textContent.includes("Synthetic bibliography, edition 1")'),'approved source citation');
  assert.match(await evaluate('document.querySelector(".details").textContent'),/abstract only; full argument not verified/);
  assert.match(await evaluate('document.querySelector(".details").textContent'),/Synthetic section 2/);
  assert.equal(await evaluate('document.querySelectorAll(".details script").length'),0);
  assert.equal(await evaluate('[...document.querySelectorAll("nav button")].some(button=>button.textContent==="Discovery")'),false);
  assert.equal(await evaluate('!!document.querySelector(".screening-box")'),false);
  assert.match(await evaluate('document.querySelector(".index-meta").textContent'),/2 published records/);
  await evaluate('const picker=document.querySelector(".public-project-picker select");picker.value="synthetic-philosophy";picker.dispatchEvent(new Event("change",{bubbles:true}))');
  await until(()=>evaluate('document.querySelector(".intro h1")?.textContent==="Synthetic philosophy research"'),'switch actual project graph');
  assert.equal(await evaluate('new URL(location.href).searchParams.has("record")'),false);
  assert.equal(await evaluate('document.querySelector(".details").textContent.includes("Synthetic Islam research source")'),false);
  await evaluate('history.back()');
  await until(()=>evaluate('document.querySelector(".details")?.textContent.includes("Synthetic Islam research source")'),'Back restores project and record');
  await evaluate('history.forward()');
  await until(()=>evaluate('document.querySelector(".intro h1")?.textContent==="Synthetic philosophy research"'),'Forward restores other project');
  await evaluate('[...document.querySelectorAll("nav button")].find(button=>button.textContent==="Records").click()');
  await until(()=>evaluate('document.querySelectorAll(".record-row").length===2'),'all approved record kinds');
  await evaluate('[...document.querySelectorAll(".record-row")].find(button=>button.textContent.includes("Synthetic philosophy research source")).click()');
  await until(()=>evaluate('document.querySelector(".details")?.textContent.includes("Synthetic philosophy research source")'),'same record ID scoped to selected project');
  await reload();
  await until(()=>evaluate('document.querySelector(".details")?.textContent.includes("Synthetic philosophy research source")'),'reload restores exact project/record');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".details")).display!=="none"'),true,'deep-linked record details visible on mobile after reload');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'public mobile horizontal overflow');
  const publicRecord=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'public-mobile-record.png'),Buffer.from(publicRecord.data,'base64'));
  await evaluate('document.querySelector(".details .close-panel").click()');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".details")).display'), 'none');
  const publicMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'public-mobile.png'),Buffer.from(publicMobile.data,'base64'));
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  publicScenario='wrong-project';await reload();
  await until(()=>evaluate('document.querySelector("h1")?.textContent==="Snapshot unavailable"'),'mismatched public project rejected');
  assert.equal(await evaluate('!!document.querySelector(".record-row")'),false);
  publicScenario='withdrawn';publicRequests.length=0;await reload();
  await until(()=>evaluate('document.querySelector("h1")?.textContent==="Nothing is published right now"'),'all withdrawn release');
  assert.equal(publicRequests.some(request=>request.path.includes('/graph-') || request.path.endsWith('/public-graph.json')),false);
  assert.equal(await evaluate('document.body.textContent.includes("Synthetic philosophy research source")'),false);
  publicScenario='unsafe-index';publicRequests.length=0;await reload();
  await until(()=>evaluate('document.querySelector("h1")?.textContent==="Snapshot unavailable"'),'unsafe graph path rejected before fetch');
  assert.deepEqual(publicRequests.map(request=>request.path),['/data/projects.json']);
  publicScenario='approved';publicRequests.length=0;
  await call('Page.navigate',{url:testOrigin+'/?project=not-published#records'});
  await until(()=>evaluate('document.body.textContent.includes("not in the current public release")'),'unknown project does not fall back');
  assert.equal(publicRequests.some(request=>request.path.includes('/graph-')),false);
  await evaluate('const recover=document.querySelector(".public-project-picker select");recover.value="synthetic-islam";recover.dispatchEvent(new Event("change",{bubbles:true}))');
  await until(()=>evaluate('document.querySelector(".intro h1")?.textContent==="Synthetic Islam research"'),'recover by choosing published project');
  assert.equal(publicRequests.some(request=>request.method!=='GET'),false);
  assert.equal(publicRequests.some(request=>request.path.endsWith('/public-graph.json')),false);
  publicScenario='legacy';await call('Page.navigate',{url:testOrigin+'/#records'});
  await until(()=>evaluate('document.querySelectorAll(".record-row").length>0'),'legacy RDF snapshot remains usable');
  assert.match(await evaluate('document.querySelector(".index-meta").textContent'),/curated records/);
  assert.equal(await evaluate('[...document.querySelectorAll("nav button")].some(button=>button.textContent==="Discovery")'),true);
  assert.deepEqual(problems,[]);
  console.log(JSON.stringify({publicChecksPassed:true,checks:['actual approved-export fixture','anonymous read-only data requests','multi-project switching','Back/Forward and record reload','citations, locators and review limits','same record ID across projects','dark mobile layout','mismatched project refusal','all-withdrawn empty state','unsafe path refusal','unknown project recovery','no legacy fallback in approved mode','legacy RDF compatibility'],artifacts}));
  console.log(JSON.stringify({publicationChecksPassed:true,checks:['explicit record, summary, bibliography and relation choices','no automatic approval','sealed preview privacy and inert labels','stale head requires new preview','revision-bound acknowledgement and approval','reload without duplicate approval','withdrawal acknowledgement','390px overflow','private rationale outside localStorage','anonymous publication denial'],publicationAttempts,artifacts}));
  console.log(JSON.stringify({ passed:true,checks:['question findings to located evidence to source','Unicode passage selection and exact reopening','passage draft retained during record navigation','private annotation search and reloadable exact-passage link','Quran reference decision reload and retained draft','idempotent reference retry after lost response','reference conflict comparison and explicit resolution','reverse verse lookup to exact saved passage','reference dismissal and 390px controls','read/skip/note save and reload','inert untrusted text','keyboard pane resize','revision conflict comparison','dark mode','390px overflow','no private localStorage','anonymous boundary'],artifacts }));
} finally {
  socket?.close(); chrome.kill(); await preview.close();
  for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Review finished')); }
  await sleep(200); await rm(profile,{ recursive:true,force:true });
}
