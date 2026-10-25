import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import * as path from 'node:path';
import { AtomicJsonStore } from '../persistence/atomicStore';
import { RemoteFileResources } from './remoteFileResources';

type Operation = 'create-folder' | 'rename' | 'move' | 'copy' | 'delete';
interface Intent { commandId: string; operation: Operation; resourceId: string; expectedVersion: string; newName?: string; destinationId?: string; destinationVersion?: string }
interface Job { commandId: string; deviceId: string; operation: Operation; phase: 'queued' | 'checking' | 'waiting' | 'verifying' | 'completed' | 'failed' | 'uncertain'; name?:string; error?: string; intentHash: string }
type Owner = (operation: Operation, params: Record<string, unknown>, deviceId: string) => Promise<Record<string, unknown>>;
function parse(raw: unknown): Intent {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid file command.');
  const value = raw as Intent;
  if (!/^[a-f0-9-]{36}$/.test(value.commandId) || !['create-folder','rename','move','copy','delete'].includes(value.operation) || !/^[a-f0-9-]{36}$/.test(value.resourceId) || !/^[a-f0-9]{64}$/.test(value.expectedVersion)) throw new Error('Invalid file command.');
  if (['rename','create-folder'].includes(value.operation) && (typeof value.newName !== 'string' || !value.newName || /[<>:"/\\|?*\x00-\x1f]/.test(value.newName) || /[. ]$/.test(value.newName) || value.newName === '.' || value.newName === '..')) throw new Error('Choose a valid file name.');
  if (['move','copy'].includes(value.operation) && (!/^[a-f0-9-]{36}$/.test(value.destinationId ?? '') || !/^[a-f0-9]{64}$/.test(value.destinationVersion ?? ''))) throw new Error('Choose a current destination folder.');
  return { commandId: value.commandId, operation: value.operation, resourceId: value.resourceId, expectedVersion: value.expectedVersion, ...(value.newName ? { newName:value.newName } : {}), ...(value.destinationId ? { destinationId:value.destinationId,destinationVersion:value.destinationVersion } : {}) };
}
async function absent(target: string): Promise<boolean> {
  try { await fs.lstat(target); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error; }
}
async function digest(target: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(current: string, relative: string): Promise<void> {
    const stats = await fs.lstat(current);
    if (stats.isSymbolicLink()) throw new Error('Folder transfers containing junctions or symbolic links need an explicit link policy.');
    hash.update(JSON.stringify([relative, stats.isDirectory() ? 'folder' : 'file', stats.isFile() ? stats.size : 0]));
    if (stats.isDirectory()) for (const name of (await fs.readdir(current)).sort()) await visit(path.join(current,name),path.join(relative,name));
    else if (stats.isFile()) { const content=createHash('sha256'); await pipeline(createReadStream(current),content); hash.update(content.digest()); }
    else throw new Error('Unsupported filesystem object.');
  }
  await visit(target,''); return hash.digest('hex');
}

/** One owner queue and durable deduplication. Ambiguous restart never redispatches. */
export class RemoteFileMutations {
  private jobs = new Map<string,Job>();
  private queue: Promise<unknown> = Promise.resolve();
  private journalQueue: Promise<unknown> = Promise.resolve();
  private readonly acceptances = new Map<string,Promise<void>>();
  private accepting = true;
  private readonly revoked = new Set<string>();
  private readonly store: AtomicJsonStore;
  constructor(private readonly directory: string, private readonly owner: Owner, private readonly wait = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms)), private readonly attempts=600,private readonly targets?:import('./fileTargetRegistry').TargetRegistry) {
    this.store=new AtomicJsonStore(path.join(directory,'commands.json'),{recoveryDir:path.join(directory,'recovery')});
  }
  async initialize(): Promise<void> {
    const file=path.join(this.directory,'commands.json');
    let raw: {jobs:Job[]};
    try { raw=JSON.parse(await fs.readFile(file,'utf8')); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; try{await fs.access(this.store.backupPath);throw new Error('File command journal needs explicit recovery.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}return; }
    if(!Array.isArray(raw.jobs))throw new Error('Invalid file command journal.');
    for(const job of raw.jobs){if(!/^[a-f0-9-]{36}$/.test(job.commandId)||typeof job.deviceId!=='string'||typeof job.intentHash!=='string')throw new Error('Invalid file command journal.');if(!['completed','failed','uncertain'].includes(job.phase)){job.phase='uncertain';job.error='The owner restarted before completion was confirmed. Check the actual files before retrying.';}this.jobs.set(JSON.stringify([job.deviceId,job.commandId]),job);}
    await this.persist();
  }
  list(deviceId:string) { return structuredClone([...this.jobs.values()].filter(job=>job.deviceId===deviceId).map(({intentHash,...job})=>job)); }
  private persist(){const snapshot=structuredClone({jobs:[...this.jobs.values()]});const saved=this.journalQueue.then(()=>this.store.save(snapshot));this.journalQueue=saved.catch(()=>{});return saved;}
  async submit(deviceId:string,catalog:RemoteFileResources,raw:unknown) {
    if(!this.accepting||this.revoked.has(deviceId))throw new Error('Device access is unavailable.');
    const intent=parse(raw),key=JSON.stringify([deviceId,intent.commandId]),intentHash=createHash('sha256').update(JSON.stringify(intent)).digest('hex');
    const previous=this.jobs.get(key);
    if(previous){if(previous.intentHash!==intentHash)throw new Error('Command identity was already used for another operation.');await this.acceptances.get(key);return this.list(deviceId).find(job=>job.commandId===intent.commandId)!;}
    const job:Job={deviceId,commandId:intent.commandId,operation:intent.operation,phase:'queued',intentHash};
    this.jobs.set(key,job);
    const accepted=this.persist();this.acceptances.set(key,accepted);
    try{
      await accepted;
      this.queue=this.queue.then(()=>this.execute(job,catalog,intent)).catch(async error=>{job.phase='failed';job.error=error instanceof Error?error.message:'File operation failed.';await this.persist();});
    }catch(error){this.jobs.delete(key);throw error;}finally{this.acceptances.delete(key);}
    return this.list(deviceId).find(item=>item.commandId===intent.commandId)!;
  }
  private async execute(job:Job,catalog:RemoteFileResources,intent:Intent):Promise<void>{
    if(this.revoked.has(job.deviceId))throw new Error('Device access was revoked before dispatch.');
    job.phase='checking';await this.persist();
    const source=await catalog.checkedPath(intent.resourceId,intent.expectedVersion,intent.operation==='create-folder');
    job.name=intent.operation==='create-folder'?intent.newName:source.entry.name;
    let target:string|null=null,params:Record<string,unknown>,expectedDigest:string|null=null;
    if(intent.operation==='create-folder'){
      if(source.entry.kind!=='folder')throw new Error('Choose a parent folder.');
      target=path.join(source.path,intent.newName!);params={path:source.path,newName:intent.newName};
    }else if(intent.operation==='rename'){
      target=path.join(path.dirname(source.path),intent.newName!);params={path:source.path,newName:intent.newName,neverOverwrite:true};
    }else if(intent.operation==='move'||intent.operation==='copy'){
      const destination=await catalog.checkedPath(intent.destinationId!,intent.destinationVersion!,true);
      if(destination.entry.kind!=='folder')throw new Error('Choose a destination folder.');
      const relative=path.relative(source.path,destination.path);
      if(source.path===destination.path||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)))throw new Error('A folder cannot be transferred into itself or its contents.');
      target=path.join(destination.path,path.basename(source.path));params={paths:[source.path],destination:destination.path,neverOverwrite:true};
    }else params={paths:[source.path]};
    if(target&&!await absent(target))throw new Error('Destination already exists. Choose another name or folder.');
    if(intent.operation!=='create-folder'&&intent.operation!=='delete')expectedDigest=await digest(source.path);
    await catalog.checkedPath(intent.resourceId,intent.expectedVersion,intent.operation==='create-folder');
    if(intent.destinationId)await catalog.checkedPath(intent.destinationId,intent.destinationVersion!,true);
    if(target&&!await absent(target))throw new Error('Destination changed before dispatch.');
    if(this.revoked.has(job.deviceId))throw new Error('Device access was revoked before dispatch.');
    job.phase='waiting';await this.persist();
    const result=await this.owner(intent.operation,params,job.deviceId);
    if(result.ok!==true)throw new Error(typeof result.message==='string'?result.message:'Owner file provider is unavailable.');
    for(let attempt=0;attempt<this.attempts;attempt++){
      const removed=await absent(source.path),created=target?!await absent(target):false;
      const ready=intent.operation==='delete'?removed:intent.operation==='move'||intent.operation==='rename'?removed&&created:created;
      if(ready){
        job.phase='verifying';await this.persist();
        if(expectedDigest){
          let matches=false;try{matches=await digest(target!)===expectedDigest;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          if(!matches){job.phase='waiting';await this.persist();await this.wait(500);continue;}
        }
        if(intent.operation==='copy')await catalog.checkedPath(intent.resourceId,intent.expectedVersion);
        if(target&&['move','rename'].includes(intent.operation))await this.targets?.relocate(source.path,target);
        if(intent.operation==='delete')await this.targets?.deleted(source.path);
        job.phase='completed';await this.persist();return;
      }
      await this.wait(500);
    }
    job.phase='uncertain';job.error='The owner accepted the operation, but completion is not confirmed. Check its files and pending provider operation.';await this.persist();
  }
  async close(){this.accepting=false;await Promise.allSettled([...this.acceptances.values()]);await this.queue;await this.journalQueue;}
  revoke(deviceId:string){this.revoked.add(deviceId);}
}
