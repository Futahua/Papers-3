import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory=await mkdtemp(path.join(os.tmpdir(),'papers-remote-owner-'));
const entry=`
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFileCapabilityService, resolveDirectoryOpusRtPath } from ${JSON.stringify(path.join(repository,'src/main/backpacks/fileCapabilityService.ts'))};
import { RemoteFileResources } from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteFileResources.ts'))};
import { RemoteFileMutations } from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteFileMutations.ts'))};
const directory=${JSON.stringify(directory)},shared=path.join(directory,'shared');await fs.mkdir(shared);await fs.writeFile(path.join(shared,'source.txt'),'native owner check');
const dopusrtPath=resolveDirectoryOpusRtPath();if(!dopusrtPath)throw new Error('Directory Opus is unavailable.');
const service=createFileCapabilityService({dopusrtPath});
const mutations=new RemoteFileMutations(path.join(directory,'journal'),(operation,params,deviceId)=>service.call({operation,params},{backpackId:'remote:'+deviceId}),undefined,40);await mutations.initialize();
const catalog=await RemoteFileResources.create([{id:'probe',name:'Probe',directory:shared}]);const root=(await catalog.shares())[0];
async function run(operation,name,extra={}){const item=name?(await catalog.list(root.id)).entries.find(e=>e.name===name):await catalog.stat(root.id);if(!item)throw new Error('Missing probe entry '+name);const commandId=randomUUID();await mutations.submit('probe',catalog,{commandId,operation,resourceId:item.id,expectedVersion:item.version,...extra});for(let n=0;n<220;n++){const job=mutations.list('probe').find(j=>j.commandId===commandId);if(['completed','failed','uncertain'].includes(job.phase)){if(job.phase!=='completed')throw new Error(operation+': '+job.error);console.log(operation+': verified');return;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Probe timed out');}
try{await run('create-folder',null,{newName:'destination'});await run('rename','source.txt',{newName:'renamed.txt'});let destination=(await catalog.list(root.id)).entries.find(e=>e.name==='destination');await run('copy','renamed.txt',{destinationId:destination.id,destinationVersion:destination.version});await run('rename','renamed.txt',{newName:'moved.txt'});destination=await catalog.stat(destination.id);await run('move','moved.txt',{destinationId:destination.id,destinationVersion:destination.version});await run('delete','destination');console.log('Generated fixture retained: '+directory);}finally{await mutations.close();}
`;
const output=path.join(directory,'probe.mjs');await build({stdin:{contents:entry,resolveDir:repository},outfile:output,bundle:true,platform:'node',format:'esm',target:'node24'});await import(pathToFileURL(output).href);
