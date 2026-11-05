const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {LocalBackend}=require('../src/backend.cjs');

async function setup(mode='ready',bundled=false){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-child-test-'));
  await fs.mkdir(path.join(root,'root with spaces'));
  await fs.writeFile(path.join(root,'local-session.json'),JSON.stringify({launch:'synthetic-launch-'+ 'l'.repeat(48),session:'synthetic-session-'+ 's'.repeat(48)}),{mode:0o600});
  let observed;
  const backend=new LocalBackend({...(bundled?{serviceExecutable:path.join(root,'bundled service')}:{repoRoot:path.join(root,'root with spaces')}),stateDir:root},{timeout:1200,
    spawnChild:(command,args,options)=>{observed={command,args,options};return spawn(process.execPath,[path.join(__dirname,'backend-child.cjs'),mode],options);}});
  return {backend,get observed(){return observed;},async cleanup(){await backend.stop();await fs.rm(root,{recursive:true,force:true});}};
}
test('managed child announces its own service and exits through its parent pipe',async()=>{
  const test=await setup();try{
    await test.backend.start();assert.match(test.backend.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(test.observed.options.shell,undefined);assert.deepEqual(test.observed.options.stdio,['pipe','pipe','pipe']);
    assert.ok(test.observed.args[0].includes('root with spaces'));
    await test.backend.stop();assert.ok(test.backend.exit);assert.equal(test.backend.exit.code,0);
  }finally{await test.cleanup();}
});
test('packaged service launches directly without Python or checkout environment',async()=>{
  const test=await setup('ready',true);try{
    await test.backend.start();
    assert.ok(test.observed.command.endsWith('bundled service'));
    assert.equal(test.observed.args[0],'--state-dir');assert.equal(test.observed.args.at(-1),'serve');
    assert.equal(test.observed.options.env.PYTHONPATH,undefined);
    assert.equal(test.observed.options.shell,undefined);
  }finally{await test.cleanup();}
});
test('malformed child announcement cannot become a backend and owned process is cleaned up',async()=>{
  const test=await setup('invalid');try{await assert.rejects(test.backend.start(),/startup response/);assert.ok(test.backend.exit);}finally{await test.cleanup();}
});
test('startup failure and unavailable database are reported without adopting other services',async()=>{
  for(const mode of ['exit','unready']){
    const test=await setup(mode);try{await assert.rejects(test.backend.start());assert.ok(test.backend.exit);}finally{await test.cleanup();}
  }
});
