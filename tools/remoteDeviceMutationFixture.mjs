import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [directory,address]=process.argv.slice(2);
if(!directory||!path.isAbsolute(directory)||!/^100\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address||''))throw new Error('Supply an isolated absolute fixture directory and Tailscale address.');
await mkdir(directory,{recursive:true});
const entry=`
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {RemoteDeviceStore} from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteDeviceStore.ts'))};
import {createRemoteFileGateway} from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteFileGateway.ts'))};
import {RemoteFileMutations} from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteFileMutations.ts'))};
import {createFileCapabilityService,resolveDirectoryOpusRtPath} from ${JSON.stringify(path.join(repository,'src/main/backpacks/fileCapabilityService.ts'))};
const root=${JSON.stringify(directory)},shared=path.join(root,'shared');await fs.mkdir(shared,{recursive:true});
const bytes=randomBytes(1024*1024);await fs.writeFile(path.join(shared,'device-check.bin'),bytes);
const service=createFileCapabilityService({dopusrtPath:resolveDirectoryOpusRtPath()});
const mutations=new RemoteFileMutations(path.join(root,'commands'),(operation,params,deviceId)=>service.call({operation,params},{backpackId:'remote:'+deviceId}));await mutations.initialize();
const store=await RemoteDeviceStore.open(path.join(root,'owner'),'Papers device check');
const invitation=await store.invite([{id:'fixture',name:'Device check files',directory:shared}],true);
let suppressAcknowledgement=true;
const gateway=await createRemoteFileGateway({owner:store.snapshot().owner,grants:[],
 pair:async(code,name)=>{const paired=await store.redeem(code,name);return {...paired,grant:store.snapshot().devices.find(device=>device.deviceId===paired.deviceId)};},
 mutate:async(deviceId,catalog,command)=>{const job=await mutations.submit(deviceId,catalog,command);if(command.newName==='response-loss.bin'&&suppressAcknowledgement){suppressAcknowledgement=false;throw new Error('Fixture suppresses the first acknowledgement after durable acceptance.');}return job;},
 changes:deviceId=>mutations.list(deviceId),revokeChanges:deviceId=>mutations.revoke(deviceId)});
await new Promise((resolve,reject)=>{gateway.server.once('error',reject);gateway.server.listen(48241,${JSON.stringify(address)},resolve);});
await fs.writeFile(path.join(root,'fixture-check.json'),JSON.stringify({address:'http://'+${JSON.stringify(address)}+':48241',code:invitation.code,sha256:createHash('sha256').update(bytes).digest('hex'),ownerId:store.snapshot().owner.id}));
console.log('Isolated native file-change gateway ready');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await gateway.close();await mutations.close();process.exit(0);});
`;
const output=path.join(directory,'gateway.mjs');await build({stdin:{contents:entry,resolveDir:repository},outfile:output,bundle:true,platform:'node',format:'esm',target:'node24'});await import(pathToFileURL(output).href);
