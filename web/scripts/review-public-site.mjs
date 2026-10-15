// Exercise the actual isolated artifact/runtime in Chrome, without API interception.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=process.env.RESEARCH_TEST_PUBLIC_SITE;
if(!directory) throw new Error('Synthetic public site directory is required');
let server,origin=process.env.RESEARCH_PUBLIC_TEST_ORIGIN;
if(origin){
  const url=new URL(origin),parts=url.hostname.split('.').map(Number);
  const privateBridge=parts.length===4 && parts.every(part=>Number.isInteger(part)&&part>=0&&part<=255) &&
    (parts[0]===10 || parts[0]===172&&parts[1]>=16&&parts[1]<=31 || parts[0]===192&&parts[1]===168);
  const ownedCiBridge=process.env.GITHUB_ACTIONS==='true' && process.env.RESEARCH_CONTAINER_TESTS==='isolated-ci-only' &&
    url.protocol==='http:' && url.port==='8080' && privateBridge && !url.username && !url.password && !url.search && !url.hash;
  if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{1,4}$/.test(origin) && !ownedCiBridge)
    throw new Error('Public container test origin must be owned loopback or the isolated CI bridge');
}else{
  const {startPublicServer}=await import(pathToFileURL(join(directory,'runtime/public-server.mjs')));
  ({server}=await startPublicServer(directory,{host:'127.0.0.1',port:0}));
  origin=`http://127.0.0.1:${server.address().port}`;
}
const profile=await mkdtemp(join(tmpdir(),'public-runtime-browser-'));
const artifacts=await mkdtemp(join(tmpdir(),'public-runtime-artifacts-'));
const chrome=spawn(process.env.CHROME_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome'),
  ['--headless=new','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',
    '--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1440,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let failure,diagnostics='',socket,serial=0;
const pending=new Map(),exceptions=[],requests=[];
chrome.stderr.on('data',value=>{diagnostics=(diagnostics+value.toString()).slice(-4000);});
chrome.on('error',error=>{failure=error;});
chrome.on('exit',()=>{failure=new Error('Owned public test browser exited');});
async function until(fn,label,attempts=100){
  for(let i=0;i<attempts;i++){if(failure)throw failure;try{const value=await fn();if(value)return value;}catch{}await sleep(100);}
  throw new Error('Timed out: '+label+(label==='owned browser startup'?' '+diagnostics:''));
}
function call(method,params={}){
  return new Promise((resolve,reject)=>{
    const id=++serial,timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},8000);
    pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression){
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error('Public browser evaluation failed');
  return result.result.value;
}
try {
  const port=await until(async()=>Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]),'owned browser startup',300);
  const page=await until(async()=>(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'),'owned browser page');
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timeout);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result);}
    else if(message.method==='Runtime.exceptionThrown')exceptions.push('Unexpected public browser exception');
    else if(message.method==='Network.requestWillBeSent')requests.push(message.params.request);
  });
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('research-theme','dark');window.__publicCsp=[];addEventListener('securitypolicyviolation',event=>window.__publicCsp.push(event.effectiveDirective));`});
  await call('Page.navigate',{url:origin+'/?project=synthetic-islam&record=shared%3Asource#records'});
  await until(()=>evaluate('document.querySelector(".details")?.textContent.includes("Synthetic bibliography, edition 1")'),'actual public source details');
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'dark');
  assert.equal(await evaluate('document.querySelectorAll(".details script").length'),0);
  assert.match(await evaluate('document.querySelector(".review-limits").textContent'),/abstract only/);
  const desktop=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'desktop.png'),Buffer.from(desktop.data,'base64'));
  await evaluate('const picker=document.querySelector(".public-project-picker select");picker.value="synthetic-philosophy";picker.dispatchEvent(new Event("change",{bubbles:true}))');
  await until(()=>evaluate('document.querySelector(".intro h1")?.textContent==="Synthetic philosophy research"'),'actual second public project');
  await evaluate('[...document.querySelectorAll("nav button")].find(button=>button.textContent==="Records").click()');
  await until(()=>evaluate('document.querySelectorAll(".record-row").length===2'),'actual public records');
  await evaluate('[...document.querySelectorAll(".record-row")].find(button=>button.textContent.includes("Synthetic philosophy research source")).click()');
  await until(()=>evaluate('document.querySelector(".details")?.textContent.includes("Synthetic philosophy research source")'),'actual record navigation');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".details")).display!=="none"'),true);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  const mobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(join(artifacts,'mobile.png'),Buffer.from(mobile.data,'base64'));
  assert.deepEqual(await evaluate('window.__publicCsp'),[]);
  assert.deepEqual(exceptions,[]);
  assert.ok(requests.length>5);
  assert.ok(requests.every(request=>request.method==='GET' && request.url.startsWith(origin+'/')));
  assert.ok(requests.every(request=>!new URL(request.url).pathname.startsWith('/v1/')));
  assert.ok(requests.every(request=>!request.url.endsWith('/data/public-graph.json')));
  console.log(JSON.stringify({isolated_public_browser_passed:true,checks:['actual portable artifact and runtime','CSP without inline scripts','external theme bootstrap','source citations and review limits','project/record navigation','anonymous public GETs only','no owner API or legacy graph','dark mobile layout'],artifacts}));
} finally {
  socket?.close();
  // Chrome flushes its profile during shutdown. Wait for the owned process to
  // close before deleting it; a fixed sleep races the profile writer on CI.
  const closed=new Promise(resolve=>{
    if(chrome.exitCode!==null || chrome.signalCode!==null)return resolve();
    chrome.once('close',resolve);
  });
  chrome.kill('SIGTERM');
  const force=setTimeout(()=>chrome.kill('SIGKILL'),5000);
  force.unref();
  try {
    await Promise.race([closed,new Promise((_,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Owned Chrome did not stop')),10000);
      timeout.unref();closed.finally(()=>clearTimeout(timeout));
    })]);
  } finally {clearTimeout(force);}
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Public browser review finished'));}
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
