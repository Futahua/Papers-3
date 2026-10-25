import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
const [installer,view]=process.argv.slice(2);if(!installer||!view||!path.isAbsolute(installer)||!path.isAbsolute(view))throw Error('Supply exact checked artifacts');
const files=new Map([['/installer',installer],['/view',view]]);
const server=createServer(async(request,response)=>{
  if(request.socket.remoteAddress!=='100.112.127.26'||request.method!=='GET'||!files.has(request.url)){response.writeHead(403);response.end();return;}
  const file=files.get(request.url);const stat=await fs.stat(file);response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(48242,'100.69.79.67',resolve));console.log('Checked update delivery ready for laptop only');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
