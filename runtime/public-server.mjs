// Standalone Node 24 runtime: built-in modules only, no owner API/database client.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, readdir, lstat, realpath} from 'node:fs/promises';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const MAX_BYTES = 25_000_000;
const asset = /^assets\/[A-Za-z0-9_-]+\.(js|css)$/;
const runtimePath = 'runtime/public-server.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keysEqual = (value, keys) => object(value) && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
const canonical = value => JSON.stringify(sort(value))+'\n';
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,sort(value[key])]));
  return value;
}

async function bounded(path, limit) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid public file');
  const data = await readFile(path);
  if (data.length > limit) throw new Error('Public file byte limit');
  return data;
}

async function inventory(root, prefix='') {
  const files = [];
  for (const item of await readdir(join(root,prefix), {withFileTypes:true})) {
    const name = prefix+item.name;
    if (item.isSymbolicLink()) throw new Error('Public symlink');
    if (item.isDirectory()) files.push(...await inventory(root,name+'/'));
    else if (item.isFile()) files.push(name);
    else throw new Error('Unsupported public file');
  }
  return files.sort();
}

export async function loadPublicSite(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Public root symlink');
  const root = await realpath(directory);
  const manifest = JSON.parse((await bounded(join(root,'build-manifest.json'),1_000_000)).toString('utf8'));
  if (!keysEqual(manifest,['format_version','kind','build_id','built_at','source_commit','source_inputs',
      'release_id','release_manifest_sha256','files','runtime','deployed']) || manifest.format_version!==1 ||
      manifest.kind!=='approved_public_site' || manifest.runtime!=='node_http_read_only_v1' || manifest.deployed!==false ||
      !/^[a-f0-9]{40}$/.test(manifest.source_commit) || !/^release-[a-f0-9]{64}$/.test(manifest.release_id) ||
      !object(manifest.files) || Object.keys(manifest.files).length>250)
    throw new Error('Invalid public build manifest');
  const {build_id, ...content} = manifest;
  if (build_id !== 'build-'+sha(canonical(content))) throw new Error('Public build identity mismatch');
  const actual = await inventory(root);
  const expected = [...Object.keys(manifest.files),'build-manifest.json'].sort();
  if (actual.join('\n')!==expected.join('\n')) throw new Error('Unexpected public build file');
  const all = new Map(); let total = 0;
  for (const [name,info] of Object.entries(manifest.files)) {
    if (name.includes('..') || name.includes('\\') || name.startsWith('/') ||
        !(name===runtimePath || ['site/index.html','site/.public-profile.json'].includes(name) ||
          name.startsWith('site/') && asset.test(name.slice(5)) || name.startsWith('release/')) ||
        !keysEqual(info,['bytes','sha256']) || !Number.isInteger(info.bytes) || info.bytes<0 ||
        !/^[a-f0-9]{64}$/.test(info.sha256)) throw new Error('Unregistered public build file');
    const data = await bounded(join(root,name),MAX_BYTES); total += data.length;
    if (total>MAX_BYTES || data.length!==info.bytes || sha(data)!==info.sha256) throw new Error('Public build integrity mismatch');
    all.set(name,data);
  }
  for (const name of [runtimePath,'site/index.html','site/.public-profile.json','release/release-manifest.json','release/data/projects.json','release/data/release.json'])
    if (!all.has(name)) throw new Error('Missing public entry point');
  if (manifest.files[runtimePath].sha256!==manifest.source_inputs?.[runtimePath]?.sha256 ||
      manifest.files[runtimePath].bytes!==manifest.source_inputs?.[runtimePath]?.bytes)
    throw new Error('Public runtime provenance mismatch');
  const releaseBytes = all.get('release/release-manifest.json');
  if (sha(releaseBytes)!==manifest.release_manifest_sha256) throw new Error('Approved release hash mismatch');
  const release = JSON.parse(releaseBytes.toString('utf8'));
  const {release_id,...releaseContent} = release;
  if (release_id!==manifest.release_id || release_id!=='release-'+sha(canonical(releaseContent)) || !object(release.files))
    throw new Error('Approved release identity mismatch');
  const releaseFiles = Object.keys(manifest.files).filter(name=>name.startsWith('release/') && name!=='release/release-manifest.json');
  if (releaseFiles.length!==Object.keys(release.files).length) throw new Error('Approved file index mismatch');
  const routes = new Map([['/',all.get('site/index.html')],['/index.html',all.get('site/index.html')]]);
  const types = new Map([['/','text/html; charset=utf-8'],['/index.html','text/html; charset=utf-8']]);
  for (const [name,data] of all) {
    let path, type;
    if (name.startsWith('site/assets/')) {path='/'+name.slice(5);type=name.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8';}
    else if (name.startsWith('release/')) {
      const relative=name.slice(8);
      if (relative!=='release-manifest.json' && (release.files[relative]?.sha256!==manifest.files[name].sha256 ||
          release.files[relative]?.bytes!==manifest.files[name].bytes ||
          !(relative==='data/projects.json' || relative==='data/release.json' || /^data\/graph-[a-f0-9]{64}\.json$/.test(relative) ||
            ['semantic/publication.ossie.json','semantic/upstream.json',...['osi-schema.json','LICENSE','LICENSE-Docs','NOTICE'].map(p=>'semantic/vendor/apache-ossie/'+p)].includes(relative))))
        throw new Error('Unregistered approved public file');
      path='/'+relative;type=relative.endsWith('.json')?'application/json; charset=utf-8':'text/plain; charset=utf-8';
    }
    if (path) {routes.set(path,data);types.set(path,type);}
  }
  return {manifest,routes,types};
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; worker-src 'none'";
const HEADERS = {
  'Content-Security-Policy': CSP, 'Strict-Transport-Security':'max-age=31536000',
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'strict-origin-when-cross-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()', 'Cross-Origin-Resource-Policy':'same-origin',
  'Cache-Control':'no-store, max-age=0'
};

export async function startPublicServer(directory, {host='0.0.0.0',port=8080,requestLimit=600,log=()=>{}}={}) {
  if (!Number.isInteger(requestLimit) || requestLimit<1 || !Number.isInteger(port) || port<0 || port>65535)
    throw new Error('Invalid public runtime limits');
  const {manifest,routes,types} = await loadPublicSite(directory);
  let requests=0,windowStart=Date.now();
  const server=createServer({maxHeaderSize:8192,requestTimeout:5000,headersTimeout:5000,keepAliveTimeout:5000,
    connectionsCheckingInterval:1000},(request,response)=>{
    const began=performance.now();
    const path=(request.url || '').split('?')[0];
    const health=['/health/live','/health/ready'].includes(path);
    let route='not_found',status=404,body=Buffer.from('Not found\n'),type='text/plain; charset=utf-8';
    const method=['GET','HEAD'].includes(request.method)?request.method:'other';
    if (method==='other') {
      status=405;body=Buffer.from('Method not allowed\n');route='method_not_allowed';response.setHeader('Allow','GET, HEAD');response.setHeader('Connection','close');
    } else if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] || 0)!==0) {
      status=413;body=Buffer.from('Request body not allowed\n');route='body_rejected';response.setHeader('Connection','close');
    } else if (health) {
      status=200;type='application/json; charset=utf-8';route='health';body=Buffer.from(JSON.stringify({status:'ok',build_id:manifest.build_id}));
    } else {
      const now=Date.now();if(now-windowStart>=60000){windowStart=now;requests=0;}
      if (++requests>requestLimit) {
        status=429;body=Buffer.from('Request limit exceeded\n');route='rate_limited';response.setHeader('Retry-After','60');
      } else if (routes.has(path)) {
        status=200;body=routes.get(path);type=types.get(path);
        route=path==='/' || path==='/index.html'?'page':path.startsWith('/assets/')?'asset':path.startsWith('/data/')?'public_data':'public_metadata';
      }
    }
    for (const [key,value] of Object.entries(HEADERS)) response.setHeader(key,value);
    response.setHeader('Content-Type',type);response.setHeader('Content-Length',body.length);
    response.setHeader('X-Research-Build',manifest.build_id);
    response.on('finish',()=>log({event:'public_request',method,route,status,duration_ms:Math.round(performance.now()-began)}));
    response.writeHead(status);response.end(method==='HEAD'?undefined:body);request.resume();
  });
  server.maxConnections=32;
  server.on('clientError',(_error,socket)=>{
    if(socket.writable){
      const headers=Object.entries(HEADERS).map(([key,value])=>key+': '+value).join('\r\n');
      socket.end('HTTP/1.1 400 Bad Request\r\n'+headers+'\r\nConnection: close\r\nContent-Length: 12\r\n\r\nBad request\n');
    }
    log({event:'public_request',method:'other',route:'bad_request',status:400,duration_ms:0});
  });
  await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,host,accept);});
  return {server,manifest};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const value=process.env.PORT || '8080';
    if(!/^\d{1,5}$/.test(value) || Number(value)<1 || Number(value)>65535) throw new Error('Invalid runtime port');
    const {server,manifest}=await startPublicServer(resolve(dirname(fileURLToPath(import.meta.url)),'..'),{
      port:Number(value),log:value=>console.log(JSON.stringify(value))});
    console.log(JSON.stringify({event:'public_runtime_ready',build_id:manifest.build_id}));
    process.once('SIGTERM',()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),8000).unref();});
  } catch {
    console.error('Public runtime failed to initialize.');process.exitCode=1;
  }
}
