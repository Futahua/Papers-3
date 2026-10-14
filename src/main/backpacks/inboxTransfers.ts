import {promises as fs,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {AtomicJsonStore} from '../persistence/atomicStore';
import type {RemoteFileEntry} from './remoteFileResources';
import type {RemoteFileClient,RemoteDownloadJob} from './remoteFileClient';
import type {FileInbox} from './fileInbox';

export interface InboxNode {source:string;ownerId:string;entry:RemoteFileEntry;children:InboxNode[]}
interface Job {id:string;fingerprint:string;paths:string[];phase:'preparing'|'downloading'|'verifying'|'publishing'|'completed'|'failed'|'paused'|'uncertain';name:string;bytes:number;totalBytes:number|null;destination:string;destinationOwnerId?:string;results:{name:string;target:string;kind:'file'|'folder'}[];error?:string;activeDownload?:string;plan?:InboxNode[];finishedBytes:number;createdAt:number}
const safeName=(name:string)=>{if(!name||name==='.'||name==='..'||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))throw Error('The source filename cannot be saved on this PC.');return name;};
const collisionName=(name:string,n:number)=>{const extension=path.extname(name);return n?name.slice(0,name.length-extension.length)+` (${n})`+extension:name;};

/** Downloads are resumable; published results and request identities are durable. */
export class InboxTransfers {
  private readonly store:AtomicJsonStore;
  private readonly jobs=new Map<string,Job>();
  private tail:Promise<unknown>=Promise.resolve();
  private saves:Promise<unknown>=Promise.resolve();
  private running=new Map<string,Promise<unknown>>();
  private closing=false;
  constructor(private readonly directory:string,private readonly inbox:FileInbox,private readonly client:RemoteFileClient,private readonly plan:(paths:string[])=>Promise<InboxNode[]>,private readonly remote?:{inbox:(ownerId:string)=>Promise<{path:string}>;copy:(source:string,destination:string)=>Promise<string>}){this.store=new AtomicJsonStore(path.join(directory,'jobs.json'),{recoveryDir:path.join(directory,'recovery')});}
  async initialize(){const saved=await this.store.load<{jobs:Job[]}>();for(const job of saved.value?.jobs??[]){if(!/^[a-f0-9-]{36}$/.test(job.id)||!Array.isArray(job.results))throw Error('Invalid inbox transfer recovery data.');if(!['completed','failed','uncertain'].includes(job.phase)){job.phase='uncertain';job.error='Download was interrupted. Its saved files are retained; it was not repeated.';}delete job.activeDownload;this.jobs.set(job.id,job);}await this.save();}
  private save(){const snapshot=structuredClone([...this.jobs.values()]);const work=this.saves.then(()=>this.store.save({jobs:snapshot}));this.saves=work.catch(()=>{});return work;}
  snapshot(){return [...this.jobs.values()].map(job=>{const active=job.activeDownload?this.client.snapshot().jobs.find(item=>item.id===job.activeDownload):null;return {...job,plan:undefined,bytes:Math.min(job.totalBytes??Number.MAX_SAFE_INTEGER,job.finishedBytes+(active?.bytes??0)),phase:job.phase==='downloading'&&active?.phase==='verifying'?'verifying':job.phase};});}
  async start(id:string,paths:string[],destinationOwnerId?:string){
    if(this.closing)throw Error('Downloads are closing.');
    if(!/^[a-f0-9-]{36}$/.test(id)||!paths.length||paths.length>64||paths.some(item=>typeof item!=='string'||item.length>32768||!/^\\\\papers~[a-f0-9-]{36}\\/i.test(item)))throw Error('Choose files from a connected device.');
    if(destinationOwnerId&&!/^[a-f0-9-]{36}$/.test(destinationOwnerId))throw Error('Invalid receiving device.');
    paths=[...new Set(paths)];const fingerprint=createHash('sha256').update(JSON.stringify([paths,destinationOwnerId??null])).digest('hex');
    const previous=this.jobs.get(id);if(previous){if(previous.fingerprint!==fingerprint)throw Error('Download request identity changed.');return this.snapshot().find(job=>job.id===id)!;}
    const destination=destinationOwnerId?await this.remote!.inbox(destinationOwnerId).then(item=>item.path):(await this.inbox.get()).path;
    const job:Job={id,fingerprint,paths,phase:'preparing',name:paths.length===1?paths[0]!.split('\\').pop()!:paths.length+' items',bytes:0,totalBytes:null,destination,...(destinationOwnerId?{destinationOwnerId}:{}),results:[],finishedBytes:0,createdAt:Date.now()};
    this.jobs.set(id,job);await this.save();this.queue(job);return this.snapshot().find(item=>item.id===id)!;
  }
  private queue(job:Job){const work=this.tail.then(()=>this.run(job));this.running.set(job.id,work);this.tail=work.catch(()=>{});void work.finally(()=>{if(this.running.get(job.id)===work)this.running.delete(job.id);}).catch(()=>{});}
  async pause(id:string){const job=this.jobs.get(id);if(!job||!['preparing','downloading','paused'].includes(job.phase))throw Error('This download cannot be paused now.');job.phase='paused';if(job.activeDownload)this.client.cancel(job.activeDownload);await this.running.get(id);await this.save();return this.snapshot().find(item=>item.id===id);}
  async resume(id:string){const job=this.jobs.get(id);if(!job||!['paused','failed'].includes(job.phase))throw Error('This download cannot resume automatically.');await this.assertDestination(job);job.phase='preparing';delete job.error;await this.save();this.queue(job);return this.snapshot().find(item=>item.id===id);}
  private async assertDestination(job:Job){if(job.destinationOwnerId){if((await this.remote!.inbox(job.destinationOwnerId)).path!==job.destination)throw Error('The receiving inbox changed. Start a new download.');}else await this.inbox.assertPinned(job.destination);}
  private async run(job:Job){
    if(this.closing||job.phase==='paused')return;
    const paused=()=>job.phase==='paused';
    const stage=job.destinationOwnerId?path.join(this.directory,'staging',job.id):path.join(job.destination,'.papers-incoming-'+job.id);
    try{
      await this.assertDestination(job);
      if(!job.plan){job.plan=await this.plan(job.paths);const count=(nodes:InboxNode[]):number=>nodes.reduce((sum,node)=>sum+(node.entry.kind==='file'?node.entry.size:count(node.children)),0);job.totalBytes=count(job.plan);if(!Number.isSafeInteger(job.totalBytes))throw Error('Download size is too large.');await this.save();}
      await fs.mkdir(stage,{recursive:true});
      job.finishedBytes=0;
      const fetchNode=async(node:InboxNode,target:string):Promise<void>=>{
        if(paused()||this.closing)throw Error('Download paused.');
        if(node.entry.kind==='folder'){await fs.mkdir(target,{recursive:true});for(const child of node.children)await fetchNode(child,path.join(target,safeName(child.entry.name)));return;}
        job.name=node.entry.name;job.phase='downloading';
        const local=await this.client.materialize(node.ownerId,node.entry,{scope:job.id,onJob:(download:RemoteDownloadJob)=>{job.activeDownload=download.id;}});
        if(paused()||this.closing)throw Error('Download paused.');
        delete job.activeDownload;job.phase='verifying';await fs.copyFile(local,target);const handle=await fs.open(target,'r+');await handle.sync();await handle.close();
        const digest=async(file:string)=>{const hash=createHash('sha256');await pipeline(createReadStream(file),hash);return hash.digest('hex');};
        if((await fs.stat(target)).size!==node.entry.size||await digest(target)!==await digest(local))throw Error('Saved file verification failed.');
        job.finishedBytes+=node.entry.size;await this.save();
      };
      for(let index=0;index<job.plan.length;index++){
        const node=job.plan[index]!;if(job.results[index]){const count=(item:InboxNode):number=>item.entry.kind==='file'?item.entry.size:item.children.reduce((sum,c)=>sum+count(c),0);job.finishedBytes+=count(node);continue;}
        const slot=path.join(stage,String(index));await fs.mkdir(slot,{recursive:true});const staged=path.join(slot,safeName(node.entry.name));await fetchNode(node,staged);
        await this.assertDestination(job);job.phase='publishing';await this.save();
        let published='';
        if(job.destinationOwnerId)published=await this.remote!.copy(staged,job.destination);
        else for(let n=0;n<10000;n++){
          const target=path.join(job.destination,collisionName(safeName(node.entry.name),n));
          try{if(node.entry.kind==='file')await fs.link(staged,target);else{if(await fs.lstat(target).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;}))continue;await fs.rename(staged,target);}published=target;break;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')continue;throw error;}
        }
        if(!published)throw Error('No free inbox filename is available.');
        job.results.push({name:path.basename(published),target:published,kind:node.entry.kind});await this.save();
      }
      // This exact staging folder belongs to this job and every result is published; creator files are outside it.
      // It is gone before the job reads as completed, so the inbox is clean when the link appears.
      if(job.destinationOwnerId?path.dirname(stage)===path.join(this.directory,'staging')&&path.basename(stage)===job.id:path.dirname(stage)===job.destination&&path.basename(stage)==='.papers-incoming-'+job.id)await fs.rm(stage,{recursive:true,force:true}).catch(()=>{});
      job.phase='completed';job.bytes=job.totalBytes??job.finishedBytes;delete job.activeDownload;await this.save();
    }catch(error){delete job.activeDownload;if(!paused()){job.phase=job.destinationOwnerId&&job.phase==='publishing'&&job.plan?.some(node=>node.entry.kind==='folder')?'uncertain':'failed';job.error=error instanceof Error?error.message:'Download failed.';}await this.save();}
  }
  async close(){this.closing=true;for(const job of this.jobs.values())if(job.activeDownload)this.client.cancel(job.activeDownload);await this.tail;await this.saves;}
}
