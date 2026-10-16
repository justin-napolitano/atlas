// Exercise compiled ResearchNotebook with an explicit synthetic boundary adapter.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build,preview as startPreview} from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url)),temporary=await mkdtemp(join(tmpdir(),'research-cache-browser-'));
const artifacts=process.env.RESEARCH_BROWSER_ARTIFACT_DIR || temporary;
await mkdir(artifacts,{recursive:true});
await build({root,configFile:false,plugins:[react()],logLevel:'warn',build:{outDir:join(temporary,'dist'),emptyOutDir:true,
  rollupOptions:{input:join(root,'scripts/fixtures/working-cache-harness.html')}}});
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
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id){const item=pending.get(value.id);if(item){clearTimeout(item.timeout);pending.delete(value.id);value.error?item.reject(new Error(value.error.message)):item.resolve(value.result);}}};
  await call('Runtime.enable');await call('Page.enable');await call('Performance.enable');await call('Page.navigate',{url:origin+'/scripts/fixtures/working-cache-harness.html'});
  await until(()=>evaluate('!!window.__cache?.choose'),'cache harness mounted');
  const counts=[];
  for(let round=0;round<3;round++){
    for(let n=0;n<30;n++){
      await evaluate(`window.__cache.choose('${n}')`);
      await until(()=>evaluate(`document.querySelector('.working-surface:not([hidden]) h1')?.textContent==='Reading ${n}'`),'active reading '+n);
      assert.ok(await evaluate('document.querySelectorAll(".working-surface").length<=4'));
    }
    await call('HeapProfiler.collectGarbage');counts.push((await call('Memory.getDOMCounters')).nodes);
  }
  assert.equal(await evaluate('window.__cache.activeEffects'),1,'only active page owns active work');
  assert.ok(Math.max(...counts)-Math.min(...counts)<=10,'retained DOM is stable after explicit test GC across three cycles');
  await evaluate(`window.__cache.choose('29');document.querySelector('.workspace-reader').scrollTop=500`);
  await evaluate(`window.__cache.choose('28')`);await until(()=>evaluate('document.querySelector(".working-surface:not([hidden]) h1")?.textContent==="Reading 28"'),'next reading');
  await evaluate(`window.__cache.choose('29')`);await until(()=>evaluate('document.querySelector(".workspace-reader").scrollTop===500'),'scroll restored');
  await evaluate(`window.__cache.protect(['0','1','2','3','4','5'])`);
  for(let n=0;n<7;n++){await evaluate(`window.__cache.choose('${n}')`);await until(()=>evaluate(`document.querySelector('.working-surface:not([hidden]) h1')?.textContent==='Reading ${n}'`),'protected reading');}
  assert.equal(await evaluate('document.querySelectorAll(".working-surface").length'),7);
  assert.ok(await evaluate('document.body.textContent.includes("protect unfinished work")'));
  await evaluate('window.__cache.protect([])');await until(()=>evaluate('document.querySelectorAll(".working-surface").length===4'),'protection cleared releases pages');
  for(let n=0;n<29;n++)await evaluate(`window.__cache.close('${n}')`);
  await evaluate(`window.__cache.choose('29')`);await until(()=>evaluate('document.querySelectorAll(".working-surface").length===1'),'closed pages released');
  assert.equal(await evaluate('window.__cache.activeEffects'),1);
  console.log(JSON.stringify({workingCachePassed:true,cycles:3,readingsPerCycle:30,warmLimit:4,domCounterObservations:counts,finalMounted:1,checks:['bounded clean DOM','protected dirty overflow','release after confirmed work','inactive effect cleanup','scroll restore','close cleanup']}));
}finally{
  socket?.close();const closed=new Promise(resolve=>chrome.once('close',resolve));chrome.kill();await closed;await preview.close();
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Cache review finished'));}
  await sleep(200);await rm(join(temporary,'profile'),{recursive:true,force:true});
}
