import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AtomicJsonStore} from '../persistence/atomicStore';

/** The receiving machine owns its inbox choice. Invalid custom choices never fall back. */
export class FileInbox {
  private readonly store:AtomicJsonStore;
  private selected:string|null=null;
  private tail:Promise<unknown>=Promise.resolve();
  constructor(file:string,private readonly defaultDirectory:string){this.store=new AtomicJsonStore(file,{recoveryDir:path.join(path.dirname(file),'recovery'),validate:value=>value&&typeof value==='object'&&('path' in value)&&((value as {path:unknown}).path===null||typeof (value as {path:unknown}).path==='string')?null:'Invalid inbox settings'});}
  async initialize(){const saved=await this.store.load<{path:string|null}>();this.selected=saved.value?.path??null;}
  async validate(directory:string){
    if(!path.isAbsolute(directory))throw Error('Choose an absolute inbox folder path.');
    const canonical=await fs.realpath(directory).catch(()=>{throw Error('The inbox folder does not exist.');});
    if(!(await fs.stat(canonical)).isDirectory())throw Error('The inbox location is not a folder.');
    const probe=path.join(canonical,'.papers-inbox-check-'+randomUUID());
    let handle;try{handle=await fs.open(probe,'wx');await handle.sync();}catch{throw Error('The inbox folder is not writable.');}finally{await handle?.close();await fs.unlink(probe).catch(()=>{});}
    return canonical;
  }
  async get(){if(!this.selected)await fs.mkdir(this.defaultDirectory,{recursive:true});return {path:await this.validate(this.selected??this.defaultDirectory),chosen:this.selected!==null};}
  set(value:string|null){const work=this.tail.then(async()=>{let directory:string|null=null;if(value!==null){if(!value.trim())throw Error('Choose an inbox folder.');directory=await this.validate(value.trim());}else await fs.mkdir(this.defaultDirectory,{recursive:true});await this.store.save({path:directory});this.selected=directory;return this.get();});this.tail=work.catch(()=>{});return work;}
  async assertPinned(directory:string){if(await this.validate(directory)!==directory)throw Error('The inbox folder changed while downloading.');}
}
