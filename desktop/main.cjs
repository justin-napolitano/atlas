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
    let config;
    if(app.isPackaged){
      const descriptor=JSON.parse(fs.readFileSync(path.join(app.getAppPath(),'runtime.json'),'utf8'));
      if(Object.keys(descriptor).sort().join(',')!=='format,kind'||descriptor.format!==2||descriptor.kind!=='bundled-local-postgresql')throw new Error('Invalid desktop runtime');
      config={serviceExecutable:path.join(process.resourcesPath,'offline/runtime/atlas-service/atlas-service'),stateDir:path.join(os.homedir(),'.local/share/atlas')};
    }else config={repoRoot:path.resolve(__dirname,'..'),stateDir:path.join(os.homedir(),'.local/share/atlas')};
    host=new DesktopHost(require('electron'),config);
    let storageBusy=false;
    const backup=async()=>{
      if(storageBusy||!host.backend)return;storageBusy=true;
      try{await host.backend.maintenance('backup');await dialog.showMessageBox(host.window,{type:'info',message:'Local backup saved',detail:'A consistent snapshot of saved research is in your private Atlas backups folder. Unfinished editor changes must finish saving to be included.',buttons:['OK','Show backups']}).then(({response})=>response===1?require('electron').shell.openPath(path.join(config.stateDir,'backups')):null);}
      catch{await dialog.showMessageBox({type:'error',message:'Backup could not finish',detail:'Your current research is unchanged. Check available disk space and try again.'});}
      finally{storageBusy=false;}
    };
    const restore=async()=>{
      if(storageBusy||!host.backend)return;
      const chosen=await dialog.showOpenDialog(host.window,{title:'Restore an Atlas backup',defaultPath:path.join(config.stateDir,'backups'),properties:['openFile'],filters:[{name:'Atlas local backup',extensions:['dump']}]});
      if(chosen.canceled||chosen.filePaths.length!==1)return;
      const choice=await dialog.showMessageBox(host.window,{type:'warning',message:'Restore this local Atlas snapshot?',detail:'Choose a backup created by this installation. Atlas will verify and restore it into a separate database, keep your original database, and restart. Cloud services are not involved.',buttons:['Cancel','Restore and restart'],defaultId:0,cancelId:0,noLink:true});
      if(choice.response!==1)return;
      host.beforeExit=async()=>{
        try{await host.backend.maintenance('restore',chosen.filePaths[0]);}
        catch{await dialog.showMessageBox({type:'error',message:'Restore was not completed',detail:'Atlas kept the original database selected. It will reopen your current research.'});}
        app.relaunch();
      };
      host.requestQuit();
    };
    const template=[...(process.platform==='darwin'?[{role:'appMenu'}]:[]),{label:'File',submenu:[{role:'close'},...(app.isPackaged?[{type:'separator'},{label:'Back Up Research Now',click:backup},{label:'Restore Local Backup…',click:restore}]:[])]},
      {role:'editMenu'},{label:'View',submenu:[{role:'reload'},{type:'separator'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'}]},{role:'windowMenu'}];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    await host.open();
  }).catch(async()=>{await host?.backend?.stop();if(host)host.finished=true;fail();});
}
