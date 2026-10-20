'use strict';
const {app,Menu,dialog}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {DesktopHost}=require('./src/host.cjs');

app.setName('Atlas');
app.enableSandbox();
app.setPath('userData',path.join(app.getPath('appData'),'Atlas'));
fs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});fs.chmodSync(app.getPath('userData'),0o700);
if(!app.requestSingleInstanceLock())app.quit();
else{
  let host;
  const fail=()=>{dialog.showErrorBox('Atlas could not open','The local workspace is not ready. Your research is unchanged. Check the installed local runtime and try opening Atlas again.');app.quit();};
  app.on('second-instance',()=>host?.open().catch(fail));
  app.on('before-quit',event=>{if(host&&!host.finished){event.preventDefault();host.requestQuit();}});
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')host?.requestQuit();});
  app.on('activate',()=>host?.open().catch(fail));
  app.whenReady().then(async()=>{
    const config=app.isPackaged?JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'runtime.json'),'utf8')):
      {format:1,repoRoot:path.resolve(__dirname,'..'),stateDir:path.join(os.homedir(),'.local/share/atlas')};
    if(Object.keys(config).sort().join(',')!=='format,repoRoot,stateDir'||config.format!==1||!path.isAbsolute(config.repoRoot)||!path.isAbsolute(config.stateDir))throw new Error('Invalid desktop runtime');
    host=new DesktopHost(require('electron'),config);
    const template=[...(process.platform==='darwin'?[{role:'appMenu'}]:[]),{label:'File',submenu:[{role:'close'}]},
      {role:'editMenu'},{label:'View',submenu:[{role:'reload'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},{role:'windowMenu'}];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    await host.open();
  }).catch(async()=>{await host?.backend?.stop();if(host)host.finished=true;fail();});
}
