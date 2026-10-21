'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');

function ownedURL(value,origin){
  try{const url=new URL(value);return url.origin===origin&&!url.username&&!url.password&&['/workspace.html','/publish.html'].includes(url.pathname);}catch{return false;}
}
function externalURL(value){
  try{const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!url.hostname)return null;
    if(url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname==='[::1]'||/^127\./.test(url.hostname)||url.hostname==='0.0.0.0')return null;
    return url.href;
  }catch{return null;}
}
function localLocation(value,origin){
  if(!ownedURL(value,origin))return '/workspace.html';
  const url=new URL(value);if(url.search.length>4000)return '/workspace.html';
  return url.pathname+url.search;
}
function ownedRequest(value,origin){
  try{
    const url=new URL(value);
    return url.origin===origin||(url.protocol==='blob:'&&new URL(url.pathname).origin===origin)||value.startsWith('data:image/');
  }catch{return false;}
}
function safeFilename(value){
  const clean=path.basename(String(value).replaceAll('\\','/')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,180);
  return clean&&clean!=='.'&&clean!=='..'?clean:'Atlas export.md';
}
function announcement(line){
  if(typeof line!=='string'||line.length>300)throw new Error('Invalid desktop backend announcement');
  const value=JSON.parse(line);
  if(Object.keys(value).sort().join(',')!=='format,kind,port'||value.kind!=='atlas-local-owner'||value.format!==1||!Number.isInteger(value.port)||value.port<1024||value.port>65535)throw new Error('Invalid desktop backend announcement');
  return `http://127.0.0.1:${value.port}`;
}
async function privateJSON(filename){
  const info=await fs.lstat(filename);
  if(!info.isFile()||info.isSymbolicLink()||info.size>4096||(info.mode&0o077)||typeof process.getuid==='function'&&info.uid!==process.getuid())throw new Error('Private local configuration required');
  return JSON.parse(await fs.readFile(filename,'utf8'));
}
module.exports={ownedURL,externalURL,localLocation,ownedRequest,safeFilename,announcement,privateJSON};
