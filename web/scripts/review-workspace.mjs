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
let serial=0, navigation=0, unloadPrompts=0; const pending=new Map(); const problems=[]; const saved=new Map(); let conflict=false, authenticated=true;
const ownerProjects=[{id:'synthetic',title:'Synthetic research project'}];let projectPosts=0;
const independentNotes=new Map();let holdNoteSave=false,releaseNoteSave=null;
let referenceDelay=false;const delayedReferenceRequests=[];
const records = [
  { id:'synthetic:question',project_id:'synthetic',kind:'question',title:'Synthetic question about authority',summary:'A bounded synthetic question.',revision:1,review_state:'pending',attributes:{} },
  { id:'synthetic:source',project_id:'synthetic',kind:'source',title:'Synthetic source <script>not HTML</script>',summary:'Synthetic source summary.',revision:1,review_state:'pending',attributes:{} },
];
const claim={ ...records[0],id:'synthetic:claim',kind:'claim',title:'Synthetic attributed finding',summary:'Synthetic finding about authority' };
const evidence={ ...records[0],id:'synthetic:evidence',kind:'evidence',title:'Synthetic located evidence',summary:'Synthetic fair paraphrase',attributes:{ rdf_properties:{ 'https://islam-research.local/vocab/locator':['"Synthetic section 2, paragraph 3"'] } } };
const readingDocument={ id:'synthetic:document',project_id:'synthetic',source_record_id:records[1].id,
  edition:'Synthetic edition',locator:'Abstract',representation_url:'https://example.invalid/source',
  source_notice:'Synthetic attribution retained verbatim.\n<b>This notice is plain text.</b>',
  text_body:'😀 Before tafsīr and التفسير; Q 4:59. After.',review_scope:'Synthetic private unverified excerpt' };
readingDocument.text_sha256=createHash('sha256').update(readingDocument.text_body).digest('hex');
const comparisonDocument={...readingDocument,id:'synthetic:comparison',edition:'Synthetic contrasting edition',text_body:'A different rendering: التفسير.',text_sha256:createHash('sha256').update('A different rendering: التفسير.').digest('hex')};
const graphEdges=[{id:'1',project_id:'synthetic',from_id:claim.id,to_id:records[0].id,predicate:'https://islam-research.local/vocab/addressesQuestion',review_state:'pending',provenance:{basis:'Synthetic bounded claim'}},{id:'2',project_id:'synthetic',from_id:claim.id,to_id:evidence.id,predicate:'https://islam-research.local/vocab/evidence',review_state:'pending',provenance:{basis:'Synthetic located evidence'}},{id:'3',project_id:'synthetic',from_id:evidence.id,to_id:records[1].id,predicate:'https://islam-research.local/vocab/source',review_state:'pending',provenance:{basis:'Synthetic source identity'}}];
const readingCollection=JSON.parse(await readFile(join(root,'../src/islam_research/resources/reading-collection-v1.json'),'utf8'));readingCollection.artifact_sha256=createHash('sha256').update(await readFile(join(root,'../src/islam_research/resources/reading-collection-v1.json'))).digest('hex');
const collectionReading=readingCollection.readings[0],collectionSource=readingCollection.sources.find(row=>row.id===collectionReading.source_id);
const collectionRecord={...records[1],id:'synthetic:collection-source',title:collectionSource.title};
const collectionDocument={id:'synthetic:collection-doc',project_id:'synthetic',source_record_id:collectionRecord.id,edition:collectionSource.edition,locator:collectionReading.locator,representation_url:collectionSource.source_url,text_body:collectionReading.text,text_sha256:collectionReading.text_sha256,review_scope:'Pending located source reading',source_notice:''};
let collectionLostResponse=true;const collectionRequests=[];
const pilotResource={resource_id:'synthetic:resource',label:'Synthetic Arabic fixture',publisher:'Synthetic',source_notice:'Synthetic source notice',reading_note:'No edition inference',review_limit:'Synthetic test text, not Quran text',attribution_url:'https://tanzil.net/',verses:[59,83].map(ayah=>({chapter:4,ayah_start:ayah,ayah_end:ayah,text:`اختبار ${ayah}`,text_sha256:createHash('sha256').update(`اختبار ${ayah}`).digest('hex'),reference:{id:`synthetic:4:${ayah}`,label:`Q 4:${ayah}`}}))};
const recoveryCopies=new Map();
const captures=[];let captureLostResponse=false;let readingLibraryRows=[];
let readingDesk=null,deskLostResponse=true;const deskRequests=[];
const verseMaterials=new Map(),verseRequests=[];let verseLostResponse=true;
const lexicalConcepts=new Map(),lexicalEntities=new Map(),lexicalRequests=new Map(),lexicalHistory=new Map();
let lexicalLostResponse=false,definitionLostResponse=false,definitionUpdateLostResponse=false;
const lexicalSource=row=>({...row,source_record_id:readingDocument.source_record_id,source_title:records[1].title,
  edition:readingDocument.edition,locator:readingDocument.locator,representation_url:readingDocument.representation_url,
  text_sha256:readingDocument.text_sha256,source_quotation:captures.find(item=>item.id===row.annotation_id)?.exact});
function lexicalPage(items,url) {
  const after=url.searchParams.get('cursor') || '',rows=items.filter(row=>row.id>after).sort((a,b)=>a.id.localeCompare(b.id));
  return {items:rows.slice(0,1),next_cursor:rows.length>1 ? rows[0].id : null};
}
const scriptureResolutions=new Map();let scriptureLostResponse=false;
const scriptureStructure=JSON.parse(await readFile(join(root,'../src/islam_research/resources/quran-structure-v1.json'),'utf8'));
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
  // Exercise the active surface, as a user does; parked tabs remain mounted.
  const scoped=expression.replace(/(?<![\w.])document\.querySelector(All)?\(/g,(_,all)=>`activeDocument.querySelector${all || ''}(`);
  const wrapped=`(()=>{const activeDocument={querySelectorAll:s=>[...document.querySelectorAll(s)].filter(n=>!n.closest('.working-surface[hidden]')),querySelector:s=>[...document.querySelectorAll(s)].find(n=>!n.closest('.working-surface[hidden]'))};return eval(${JSON.stringify(scoped)});})()`;
  const result=await call('Runtime.evaluate',{ expression:wrapped,returnByValue:true,awaitPromise:true });
  if (result.exceptionDetails) throw new Error('Browser evaluation failed: '+JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function reload() {
  const previous=navigation;
  await call('Page.reload');
  await until(() => navigation>previous,'new document committed');
}
async function revealPassageTools(){await evaluate(`{for(const details of document.querySelectorAll('.working-surface:not([hidden]) .reader-source-anchors,.working-surface:not([hidden]) .passage-research-tools'))if(!details.open)details.querySelector(':scope > summary').click();}`);}
async function reveal(selector){await evaluate(`{const target=document.querySelector(${JSON.stringify(selector)});if(!target)throw new Error('Missing reveal target');const parents=[];for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)parents.unshift(p);parents.forEach(p=>p.querySelector(':scope > summary').click());}`);}
async function click(text) {
  if(['Add source','All research','Reading collection & context','Read the Sirry article','Verse import tools','Resume reading'].includes(text) && !await evaluate(`[...document.querySelectorAll('button')].some(button=>button.textContent===${JSON.stringify(text)})`)){await click('Sources');await until(()=>evaluate('!!document.querySelector(".atlas-reading-tools")'),'contextual reading tools');}
  await evaluate(`{const aliases={'Back to my reading':'← Back to reading','Back to reading':'← Back to reading','Compare readings':'Compare'};const target=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(text)}) || [...document.querySelectorAll('button')].find(button=>button.textContent===aliases[${JSON.stringify(text)}]);if(!target)throw new Error('Missing button '+${JSON.stringify(text)});const parents=[];for(let p=target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)parents.unshift(p);parents.forEach(p=>p.querySelector(':scope > summary').click());target.click();}`); }
async function fixture(event) {
  const url=new URL(event.request.url), path=url.pathname;
  if(referenceDelay && ['/v1/record','/v1/reading/documents','/v1/reading/document','/v1/reading/annotations','/v1/lexicon/annotation-links'].includes(path)){
    delayedReferenceRequests.push(path);
    // Deterministically reorder different request classes; readiness must follow
    // the visible reader's loaded state, not retained hidden DOM or a timer.
    await sleep(path==='/v1/record'?160:40);
  }
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
  else if(path==='/v1/reading/library') data={items:readingLibraryRows,next_cursor:null};
  else if(path==='/v1/reading/collection') data=readingCollection;
  else if(path==='/v1/notebook/entries' && event.request.method==='POST'){
    const value=JSON.parse(event.request.postData),id='urn:research:notebook:'+value.request_uuid;
    const row={...value,id,state:'active',revision:1};independentNotes.set(id,row);
    if(holdNoteSave){holdNoteSave=false;await new Promise(resolve=>{releaseNoteSave=resolve;});}
    data={id,project_id:value.project_id,revision:1};
  }
  else if(path==='/v1/notebook/entry') {data=independentNotes.get(url.searchParams.get('entry_id'));if(!data){status=404;data={};}}
  else if(path==='/v1/notebook/items') data={items:captures.map(row=>({id:row.id,item_kind:'passage_note',thought_type:'passage_note',project_id:row.project_id,record_id:readingDocument.source_record_id,document_id:row.document_id,annotation_id:row.id,title:'Passage note: '+row.exact,body:row.body,selected_quote:row.exact,revision:row.revision})),next_cursor:null};
  else if (path==='/v1/verses/pilot') data=pilotResource;
  else if (path==='/v1/projects') {
    if(event.request.method==='POST'){const value=JSON.parse(event.request.postData);projectPosts++;const row={id:value.project_id,title:value.title,scope:value.scope};ownerProjects.push(row);status=503;data={detail:'Synthetic response lost after commit'};}
    else data={items:ownerProjects};
  }
  else if(path==='/v1/record-context'){const id=url.searchParams.get('record_id'),record=[...records,claim,evidence,collectionRecord,...lexicalConcepts.values()].find(row=>row.id===id);data={project_id:'synthetic',record,items:graphEdges.filter(edge=>edge.from_id===id || edge.to_id===id).map(edge=>({edge,node:[...records,claim,evidence].find(row=>row.id===(edge.from_id===id ? edge.to_id : edge.from_id)),direction:edge.from_id===id ? 'out' : 'in',meaning:'Synthetic recorded relation'})),next_cursor:null};}
  else if (path==='/v1/records') data={ items:records,next_cursor:null };
  else if (path==='/v1/search') {
    const scope=url.searchParams.get('scope'), q=url.searchParams.get('q').toLowerCase();
    const matches=captures.filter(c=>(c.exact+' '+c.body).toLowerCase().includes(q)).map(c=>({ channel:'private_annotation',
      target_id:c.id,document_id:c.document_id,capture_kind:c.capture_kind,revision:c.revision,excerpt:c.exact+' · '+c.body }));
    data={ items:scope==='annotations' ? (matches.length ? [{...records[1],matches}] : []) : records,next_cursor:null };
  }
  else if(path==='/v1/reading/link-collection'){
    const value=JSON.parse(event.request.postData);collectionRequests.push(value);assert.equal(value.owner_confirmed,true);
    assert.equal(value.document_id,collectionDocument.id);const id='synthetic:collection-material',annotationId='synthetic:collection-annotation';
    if(!verseMaterials.has(id)){
      captures.push({id:annotationId,project_id:'synthetic',document_id:collectionDocument.id,text_sha256:collectionDocument.text_sha256,start_pos:0,end_pos:Array.from(collectionReading.text).length,exact:collectionReading.text,capture_kind:'comment',mark_style:'none',body:'',revision:1});
      verseMaterials.set(id,{id,project_id:'synthetic',annotation_id:annotationId,document_id:collectionDocument.id,text_sha256:collectionDocument.text_sha256,source_record_id:collectionRecord.id,selected_quote:collectionReading.text,material_kind:'translation',link_kind:'representation',review_state:'pending',revision:1,chapter:4,ayah_start:59,ayah_end:59,reference:{id:'q4:59',label:'Q 4:59',chapter:4,ayah_start:59,ayah_end:59},edition:collectionSource.edition,locator:collectionReading.locator,source_scope:collectionReading.source_scope,attribution:collectionReading.attribution});
    }
    data={project_id:'synthetic',reading_id:collectionReading.id,document_id:collectionDocument.id,record_id:collectionRecord.id,annotation_id:annotationId,material_id:id,revision:1};
    if(collectionLostResponse){collectionLostResponse=false;status=503;data={};}
  }
  else if(path==='/v1/reading/draft' && event.request.method==='PUT'){
    const value=JSON.parse(event.request.postData),id='urn:research:draft:'+value.draft_uuid,previous=recoveryCopies.get(id);
    const base=saved.get(value.record_id) || {note:'',revision:0};
    if(previous && previous.revision!==value.expected_revision){if(previous.revision===value.expected_revision+1 && previous.body===value.body)data=previous;else {status=409;data={current:previous};}}
    else {data={...value,id,revision:value.expected_revision+1,start_pos:value.start,end_pos:value.end,base_snapshot:{note:base.note,revision:base.revision},record_title:records[1].title};recoveryCopies.set(id,data);}
  }
  else if(path==='/v1/reading/drafts')data={items:[...recoveryCopies.values()].filter(row=>row.project_id===url.searchParams.get('project_id') && row.record_id===url.searchParams.get('record_id') && row.context_kind===url.searchParams.get('context_kind') && row.state===url.searchParams.get('state')),next_cursor:null};
  else if(path==='/v1/reading/draft'){data=recoveryCopies.get(url.searchParams.get('draft_id'));if(!data){status=404;data={};}}
  else if(path==='/v1/reading/desk' && event.request.method==='PUT') {
    const value=JSON.parse(event.request.postData);deskRequests.push(value);
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    const same=readingDesk && ['project_id','record_id','document_id','annotation_id'].every(key=>(readingDesk[key] || null)===(value[key] || null));
    if(readingDesk && readingDesk.revision===value.expected_revision+1 && same)data=readingDesk;
    else if(value.expected_revision!==(readingDesk?.revision || 0)){status=409;data={current:readingDesk};}
    else {const capture=captures.find(row=>row.id===value.annotation_id);readingDesk={...value,start_pos:capture?.start_pos || 0,end_pos:capture?.end_pos || 0,revision:value.expected_revision+1};data=readingDesk;
      if(deskLostResponse){deskLostResponse=false;status=503;data={detail:'Synthetic lost bookmark response'};}}
  }
  else if(path==='/v1/reading/desk'){if(readingDesk)data=readingDesk;else {status=404;data={};}}
  else if(path==='/v1/verses/materials' && event.request.method==='POST') {
    const value=JSON.parse(event.request.postData);verseRequests.push(value);const id='synthetic:material:'+value.request_uuid;
    const previous=verseMaterials.get(id);
    if(previous)data={id,project_id:previous.project_id,revision:previous.revision};
    else {const a=captures.find(row=>row.id===value.annotation_id);assert.ok(a);assert.equal(value.owner_confirmed,true);assert.equal(value.citation_basis,'none');
      const reference={id:`synthetic:quran:${value.chapter}:${value.ayah_start}-${value.ayah_end}`,label:`Q ${value.chapter}:${value.ayah_start}${value.ayah_end!==value.ayah_start ? '–'+value.ayah_end : ''}`,chapter:value.chapter,ayah_start:value.ayah_start,ayah_end:value.ayah_end};
      verseMaterials.set(id,{...value,id,document_id:a.document_id,text_sha256:a.text_sha256,selected_quote:a.exact,reference,revision:1,review_state:'pending',edition:readingDocument.edition,locator:readingDocument.locator,source_record_id:readingDocument.source_record_id});
      data={id,project_id:value.project_id,revision:1};if(verseLostResponse){verseLostResponse=false;status=503;data={detail:'Synthetic lost verse connection response'};}}
  }
  else if(path==='/v1/verses/material')data=verseMaterials.get(url.searchParams.get('material_id'));
  else if(path==='/v1/verses/annotation-links')data={items:[...verseMaterials.values()].filter(row=>row.annotation_id===url.searchParams.get('annotation_id')),next_cursor:null};
  else if(path==='/v1/verses/materials')data={items:[...verseMaterials.values()].filter(row=>row.project_id===url.searchParams.get('project_id') && row.chapter===Number(url.searchParams.get('chapter')) && row.ayah_start<=Number(url.searchParams.get('ayah_end')) && row.ayah_end>=Number(url.searchParams.get('ayah_start'))),next_cursor:null};
  else if (path==='/v1/reading/documents') data={items:url.searchParams.get('source_record_id')===collectionRecord.id ? [collectionDocument] : url.searchParams.get('source_record_id')===readingDocument.source_record_id ? [readingDocument,comparisonDocument] : [],next_cursor:null};
  else if (path==='/v1/reading/document') data=url.searchParams.get('document_id')===collectionDocument.id ? collectionDocument : url.searchParams.get('document_id')===comparisonDocument.id ? comparisonDocument : readingDocument;
  else if (path==='/v1/reading/annotations' && event.request.method==='POST') {
    const value=JSON.parse(event.request.postData), characters=Array.from(readingDocument.text_body);
    assert.equal(value.text_sha256,readingDocument.text_sha256);
    assert.equal(characters.slice(value.start,value.end).join(''),value.exact);
    assert.equal(value.start,Array.from(readingDocument.text_body.slice(0,readingDocument.text_body.indexOf(value.exact))).length);
    const existing=captures.find(row=>row.id==='urn:research:annotation:'+value.annotation_uuid);
    data=existing || {...value,mark_style:value.mark_style || 'highlight',id:'urn:research:annotation:'+value.annotation_uuid,start_pos:value.start,end_pos:value.end,
      prefix:characters.slice(Math.max(0,value.start-40),value.start).join(''),suffix:characters.slice(value.end,value.end+40).join(''),
      revision:1,created_at:'2026-10-15T00:00:00Z',changed_by:'synthetic-owner'};
    if(existing) {assert.equal(existing.body,value.body);assert.equal(existing.mark_style,value.mark_style);}
    else captures.push(data);
    if(captureLostResponse) {captureLostResponse=false;status=503;data={detail:'Synthetic lost capture response'};}
  }
  else if (path==='/v1/reading/annotations') data={ items:captures,next_cursor:null };
  else if (path==='/v1/reading/annotation' && event.request.method==='PUT') {
    const value=JSON.parse(event.request.postData), index=captures.findIndex(row=>row.id===value.annotation_id && row.project_id===value.project_id);
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    assert.ok(index>=0);
    if(value.expected_revision!==captures[index].revision) {status=409;data={current:captures[index]};}
    else {data={...captures[index],body:value.body,mark_style:value.mark_style || captures[index].mark_style,revision:captures[index].revision+1};captures[index]=data;}
  }
  else if (path==='/v1/reading/annotation') {
    const row=captures.find(c=>c.id===url.searchParams.get('annotation_id'));
    data={annotation:row,anchor:{anchored:true,start:row.start_pos,end:row.end_pos},web_annotation:{ id:row.id,type:'Annotation',
      'ir:scriptureReferences':[...scriptureResolutions.values()].filter(item=>item.annotation_id===row.id) }};
  }
  else if(path==='/v1/reading/scripture-candidates') {
    const row=captures.find(item=>item.id===url.searchParams.get('annotation_id'));
    data={annotation_id:row.id,structure_profile:scriptureStructure,
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
  else if(path==='/v1/lexicon/captures' && event.request.method==='POST') {
    const value=JSON.parse(event.request.postData),previous=lexicalRequests.get(value.request_uuid);
    assert.equal(value.owner_confirmed,true);assert.equal(value.project_id,'synthetic');
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    if(previous) {assert.deepEqual(value,previous.input);data=previous.result;}
    else {
      const annotation=captures.find(row=>row.id===value.annotation_id),word=Array.from(annotation.exact).slice(value.start,value.end).join('');
      const ids=Object.fromEntries(['concept','entry','form','representation','sense','occurrence'].map(kind=>[kind+'_id','synthetic:lexical:'+kind+':'+value.request_uuid]));
      if(value.concept?.mode==='existing')ids.concept_id=value.concept.concept_id;
      if(value.sense_id) {
        const sense=lexicalEntities.get(value.sense_id),representation=lexicalEntities.get(value.representation_id);
        assert.equal(sense.entry_id,representation.entry_id);assert.equal(representation.written_rep,word);
        Object.assign(ids,{concept_id:sense.concept_id,entry_id:sense.entry_id,form_id:representation.form_id,sense_id:sense.id,representation_id:representation.id});
      } else {
        if(value.concept.mode==='new')lexicalConcepts.set(ids.concept_id,{id:ids.concept_id,project_id:'synthetic',kind:'concept',title:value.concept.title,summary:value.concept.scope,attributes:{},revision:1,review_state:'pending'});
        lexicalEntities.set(ids.sense_id,{id:ids.sense_id,project_id:'synthetic',concept_id:ids.concept_id,entry_id:ids.entry_id,scope:value.sense_scope,rationale:value.rationale,state:'active',review_state:'pending',revision:1,entity_kind:'sense',written_rep:word,language_tag:value.entry.language_tag});
        lexicalEntities.set(ids.representation_id,{id:ids.representation_id,project_id:'synthetic',entry_id:ids.entry_id,form_id:ids.form_id,written_rep:word,language_tag:value.entry.language_tag,script_tag:value.entry.script_tag,transliteration_scheme:value.entry.transliteration_scheme,entity_kind:'representation'});
      }
      const representation=lexicalEntities.get(ids.representation_id);
      lexicalEntities.set(ids.occurrence_id,{id:ids.occurrence_id,project_id:'synthetic',concept_id:ids.concept_id,sense_id:ids.sense_id,representation_id:ids.representation_id,annotation_id:annotation.id,
        document_id:annotation.document_id,text_sha256:annotation.text_sha256,term_start:value.start,term_end:value.end,exact:word,rationale:value.rationale,review_state:'pending',state:'active',entity_kind:'occurrence',language_tag:representation.language_tag,script_tag:representation.script_tag});
      lexicalRequests.set(value.request_uuid,{input:value,result:ids});data=ids;
    }
    status=201;if(lexicalLostResponse){lexicalLostResponse=false;status=503;data={detail:'Synthetic lost lexical acknowledgement'};}
  }
  else if(path==='/v1/lexicon/annotation-links') {
    const annotationId=url.searchParams.get('annotation_id');
    data=lexicalPage([...lexicalEntities.values()].filter(row=>row.annotation_id===annotationId && row.state==='active' && ['occurrence','definition'].includes(row.entity_kind)).map(row=>({id:row.id,concept_id:row.concept_id,
      concept_title:lexicalConcepts.get(row.concept_id).title,link_kind:row.entity_kind==='occurrence' ? 'term_occurrence' : 'definition_assertion',definition_kind:row.definition_kind,review_state:'pending'})),url);
  }
  else if(path==='/v1/lexicon/search') {
    const normalize=value=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase(),q=normalize(url.searchParams.get('q'));
    const matching=[...lexicalConcepts.values()].filter(row=>normalize(row.title).includes(q) || [...lexicalEntities.values()].some(item=>(item.concept_id===row.id && item.entity_kind==='sense' && normalize(item.written_rep).includes(q)) || (item.concept_id===row.id && item.entity_kind==='definition' && normalize(item.body).includes(q))));
    data={items:matching.map(row=>{const term=[...lexicalEntities.values()].find(item=>item.concept_id===row.id && item.entity_kind==='sense' && normalize(item.written_rep).includes(q));
      return {...row,match_id:term?.id || row.id,original:term?.written_rep || row.title};}),truncated:false};
  }
  else if(path==='/v1/lexicon/concept') {
    const id=url.searchParams.get('concept_id');data={concept:lexicalConcepts.get(id),definition_gap:![...lexicalEntities.values()].some(row=>row.entity_kind==='definition' && row.concept_id===id && row.definition_kind!=='machine_proposed' && row.state==='active'),coverage:'Synthetic private indexed reading coverage'};
  }
  else if(path==='/v1/lexicon/entity') data=lexicalEntities.get(url.searchParams.get('entity_id'));
  else if(path==='/v1/lexicon/definitions' && event.request.method==='POST') {
    const value=JSON.parse(event.request.postData),id='synthetic:definition:'+value.definition_uuid;
    assert.equal(value.owner_confirmed,true);assert.equal(value.project_id,'synthetic');
    assert.equal(event.request.headers['X-Research-Write'] || event.request.headers['x-research-write'],'1');
    if(value.wording_mode==='quotation')assert.equal(value.body,captures.find(row=>row.id===value.annotation_id).exact);
    data=lexicalEntities.get(id);
    if(data)assert.equal(data.body,value.body);
    else {data={...value,id,revision:1,state:'active',review_state:'pending',entity_kind:'definition'};lexicalEntities.set(id,data);lexicalHistory.set(id,[structuredClone(data)]);}
    status=201;if(definitionLostResponse){definitionLostResponse=false;status=503;data={detail:'Synthetic lost definition acknowledgement'};}
  }
  else if(path==='/v1/lexicon/definition' && event.request.method==='PUT') {
    const value=JSON.parse(event.request.postData),row=lexicalEntities.get(value.definition_id);
    assert.equal(value.owner_confirmed,true);assert.equal(value.project_id,row.project_id);
    const same=['body','attribution','scope','dating_note','rationale','wording_mode'].every(key=>value[key]===row[key]);
    if(row.revision===value.expected_revision+1 && same)data=row;
    else if(row.revision!==value.expected_revision){status=409;data={current:row};}
    else {data={...row,...value,revision:row.revision+1};lexicalEntities.set(row.id,data);lexicalHistory.get(row.id).unshift(structuredClone(data));}
    if(status===200 && definitionUpdateLostResponse){definitionUpdateLostResponse=false;status=503;data={detail:'Synthetic lost correction acknowledgement'};}
  }
  else if(path==='/v1/lexicon/history') {
    const rows=(lexicalHistory.get(url.searchParams.get('entity_id')) || []).filter(row=>row.revision<Number(url.searchParams.get('before_revision') || 2147483647));
    data={items:rows.slice(0,1).map(row=>({entity_id:row.id,revision:row.revision,snapshot:row})),next_before_revision:rows.length>1 ? rows[0].revision : null};
  }
  else if(['/v1/lexicon/definitions','/v1/lexicon/occurrences','/v1/lexicon/senses','/v1/lexicon/representations'].includes(path)) {
    const kind=path.split('/').at(-1).replace(/ies$/,'y').replace(/s$/,''),id=url.searchParams.get('concept_id'),entryId=url.searchParams.get('entry_id');
    data=lexicalPage([...lexicalEntities.values()].filter(row=>row.entity_kind===kind && (!row.state || row.state==='active') && (entryId ? row.entry_id===entryId : row.concept_id===id))
      .map(row=>['definition','occurrence'].includes(kind) ? lexicalSource(row) : row),url);
  }
  else if (path==='/v1/record') data=[...records,collectionRecord,...lexicalConcepts.values(),claim,evidence,{...records[1],id:'synthetic:other',title:'Another synthetic source'}].find(r => r.id===url.searchParams.get('record_id'));
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
  } else if (path==='/v1/evidence-path') data={ project_id:'synthetic',nodes:[...records,claim,evidence],edges:graphEdges,paths:[{ records:[records[0].id,claim.id,evidence.id,records[1].id],edges:['1','2','3'] }],truncated:false };
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
    else if (message.method==='Page.javascriptDialogOpening' && message.params.type==='beforeunload') {unloadPrompts++;call('Page.handleJavaScriptDialog',{accept:true}).catch(error=>problems.push(error.message));}
    else if (message.method==='Runtime.exceptionThrown') problems.push('Unexpected browser runtime exception');
    else if (message.method==='Page.frameNavigated' && !message.params.frame.parentId) navigation++;
  });
  await call('Runtime.enable'); await call('Page.enable'); await call('Fetch.enable',{ patterns:[{ urlPattern:'*/v1/*' }] });
  await call('Page.navigate',{ url:testOrigin+'/workspace.html' });
  await until(() => evaluate('document.querySelectorAll(".workspace-row").length===2'),'project record list');
  await click('All research');
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(() => evaluate('document.querySelector(".workspace-trails")?.textContent.includes("Synthetic section 2, paragraph 3")'),'located question evidence trail');
  assert.match(await evaluate('document.querySelector(".workspace-trails").textContent'),/Synthetic finding about authority/);
  await evaluate('[...document.querySelectorAll(".workspace-trails .evidence-step>button")].at(-1).click()');
  await until(() => evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic source")'),'open source from evidence trail');
  await until(() => evaluate('!!document.querySelector("[data-record-note]")'),'source reading notes');
  assert.equal(await evaluate('document.querySelectorAll(".workspace-record-heading script").length'),0);
  await until(()=>evaluate('!!document.querySelector(".reader-text")'),'private passage reader');
  assert.equal(await evaluate('!!document.querySelector("#atlas-library .workspace-tools")'),false,'occasional tools leave the sidebar');
  assert.equal(await evaluate('!!document.querySelector(".atlas-project-branch .atlas-primary-nav")'),true,'project contains its research navigation');
  await evaluate(`{window.__retainedReader=document.querySelector('.reader-text');const range=document.createRange();range.selectNodeContents(window.__retainedReader);range.setEnd(range.startContainer,0);const node=window.__retainedReader.querySelector('span')?.firstChild || window.__retainedReader.firstChild;const walker=document.createTreeWalker(window.__retainedReader,NodeFilter.SHOW_TEXT);const first=walker.nextNode();range.setStart(first,0);range.setEnd(first,2);getSelection().removeAllRanges();getSelection().addRange(range);document.querySelector('#workspace-view').scrollTop=100;window.__readingTabScroll=document.querySelector('#workspace-view').scrollTop;}`);
  await click('Notes');await until(()=>evaluate('!!document.querySelector(".notebook-heading")'),'notes workspace');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".notebook-heading h2")).fontSize'),'16px','full workspace preserves compact explorer heading');
  assert.equal(await evaluate('document.querySelector(".notebook-tools").open'),false);
  await writeFile(join(artifacts,'compact-notebook-full-app.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await click('New note');
  await evaluate('document.querySelector(".notebook-note-title input").focus()');await call('Input.insertText',{text:'Synthetic working note'});
  await evaluate('document.querySelector(".notebook-note-body textarea").focus()');await call('Input.insertText',{text:'An unfinished thought kept while reading.'});
  await evaluate('window.__retainedNote=document.querySelector(".notebook-note-title input");true');
  await click('Questions');await until(()=>evaluate('!!document.querySelector(".notebook-heading")'),'questions workspace');await click('New question');
  await evaluate('document.querySelector(".notebook-note-title textarea").focus()');await call('Input.insertText',{text:'Synthetic working question?'});
  await evaluate(`[...document.querySelectorAll('.working-tab>button:first-child')].find(button=>button.querySelector('small')?.textContent==='Note').click()`);
  await until(()=>evaluate('document.querySelector(".notebook-note-title input")?.value==="Synthetic working note"'),'note draft retained across question tab');
  assert.equal(await evaluate('document.querySelector(".notebook-note-title input")===window.__retainedNote'),true,'note editor stays mounted');
  assert.match(await evaluate('document.querySelector(".notebook-note-body textarea").value'),/unfinished thought/);
  await evaluate(`[...document.querySelectorAll('.working-tab>button:first-child')].find(button=>button.querySelector('span')?.textContent.includes('Synthetic source')).click()`);
  await until(()=>evaluate('document.querySelector(".reader-text")===window.__retainedReader'),'reader stays mounted across tabs');
  await until(()=>evaluate('getSelection().toString().length>0'),'source text selection restored');
  assert.equal(await evaluate('document.querySelector("#workspace-view").scrollTop'),await evaluate('window.__readingTabScroll'),'reading scroll restored');
  await evaluate('getSelection().removeAllRanges()');
  await evaluate(`[...document.querySelectorAll('.working-tab>button:first-child')].find(button=>button.querySelector('small')?.textContent==='Note').click()`);
  await until(()=>evaluate('!!document.querySelector(".notebook-note-title input")'),'note tab before closing');
  await evaluate(`[...document.querySelectorAll('.working-tab')].find(tab=>tab.querySelector('small')?.textContent==='Note').querySelector('.working-tab-close').click()`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.working-tab small')].some(node=>node.textContent==='Note')`),true,'unfinished note tab stays accessible instead of losing work');
  await click('Notes');await until(()=>evaluate('document.querySelector(".notebook-note-title input")?.value==="Synthetic working note"'),'closed note draft reopens without loss');
  assert.match(await evaluate('document.querySelector(".notebook-note-body textarea").value'),/unfinished thought/);
  await until(()=>evaluate('!document.querySelector(".notebook-editor-toolbar button").disabled'),'reopened note ready to save');
  holdNoteSave=true;await evaluate('document.querySelector(".notebook-editor-toolbar button").click()');
  try{await until(()=>releaseNoteSave,'pending notebook save');}catch(error){throw new Error(error.message+' · '+JSON.stringify({notes:independentNotes.size,problems,ui:await evaluate('document.querySelector(".research-notebook")?.innerText')}));}
  await evaluate(`[...document.querySelectorAll('.working-tab>button:first-child')].find(button=>button.querySelector('span')?.textContent.includes('Synthetic source')).click()`);
  await until(()=>evaluate('document.querySelector(".reader-text")===window.__retainedReader'),'return to retained reading after closing a note');
  const readingURL=await evaluate('location.href');releaseNoteSave();
  await until(()=>evaluate(`[...window.document.querySelectorAll('.working-surface[hidden] .notebook-editor-toolbar>span')].some(node=>node.textContent==='Saved · revision 1')`),'save completes in background notebook');
  assert.equal(await evaluate('location.href'),readingURL,'background notebook save cannot redirect the active source');
  // Reproduce user-reported sizing failure in the full workspace CSS cascade.
  const originalSource=await evaluate('document.querySelector(".reader-text").textContent');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize'),'22px');
  const renderedBefore=await evaluate('{const r=document.createRange();r.selectNodeContents(document.querySelector(".reader-text"));r.getBoundingClientRect().height}');
  await evaluate('document.querySelector(".reading-appearance-panel").open=true');
  const sizeButton=await evaluate(`{const b=document.querySelector('[aria-label="Increase source text size"]');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();({x:r.left+r.width/2,y:r.top+r.height/2})}`);
  await call('Input.dispatchMouseEvent',{type:'mouseMoved',...sizeButton});
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...sizeButton});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...sizeButton});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize'),'24px');
  await evaluate('document.querySelector(".reading-appearance-panel").open=true');
  await evaluate(`{const f=document.querySelector('input[aria-label="Reading zoom"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(f,180);f.dispatchEvent(new Event('input',{bubbles:true}));f.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize==="43.2px"'),'full-workspace zoom changes rendered source');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-margin .location-margin-composer textarea")).fontSize'),'30.6px','zoom enlarges actual notes too');
  const renderedAfter=await evaluate('{const r=document.createRange();r.selectNodeContents(document.querySelector(".reader-text"));r.getBoundingClientRect().height}');
  assert.ok(renderedAfter>renderedBefore,'glyph layout grows, not just a counter or CSS variable');
  assert.equal(await evaluate('document.querySelector(".reader-text").textContent'),originalSource);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-text")).fontSize'),'43.2px','mobile stylesheet cannot override reading preference');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await click('Reset reading preferences');await evaluate('document.querySelector(".reading-appearance-panel").open=false');
  await call('Emulation.clearDeviceMetricsOverride');
  assert.equal(await evaluate('document.querySelector(".reader-edition-details").open'),false);
  await evaluate('document.querySelector(".reader-edition-details summary").click()');
  assert.equal(await evaluate('document.querySelector(".reader-source-notice pre").textContent'),readingDocument.source_notice);
  assert.equal(await evaluate('document.querySelectorAll(".reader-source-notice b").length'),0);
  await evaluate('document.querySelector(".reader-edition-details summary").click()');
  // Compare actual immutable version identities independently and restore them from URL.
  await click('Compare readings');
  await until(()=>evaluate('document.querySelectorAll(".comparison-pane").length===2'),'independent comparison panes');
  assert.equal(await evaluate('document.querySelector(".skip-link").getAttribute("href")'), '#workspace-view');
  assert.ok(await evaluate('!!document.querySelector("#workspace-view")'));
  await until(()=>evaluate('[...document.querySelectorAll(".comparison-pane")[1].querySelector("select").options].some(option=>option.value==="synthetic:source")'),'comparison source choices loaded');
  await evaluate(`{const select=document.querySelectorAll('.comparison-pane')[1].querySelector('select');select.value='synthetic:source';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate('document.querySelectorAll(".comparison-text").length===2'),'both source versions loaded');
  await evaluate(`{const select=document.querySelectorAll('.comparison-pane')[1].querySelectorAll('select')[1];select.value='synthetic:comparison';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate('document.querySelectorAll(".comparison-text")[1]?.textContent.includes("different rendering")'),'contrasting edition');
  assert.equal(await evaluate('document.querySelectorAll(".comparison-text")[0].textContent'),readingDocument.text_body);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await writeFile(join(artifacts,'comparison-mobile.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await call('Emulation.clearDeviceMetricsOverride');

  await reload();
  await until(()=>evaluate('document.querySelectorAll(".comparison-text")[1]?.textContent.includes("different rendering")'),'comparison URL reload');
  await evaluate(`{const select=document.querySelectorAll('.comparison-pane')[1].querySelector('select');select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate('!new URL(location.href).searchParams.has("right_source") && !new URL(location.href).searchParams.has("right_document")'),'cleared comparison removes stale URL target');
  await reload();
  await until(()=>evaluate('document.querySelectorAll(".comparison-pane")[1]?.querySelector("select").value==="" && document.querySelectorAll(".comparison-text").length===1'),'cleared comparison stays empty after reload');

  await click('Back to my reading');
  await until(()=>evaluate('!!document.querySelector(".reader-text")'),'return from comparison to source');
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
  await until(()=>[...recoveryCopies.values()].some(row=>row.context_kind==='capture'&&row.body.includes('Synthetic anchored term note')&&row.state==='active'),'automatic capture recovery acknowledged');
  const captureRecovery=[...recoveryCopies.values()].find(row=>row.context_kind==='capture'&&row.body.includes('Synthetic anchored term note')&&row.state==='active');
  await evaluate(`{const select=[...document.querySelectorAll('.reader-capture label')].find(label=>label.textContent.startsWith('Capture as')).querySelector('select');select.value='term_candidate';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>recoveryCopies.get(captureRecovery.id)?.capture_kind==='term_candidate','pending classification updated under same recovery ID');
  await evaluate(`{const select=[...document.querySelectorAll('.reader-capture label')].find(label=>label.textContent.startsWith('Capture as')).querySelector('select');select.value='comment';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>recoveryCopies.get(captureRecovery.id)?.capture_kind==='comment','capture classification restored without a duplicate recovery');
  assert.equal([...recoveryCopies.values()].filter(row=>row.context_kind==='capture'&&row.body.includes('Synthetic anchored term note')).length,1);
  await evaluate('document.querySelector(".reader-capture button").click()');
  await until(()=>evaluate('document.querySelector(".reader-annotations")?.textContent.includes("Synthetic anchored term note")'),'persisted passage note');
  assert.equal(captures.length,1);
  await evaluate('document.querySelector(".reader-reopen").click()');
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'reopen exact passage');
  await click('All research');await reveal('.workspace-search');
  await evaluate(`const scope=document.querySelector('.workspace-search select');
    scope.value='annotations'; scope.dispatchEvent(new Event('change',{bubbles:true}));
    document.querySelector('.workspace-query input').focus();`);
  await call('Input.insertText',{text:'anchored'});
  await evaluate('document.querySelector(".workspace-search").requestSubmit()');
  await until(()=>evaluate('!!document.querySelector(".workspace-passage-hit")'),'private annotation search result');
  await evaluate('document.querySelector(".workspace-passage-hit").click()');
  await until(()=>evaluate('new URLSearchParams(location.search).has("annotation") && document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'search opens exact saved passage');
  await reload();
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'annotation bookmark survives reload');
  await click('Compare readings');
  await until(()=>evaluate('!!document.querySelector(".comparison-pane")'),'comparison from saved passage');
  await click('Back to my reading');
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'comparison return preserves exact origin passage');

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
  await revealPassageTools();
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle:not([aria-expanded=true])")?.click()');
  const citationSelector='[data-candidate-key="'+'c'.repeat(64)+'"]';
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(citationSelector)})`),'located reference candidate');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' textarea')}).focus()`);
  await call('Input.insertText',{text:'Synthetic owner reference resolution'});
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(()=>evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic question")'),'leave reference draft');
  await evaluate('document.querySelectorAll(".workspace-row")[1].click()');
  await until(()=>evaluate('document.querySelectorAll(".scripture-toggle").length===2'),'return to reference source');
  await revealPassageTools();
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle:not([aria-expanded=true])")?.click()');
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' textarea')})?.value==='Synthetic owner reference resolution'`),'reference draft retained');
  await evaluate(`{const field=document.querySelector(${JSON.stringify(citationSelector)}).querySelectorAll('input')[2];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'177');field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' [role=alert]')})?.textContent.includes('valid surah and ayah range')`),'invalid verse bounds explain the correction');
  assert.equal(scriptureResolutions.size,0);
  await evaluate(`{const field=document.querySelector(${JSON.stringify(citationSelector)}).querySelectorAll('input')[2];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'59');field.dispatchEvent(new Event('input',{bubbles:true}));}`);
  scriptureLostResponse=true;
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' [role=alert]')})?.textContent.includes('draft is still here')`),'lost acknowledgement keeps reference draft');
  await evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-confirm')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(citationSelector+' .scripture-saved')})?.textContent.includes('revision 1')`),'idempotent reference retry');
  assert.equal([...scriptureResolutions.values()][0].revision,1);
  await reload();
  await until(()=>evaluate('document.querySelectorAll(".scripture-toggle").length===2'),'saved reference reload');
  await revealPassageTools();
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle:not([aria-expanded=true])")?.click()');
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
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="Q 4:59"'),'reverse lookup opens exact saved passage');
  await revealPassageTools();
  await evaluate('[...document.querySelectorAll(".saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="Q 4:59").querySelector(".scripture-toggle:not([aria-expanded=true])")?.click()');
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
  await revealPassageTools();
  await evaluate('[...document.querySelectorAll(".working-surface:not([hidden]) .saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="tafsīr").querySelector(".scripture-toggle:not([aria-expanded=true])")?.click()');
  const termManual='[...document.querySelectorAll(".working-surface:not([hidden]) .saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="tafsīr").querySelector("[data-candidate-key=manual]")';
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
  const termLexicon='[...document.querySelectorAll(".working-surface:not([hidden]) .saved-passage-note")].find(node=>node.querySelector(".reader-reopen").textContent==="tafsīr").querySelector(".lexicon-capture")';
  async function fillLexicon(selector,text) {
    await evaluate(`${termLexicon}.querySelector(${JSON.stringify(selector)}).focus();${termLexicon}.querySelector(${JSON.stringify(selector)}).select()`);
    await call('Input.insertText',{text});
  }
  async function chooseLexicon(selector,value) {
    await evaluate(`{const node=${termLexicon}.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));}`);
  }
  await revealPassageTools();
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'source reference tools ready');
  await evaluate(`${termLexicon}.querySelector('.lexicon-toggle:not([aria-expanded=true])')?.click()`);
  await until(()=>evaluate(`!!${termLexicon}.querySelector('.lexicon-concept-title')`),'term-to-concept authoring form');
  await fillLexicon('.lexicon-concept-title','Synthetic scoped concept <script>not HTML</script>');
  await fillLexicon('.lexicon-concept-scope','An owner scope note, not a sourced definition.');
  await fillLexicon('.lexicon-scope','Synthetic source-specific reading context.');
  await fillLexicon('.lexicon-rationale','Synthetic explicit reason to connect this exact word.');
  await fillLexicon('.lexicon-language input','ar-Latn');
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(()=>evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic question")'),'leave lexical creation draft');
  await evaluate('document.querySelectorAll(".workspace-row")[1].click()');
  await until(()=>evaluate(`!!${termLexicon}`),'return to captured lexical term');
  await revealPassageTools();
  assert.match(await evaluate(`${termLexicon}.querySelector('.lexicon-toggle').textContent`),/unsaved draft/);
  await revealPassageTools();
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'source reference tools ready');
  await evaluate(`${termLexicon}.querySelector('.lexicon-toggle:not([aria-expanded=true])')?.click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-scope')?.value==='Synthetic source-specific reading context.'`),'lexical draft survives record navigation');
  lexicalLostResponse=true;
  await evaluate(`${termLexicon}.querySelector('.lexicon-save').click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-save')?.textContent==='Retry exact save'`),'lost lexical acknowledgement retains exact creation request');
  assert.equal(lexicalConcepts.size,1);
  assert.equal(await evaluate(`${termLexicon}.querySelector('.lexicon-author fieldset').disabled`),true);
  await evaluate(`${termLexicon}.querySelector('.lexicon-save').click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-message')?.textContent.includes('Saved privately')`),'lexical retry verified against the source occurrence');
  assert.equal(lexicalRequests.size,1);
  await reload();
  await until(()=>evaluate(`!!${termLexicon}`),'reading source reload after lexical capture');
  await revealPassageTools();
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'source reference tools ready');
  await evaluate(`${termLexicon}.querySelector('.lexicon-toggle:not([aria-expanded=true])')?.click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-links button')?.textContent.includes('Synthetic scoped concept')`),'durable passage-to-concept link recovered');
  await evaluate(`${termLexicon}.querySelector('.lexicon-links button').click()`);
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-definition-gap")'),'concept page shows a definition gap');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-occurrences mark")?.textContent==="tafsīr"'),'concept occurrence preserves exact accented term');
  assert.equal(await evaluate('document.querySelectorAll(".working-surface:not([hidden]) .concept-panel script").length'),0);
  await reload();
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-definition-gap")'),'concept URL survives reload');
  const lexicalConcept=[...lexicalConcepts.values()][0];
  const machine={id:'synthetic:machine-proposal',project_id:'synthetic',concept_id:lexicalConcept.id,annotation_id:captures[0].id,entity_kind:'definition',definition_kind:'machine_proposed',
    wording_mode:'paraphrase',body:'Synthetic machine proposal, not an accepted definition.',attribution:'Synthetic tool output',scope:'Only a fixture proposal',dating_note:'Unknown',
    rationale:'Synthetic proposal evidence is unreviewed',proposal_tool:'synthetic-tool',proposal_version:'1',proposal_activity:'synthetic:activity',review_state:'pending',state:'active',revision:1};
  lexicalEntities.set(machine.id,machine);lexicalHistory.set(machine.id,[structuredClone(machine)]);
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-panel-heading button").click()');
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-machine-proposals")'),'machine proposal remains separated');
  assert.equal(await evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-definition-gap")'),true);
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-occurrence-source").click()');
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'concept occurrence returns to the exact source passage');
  await revealPassageTools();
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'source reference tools ready');
  await evaluate(`${termLexicon}.querySelector('.lexicon-toggle:not([aria-expanded=true])')?.click()`);
  await until(()=>evaluate(`!!${termLexicon}.querySelector('.lexicon-mode')`),'definition action selector');
  await chooseLexicon('.lexicon-mode','definition');
  await fillLexicon('.lexicon-find input','Synthetic scoped');
  await evaluate(`${termLexicon}.querySelector('.lexicon-find button').click()`);
  await until(()=>evaluate(`!!${termLexicon}.querySelector('.lexicon-search-results button')`),'find existing scoped concept');
  await evaluate(`${termLexicon}.querySelector('.lexicon-search-results button').click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-choice')?.textContent.includes('Synthetic scoped concept')`),'explicit concept selection for definition');
  await chooseLexicon('.lexicon-definition-kind','reference_gloss');
  await fillLexicon('.lexicon-definition-body','A synthetic reference gloss with explicitly limited scope.');
  await fillLexicon('.lexicon-attribution','Synthetic reference author');
  await fillLexicon('.lexicon-scope','Only the synthetic passage and selected reference.');
  await fillLexicon('.lexicon-rationale','Synthetic located support, pending scholarly review.');
  await chooseLexicon('.lexicon-wording-mode','quotation');
  await evaluate(`${termLexicon}.querySelector('.lexicon-save').click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-message')?.textContent.includes('quotation must match')`),'edited wording cannot masquerade as a quotation');
  assert.equal([...lexicalEntities.values()].filter(row=>row.entity_kind==='definition').length,1);
  await chooseLexicon('.lexicon-wording-mode','paraphrase');definitionLostResponse=true;
  await evaluate(`${termLexicon}.querySelector('.lexicon-save').click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-save')?.textContent==='Retry exact save'`),'lost definition acknowledgement retains original request');
  await evaluate(`${termLexicon}.querySelector('.lexicon-save').click()`);
  await until(()=>evaluate(`${termLexicon}.querySelector('.lexicon-message')?.textContent.includes('Saved privately')`),'definition creation retry is idempotent');
  assert.equal([...lexicalEntities.values()].filter(row=>row.entity_kind==='definition' && row.definition_kind==='reference_gloss').length,1);
  await revealPassageTools();
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'source reference tools ready');
  await evaluate(`${termLexicon}.querySelector('.lexicon-toggle:not([aria-expanded=true])')?.click()`);
  await until(()=>evaluate(`!!${termLexicon}.querySelector('.lexicon-links button')`),'definition passage link reload');
  await evaluate(`${termLexicon}.querySelector('.lexicon-links button').click()`);
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-text")?.textContent.includes("synthetic reference gloss")'),'located attributed definition visible');
  assert.equal(await evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-definition-gap")'),false);
  assert.match(await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition").textContent'),/Synthetic reference author/);
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-panel > button").click()');
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-machine-proposals")'),'definition pagination retains the separate machine proposal');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-open").click()');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-body").focus();document.querySelector(".working-surface:not([hidden]) .concept-edit-body").select()');
  await call('Input.insertText',{text:'My corrected synthetic reading of the source.'});
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-rationale").focus();document.querySelector(".working-surface:not([hidden]) .concept-edit-rationale").select()');
  await call('Input.insertText',{text:'Synthetic correction after checking source context.'});
  referenceDelay=true;
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-source").click()');
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'leave definition correction draft');
  await revealPassageTools();
  await until(()=>evaluate(`!!${termLexicon} && ${termLexicon}.closest('.source-reader').getAttribute('aria-busy')==='false'`),'source reference tools ready');
  await evaluate(`${termLexicon}.querySelector('.lexicon-toggle:not([aria-expanded=true])')?.click()`);
  await until(()=>evaluate(`!!${termLexicon}.querySelector('.lexicon-links button')`),'reopen concept through durable passage link');
  await evaluate(`${termLexicon}.querySelector('.lexicon-links button').click()`);
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-body")?.value.includes("My corrected synthetic reading")'),'definition draft retained through source navigation');
  referenceDelay=false;assert.ok(delayedReferenceRequests.includes('/v1/record'),'reference navigation exercised delayed record loading');
  const recordedDefinition=[...lexicalEntities.values()].find(row=>row.entity_kind==='definition' && row.definition_kind==='reference_gloss');
  const cloudDefinition={...recordedDefinition,body:'Cloud definition edit from another device.',rationale:'Synthetic cloud rationale',revision:2};
  lexicalEntities.set(recordedDefinition.id,cloudDefinition);lexicalHistory.get(recordedDefinition.id).unshift(structuredClone(cloudDefinition));
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-save").click()');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-conflict")?.textContent.includes("Cloud definition edit")'),'definition conflict compares current cloud content');
  assert.match(await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-body").value'),/My corrected synthetic reading/);
  await evaluate('document.querySelectorAll(".working-surface:not([hidden]) .concept-definition-conflict button")[1].click()');
  definitionUpdateLostResponse=true;
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-save").click()');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-edit [role=alert]")?.textContent.includes("draft is retained")'),'lost correction response preserves typed definition');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-save").click()');
  await until(()=>evaluate('!document.querySelector(".working-surface:not([hidden]) .concept-edit-body") && document.querySelector(".working-surface:not([hidden]) .concept-definition-text")?.textContent.includes("My corrected synthetic reading")'),'explicit correction saved against the confirmed revision');
  assert.equal(lexicalEntities.get(recordedDefinition.id).revision,3);
  assert.equal(lexicalHistory.get(recordedDefinition.id).length,3);
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-history-open").click()');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-history")?.textContent.includes("Revision 3")'),'definition revision history');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-history button").click()');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-history")?.textContent.includes("Cloud definition edit")'),'earlier cloud revision retained in history');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-open").click()');
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-edit-body")'),'reopen definition correction for withdrawal comparison');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-body").focus();document.querySelector(".working-surface:not([hidden]) .concept-edit-body").select()');
  await call('Input.insertText',{text:'A local draft while another device withdraws the assertion.'});
  const withdrawnDefinition={...lexicalEntities.get(recordedDefinition.id),state:'withdrawn',rationale:'Withdrawn from another synthetic owner client for review.',revision:4};
  lexicalEntities.set(recordedDefinition.id,withdrawnDefinition);lexicalHistory.get(recordedDefinition.id).unshift(structuredClone(withdrawnDefinition));
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-edit-save").click()');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-conflict")?.textContent.includes("withdrawn")'),'remote withdrawal is visible during conflict comparison');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-conflict button").click()');
  assert.equal(lexicalEntities.get(recordedDefinition.id).state,'withdrawn');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-panel-heading button").click()');
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-definition-gap") && document.querySelectorAll(".working-surface:not([hidden]) .concept-panel > .concept-definition").length===0'),'withdrawn assertion leaves the active definition gap visible');
  // Another authorized client can explicitly restore via the existing owner API;
  // the reader itself never silently reactivates a withdrawn assertion.
  const restoredDefinition={...withdrawnDefinition,state:'active',rationale:'Explicitly restored in a second synthetic owner client.',revision:5};
  lexicalEntities.set(recordedDefinition.id,restoredDefinition);lexicalHistory.get(recordedDefinition.id).unshift(structuredClone(restoredDefinition));
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-panel-heading button").click()');
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-text")?.textContent.includes("My corrected synthetic reading")'),'explicit remote reactivation can be refreshed');
  await reload();
  await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) .concept-definition-text")?.textContent.includes("My corrected synthetic reading")'),'corrected definition persists on reload');
  const lexicalDesktop=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'lexicon-desktop.png'),Buffer.from(lexicalDesktop.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate('[...document.querySelectorAll(".header-tools button")].find(button=>/^(Dark|Light) mode$/.test(button.textContent)).click();document.querySelector(".working-surface:not([hidden]) .concept-panel").scrollIntoView({block:"start"})');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'lexicon concept fits dark mobile layout');
  const lexicalMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'lexicon-mobile-dark.png'),Buffer.from(lexicalMobile.data,'base64'));
  await evaluate('[...document.querySelectorAll(".header-tools button")].find(button=>/^(Dark|Light) mode$/.test(button.textContent)).click()');
  await call('Emulation.clearDeviceMetricsOverride');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-source").click()');
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'corrected definition source remains unchanged');
  async function captureWord(word) {
    await evaluate(`{const walker=document.createTreeWalker(document.querySelector('.reader-text'),NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode()) && !node.textContent.includes(${JSON.stringify(word)})){}
      const offset=node.textContent.indexOf(${JSON.stringify(word)}),range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+${word.length});
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.querySelector('.reader-select').click();}`);
    await until(()=>evaluate('!!document.querySelector(".reader-capture button")'),'new located word capture');
    const before=captures.length;await evaluate('document.querySelector(".reader-capture button").click()');
    await until(()=>captures.length===before+1 && evaluate(`!!document.querySelector('[data-annotation-id="${captures.at(-1)?.id}"]')`),'new captured term saved');
    return `[data-annotation-id=${JSON.stringify(captures.at(-1).id)}] .lexicon-capture`;
  }
  const repeatedTerm=await captureWord('tafsīr');
  await revealPassageTools();
  await evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-toggle:not([aria-expanded=true])')}).click()`);
  async function fillAt(rootSelector,selector,text) {
    await evaluate(`document.querySelector(${JSON.stringify(rootSelector+' '+selector)}).focus();document.querySelector(${JSON.stringify(rootSelector+' '+selector)}).select()`);
    await call('Input.insertText',{text});
  }
  await fillAt(repeatedTerm,'.lexicon-find input','Synthetic scoped');
  await evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-find button')}).click()`);
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-search-results button')})`),'reuse concept search');
  await evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-search-results button')}).click()`);
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-author details button')})`),'recorded entry choice');
  await evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-author details')}).open=true;document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-author details button')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-author details select')})?.options.length===2`),'exact recorded spelling available');
  await evaluate(`{const select=document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-author details select')});select.value=select.options[1].value;select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await fillAt(repeatedTerm,'.lexicon-rationale','Explicitly reuse the recorded entry and scoped meaning.');
  await evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-save')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(repeatedTerm+' .lexicon-message')})?.textContent.includes('Saved privately')`),'existing lexical sense reused without a duplicate concept');
  assert.equal(lexicalConcepts.size,1);assert.equal([...lexicalEntities.values()].filter(row=>row.entity_kind==='sense').length,1);
  const arabicTerm=await captureWord('التفسير');
  await revealPassageTools();
  await evaluate(`document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-toggle:not([aria-expanded=true])')}).click()`);
  await fillAt(arabicTerm,'.lexicon-find input','Synthetic scoped');
  await evaluate(`document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-find button')}).click()`);
  await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-search-results button')})`),'explicit concept mapping for Arabic form');
  await evaluate(`document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-search-results button')}).click()`);
  await fillAt(arabicTerm,'.lexicon-language input','ar');
  await fillAt(arabicTerm,'.lexicon-language label:nth-child(2) input','Arab');
  await fillAt(arabicTerm,'.lexicon-scope','An explicitly scoped Arabic reading, not automatic equivalence.');
  await fillAt(arabicTerm,'.lexicon-rationale','Synthetic owner explicitly links this original Arabic wording.');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-source-quote')}).getAttribute('dir')`),'auto');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`[...document.querySelectorAll('.header-tools button')].find(button=>/^(Dark|Light) mode$/.test(button.textContent)).click();document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-source-quote')}).scrollIntoView({block:'start'})`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-source-quote')})).direction`),'rtl');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Arabic concept capture fits mobile');
  const arabicMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'lexicon-arabic-mobile-dark.png'),Buffer.from(arabicMobile.data,'base64'));
  await evaluate('[...document.querySelectorAll(".header-tools button")].find(button=>/^(Dark|Light) mode$/.test(button.textContent)).click()');await call('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-save')}).click()`);
  await until(()=>evaluate(`document.querySelector(${JSON.stringify(arabicTerm+' .lexicon-message')})?.textContent.includes('Saved privately')`),'Arabic original wording and scoped connection saved');
  assert.equal([...lexicalEntities.values()].filter(row=>row.entity_kind==='sense').length,2);
  assert.ok([...lexicalEntities.values()].some(row=>row.entity_kind==='representation' && row.written_rep==='التفسير' && row.language_tag==='ar'));
  await click('All research');await reveal('.workspace-search');
  await evaluate(`{const scope=document.querySelector('.workspace-search select');scope.value='lexicon';scope.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.workspace-query input').focus();document.querySelector('.workspace-query input').select();}`);
  await call('Input.insertText',{text:'tafsir'});
  await evaluate('document.querySelector(".workspace-search").requestSubmit()');
  await until(()=>evaluate('document.querySelector(".workspace-row")?.textContent.includes("Matched wording")'),'normalized concept search from workspace');
  assert.match(await evaluate('document.querySelector(".workspace-row").textContent'),/tafsīr/);
  await evaluate('document.querySelector(".workspace-row").click()');
  await until(()=>evaluate('!!document.querySelector(".working-surface:not([hidden]) .concept-panel") && !!document.querySelector(".working-surface:not([hidden]) .concept-occurrences button")'),'open concept from lexical match');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-occurrences > button").click()');
  await until(()=>evaluate('document.querySelectorAll(".working-surface:not([hidden]) .concept-occurrences article").length===2'),'reading occurrence pagination');
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-occurrences > button").click()');
  await until(()=>evaluate('document.querySelectorAll(".working-surface:not([hidden]) .concept-occurrences article").length===3'),'last reading occurrence page');
  assert.ok(await evaluate('[...document.querySelectorAll(".working-surface:not([hidden]) .concept-occurrences mark")].some(node=>node.textContent==="التفسير")'),'Arabic occurrence remains original in the concept reading view');
  await click('All research');await reveal('.workspace-search');
  await evaluate(`{const scope=document.querySelector('.workspace-search select');scope.value='all';scope.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await evaluate('document.querySelector(".workspace-search").requestSubmit()');
  await until(()=>evaluate('document.querySelectorAll(".workspace-row").length===3'),'all-research search includes ordinary and lexical matches');
  assert.equal(await evaluate('[...document.querySelectorAll(".workspace-row")].filter(node=>node.textContent.includes("Synthetic scoped concept")).length'),1);
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("Synthetic scoped") || value.includes("My corrected synthetic") || value.includes("explicitly scoped Arabic"))'),false);
  await evaluate('document.querySelector(".working-surface:not([hidden]) .concept-source").click()');
  await until(()=>evaluate('document.querySelector(".reader-text mark.is-selected")?.textContent==="tafsīr"'),'definition follows its exact attributed source');
  await reload();
  await until(()=>evaluate('!!document.querySelector("[data-record-note]")'),'resume existing reading workflow after lexical navigation');
  // Real compiled reader interactions; intercepted transport remains synthetic.
  // PostgreSQL/API tests separately exercise the same anchored style contract.
  await until(()=>evaluate('document.querySelectorAll(".reader-text mark[role=button]").length>=3'),'all saved annotations rendered as persistent source marks');
  assert.equal(await evaluate('document.querySelector(".reader-text").textContent'),readingDocument.text_body);
  const beforeOverlap=captures.length;
  await evaluate(`{const root=document.querySelector('.reader-text'),text=root.textContent,start=text.indexOf('Before tafsīr'),end=start+'Before tafsīr'.length;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),range=document.createRange();let node,total=0,started=false;
    while((node=walker.nextNode())) {const next=total+node.textContent.length;
      if(!started && start>=total && start<next) {range.setStart(node,start-total);started=true;}
      if(started && end<=next) {range.setEnd(node,end-total);break;}total=next;}
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    document.querySelector('.reader-underline').click();}`);
  await until(()=>evaluate('document.querySelector(".reader-capture textarea")===document.activeElement'),'selection opens adjacent margin composer');
  assert.equal(await evaluate('document.querySelector(".reader-capture select").value'),'underline');
  await call('Input.insertText',{text:'My synthetic margin note crossing an existing marked word.'});
  captureLostResponse=true;
  await evaluate('document.querySelector(".reader-capture button").click()');
  await until(()=>evaluate('document.querySelector(".reader-capture button")?.textContent==="Retry original save"'),'uncertain capture preserves original request');
  assert.equal(captures.length,beforeOverlap+1);
  assert.equal(await evaluate('document.querySelector(".reader-capture textarea").disabled'),true);
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');
  await until(()=>evaluate('!document.querySelector(".reader-text")'),'leave uncertain capture');
  await evaluate('document.querySelectorAll(".workspace-row")[1].click()');
  await until(()=>evaluate('document.querySelector(".reader-capture button")?.textContent==="Retry original save"'),'uncertain margin draft survives record navigation');
  await evaluate('document.querySelector(".reader-capture button").click()');
  await until(()=>evaluate('!document.querySelector(".reader-capture")'),'original capture retry confirmed');
  assert.equal(captures.length,beforeOverlap+1);
  const marginId=captures.at(-1).id;
  assert.equal(captures.at(-1).mark_style,'underline');
  await reload();
  await until(()=>evaluate('!!document.querySelector(".reader-text mark.has-overlap.has-underline")'),'overlapping underline survives reload');
  assert.equal(await evaluate('document.querySelector(".reader-text").textContent'),readingDocument.text_body);
  await evaluate('[...document.querySelectorAll(".reader-text mark")].find(node=>node.textContent==="Before ").click()');
  await until(()=>evaluate(`document.activeElement===document.querySelector('[data-annotation-id="${marginId}"]')`),'click source mark focuses its saved margin note');
  await evaluate(`document.querySelector('[data-annotation-id="${marginId}"] .reader-reopen').click()`);
  await until(()=>evaluate('document.activeElement===document.querySelector(".reader-text")'),'note quotation returns keyboard focus to source');
  assert.equal(await evaluate('[...document.querySelectorAll(".reader-text mark.is-selected")].map(node=>node.textContent).join("")'),'Before tafsīr');
  assert.equal(await evaluate('new URLSearchParams(location.search).get("annotation")'),marginId);
  assert.equal(await evaluate('new URLSearchParams(location.search).get("document")'),readingDocument.id);
  await reveal('.reading-place');
  await until(()=>evaluate('[...document.querySelectorAll(".reading-place button")].some(button=>button.textContent==="Bookmark this passage" && !button.disabled)'),'saved annotation is bookmarkable');
  await click('Bookmark this passage');
  await until(()=>evaluate('document.querySelector(".reading-place").textContent.includes("not confirmed")'),'bookmark response lost after commit');
  assert.equal(readingDesk.revision,1);assert.equal(readingDesk.annotation_id,marginId);
  await click('Retry original bookmark');await until(()=>evaluate('document.querySelector(".reading-place").textContent.includes("revision 1")'),'exact bookmark retry confirmed');
  assert.deepEqual(deskRequests[0],deskRequests[1]);assert.equal(readingDesk.revision,1);
  await reload();await until(()=>evaluate('!!document.querySelector(".reader-text mark.is-selected")'),'saved source reloaded');
  await evaluate('document.querySelectorAll(".workspace-row")[0].click()');await until(()=>evaluate('!document.querySelector(".reader-text")'),'leave bookmarked reading');
  await click('Resume saved reading');await until(()=>evaluate(`new URL(location.href).searchParams.get('annotation')===${JSON.stringify(marginId)} && !!document.querySelector('.reader-text mark.is-selected')`),'server bookmark resumes exact annotation and document');
  readingDesk={...readingDesk,annotation_id:captures[0].id,start_pos:captures[0].start_pos,end_pos:captures[0].end_pos,revision:2};
  await until(()=>evaluate('[...document.querySelectorAll(".reading-place button")].some(button=>button.textContent==="Bookmark this passage" && !button.disabled)'),'ready to save updated reading place');
  await click('Bookmark this passage');await until(()=>evaluate('!!document.querySelector(".reading-place-conflict")'),'other-device bookmark conflict shown');
  assert.equal(readingDesk.revision,2,'conflict does not silently overwrite other device');
  await click('Replace with my requested bookmark');await until(()=>evaluate('document.querySelector(".reading-place").textContent.includes("revision 3") && !document.querySelector(".reading-place-conflict")'),'explicit bookmark conflict replacement');
  assert.equal(readingDesk.annotation_id,marginId);assert.equal(readingDesk.revision,3);
  await revealPassageTools();
  await evaluate(`document.querySelector('[data-annotation-id="${marginId}"] .verse-links > button').click()`);
  await until(()=>evaluate(`!!document.querySelector('[data-annotation-id="${marginId}"] .verse-links form')`),'verse connection form beside source note');
  for(const [name,text] of [['chapter','2'],['ayah_start','255'],['attribution','Synthetic source attribution'],['source_scope','Bounded owner discussion, not an explicit citation'],['rationale','Synthetic paragraph-to-verse research link']]) {
    await evaluate(`{const field=document.querySelector('[data-annotation-id="${marginId}"] .verse-links [name="${name}"]');field.focus();field.select();}`);await call('Input.insertText',{text});
  }
  await evaluate(`document.querySelector('[data-annotation-id="${marginId}"] .verse-links-confirm input').click()`);
  await click('Save verse connection');await until(()=>evaluate(`document.querySelector('[data-annotation-id="${marginId}"] .verse-links [role=alert]')?.textContent.includes('not be confirmed')`),'uncertain source-to-verse connection');
  assert.equal(verseMaterials.size,1);await click('Retry exact connection save');
  await until(()=>evaluate(`!!document.querySelector('[data-annotation-id="${marginId}"] .verse-links-saved button')`),'source-bound verse connection readback');
  assert.deepEqual(verseRequests[0],verseRequests[1]);
  await evaluate(`document.querySelector('[data-annotation-id="${marginId}"] .verse-links-saved button').click()`);
  await until(()=>evaluate('document.querySelector(".selected-verse-material h3")?.textContent.includes("Q 2:255") && !!document.querySelector(".selected-verse-material blockquote")'),'source passage to selected verse range');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("chapter")'),'2');
  assert.equal(await evaluate('document.querySelector(".selected-verse-material blockquote").textContent'),captures.at(-1).exact);
  assert.equal(await evaluate('document.querySelectorAll(".pilot-arabic").length'),0,'unbundled range never shows unrelated Arabic text');
  await evaluate('document.querySelector(".selected-verse-material button").click()');
  await until(()=>evaluate(`new URL(location.href).searchParams.get('annotation')===${JSON.stringify(marginId)} && !!document.querySelector('.reader-text mark.is-selected')`),'verse material returns to exact source annotation');
  await evaluate('document.querySelector(".reader-focus").click()');
  await until(()=>evaluate('getComputedStyle(document.querySelector(".workspace-results")).display==="none"'),'focus mode gives source and margin the reading desk');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-desk")).display'),'grid');
  const marginWidth=await evaluate('document.querySelector(".reader-desk").style.getPropertyValue("--list-width")');
  await evaluate('document.querySelector(".reader-desk .pane-divider").focus()');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'});
  assert.notEqual(await evaluate('document.querySelector(".reader-desk").style.getPropertyValue("--list-width")'),marginWidth);
  await evaluate('document.querySelector(".reader-margin-toggle").click()');
  assert.equal(await evaluate('document.querySelector(".reader-margin").hidden'),true);
  await evaluate('[...document.querySelectorAll(".reader-text mark")].find(node=>node.textContent==="Before ").click()');
  await until(()=>evaluate('!document.querySelector(".reader-margin").hidden'),'clicking mark reopens collapsed margin');
  const marginDesktop=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'reader-margin-desktop.png'),Buffer.from(marginDesktop.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(100);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'margin reader mobile horizontal overflow');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".reader-desk")).display'),'block');
  const marginMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'reader-margin-mobile.png'),Buffer.from(marginMobile.data,'base64'));
  await call('Emulation.clearDeviceMetricsOverride');
  await evaluate('document.querySelector(".reader-focus").click()');
  await reveal('[data-record-note]');await evaluate('document.querySelector("[data-record-note]").focus()');
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
  await until(() => evaluate('document.querySelector("[data-record-note]")?.value.includes("Synthetic browser note")'),'reload retains cloud note');
  assert.equal(await evaluate('document.querySelector(".workspace-notes select").value'),'read');
  assert.equal(await evaluate('document.querySelector(".workspace-decisions button:nth-child(2)").getAttribute("aria-pressed")'),'true');
  await reveal('[data-record-note]');await evaluate('document.querySelector("[data-record-note]").focus()');await call('Input.insertText',{text:' Recoverable unfinished interpretation.'});
  await evaluate('document.querySelector(".workspace-notes .recoverable-draft .draft-actions button").click()');
  await until(()=>[...recoveryCopies.values()].some(row=>row.record_id==='synthetic:source'&&row.context_kind==='record_note'&&row.state==='active'&&row.body.includes('Recoverable unfinished')),'exact private recovery copy saved independently');
  assert.ok(!saved.get('synthetic:source').note.includes('Recoverable unfinished'));
  await reload();
  await until(()=>evaluate('!!document.querySelector("[data-record-note]")'),'record editor reopens after draft save');await reveal('[data-record-note]');
  assert.ok(!(await evaluate('document.querySelector("[data-record-note]").value')).includes('Recoverable unfinished'));
  await evaluate(`[...document.querySelector('.workspace-notes .recoverable-draft').querySelectorAll('button')].find(button=>button.textContent==='Find saved drafts').click()`);
  await until(()=>evaluate('[...document.querySelectorAll(".workspace-notes .recoverable-draft article")].some(row=>row.textContent.includes("Recoverable unfinished"))'),'durable writing found after reload');
  await evaluate(`[...document.querySelectorAll('.workspace-notes .recoverable-draft article')].find(row=>row.textContent.includes('Recoverable unfinished')).querySelector('button').click()`);
  await until(()=>evaluate('!!document.querySelector(".workspace-notes .draft-preview")'),'recovery compares actual cloud note');
  await evaluate(`[...document.querySelector('.workspace-notes .draft-preview').querySelectorAll('button')].find(button=>button.textContent==='Recover into editor').click()`);
  await until(()=>evaluate('document.querySelector("[data-record-note]").value.includes("Recoverable unfinished")'),'draft restored into actual record editor');
  assert.ok(!saved.get('synthetic:source').note.includes('Recoverable unfinished'),'recovery never commits actual note');
  const width=await evaluate('document.querySelector(".owner-panes").style.getPropertyValue("--list-width")');
  await evaluate('document.querySelector(".owner-panes > .pane-divider").focus()');
  await call('Input.dispatchKeyEvent',{ type:'keyDown',key:'ArrowRight',code:'ArrowRight' });
  assert.notEqual(await evaluate('document.querySelector(".owner-panes").style.getPropertyValue("--list-width")'),width);
  conflict=true;
  await reveal('[data-record-note]');await evaluate('document.querySelector("[data-record-note]").focus()'); await call('Input.insertText',{ text:' New draft.' });
  await evaluate('document.querySelector(".workspace-note-actions button").click()');
  await until(() => evaluate('!!document.querySelector(".workspace-conflict")'),'revision conflict');
  assert.match(await evaluate('document.querySelector("[data-record-note]").value'),/New draft/);
  assert.match(await evaluate('document.querySelector(".workspace-conflict pre").textContent'),/Cloud edit/);
  await evaluate('document.querySelector(".workspace-conflict button").click()');
  await until(() => evaluate('document.querySelector("[data-record-note]").value.startsWith("Cloud edit")'),'explicit cloud resolution');
  await evaluate('[...document.querySelectorAll(".header-tools button")].find(button=>/^(Dark|Light) mode$/.test(button.textContent)).click()');
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
  await click('Reading collection & context');
  await until(()=>evaluate('document.querySelectorAll(".collection-readings article").length===3'),'actual collection reading choices');
  assert.ok(await evaluate('document.querySelector(".reading-collection").textContent.includes("Rodwell")'));
  await evaluate(`{const select=document.querySelector('.reading-collection select');select.value='83';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(()=>evaluate('document.querySelectorAll(".collection-readings article").length===2'),'collection Q4:83 choices');
  await reload();
  await until(()=>evaluate('document.querySelector(".reading-collection select")?.value==="83"'),'collection verse survives reload');
  await evaluate('document.querySelector(".collection-readings article button").click()');
  await until(()=>evaluate('document.querySelector("[name=title]")?.value.includes("Rodwell")'),'real translation mapped to reviewed intake');
  await evaluate('history.back()');
  await until(()=>evaluate('document.querySelector(".reading-collection select")?.value==="83"'),'collection verse retained when returning from intake');

  await click('Back to my reading');
  await click('Notes');
  await click('Reading notes');
  await until(()=>evaluate('document.querySelectorAll(".research-notebook .notebook-title").length>0'),'workspace notebook shows live passage notes');
  await evaluate('document.querySelector(".research-notebook .notebook-title").click()');
  await until(()=>evaluate('!!document.querySelector(".reader-text mark.is-selected")'),'notebook backlink opens saved passage');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("view")'),'notebook');
  assert.ok(await evaluate('!!document.querySelector(".notebook-source-pane .reader-text mark.is-selected")'));
  await click('Close source ×');
  await click('Read the Sirry article');
  await until(()=>evaluate('document.querySelector("[name=title]")?.value.includes("Who Are Those in Authority")'),'real article preset reachable from workspace');
  assert.ok(await evaluate('document.querySelector(".intake-preset-note").textContent.includes("manual transcription")'));
  assert.equal(await evaluate('new URL(location.href).searchParams.get("view")'),'article-pilot');
  await click('Back to reading');await click('Add source');
  await until(()=>evaluate('!!document.querySelector("[name=title]")'),'workspace source intake');
  await evaluate('document.querySelector("[name=title]").focus()');await call('Input.insertText',{text:'Private retained source draft'});
  await click('Back to reading');await click('Read the Sirry article');
  await until(()=>evaluate('document.querySelector("[name=title]")?.value==="Private retained source draft"'),'article preset never overwrites retained intake');
  await call('Page.navigate',{url:testOrigin+'/workspace.html?'+new URLSearchParams({project:'synthetic',record:collectionRecord.id,document:collectionDocument.id,reading_id:collectionReading.id,view:'collection-link'})});
  await until(()=>evaluate('!!document.querySelector(".collection-reading-link textarea")'),'confirmed reading connection entry point');
  assert.equal(await evaluate('document.querySelector(".collection-reading-link input[type=checkbox]").checked'),false);
  await evaluate('document.querySelector(".collection-reading-link textarea").focus()');await call('Input.insertText',{text:'Compare the named translation with the identified Arabic verse.'});
  await evaluate('document.querySelector(".collection-reading-link input[type=checkbox]").click()');
  await evaluate('document.querySelector(".collection-reading-link form").requestSubmit()');
  await until(()=>evaluate('document.querySelector(".collection-reading-link form button")?.textContent.includes("Retry original")'),'lost connection result retains original request');
  await evaluate('document.querySelector(".collection-reading-link form").requestSubmit()');
  await until(()=>evaluate('new URL(location.href).searchParams.get("annotation")==="synthetic:collection-annotation" && document.querySelector(".reader-text")?.textContent.includes("O ye who believe!")'),'confirmed named translation opens exact source');
  assert.equal(collectionRequests.length,2);assert.deepEqual(collectionRequests[0],collectionRequests[1]);
  await click('Verse import tools');
  await until(()=>evaluate('document.querySelectorAll(".pilot-arabic").length===2'),'translation linked to pilot');
  await evaluate(`document.querySelector('[data-pilot-ayah="59"] .pilot-related-load').click()`);
  await until(()=>evaluate(`document.querySelector('[data-pilot-ayah="59"] .pilot-related')?.textContent.includes('Rodwell')`),'verse reader shows actual named translation material');
  await click('Back to reading');await click('Verse import tools');

  await until(()=>evaluate('document.querySelectorAll(".pilot-arabic").length===2'),'Arabic pilot reachable from workspace');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("view")'),'pilot');
  await evaluate('history.back()');await until(()=>evaluate('!document.querySelector(".pilot-reading")'),'Back restores reading view');
  await evaluate('history.forward()');await until(()=>evaluate('document.querySelectorAll(".pilot-arabic").length===2'),'Forward restores pilot view');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'workspace pilot fits mobile width');
  assert.equal(await evaluate('Object.values(localStorage).some(value=>value.includes("Private retained source draft"))'),false);
  await click('Back to reading');
  // Landing opens actual saved text, honors a durable bookmark's version, and
  // keeps an explicitly requested record ahead of both automatic choices.
  const retainedDesk=readingDesk;
  readingLibraryRows=[{project_id:'synthetic',record_id:records[1].id,document_id:readingDocument.id,title:records[1].title,edition:readingDocument.edition,locator:readingDocument.locator,reading:'unread'}];
  readingDesk=null;
  await call('Page.navigate',{url:testOrigin+'/workspace.html?project=synthetic'});
  await until(()=>evaluate('document.querySelector(".reader-text")?.textContent==='+JSON.stringify(readingDocument.text_body)),'landing opens first saved reading, not metadata');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("record")'),records[1].id);
  assert.equal(await evaluate('new URL(location.href).searchParams.get("document")'),readingDocument.id);
  assert.equal(await evaluate('document.querySelectorAll(".atlas-reading-item").length'),1);
  readingDesk={project_id:'synthetic',record_id:records[1].id,document_id:comparisonDocument.id,annotation_id:null,start_pos:0,end_pos:0,revision:7};
  await call('Page.navigate',{url:testOrigin+'/workspace.html?project=synthetic'});
  await until(()=>evaluate('document.querySelector(".reader-text")?.textContent==='+JSON.stringify(comparisonDocument.text_body)),'landing bookmark wins over first library version');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("document")'),comparisonDocument.id);
  await call('Page.navigate',{url:testOrigin+'/workspace.html?'+new URLSearchParams({project:'synthetic',record:records[0].id})});
  await until(()=>evaluate('document.querySelector(".workspace-record-heading")?.textContent.includes("Synthetic question")'),'explicit record URL wins over bookmark and first reading');
  assert.equal(await evaluate('new URL(location.href).searchParams.get("record")'),records[0].id);
  assert.equal(await evaluate('!!document.querySelector(".reader-text")'),false,'explicit question does not receive another source text');
  readingDesk=retainedDesk;readingLibraryRows=[];
  await call('Emulation.clearDeviceMetricsOverride');
  assert.equal(await evaluate(`!!document.querySelector('select[aria-label="Research project"]')`),false,'project navigation has no select menu');
  await click('+ New project');
  await evaluate('document.querySelector(".atlas-projects input").focus()');await call('Input.insertText',{text:'Synthetic philosophy project'});
  await until(()=>evaluate('!!document.querySelector(".atlas-projects input")?.value && !document.querySelector(".atlas-projects button[type=submit]")?.disabled'),'project name ready to save');
  await click('Create project');
  try{await until(()=>evaluate('document.querySelector(".atlas-projects [role=alert]")?.textContent.includes("Retry")'),'uncertain project creation retained');}catch(error){throw new Error(error.message+' · '+JSON.stringify({projectPosts,ui:await evaluate('document.querySelector(".atlas-projects")?.textContent')}));}
  assert.equal(projectPosts,1);
  await click('Retry creation');
  await until(()=>evaluate('document.querySelector(".atlas-project-list [aria-current=page]")?.textContent==="Synthetic philosophy project"'),'same project reconciled after lost response');
  assert.equal(projectPosts,1,'reconciliation does not POST a duplicate project');
  const createdProject=ownerProjects[1].id;
  assert.equal(await evaluate('new URL(location.href).searchParams.get("project")'),createdProject);
  await reload();
  await until(()=>evaluate('document.querySelector(".atlas-project-list [aria-current=page]")?.textContent==="Synthetic philosophy project"'),'created project survives reload');
  await evaluate('document.querySelector(".atlas-project-list button").click()');
  await until(()=>evaluate('new URL(location.href).searchParams.get("project")==="synthetic"'),'direct project switch');
  authenticated=false; await reload();
  assert.ok(unloadPrompts>=1,'unsaved intake warns before leaving the page');
  await until(() => evaluate('document.querySelector("[role=alert]")?.textContent.includes("Owner sign-in")'),'anonymous sign-in boundary');
  assert.equal(await evaluate('!!document.querySelector("[data-record-note]")'),false);
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
  console.log(JSON.stringify({ passed:true,checks:['project tree and contextual tools','mounted note and reader retention across working tabs','text selection and reading scroll restoration','closing and reopening retains unfinished writing','background note save cannot redirect active reading','first saved reading opens source text on landing','durable bookmark version wins over library default','explicit record URL wins over automatic reading','explicit collection translation link retry and verse-to-source return','actual collection readings and verse reload','notebook passage backlinks','record writing draft save/reload/recover without actual-note write','independent comparison versions and URL reload','comparison 390px layout and exact passage return','question findings to located evidence to source','Unicode passage selection and exact reopening','passage draft retained during record navigation','private annotation search and reloadable exact-passage link','Quran reference decision reload and retained draft','idempotent reference retry after lost response','reference conflict comparison and explicit resolution','reverse verse lookup to exact saved passage','reference dismissal and 390px controls','manual mapping distinct from citation claims','invalid verse bounds explained before saving','word to scoped concept and durable passage links','idempotent concept and definition creation after lost responses','explicit definition gaps and separate machine proposals','attributed definitions and exact source reopening','definition correction conflict, retry and history','existing lexical connection reuse and Arabic source preservation','normalized and combined research search','lexical pagination and dark/mobile/RTL layout','persistent source marks and overlapping underline reload','direct margin writing and frozen idempotent capture retry','mark-to-note and note-to-source focus with stable bookmarks','resizable collapsible margin and focused mobile reading','read/skip/note save and reload','inert untrusted text','keyboard pane resize','revision conflict comparison','dark mode','390px overflow','no private localStorage','margin source-to-verse discussion save and exact retry','generic selected verse-range view and source return','no unrelated Arabic text for unbundled ranges','durable bookmark exact retry and reload','server bookmark to exact source passage','other-device bookmark conflict requires explicit replacement','workspace source intake and real article preset','retained intake never overwritten by preset','Arabic pilot URL Back and Forward','anonymous boundary'],artifacts }));
} finally {
  socket?.close(); chrome.kill();
  // This suite owns the ephemeral preview. Close its remaining keep-alive
  // sockets so successful reviews do not linger waiting for an HTTP timeout.
  preview.httpServer.closeAllConnections?.();
  await preview.close();
  for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Review finished')); }
  await sleep(200); await rm(profile,{ recursive:true,force:true });
}
