import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';

const redirect=server=>{server.middlewares.use((request,response,next)=>{
  if(request.url!=='/')return next();
  response.writeHead(302,{Location:'/samples/'});response.end();
});};
export default defineConfig({
  publicDir:false,
  cacheDir:".vite-samples",
  optimizeDeps:{noDiscovery:true,include:[]},
  plugins:[{name:'reading-sample-entry',configureServer:redirect,configurePreviewServer:redirect}],
  server:{host:'127.0.0.1',port:5181,strictPort:true},
  preview:{host:'127.0.0.1',port:5181,strictPort:true},
  build:{outDir:'dist-samples',rollupOptions:{input:Object.fromEntries(['index','reader/index','study/index','notebook/index'].map(name=>[name,fileURLToPath(new URL(`./samples/${name}.html`,import.meta.url))]))}},
});
