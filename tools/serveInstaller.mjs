import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
const [file,bind,peer]=process.argv.slice(2);
if(!file||!bind||!peer)throw new Error('Supply installer file, private bind address and allowed peer.');
const stats=await fs.stat(file),hash=createHash('sha256');await pipeline(createReadStream(file),hash);const sha256=hash.digest('hex');
const server=createServer((request,response)=>{
 if(request.socket.remoteAddress?.replace(/^::ffff:/,'')!==peer){response.writeHead(403);response.end();return;}
 if(request.url==='/metadata'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({bytes:stats.size,sha256}));return;}
 if(request.url!=='/installer'||!['GET','HEAD'].includes(request.method)){response.writeHead(404);response.end();return;}
 response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stats.size});
 if(request.method==='HEAD'){response.end();return;}
 void pipeline(createReadStream(file),response).catch(()=>response.destroy());
});
server.listen(48242,bind,()=>console.log('Private installer delivery ready'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
