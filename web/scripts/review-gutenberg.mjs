// Real browser / synthetic writing; an optional permitted book JSON stays outside git.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';
const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-gutenberg-'));
const hash=t=>createHash('sha256').update(t).digest('hex');
const texts=['CHAPTER I\n\nJustice is a question worth studying. é 😀 العربية\n\n<script>window.untrustedBook=true</script>\n\n'+('A synthetic paragraph about philosophy.\n\n'.repeat(90)), 'CHAPTER II\n\nAnother argument deserves a note.\n\n'+('Synthetic chapter two.\n\n'.repeat(90))];
const synthetic={book_id:1497,title:'Synthetic philosophy',creators:['Synthetic author'],translators:[],languages:['en'],edition:'Synthetic digital edition',rights_notice:'Synthetic public-domain test fixture',source_url:'https://www.gutenberg.org/ebooks/1497',representation_url:'https://gutenberg.pglaf.org/cache/epub/1497/pg1497.txt',attribution:'Synthetic Gutenberg fixture',license_url:'https://www.gutenberg.org/policy/license.html',availability:'read',version:hash(texts.join('')),sections:texts.map((text,index)=>({index,label:'CHAPTER '+(index+1),text,text_sha256:hash(text)}))};
const book=process.env.RESEARCH_GUTENBERG_BOOK?JSON.parse(await readFile(process.env.RESEARCH_GUTENBERG_BOOK,'utf8')):synthetic;
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || await mkdtemp(join(tmpdir(),'research-gutenberg-artifacts-'));await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',define:{__GUTENBERG_TEST_BOOK__:JSON.stringify(book)},build:{outDir:join(temporary,'dist'),rollupOptions:{input:join(root,'scripts/fixtures/gutenberg-harness.html')}}});
const preview=await startPreview({root,configFile:false,logLevel:'silent',build:{outDir:join(temporary,'dist')},preview:{host:'127.0.0.1',port:0,strictPort:true}});
const origin=`http://127.0.0.1:${preview.httpServer.address().port}`;
const chrome=spawn(process.env.CHROME_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome'),['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(temporary,'profile')}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let socket,serial=0,diagnostics='';const pending=new Map();chrome.stderr.on('data',d=>{diagnostics=(diagnostics+d).slice(-2000);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<150;i++){try{const value=await fn();if(value)return value;}catch{}await sleep(100);}throw new Error('Timed out: '+label+' '+diagnostics);}
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},20000);pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function click(text){await evaluate(`{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)});if(!b)throw new Error('Missing button '+${JSON.stringify(text)});for(let p=b.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;b.click();}`);}
try{
  const port=await until(async()=>Number((await readFile(join(temporary,'profile','DevToolsActivePort'),'utf8')).split('\n')[0]),'Chrome debug port');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);if(p){clearTimeout(p.timeout);pending.delete(v.id);v.error?p.reject(new Error(v.error.message)):p.resolve(v.result);}}};
  await call('Runtime.enable');await call('Page.enable');
  await call('Page.navigate',{url:origin+'/scripts/fixtures/gutenberg-harness.html'});
  await until(()=>evaluate('!!document.querySelector("#gutenberg-query")'),'search');
  await evaluate('document.querySelector("#gutenberg-query").focus()');await call('Input.insertText',{text:'philosophy'});await click('Search');
  await until(()=>evaluate('!!document.querySelector(".gutenberg-book-title")'),'catalog result');await click(book.title);
  await until(()=>evaluate('document.querySelector(".reader-text")?.textContent.length>50'),'open book without import');
  assert.equal(await evaluate('window.__books.records.size'),0,'opening creates no project membership');
  assert.equal(await evaluate('window.__books.documents.size'),0,'opening creates no saved excerpt');
  assert.equal(await evaluate('!!window.untrustedBook'),false,'book markup remains inert');
  await evaluate(`{const root=document.querySelector('.reader-text'),walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const node=walk.nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(20,node.textContent.length));const s=getSelection();s.removeAllRanges();s.addRange(range);}`);
  await until(()=>evaluate('!!document.querySelector(".reader-selection-tools") || document.querySelector(".reader-capture-actions") || document.querySelector(".reader-selection-preview") || getSelection().toString().length>0'),'selection');
  const controls=await evaluate('[...document.querySelectorAll("button")].filter(b=>!b.closest("[hidden]")).map(b=>b.textContent)');
  const action=['Annotate selected text','Highlight','Highlight selection','Note on selection','Add margin note','Annotate selection'].find(t=>controls.includes(t));
  if(!action)throw new Error('Selection actions: '+controls.join('|'));
  await click(action);
  await until(()=>evaluate('!!document.querySelector(".reader-capture textarea")'),'passage composer');
  await evaluate('window.__books.lose();document.querySelector(".reader-capture textarea").focus()');await call('Input.insertText',{text:'Synthetic exact-passage note'});await click('Save passage note');
  await until(()=>evaluate('document.body.textContent.includes("Retry original save")'),'lost acknowledgement');
  await click('Retry original save');
  await until(()=>evaluate('!document.querySelector(".reader-capture") && window.__books.notes.size===1'),'exact retry saves one note');
  assert.equal(await evaluate('window.__books.records.size'),1);
  assert.equal(await evaluate('window.__books.notes.size'),1);
  assert.equal(await evaluate('document.querySelectorAll(".reader-text mark").length>0'),true);
  await click('Next →');await until(()=>evaluate('document.querySelector(".reader-text")?.textContent.includes('+JSON.stringify(book.sections[1].text.slice(0,30))+')'),'next section');
  await until(()=>evaluate('window.__books.place()?.section===1'),'durable resume section');
  await click('Sources');await until(()=>evaluate('!!document.querySelector("#gutenberg-query")'),'back to catalog');
  await evaluate('document.querySelector("#gutenberg-query").focus()');await call('Input.insertText',{text:'philosophy'});await click('Search');await until(()=>evaluate('!!document.querySelector(".gutenberg-book-title")'),'reopen result');await click(book.title);
  await until(()=>evaluate('document.querySelector(".gutenberg-section-nav")?.textContent.includes("2 /") && !!document.querySelector(".reader-text")'),'resume after reader remount');
  await click('← Previous');await until(()=>evaluate('!!document.querySelector(".reader-text mark")'),'original saved highlight');
  await evaluate('document.querySelector(".reader-text mark").click()');
  await until(()=>evaluate('document.body.textContent.includes("Synthetic exact-passage note")'),'saved highlight opens note');
  await evaluate('document.querySelector(".reader-text").focus();getSelection().removeAllRanges()');
  const width=await evaluate('document.querySelector(".reader-text").getBoundingClientRect().width');assert.ok(width>300);
  await call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(artifacts,'gutenberg-desktop.png'),Buffer.from(r.data,'base64')));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`{const shell=document.querySelector('.atlas-workspace');shell.style.gridTemplateColumns='minmax(0,1fr)';shell.querySelector('aside').style.display='none';}`);
  await sleep(200);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'390px book has no horizontal page overflow');
  await call('Page.captureScreenshot',{format:'png'}).then(r=>writeFile(join(artifacts,'gutenberg-mobile.png'),Buffer.from(r.data,'base64')));
  console.log(JSON.stringify({searchToReading:true,noImportRequired:true,atomicExactNote:true,lostResponseRetry:true,originalHighlightReturn:true,sectionResume:true,inertText:true,mobileNoOverflow:true,book:book.title,artifacts}));
}finally{socket?.close();chrome.kill('SIGTERM');await preview.httpServer.close();await new Promise(resolve=>{if(chrome.exitCode!==null)return resolve();chrome.once('exit',resolve);setTimeout(resolve,3000);});await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
