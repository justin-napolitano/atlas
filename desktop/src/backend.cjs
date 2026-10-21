'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const {announcement,privateJSON}=require('./policy.cjs');

class LocalBackend{
  constructor(config,{spawnChild=spawn,fetchHTTP=fetch,timeout=30000}={}){
    Object.assign(this,{config,spawnChild,fetchHTTP,timeout});this.child=null;this.stopping=false;
  }
  async start(){
    const {repoRoot,stateDir,serviceExecutable}=this.config;
    const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};
    if(repoRoot)env.PYTHONPATH=path.join(repoRoot,'src');else delete env.PYTHONPATH;
    for(const key of ['PYTHONHOME','PYTHONINSPECT','PYTHONSTARTUP','NODE_OPTIONS','ELECTRON_RUN_AS_NODE'])delete env[key];
    const preferred=Number.isInteger(this.config.preferredPort)&&this.config.preferredPort>=1024&&this.config.preferredPort<=65535?this.config.preferredPort:0;
    const command=serviceExecutable||path.join(repoRoot,'.venv/bin/python');
    const args=serviceExecutable?['--state-dir',stateDir,'--port',String(preferred),'serve']:
      [path.join(repoRoot,'scripts/local_workspace.py'),'--state-dir',stateDir,'desktop-serve','--port',String(preferred)];
    const child=this.spawnChild(command,args,{cwd:serviceExecutable?path.dirname(serviceExecutable):repoRoot,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
    this.child=child;
    child.stdin.on('error',()=>{});
    this.exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{this.exit={code,signal};resolve();});child.once('error',()=>{this.exit={code:null,signal:'startup-error'};resolve();});});
    child.stderr.on('data',()=>{}); // Never forward private runtime diagnostics to renderer/logs.
    try{
      this.origin=await new Promise((resolve,reject)=>{
        let line='',done=false;
        const timer=setTimeout(()=>finish(new Error('Local backend did not start')),this.timeout);
        const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);child.stdout.removeListener('data',read);child.stdout.resume();error?reject(error):resolve(value);};
        const read=chunk=>{line+=chunk.toString();if(line.length>512)return finish(new Error('Invalid backend startup response'));
          if(line.includes('\n')){try{finish(null,announcement(line.slice(0,line.indexOf('\n'))));}catch{finish(new Error('Invalid backend startup response'));}}};
        child.stdout.on('data',read);this.exited.then(()=>finish(new Error('Local backend stopped during startup')));
      });
      // A fresh packaged installation creates private credentials before announcing.
      const keys=await privateJSON(path.join(stateDir,'local-session.json'));
      if(Object.keys(keys).sort().join(',')!=='launch,session'||!Object.values(keys).every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(v)))throw new Error('Local session is not configured');
      this.credentials=keys;
      const deadline=Date.now()+this.timeout;
      while(Date.now()<deadline){
        if(this.exit)throw new Error('Local backend stopped during startup');
        try{const result=await this.fetchHTTP(this.origin+'/health/ready',{headers:{Cookie:'atlas_local_owner='+keys.session},redirect:'error',signal:AbortSignal.timeout(2000)});
          if(result.status===200&&(await result.json()).status==='ready')return this;
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,120));
      }
      throw new Error('Local database did not become ready');
    }catch(error){await this.stop();throw error;}
  }
  async stop(){
    if(this.stopPromise)return this.stopPromise;
    this.stopping=true;
    this.stopPromise=(async()=>{
      if(!this.child||this.exit)return;
      this.child.stdin.end(); // EOF asks only this owned API child to stop gracefully.
      let timer;await Promise.race([this.exited,new Promise(resolve=>{timer=setTimeout(resolve,12000);})]);clearTimeout(timer);
      if(!this.exit){this.child.kill('SIGTERM');await Promise.race([this.exited,new Promise(resolve=>setTimeout(resolve,2000))]);}
      if(!this.exit)this.child.kill('SIGKILL');
    })();return this.stopPromise;
  }
}
module.exports={LocalBackend};
