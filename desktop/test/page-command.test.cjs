'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {newPageMenuItem}=require('../src/page-command.cjs');
test('New Page has the platform accelerator and uses the existing capture event',async()=>{
 const calls=[];const item=newPageMenuItem({open:async()=>({isDestroyed:()=>false,webContents:{executeJavaScript:async code=>calls.push(code)}})});
 assert.equal(item.accelerator,'CmdOrCtrl+N');await item.click();
 assert.deepEqual(calls,["window.dispatchEvent(new Event('atlas:new-page'))"]);
});
