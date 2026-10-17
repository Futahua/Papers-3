import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { defaultOptions, type HttpStack } from 'tus-js-client';

const run = promisify(execFile);
export interface UsbPeer { id: string; address: string; token: string }
/** A cable is an ephemeral route to an already paired owner, never a new identity. */
export class UsbPeerTransport {
  private route: { origin: string; port: number; serial: string; checked: number } | null = null;
  private proxy: Server | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = false;
  private adb: string | null = null;
  private forward: {serial:string;port:number}|null=null;
  constructor(private readonly peers: () => UsbPeer[], private readonly localAddress: () => string | null) {}
  start() {
    void this.poll(); this.timer=setInterval(()=>void this.poll(),4000); this.timer.unref();
  }
  address(raw: string) {
    const url=new URL(raw), route=this.route;
    return route && route.origin===url.origin && Date.now()-route.checked<12000
      ? `http://127.0.0.1:${route.port}${url.pathname}${url.search}` : raw;
  }
  /** Keep tus URLs/journal identities logical while routing each request over the cable. */
  httpStack(): HttpStack {
    return {getName:()=> 'PapersUSB', createRequest:(method,url)=>{
      const physical=this.address(url), request=defaultOptions.httpStack.createRequest(method,physical);
      return new Proxy(request,{get:(target,key)=>{
        if(key==='getURL')return()=>url;
        if(key==='send')return async(body:Parameters<typeof request.send>[0])=>{
          const response=await target.send(body);
          return new Proxy(response,{get:(reply,name)=>{
            if(name==='getHeader')return(header:string)=>{
              const value=reply.getHeader(header);
              if(header.toLowerCase()!=='location'||!value||physical===url)return value;
              const resolved=new URL(value,physical);
              if(resolved.origin!==new URL(physical).origin)throw Error('USB upload redirected to another owner');
              return new URL(resolved.pathname+resolved.search,new URL(url).origin).href;
            };
            const value=Reflect.get(reply,name);return typeof value==='function'?value.bind(reply):value;
          }});
        };
        const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
      }});
    }};
  }
  private async command(args:string[]) {
    return (await run(this.adb!,args,{windowsHide:true,timeout:3500,maxBuffer:65536})).stdout.trim();
  }
  private async listener() {
    if(this.proxy)return;
    const server=createServer((req,res)=>{
      let target:URL;
      try {target=new URL(req.url!);if(target.origin!==this.localAddress()||!target.pathname.startsWith('/v1/')||target.username||target.password)throw Error();}
      catch {res.writeHead(403).end();return;}
      const upstream=httpRequest(target,{method:req.method,headers:{...req.headers,host:target.host}},reply=>{res.writeHead(reply.statusCode!,reply.headers);reply.pipe(res);});
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
      req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream);
    });
    server.headersTimeout=10000;server.requestTimeout=0;
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    this.proxy=server;
  }
  private async poll() {
    if(this.busy||this.stopped)return;this.busy=true;
    try {
      if(!this.adb){for(const candidate of [process.env.PAPERS_ADB,process.resourcesPath&&`${process.resourcesPath}/adb/adb.exe`,process.env.ANDROID_HOME&&`${process.env.ANDROID_HOME}/platform-tools/adb.exe`,`${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`,'D:/Programs/AndroidSDK/platform-tools/adb.exe']){if(!candidate)continue;try{await access(candidate);this.adb=candidate;break;}catch{}}}
      if(!this.adb||!this.localAddress())return;
      // -d explicitly selects USB hardware, excluding wireless adb transports.
      const serial=await this.command(['-d','get-serialno']);
      if(!serial||serial==='unknown')throw Error('No authorized USB phone');
      if(this.route?.serial!==serial){await this.clearRoute();}
      await this.listener();
      const port=this.route?.port??Number(await this.command(['-s',serial,'forward','tcp:0','tcp:48240']));
      if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid USB forwarding port');
      this.forward={serial,port};
      await this.command(['-s',serial,'reverse','tcp:48243',`tcp:${(this.proxy!.address() as {port:number}).port}`]);
      let accepted=false;
      for(const peer of this.peers()){
        try {
          const response=await fetch(`http://127.0.0.1:${port}/v1/transport/usb`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{Authorization:'Bearer '+peer.token,'Content-Type':'application/json'},body:JSON.stringify({address:this.localAddress()})});
          if(!response.ok)continue;
          const result=await response.json() as {owner?:{id?:string}};
          if(result.owner?.id!==peer.id)continue;
          this.route={origin:new URL(peer.address).origin,port,serial,checked:Date.now()};accepted=true;break;
        }catch{}
      }
      if(!accepted)await this.clearRoute();
    } catch {await this.clearRoute();} finally {this.busy=false;}
  }
  private async clearRoute() {const previous=this.forward;this.route=null;this.forward=null;if(previous&&this.adb)await this.command(['-s',previous.serial,'forward','--remove',`tcp:${previous.port}`]).catch(()=>{});}
  async close() {this.stopped=true;clearInterval(this.timer);while(this.busy)await new Promise(resolve=>setTimeout(resolve,25));await this.clearRoute();this.proxy?.closeAllConnections();this.proxy?.close();this.proxy=null;}
}
