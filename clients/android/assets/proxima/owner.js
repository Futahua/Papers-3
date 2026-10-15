(async()=>{
 await ProximaPersistence.ready;
 globalThis.__proximaOwnerEngine=true; // proxima-sync.js: no page to refresh here
 for(const name of ['sync-core','proxima-sync','remote-domain','remote-follow','store'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=name+'.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
 const backups=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('proxima-backups',1);r.onupgradeneeded=()=>r.result.createObjectStore('backups',{keyPath:'at'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 globalThis.phoneOwnerRequest=async(id,request)=>{try{
  const source=request.source;
  let result;
  if(request.operation==='snapshot')result={snapshot:await Store.remoteProjection(source,null,true)};
  else if(request.operation==='command'){
   const c=request.command;if(!c||typeof c.commandId!=='string'||!Number.isSafeInteger(c.expectedSeq)||! /^(?:task|project|run|schedule-event|timeline-interval|timeline-queue)\.[a-z.-]+$|^timeline\.(?:undo|redo)$/.test(c.type))throw Error('Invalid Proxima command.');
   const command=await Store.command({...c,actor:'remote-device',client:'papers-remote'});result={command,snapshot:await Store.remoteProjection(source,null,true)};
  }else if(request.operation==='replace'){
   // A computer's sync exchange (Proxima public/proxima-sync.js) rides this route; nothing is replaced.
   if(request.snapshot?.proximaSync){PapersOwner.reply(String(id),JSON.stringify({ok:true,result:{proximaSync:await ProximaSync.exchange(request.snapshot.proximaSync)}}));return;}
   // Whole copies from a device still running the old authoritative-device model would overwrite edits.
   if(request.snapshot?.mirror)throw Error('This phone now syncs instead of taking whole copies; update '+(request.snapshot.mirror.name||'the sending device')+'.');
   const projection=ProximaRemoteDomain.validateProjection(request.snapshot);await Store.flushCommands();
   await navigator.locks.request('proxima-store-write',async()=>{
    const current=await ProximaPersistence.read();if(request.expectedSeq!==undefined&&request.expectedSeq!==(current?.seq||0))throw Error('Source changed since confirmation.');
    const db=await backups();await new Promise((resolve,reject)=>{const tx=db.transaction('backups','readwrite'),table=tx.objectStore('backups');table.put({at:Date.now(),reason:'Before copying from '+request.from,state:current});const keys=table.getAllKeys();keys.onsuccess=()=>{for(const key of keys.result.sort((a,b)=>a-b).slice(0,-10))table.delete(key);};tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);});db.close();
    const records=projection.records,layout=projection.viewLayout||{};await ProximaPersistence.write({version:1,seq:Math.max(current?.seq||0,projection.source.seq)+1,projects:records.projects,tasks:records.tasks.map(item=>({...item,...layout.tasks?.[item.id]})),scheduleEvents:records.scheduleEvents,timelineRows:records.timelineRows.map(item=>({...item,...layout.timelineRows?.[item.id]})),timelineIntervals:records.timelineIntervals,importedRuns:records.importedRuns,run:records.run||null});
   });result={replaced:true,snapshot:await Store.remoteProjection(source,null,true)};
  }else throw Error('Unsupported Proxima owner operation.');
  PapersOwner.reply(String(id),JSON.stringify({ok:true,result}));
 }catch(error){PapersOwner.reply(String(id),JSON.stringify({ok:false,message:error.message||String(error)}));}};
 PapersOwner.ready();
})().catch(error=>PapersOwner.failed(error.message||String(error)));
