'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');

async function main(){
  const desktop=path.resolve(__dirname,'..'),repoRoot=path.dirname(desktop),stateDir=path.join(os.homedir(),'.local/share/atlas');
  const output=path.join(repoRoot,'research-library/desktop-build');
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'atlas-desktop-package-'));
  try{
    for(const name of ['main.cjs','src'])await fs.cp(path.join(desktop,name),path.join(staging,name),{recursive:true});
    const pkg=require('../package.json');
    await fs.writeFile(path.join(staging,'package.json'),JSON.stringify({name:'atlas-desktop',productName:'Atlas',version:pkg.version,main:'main.cjs',description:pkg.description}));
    await fs.writeFile(path.join(staging,'runtime.json'),JSON.stringify({format:1,repoRoot,stateDir}));
    const {default:packager}=await import('@electron/packager');
    const options={dir:staging,out:output,name:'Atlas',platform:process.platform,arch:process.arch,electronVersion:pkg.devDependencies.electron,
      appBundleId:'org.researchatlas.desktop',appCategoryType:'public.app-category.education',asar:true,overwrite:true,prune:true};
    if(process.platform==='darwin'){
      const png=path.join(staging,'atlas.png'),iconset=path.join(staging,'Atlas.iconset');await fs.mkdir(iconset);
      execFileSync('/usr/bin/swift',[path.join(__dirname,'icon.swift'),png],{stdio:'pipe'});
      for(const size of [16,32,128,256,512])for(const scale of [1,2])execFileSync('/usr/bin/sips',['-z',String(size*scale),String(size*scale),png,'--out',path.join(iconset,`icon_${size}x${size}${scale===2?'@2x':''}.png`)],{stdio:'pipe'});
      options.icon=path.join(staging,'Atlas.icns');execFileSync('/usr/bin/iconutil',['-c','icns',iconset,'-o',options.icon],{stdio:'pipe'});
      // The generated icon is copied by packager, never retained as extra app data.
      await fs.rm(iconset,{recursive:true});await fs.rm(png);
    }
    const paths=await packager(options);
    console.log(JSON.stringify({kind:'configured_local_desktop',output:paths,standaloneInstaller:false,signed:false}));
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}
main().catch(()=>{console.error('Desktop packaging failed. Existing app and research were not changed.');process.exitCode=1;});
