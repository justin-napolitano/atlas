'use strict';
// Trusted application menu action; reuse the renderer's existing private capture path.
function newPageMenuItem(host){
  return {label:'New Page',accelerator:'CmdOrCtrl+N',click:async()=>{
    const window=await host.open();
    if(!window.isDestroyed())await window.webContents.executeJavaScript("window.dispatchEvent(new Event('atlas:new-page'))");
  }};
}
module.exports={newPageMenuItem};
