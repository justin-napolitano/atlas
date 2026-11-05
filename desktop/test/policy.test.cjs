const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {ownedURL,externalURL,localLocation,ownedRequest,safeFilename,announcement,privateJSON}=require('../src/policy.cjs');
const origin='http://127.0.0.1:54321';
test('privileged window navigation never trusts foreign origins, credentials or native schemes',()=>{
  assert.equal(ownedURL(origin+'/workspace.html?view=quran',origin),true);
  for(const url of ['https://example.org/workspace.html',origin+'/v1/workspace/notes','file:///etc/passwd','javascript:alert(1)','http://user:pass@127.0.0.1:54321/workspace.html','http://127.0.0.1:54322/workspace.html'])assert.equal(ownedURL(url,origin),false);
  for(const url of ['file:///tmp/example','javascript:alert(1)','data:text/html,test','https://user:password@example.org','http://127.1/path','http://localhost/path'])assert.equal(externalURL(url),null);
  assert.equal(externalURL('https://example.org/article'),'https://example.org/article');
});
test('renderer resources are restricted to the owned service and local images/blobs',()=>{
  assert.equal(ownedRequest(origin+'/assets/app.js',origin),true);
  assert.equal(ownedRequest('blob:'+origin+'/download',origin),true);
  for(const url of ['https://example.org/tracking.png','file:///tmp/config','blob:https://example.org/download','data:text/javascript,alert(1)'])assert.equal(ownedRequest(url,origin),false);
});
test('child port announcements cannot smuggle an external backend or credentials',()=>{
  assert.equal(announcement(JSON.stringify({format:1,kind:'atlas-local-owner',port:54321})),origin);
  for(const value of [{format:1,kind:'atlas-local-owner',port:80},{format:1,kind:'atlas-local-owner',port:'54321'},{format:1,kind:'atlas-local-owner',port:54321,url:'https://evil.invalid'},{}])assert.throws(()=>announcement(JSON.stringify(value)));
});
test('window restoration and exported filenames cannot become filesystem or navigation targets',()=>{
  assert.equal(localLocation(origin+'/workspace.html?view=notes',origin),'/workspace.html?view=notes');
  assert.equal(localLocation('file:///tmp/private',origin),'/workspace.html');
  assert.equal(safeFilename('../../test.md'),'test.md');assert.equal(safeFilename('..\\secret.txt'),'secret.txt');
});
test('private bootstrap files reject symlinks and loose permissions',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-private-test-'));
  try{const file=path.join(root,'keys.json');await fs.writeFile(file,'{"synthetic":true}',{mode:0o600});
    assert.deepEqual(await privateJSON(file),{synthetic:true});
    const alias=path.join(root,'alias.json');await fs.symlink(file,alias);await assert.rejects(privateJSON(alias));
    await fs.chmod(file,0o644);await assert.rejects(privateJSON(file));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
