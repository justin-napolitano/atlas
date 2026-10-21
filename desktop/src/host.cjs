'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {LocalBackend}=require('./backend.cjs');
const {ownedURL,externalURL,localLocation,ownedRequest,safeFilename,privateJSON}=require('./policy.cjs');

class DesktopHost{
  constructor(electron,config,{backendFactory=value=>new LocalBackend(value).start(),confirmDiscard=null,preferencesFile=null}={}){
    Object.assign(this,{electron,config,backendFactory,confirmDiscard});
    this.preferencesFile=preferencesFile||path.join(electron.app.getPath('userData'),'window.json');
    this.window=null;this.quitting=false;this.finished=false;this.preferences={};
  }
  async open(){
    if(this.window&&!this.window.isDestroyed()){if(this.window.isMinimized())this.window.restore();this.window.show();this.window.focus();return this.window;}
    if(this.opening)return this.opening;
    this.opening=this.createWindow().finally(()=>this.opening=null);return this.opening;
  }
  async createWindow(){
    const {app,BrowserWindow,session,screen,shell,dialog}=this.electron;
    try{this.preferences=await privateJSON(this.preferencesFile);}catch{this.preferences={};}
    if(!this.backend){this.backend=await this.backendFactory({...this.config,preferredPort:this.preferences.backendPort});
      this.backend.exited?.then(()=>{if(!this.backend.stopping&&this.window&&!this.window.isDestroyed())dialog.showMessageBox(this.window,{type:'error',title:'Atlas storage stopped',message:'The local service stopped. Keep any unfinished writing open and restart Atlas after saving a copy.',buttons:['Keep open']});});}
    const {origin,credentials}=this.backend;
    const profile=session.fromPartition('persist:atlas-owner');
    profile.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    profile.setPermissionCheckHandler(()=>false);
    profile.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!ownedRequest(details.url,origin)}));
    if(this.downloadHandler)profile.removeListener('will-download',this.downloadHandler);
    this.downloadHandler=(event,item)=>{
      if(!ownedRequest(item.getURL(),origin)){event.preventDefault();return;}
      item.setSaveDialogOptions({defaultPath:path.join(app.getPath('downloads'),safeFilename(item.getFilename()))});
    };profile.on('will-download',this.downloadHandler);
    await profile.cookies.set({url:origin,name:'atlas_local_owner',value:credentials.session,httpOnly:true,secure:false,sameSite:'strict',path:'/'});
    const area=screen.getPrimaryDisplay().workAreaSize;
    const width=Math.min(area.width,Math.max(760,Number(this.preferences.width)||1280));
    const height=Math.min(area.height,Math.max(560,Number(this.preferences.height)||860));
    const win=new BrowserWindow({title:'Atlas',width,height,minWidth:640,minHeight:480,show:false,backgroundColor:'#1c1c1c',
      webPreferences:{session:profile,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,
        contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:true}});
    this.window=win;
    const openExternal=url=>{const target=externalURL(url);if(target)shell.openExternal(target).catch(()=>{});};
    win.webContents.on('will-attach-webview',event=>event.preventDefault());
    win.webContents.setWindowOpenHandler(({url})=>{if(ownedURL(url,origin))win.loadURL(url).catch(()=>{});else openExternal(url);return {action:'deny'};});
    for(const name of ['will-navigate','will-redirect'])win.webContents.on(name,(event,url)=>{
      if(!ownedURL(url,origin)){event.preventDefault();if(name==='will-navigate')openExternal(url);}
    });
    win.webContents.on('will-prevent-unload',event=>{
      const discard=this.confirmDiscard?this.confirmDiscard():dialog.showMessageBoxSync(win,{type:'warning',title:'Writing is still unsaved',
        message:'Your latest writing has not been saved yet.',detail:'Keep Atlas open to finish saving. Close anyway only if you intend to leave this unfinished writing.',
        buttons:['Keep writing','Close anyway'],defaultId:0,cancelId:0,noLink:true})===1;
      if(discard){this.savePreferences('/workspace.html?view=continue');event.preventDefault();}
      else {this.quitting=false;this.beforeExit=null;}
    });
    win.on('close',()=>this.savePreferences());
    win.on('closed',()=>{this.window=null;if(this.quitting||process.platform!=='darwin')this.finishQuit();});
    let location='/workspace.html';
    try{if(typeof this.preferences.location==='string')location=localLocation(new URL(this.preferences.location,origin).href,origin);}catch{}
    await win.loadURL(origin+location);
    win.show();return win;
  }
  savePreferences(location){
    if(!this.window||this.window.isDestroyed()||!this.backend)return;
    const [width,height]=this.window.getSize();
    const value={width,height,location:location||localLocation(this.window.webContents.getURL(),this.backend.origin),backendPort:Number(new URL(this.backend.origin).port)};
    this.preferencesWrite=(this.preferencesWrite||Promise.resolve()).catch(()=>{}).then(async()=>{
      await fs.mkdir(path.dirname(this.preferencesFile),{recursive:true,mode:0o700});
      const temporary=this.preferencesFile+'.tmp';await fs.writeFile(temporary,JSON.stringify(value),{mode:0o600});await fs.rename(temporary,this.preferencesFile);
    });
  }
  requestQuit(){
    this.quitting=true;
    if(this.window&&!this.window.isDestroyed())this.window.close();else this.finishQuit();
  }
  async finishQuit(){
    if(this.finishing)return this.finishing;
    this.finishing=(async()=>{await this.preferencesWrite;await this.backend?.stop();await this.beforeExit?.();this.finished=true;this.electron.app.quit();})();return this.finishing;
  }
}
module.exports={DesktopHost};
