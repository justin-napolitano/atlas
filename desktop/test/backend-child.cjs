// Synthetic unit-test child. The production app never imports this file.
const http=require('node:http');
const mode=process.argv[2];
if(mode==='exit')process.exit(1);
const server=http.createServer((req,res)=>{
  const authorized=req.headers.cookie==='atlas_local_owner=synthetic-session-'+ 's'.repeat(48);
  res.writeHead(authorized&&mode!=='unready'?200:503,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ready'}));
});
server.listen(0,'127.0.0.1',()=>{
  console.log(JSON.stringify(mode==='invalid'?{url:'https://example.invalid'}:{format:1,kind:'atlas-local-owner',port:server.address().port}));
});
process.stdin.resume();process.stdin.on('end',()=>server.close(()=>process.exit(0)));
