// Real native renderer against a synthetic local owner/PG service and fake GitHub.
const {app,BrowserWindow,Menu}=require('electron');
const electron=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {DesktopHost}=require('../src/host.cjs');
const {privateJSON}=require('../src/policy.cjs');
const root=path.dirname(process.env.ATLAS_ELECTRON_TEST_CONFIG||'');
app.setName('Atlas Synthetic Vault Review');app.enableSandbox();app.setPath('userData',path.join(root,'profile'));app.commandLine.appendSwitch('disable-background-networking');app.on('window-all-closed',()=>{});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label){for(let i=0;i<150;i++){try{if(await check())return;}catch{}await pause(100);}throw Error('Timed out: '+label);}
let window,config;
app.whenReady().then(async()=>{
 config=await privateJSON(process.env.ATLAS_ELECTRON_TEST_CONFIG);
 const host=new DesktopHost(electron,{}, {backendFactory:async()=>({origin:config.origin,credentials:config.credentials,stop:async()=>{}}),confirmDiscard:()=>false,preferencesFile:path.join(root,'window.json')});
 Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'editMenu'}]));window=await host.open();window.setTitle('Atlas — synthetic vault review');window.webContents.setBackgroundThrottling(false);
 const screenshot=async name=>{for(let attempt=0;attempt<4;attempt++){try{await pause(300);const page=await window.webContents.capturePage(undefined,{stayAwake:true});if(page.isEmpty())throw Error('Empty frame');await fs.writeFile(path.join(config.screenshots,name),page.toPNG());return;}catch(error){if(attempt===3)throw Error('Screenshot '+name+': '+error.message);}}};
 const ui=code=>window.webContents.executeJavaScript(code),active='.working-surface:not([hidden])';
 const press=keyCode=>{window.webContents.sendInputEvent({type:'keyDown',keyCode});if(keyCode==='Return'||keyCode==='Space')window.webContents.sendInputEvent({type:'char',keyCode:keyCode==='Return'?'\r':' '});window.webContents.sendInputEvent({type:'keyUp',keyCode});};
 await until(()=>ui('!![...document.querySelectorAll(".connected-sidebar-footer button")].find(row=>row.textContent==="Private vault")'),'native vault capability');
 await ui('[...document.querySelectorAll(".connected-sidebar-footer button")].find(row=>row.textContent==="Private vault").focus()');press('Return');
 await until(()=>ui('!!document.querySelector("'+active+' input[placeholder=\\"owner/repository\\"]")'),'connection form');
 await ui('document.querySelector("'+active+' input[placeholder=\\"owner/repository\\"]").focus()');await window.webContents.insertText('synthetic-owner/private-vault');press('Return');
 await until(()=>ui('document.querySelector("'+active+'")?.textContent.includes("Connected as synthetic-owner")'),'real connection confirmation');
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Preview my pages").focus()');press('Return');
 await until(()=>ui('document.querySelector("'+active+' [aria-label=\\"Vault preview\\"]")?.textContent.includes("Synthetic eligible note")'),'bounded preview');
 assert.equal(await ui('document.querySelector("'+active+'").textContent.includes("Legacy project context is not portable yet")'),true);
 assert.equal(await ui('document.querySelector("'+active+'").textContent.includes("Nothing uploads until you review")'),true);
 assert.equal(await ui('document.querySelectorAll("'+active+' [aria-label=\\"Vault preview\\"] button").length>=2'),true);
 if(config.sync){
 await ui('document.querySelector(`'+active+' input[aria-label="Sync Synthetic eligible note"]`).focus()');press('Space');
 await until(()=>ui('document.querySelector(`'+active+' input[aria-label="Sync Synthetic eligible note"]`)?.checked'),'page selected by keyboard');
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Review backup").focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' [aria-label="Reviewed backup"]`)?.textContent.includes("Send to GitHub")'),'frozen sync review');
 if(config.sourceContext){
  assert.equal(await ui('document.querySelector(`'+active+' [aria-label="Source context"]`)?.textContent.includes("Synthetic citation source")'),true);
  assert.equal(await ui('document.querySelector(`'+active+' [aria-label="Source context"]`)?.textContent.includes("Chapter 2, page 7")'),true);
  assert.equal(await ui('document.querySelector(`'+active+' [aria-label="Source context"]`)?.textContent.includes("Synthetic exact passage")'),true);
 }
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Back up selected pages").focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' [aria-label="Reviewed backup"]`)?.textContent.includes("These saved revisions are backed up.")'),'reviewed sync confirmation');
 assert.equal(await ui('document.querySelector(`'+active+' [aria-label="Backup coverage"]`)?.textContent.includes("Confirmed coverage: 1 of 1")'),true);
 await until(()=>ui('[...document.querySelectorAll("'+active+' button")].some(row=>row.textContent==="Inspect recovery"&&!row.disabled)'),'recovery control ready after confirmation refresh');
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Inspect recovery").focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' [aria-label="Read-only recovery preview"]`)?.textContent.includes("Matches current writing")'),'read-only exact recovery preview');
 assert.equal(await ui('document.querySelector(`'+active+' [aria-label="Read-only recovery preview"]`)?.textContent.includes("No notes, revisions, drafts, tasks or pending operations were changed")'),true);
 assert.equal(await ui('document.activeElement?.getAttribute("aria-label")==="Read-only recovery preview"'),true);
 await screenshot('backup-recovery-desktop.png');
 if(config.sourceContext){
  await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="New selection").focus()');press('Return');
  await until(()=>ui('[...document.querySelectorAll("'+active+' button")].some(row=>row.textContent==="Preview passage notes"&&!row.disabled)'),'passage preview ready');
  await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Preview passage notes").focus()');press('Return');
  await until(()=>ui('!!document.querySelector(`'+active+' input[aria-label="Sync Synthetic exact passage"]`)'),'passage annotation candidate');
  await ui('document.querySelector(`'+active+' input[aria-label="Sync Synthetic exact passage"]`).focus()');press('Space');
  await until(()=>ui('document.querySelector(`'+active+' input[aria-label="Sync Synthetic exact passage"]`)?.checked'),'annotation selected');
  await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Review backup").focus()');press('Return');
  await until(()=>ui('[...document.querySelectorAll("'+active+' button")].some(row=>row.textContent==="Back up selected pages"&&!row.disabled)'),'annotation review ready');
  await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Back up selected pages").focus()');press('Return');
  await until(()=>ui('[...document.querySelectorAll("'+active+' button")].some(row=>row.textContent==="Inspect recovery"&&!row.disabled)'),'annotation confirmation');
  await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Inspect recovery").focus()');press('Return');
  await until(()=>ui('document.querySelector(`'+active+' [aria-label="Read-only recovery preview"] .vault-preview-row>span`)?.textContent==="Synthetic exact passage"'),'annotation recovery identity');
  assert.equal(await ui('document.querySelector(`'+active+' [aria-label="Read-only recovery preview"]`)?.textContent.includes("Matches current writing")'),true);
  await until(()=>ui('document.activeElement?.getAttribute("aria-label")==="Read-only recovery preview"'),'annotation recovery focus');
  await screenshot('source-context-annotation.png');
 }
 }

 if(config.tasks){
 await ui('[...document.querySelectorAll(".connected-nav button")].find(row=>row.textContent==="Tasks").focus()');press('Return');
 await until(()=>ui('!!document.querySelector(`'+active+' input[aria-label="Task title"]`)'),'task capture');
 await ui('document.querySelector(`'+active+' input[aria-label="Task title"]`).focus()');await window.webContents.insertText('Synthetic native task');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' .connected-task-detail`)?.textContent.includes("Saved locally")'),'durable local task capture');
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Sync tasks").focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' .connected-task-detail`)?.textContent.includes("Confirmed on GitHub")'),'task confirmed');
 await ui('document.querySelector(".connected-new-note").focus()').catch(()=>{});
 window.webContents.sendInputEvent({type:'keyDown',keyCode:'n',modifiers:['meta']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'n',modifiers:['meta']});
 await until(()=>ui('!!document.querySelector(`'+active+' .cm-content[aria-label="Note body"]`)'),'new page');
 await ui('document.querySelector(`'+active+' .cm-content[aria-label="Note body"]`).focus()');await window.webContents.insertText('Synthetic task context\n\n/task Follow the evidence');
 await until(()=>ui('!!document.querySelector(`[aria-label="Create task"] [role="option"]`)'),'/task completion');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' input[aria-label="Task title"]`)?.value==="Follow the evidence"'),'task draft context');press('Tab');
 await ui('document.querySelector(`'+active+' input[aria-label="Task title"]`).focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' .connected-task-detail`)?.textContent.includes("Open context page")'),'task to page linkage');
 await screenshot('tasks-desktop.png');
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Open context page").focus()');press('Return');
 await until(()=>ui('document.querySelector("'+active+'")?.textContent.includes("Synthetic task context")'),'return to original page');
 await ui('[...document.querySelectorAll(".connected-sidebar-footer button")].find(row=>row.textContent==="Private vault").focus()');press('Return');
 }
 await screenshot('vault-desktop.png');
 const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await loaded;
 await until(()=>ui('document.querySelector("'+active+'")?.textContent.includes("Connected as synthetic-owner")'),'connection survives reload');
 await window.setMinimumSize(0,0);window.setContentSize(390,844);await pause(200);
 assert.equal(await ui('innerWidth'),390);assert.equal(await ui('document.documentElement.scrollWidth<=innerWidth+2'),true);
 await screenshot('vault-mobile.png');
 await fs.writeFile(config.resultFile,JSON.stringify({nativeVault:true,keyboardConnect:true,keyboardPreview:true,coverageVisible:true,reload:true,mobile:true,...(config.sync?{verifiedBackupCoverage:true,readOnlyRecovery:true}:{}),...(config.sourceContext?{sourceCitation:true,annotationBackup:true}:{}),...(config.tasks?{keyboardTaskCapture:true,taskSync:true,slashTask:true,contextReturn:true}:{})}),{mode:0o600});window.destroy();app.exit(0);
}).catch(async error=>{let detail='';try{if(window&&config?.screenshots){await fs.writeFile(path.join(config.screenshots,'vault-failure.png'),(await window.webContents.capturePage()).toPNG());detail='\nSynthetic renderer: '+await window.webContents.executeJavaScript('document.querySelector(".working-surface:not([hidden])")?.textContent');}}catch{}await fs.writeFile(path.join(root,'electron-failure.txt'),String(error.stack)+detail,{mode:0o600});app.exit(1);});
