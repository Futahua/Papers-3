import { describe,it,expect } from 'vitest';
import { createServer,request as httpRequest } from 'node:http';
import { UsbPeerTransport } from '../src/main/backpacks/usbPeerTransport';

describe('USB peer routes',()=>{
 it('keeps owner identity and expires only its physical route',()=>{
  const transport=new UsbPeerTransport(()=>[],()=>null);
  (transport as any).route={origin:'http://100.64.0.2:48240',port:40000,serial:'phone',checked:Date.now()};
  expect(transport.address('http://100.64.0.2:48240/v1/files/x?offset=9')).toBe('http://127.0.0.1:40000/v1/files/x?offset=9');
  expect(transport.address('http://100.64.0.3:48240/v1/files/x')).toBe('http://100.64.0.3:48240/v1/files/x');
  (transport as any).route.checked=Date.now()-13000;
  expect(transport.address('http://100.64.0.2:48240/v1/files/x')).toBe('http://100.64.0.2:48240/v1/files/x');
 });
 it('tus retains logical URLs even when the cable server returns an absolute location',async()=>{
  const server=createServer((req,res)=>{expect(req.headers.authorization).toBe('Bearer fixture');res.writeHead(201,{Location:`http://127.0.0.1:${(server.address() as any).port}/v1/files/transfers/123`});res.end();});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
   const transport=new UsbPeerTransport(()=>[],()=>null);
   (transport as any).route={origin:'http://100.64.0.2:48240',port:(server.address() as any).port,serial:'phone',checked:Date.now()};
   const request=transport.httpStack().createRequest('POST','http://100.64.0.2:48240/v1/files/transfers');
   request.setHeader('Authorization','Bearer fixture');
   expect(request.getURL()).toBe('http://100.64.0.2:48240/v1/files/transfers');
   const response=await request.send(null);
   expect(response.getHeader('Location')).toBe('http://100.64.0.2:48240/v1/files/transfers/123');
  }finally{server.closeAllConnections();server.close();}
 });
 it('loopback proxy forwards only its own owner and preserves authentication',async()=>{
  let hits=0;
  const owner=createServer((req,res)=>{hits++;expect(req.headers.authorization).toBe('Bearer fixture');res.end('owner');});
  await new Promise<void>(r=>owner.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${(owner.address() as any).port}`,transport=new UsbPeerTransport(()=>[],()=>origin);
  await (transport as any).listener();
  const send=(url:string)=>new Promise<number>((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:(transport as any).proxy.address().port,path:url,headers:{Authorization:'Bearer fixture'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end();});
  try{expect(await send(origin+'/v1/files/shares')).toBe(200);expect(await send('http://100.64.0.9:48240/v1/files/shares')).toBe(403);expect(await send(origin+'/private')).toBe(403);expect(hits).toBe(1);}
  finally{await transport.close();owner.closeAllConnections();owner.close();}
 });
});
