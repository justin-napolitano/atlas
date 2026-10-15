import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, cp, writeFile, rm, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {request} from 'node:http';

const directory=process.env.RESEARCH_TEST_PUBLIC_SITE;
if (!directory) throw new Error('Set RESEARCH_TEST_PUBLIC_SITE to a synthetic verified artifact');
const {startPublicServer,loadPublicSite}=await import(pathToFileURL(join(directory,'runtime/public-server.mjs')));

async function running(fn,options={}) {
  const logs=[];
  const {server,manifest}=await startPublicServer(directory,{host:'127.0.0.1',port:0,log:value=>logs.push(value),...options});
  try { await fn(`http://127.0.0.1:${server.address().port}`,logs,manifest); }
  finally { await new Promise(resolve=>server.close(resolve)); }
}

test('verified runtime serves exactly the public page, assets, approved data and semantic licenses',async()=>{
  await running(async(base,_logs,manifest)=>{
    const response=await fetch(base+'/?project=synthetic-islam&record=shared%3Asource#records');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-research-build'),manifest.build_id);
    const html=await response.text();
    assert.ok(!/<script>(?!\s*<\/script>)/.test(html));
    const index=await (await fetch(base+'/data/projects.json')).json();
    assert.equal(index.projects.length,2);
    for(const project of index.projects){
      const graph=await (await fetch(base+'/data/'+project.graph_data)).json();
      assert.equal(graph.project.id,project.id);
      assert.ok(graph.nodes.every(node=>node.status==='pending'));
    }
    for(const asset of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) assert.equal((await fetch(base+asset[1])).status,200);
    assert.equal((await fetch(base+'/semantic/vendor/apache-ossie/NOTICE')).status,200);
    assert.equal((await fetch(base+'/release-manifest.json')).status,200);
  });
});

test('HTML and JSON responses enforce CSP, cache, transport and browser boundaries',async()=>{
  await running(async base=>{
    for(const path of ['/','/data/projects.json','/does-not-exist','/health/ready']){
      const response=await fetch(base+path);
      assert.match(response.headers.get('content-security-policy'),/script-src 'self';/);
      assert.doesNotMatch(response.headers.get('content-security-policy'),/script-src[^;]*unsafe-inline|unsafe-eval/);
      assert.equal(response.headers.get('cache-control'),'no-store, max-age=0');
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.equal(response.headers.get('x-frame-options'),'DENY');
      assert.match(response.headers.get('strict-transport-security'),/max-age=31536000/);
      assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
      assert.equal(response.headers.get('access-control-allow-origin'),null);
      assert.equal(response.headers.get('set-cookie'),null);
      await response.arrayBuffer();
    }
  });
});

test('owner pages, APIs, build history, source maps, runtime code and traversal are unavailable',async()=>{
  await running(async base=>{
    for(const path of ['/workspace.html','/publish.html','/v1/me','/v1/search','/build-manifest.json',
      '/current.json','/builds/','/runtime/public-server.mjs','/site/.public-profile.json','/.env',
      '/data/public-graph.json','/releases/old/data/projects.json','/%252e%252e/runtime/public-server.mjs','/assets/owner.js.map']){
      const response=await fetch(base+path);assert.equal(response.status,404,path);
      assert.equal(await response.text(),'Not found\n');
    }
    for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
      const response=await fetch(base+'/v1/personal-states',{method,body:'SYNTHETIC_PRIVATE_BODY'});
      assert.equal(response.status,405);assert.equal(await response.text(),'Method not allowed\n');
    }
    const head=await fetch(base+'/data/projects.json',{method:'HEAD'});
    assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>0);assert.equal(await head.text(),'');
  });
});

test('logs retain route class and status without URLs, private query values or authorization',async()=>{
  await running(async(base,logs)=>{
    const response=await fetch(base+'/unknown?note=SYNTHETIC_PRIVATE_QUERY',{headers:{Authorization:'SYNTHETIC_NOT_A_REAL_TOKEN'}});
    await response.text();
    assert.ok(logs.length>0);assert.equal(logs[0].route,'not_found');assert.equal(logs[0].status,404);
    assert.doesNotMatch(JSON.stringify(logs),/SYNTHETIC_|unknown\?|Authorization/);
    assert.deepEqual(Object.keys(logs[0]).sort(),['duration_ms','event','method','route','status']);
  });
});

test('bounded instance request budget preserves health checks',async()=>{
  await running(async base=>{
    for(let i=0;i<2;i++) assert.equal((await fetch(base+'/')).status,200);
    const limited=await fetch(base+'/data/projects.json');assert.equal(limited.status,429);
    assert.equal(limited.headers.get('retry-after'),'60');
    assert.equal((await fetch(base+'/health/ready')).status,200);
  },{requestLimit:2});
});

test('GET bodies are rejected before reading public files',async()=>{
  await running(async base=>{
    const status=await new Promise((resolve,reject)=>{
      const req=request(base+'/data/projects.json',{method:'GET',headers:{'Content-Length':'4'}},response=>{
        response.resume();response.on('end',()=>resolve(response.statusCode));
      });req.on('error',reject);req.end('test');
    });
    assert.equal(status,413);
  });
});

test('tampered, extra and symlink files prevent startup instead of becoming public',async()=>{
  for(const kind of ['tamper','extra','symlink']){
    const root=await mkdtemp(join(tmpdir(),'public-artifact-test-'));
    try {
      await cp(directory,join(root,'artifact'),{recursive:true});
      const artifact=join(root,'artifact');
      if(kind==='tamper') await writeFile(join(artifact,'site/index.html'),'SYNTHETIC_TAMPER');
      else if(kind==='extra') await writeFile(join(artifact,'site/private-notes.json'),'SYNTHETIC_PRIVATE_NOTE');
      else await symlink(join(artifact,'runtime/public-server.mjs'),join(artifact,'site/private-link'));
      await assert.rejects(loadPublicSite(artifact));
    } finally {await rm(root,{recursive:true,force:true});}
  }
});
