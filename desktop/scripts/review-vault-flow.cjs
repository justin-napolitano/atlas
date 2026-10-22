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
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Review sync").focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' [aria-label="Reviewed sync"]`)?.textContent.includes("Send to GitHub")'),'frozen sync review');
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Apply reviewed changes").focus()');press('Return');
 await until(()=>ui('document.querySelector(`'+active+' [aria-label="Reviewed sync"]`)?.textContent.includes("This sync is confirmed.")'),'reviewed sync confirmation');
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
 await ui('[...document.querySelectorAll("'+active+' button")].find(row=>row.textContent==="Open context page").focus()');press('Return');
 await until(()=>ui('document.querySelector("'+active+'")?.textContent.includes("Synthetic task context")'),'return to original page');
 await ui('[...document.querySelectorAll(".connected-sidebar-footer button")].find(row=>row.textContent==="Private vault").focus()');press('Return');
 }
 await pause(200);await fs.writeFile(path.join(config.screenshots,'vault-desktop.png'),(await window.webContents.capturePage()).toPNG());
 const loaded=new Promise(resolve=>window.webContents.once('did-finish-load',resolve));window.webContents.reload();await loaded;
 await until(()=>ui('document.querySelector("'+active+'")?.textContent.includes("Connected as synthetic-owner")'),'connection survives reload');
 await window.setMinimumSize(0,0);window.setContentSize(390,844);await pause(200);
 assert.equal(await ui('innerWidth'),390);assert.equal(await ui('document.documentElement.scrollWidth<=innerWidth+2'),true);
 await fs.writeFile(path.join(config.screenshots,'vault-mobile.png'),(await window.webContents.capturePage()).toPNG());
 await fs.writeFile(config.resultFile,JSON.stringify({nativeVault:true,keyboardConnect:true,keyboardPreview:true,coverageVisible:true,reload:true,mobile:true}),{mode:0o600});window.destroy();app.exit(0);
}).catch(async error=>{try{if(window&&config?.screenshots)await fs.writeFile(path.join(config.screenshots,'vault-failure.png'),(await window.webContents.capturePage()).toPNG());}catch{}await fs.writeFile(path.join(root,'electron-failure.txt'),String(error.stack),{mode:0o600});app.exit(1);});
