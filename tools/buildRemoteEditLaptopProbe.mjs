import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output=process.argv[2];if(!output||!path.isAbsolute(output))throw Error('Supply an isolated absolute output directory.');await mkdir(output,{recursive:true});
const entry=`
import {promises as fs} from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {randomBytes,createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {RemoteFileClient} from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteFileClient.ts'))};
import {RemoteFileEditNativeProvider} from ${JSON.stringify(path.join(repository,'src/main/backpacks/remoteFileEditNativeProvider.ts'))};
const here=path.dirname(fileURLToPath(import.meta.url));const config=JSON.parse(await fs.readFile(path.join(here,'fixture-private.json'),'utf8'));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'papers-laptop-edit-'));const receiver=path.join(root,'receiver');
const box={seal:value=>Buffer.from(value).toString('base64'),open:value=>Buffer.from(value,'base64').toString()};
let client=new RemoteFileClient(receiver,box);await client.initialize();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 await client.pair(config.address,config.code,'Generated laptop edit probe');const owner=client.snapshot().devices.at(-1).id;
 const folder=(await client.browse(owner)).entries[0];const original=(await client.browse(owner,folder.id)).entries[0];
 const edit=await client.beginEdit(owner,original);const working=await client.editPath(edit.id);const changed=randomBytes(5*1024*1024);await fs.writeFile(working,changed);
 const saved=await client.saveEdit(edit.id);assert.equal(saved.phase,'saved');assert.equal(sha(await fs.readFile(working)),sha(changed));
 const current=(await client.browse(owner,folder.id)).entries[0];const job=client.download(owner,current);let completed=false;
 for(let attempt=0;attempt<1200;attempt++){const state=client.snapshot().jobs.find(item=>item.id===job.id);if(state.phase==='failed')throw Error(state.error);if(state.phase==='completed'){completed=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(completed,'Verification download completed');
 const copies=await client.offline(owner);const copy=copies.find(item=>item.entry.version===current.version);assert.equal(sha(await fs.readFile(await client.cachedPath(owner,copy.key))),sha(changed));
 const prior=copies.find(item=>item.entry.version===original.version);assert.equal((await fs.readFile(await client.cachedPath(owner,prior.key),'utf8')),'Generated original phone fixture');
 await client.close();client=new RemoteFileClient(receiver,box);await client.initialize();assert.equal((await client.saveEdit(edit.id)).phase,'saved');
 const provider=new RemoteFileEditNativeProvider(path.join(here,'conditional-file-save.ps1'),path.join(here,'conditional-file-save.cs'));
 const local=path.join(root,'native');await fs.mkdir(local);const source=path.join(local,'source.txt'),upload=path.join(local,'upload.txt');await fs.writeFile(source,'original');await fs.writeFile(upload,'edited');
 const resolved={path:source,approvedRoot:local};const revision=await provider.inspect(resolved),replacement=await provider.inspect({path:upload,approvedRoot:local});const expected={token:revision.token,sourceSha256:revision.sha256,editedSha256:replacement.sha256};let checks=0;
 await assert.rejects(provider.save(resolved,upload,expected,()=>{if(++checks===3)throw Error('withdrawn fixture permission');}));assert.equal(await fs.readFile(source,'utf8'),'original');
 await provider.save(resolved,upload,expected,()=>{});assert.equal(await fs.readFile(source,'utf8'),'edited');await assert.rejects(provider.save(resolved,upload,expected,()=>{}),{code:'VERSION_CHANGED'});
 const evidence={passed:true,root,remoteEditedBytes:changed.length,remoteSavedSha256:sha(changed),retainedCache:true,restartedReceipt:true,laptopNativeRollback:true,laptopNativeStaleRefusal:true};await fs.writeFile(path.join(here,'verified.json'),JSON.stringify(evidence));console.log(JSON.stringify(evidence));
}finally{await client.close();}
`;
await build({stdin:{contents:entry,resolveDir:repository},outfile:path.join(output,'probe.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
console.log('Generated laptop probe bundle ready');
