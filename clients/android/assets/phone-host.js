import {createNavigatorHistory} from './ayg/app/device-modes.js';
// Runs As you Go (the same page as on Windows) in a frame and answers its host requests on
// the phone. The phone's own As you Go lives in the app; another device's drives appear as
// \\papers~<deviceId>\D:\... paths, served by the paired computer through MobileFiles.
let sequence = 0;
const replies = new Map();
window.papersReply = (id, result) => { const pending = replies.get(id); if (!pending) return; replies.delete(id); pending(result); };
const native = (params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  replies.set(id, (result) => result?.ok ? resolve(result.result) : reject(new Error(result?.message || 'Operation failed.')));
  window.PapersNative.request(String(id), JSON.stringify(params));
});

const frame = document.querySelector('#ayg');
const locationHistory=createNavigatorHistory();let pendingLocation=null;
function historyState(){const state={back:locationHistory.canBack,forward:locationHistory.canForward,busy:Boolean(pendingLocation)};for(const child of [frame,layer].filter(Boolean))child.contentWindow?.postMessage({type:'papers:phone:history-state',state},location.origin);}
const EMPTY_STATE = { schemaVersion: 1, groups: [], shortcuts: [] };
const PATTERN = /^\\\\papers~([a-f0-9-]{36})(?:\\(.*))?$/i;
const parse = (value) => { const m = typeof value === 'string' ? PATTERN.exec(value.replace(/\//g, '\\').replace(/\\+$/, '')) : null; return m ? { ownerId: m[1].toLowerCase(), parts: (m[2] || '').split('\\').filter(Boolean) } : null; };
const remotePath = (ownerId, parts) => [`\\\\papers~${ownerId}`, ...parts].join('\\');
const listings = new Map();
let devices = [];
async function status() { const result = await native({ operation: 'status' }); devices = result.devices || []; return result; }
async function listAll(ownerId, id = '') {
  const key = ownerId + '|' + id, cached = listings.get(key);
  if (cached && Date.now() - cached.at < 2000) return cached.entries;
  const entries = []; let offset = 0;
  while (offset !== null) { const page = await native({ operation: 'browse', ownerId, resourceId: id, offset }); entries.push(...page.entries.map(item=>({...item,offline:page.online===false}))); offset = page.nextOffset ?? null; }
  listings.set(key, { at: Date.now(), entries });
  return entries;
}
const forget = (ownerId) => { for (const key of [...listings.keys()]) if (key.startsWith(ownerId + '|')) listings.delete(key); };
async function resolve(target) {
  const parsed = parse(target);
  if (!parsed) throw new Error('This phone has no local drives.');
  if (!devices.some((d) => d.id === parsed.ownerId)) await status();
  let entry = null;
  for (const part of parsed.parts) {
    const entries = await listAll(parsed.ownerId, entry?.id);
    entry = entries.find((item) => item.name === part) ?? entries.find((item) => item.name.toLowerCase() === part.toLowerCase());
    if (!entry) throw new Error('That item is no longer on the device.');
  }
  return { ...parsed, entry };
}
const deviceName = (ownerId) => devices.find((d) => d.id === ownerId)?.name ?? 'Device';
function describe(ownerId, parts, entry) {
  const kind = entry?.kind ?? 'folder', name = entry ? entry.name : deviceName(ownerId);
  const dot = kind === 'file' ? name.lastIndexOf('.') : -1;
  return { offline:entry?.offline===true, ...(entry?.hidden === true ? { hidden: true } : {}), path: remotePath(ownerId, parts), name, parent: remotePath(ownerId, parts.slice(0, -1)), kind, extension: dot > 0 ? name.slice(dot).toLowerCase() : '', size: kind === 'file' ? entry.size : null, createdAt: null, modifiedAt: entry ? Math.round(entry.modifiedAt) : null, identity: entry ? `${ownerId}:${entry.id}` : ownerId, remote: { ownerId, device: deviceName(ownerId) } };
}
async function command(ownerId, body) {
  const commandId = crypto.randomUUID();
  await native({ operation: 'change', ownerId, command: { commandId, ...body } });
  for (let i = 0; i < 600; i++) {
    const job = (await native({ operation: 'changes', ownerId })).find((item) => item.commandId === commandId);
    if (job && ['completed', 'failed', 'uncertain'].includes(job.phase)) { forget(ownerId); if (job.phase !== 'completed') throw new Error(job.error || 'The device reported ' + job.phase + '.'); return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The device did not confirm the change.');
}
async function cacheKey(ownerId,entry){const data=new TextEncoder().encode(JSON.stringify([ownerId,entry.id,entry.version]));const digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
const inboxKey = (ownerId) => 'papers-phone-inbox:' + ownerId;

async function fileCapability(operation, params) {
  if(operation==='workspace-files'){
    const request={...params};if(request.path)request.path=phoneUri(request.path)||request.path;
    const result=await native({operation:'workspace-files',request});
    if(result.path?.startsWith('/')){
      const uri='content://com.android.externalstorage.documents/document/'+encodeURIComponent('primary:'+result.path.replace(/^\/storage\/emulated\/0\//,''));
      result.path=phonePath(uri);
      // The PC peer root uses the same display/storage address as ordinary phone paths.
      result.transportPath??='Internal storage\\'+decodeURIComponent(uri.split('/document/')[1]).replace(/^primary:/,'').replace(/\//g,'\\');
    }
    return {ok:true,result};
  }
  if(operation.startsWith('file-target-')){
    const own=phoneUri(params.path);
    if(own){const target=await native({operation:operation.replace('file-target-','phone-target-'),uri:own,targetId:params.targetId,expectedRevision:params.expectedRevision,commandId:params.commandId,oldUri:phoneUri(params.oldPath),newUri:phoneUri(params.newPath)});return {ok:true,target:{...target,...(target.uri?{path:phonePath(target.uri)}:{})}};}
    const parsed=parse(params.path);if(!parsed)return {ok:false,code:'UNSUPPORTED'};
    if(operation==='file-target-relocate')return {ok:true};
    let request={operation:operation==='file-target-delete'?'delete':operation==='file-target-restore'?'restore':'resolve',targetId:params.targetId,expectedRevision:params.expectedRevision,commandId:params.commandId};if(operation==='file-target-track'){const source=await resolve(params.path);request={operation:'track',resourceId:source.entry.id,expectedVersion:source.entry.version};}
    const target=await native({operation:'targets',ownerId:parsed.ownerId,request});return {ok:true,target:{...target,...(Array.isArray(target.parts)?{path:remotePath(parsed.ownerId,target.parts)}:{})}};
  }
  if(operation==='clipboard-image')return {ok:true,dataUrl:await native({operation:'clipboard-image'})};
  if (operation === 'remote-files') return { ok: true, result: await remoteFiles(params) };
  const paths = Array.isArray(params.paths) ? params.paths : [];
  if (operation === 'search') {
    const scope = parse(params.path);
    if (!scope) {
      const found = await native({ operation: 'phone-search', query: String(params.query || ''), limit: params.limit || 100 });
      return { ok: true, provider: 'phone-index', total: found.total, ready: found.ready, results: found.results.map(item => phoneDescription(item)), message: found.ready ? null : 'Indexing phone files…' };
    }
    const found = await native({ operation: 'search', ownerId: scope.ownerId, query: String(params.query || ''), limit: params.limit || 100 });
    const results = found.map((item) => ({ path: remotePath(scope.ownerId, item.parts), name: item.name, kind: item.kind, size: item.size, modifiedAt: item.modifiedAt, attributes: 0 }));
    return { ok: true, provider: 'everything', version: null, total: results.length, results };
  }
  if (operation === 'providers') return { ok: true, providers: { everything: true } };
  // Custom pictures of real files and folders live on the device that owns them (the phone's own in
  // PhoneCustomIcons, a computer's behind its gateway), so every device browsing them sees the same.
  if (operation === 'custom-icons') {
    const folder = phoneUri(params.path);
    if (folder) return { ok: true, icons: await native({ operation: 'phone-custom-icons', uri: folder }).catch(() => ({})) };
    if (!parse(params.path)) return { ok: true, icons: {} };
    const { ownerId, entry } = await resolve(params.path);
    return { ok: true, icons: entry?.kind === 'folder' ? await native({ operation: 'custom-icons', ownerId, resourceId: entry.id }).catch(() => ({})) : {} };
  }
  if (operation === 'custom-icon-set') {
    const icon = params.icon ?? null, own = paths.map(phoneUri).filter(Boolean);
    if (own.length) await native({ operation: 'phone-custom-icon-set', uris: own, icon });
    for (const path of paths.filter(path => !phoneUri(path))) {
      if (!parse(path)) return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available on the phone.' };
      const { ownerId, entry } = await resolve(path);
      if (!entry) return { ok: false, code: 'REMOTE_UNSUPPORTED', message: 'A drive of another device cannot have a custom picture.' };
      await native({ operation: 'custom-icon-set', ownerId, resourceId: entry.id, icon });
    }
    return { ok: true };
  }
  // The phone's own files (chosen with the paperclip) live at \\papers~phone\<content address>.
  if(['copy','move'].includes(operation)&&phoneUri(params.destination)&&paths.length&&paths.every(parse))return copyDeviceToPhone(paths,params.destination);
  if(['copy','move'].includes(operation)&&parse(params.destination)&&paths.length&&paths.every(phoneUri))return copyPhoneToDevice(paths,params.destination);
  if(operation==='editing'){
    const uri=phoneUri(params.path);if(uri)return native({operation:'phone-editing',uri,...params});
    const {ownerId,entry}=await resolve(params.path);if(!entry||entry.kind!=='file')throw Error('Choose a file.');
    const status=await native({operation:'edit-assignments',ownerId});const assignments=status.assignments.filter(item=>item.entry.id===entry.id),localCopy=status.localCopies?.find(copy=>assignments.some(item=>item.active&&item.id===copy.assignmentId));
    if(params.action==='open'){if(!localCopy)throw Error('Working copy is not ready on this device');await native({operation:'edit-open',editId:localCopy.id});}
    if(params.action==='assign')await native({operation:'edit-assign',ownerId,entry,editorDeviceId:params.editorDeviceId});
    if(params.action==='stop'){if(!assignments.some(item=>item.id===params.assignmentId))throw Error('Assignment does not belong to this file');await native({operation:'edit-stop',ownerId,assignmentId:params.assignmentId});}
    return {ok:true,editors:status.editors,assignments,localCopy};
  }
  const own = phoneUri(params.path);
  if (own || paths.some(path=>phoneUri(path))) {
    if(['create-folder','rename','copy','move','delete'].includes(operation))return phoneChange(operation,params);
    if(own)return phoneFile(operation,own,params.path);
  }
  if (![params.path, params.destination, ...paths].some(parse)) return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available on the phone.' };
  switch (operation) {
    case 'stat': { const { ownerId, parts, entry } = await resolve(params.path); return { ok: true, entry: describe(ownerId, parts, entry) }; }
    case 'list': {
      const { ownerId, parts, entry } = await resolve(params.path);
      const items = (await listAll(ownerId, entry?.id)).map((item) => describe(ownerId, [...parts, item.name], item))
        .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      return { ok: true, entry: describe(ownerId, parts, entry), items, truncated: false };
    }
    case 'icon': return { ok: true, icon: null };
    case 'thumbnail': {
      const {ownerId,entry}=await resolve(params.path);if(!entry||entry.kind!=='file')return {ok:true,preview:{kind:'none'}};
      return {ok:true,preview:await native({operation:'thumbnail',ownerId,resourceId:entry.id})};
    }
    case 'preview': {
      // The computer that holds the file renders text and images with its own tools; a PDF, audio or
      // video is fetched (verified) and previewed on the phone.
      const { ownerId, parts, entry } = await resolve(params.path);
      const described = describe(ownerId, parts, entry);
      if (!entry || entry.kind !== 'file') return { ok: true, entry: described, preview: { kind: 'none' } };
      if (/^\.(pdf|mp4|m4v|webm|mkv|mov|3gp|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/.test(described.extension)) return { ok: true, entry: described, preview: await native({ operation: 'cache-preview', ownerId, entry }) };
      return { ok: true, entry: described, preview: await native({ operation: 'preview', ownerId, resourceId: entry.id }) };
    }
    case 'open': {
      const {ownerId,entry}=await resolve(params.path);if(!entry||entry.kind!=='file')throw Error('Choose a file to open.');
      const editing=await native({operation:'edit-assignments',ownerId}).catch(()=>null);const assignment=editing?.assignments?.find(a=>a.active&&a.entry?.id===entry.id),copy=editing?.localCopies?.find(c=>c.assignmentId===assignment?.id);if(copy)return {ok:true,...await native({operation:'edit-open',editId:copy.id})};
      const job=await native({operation:'download',ownerId,entry});
      for(;;){const current=await native({operation:'download-job',jobId:job.id});if(current.phase==='completed')break;if(current.phase==='failed')throw Error(current.error||'The file could not be fetched.');await new Promise(r=>setTimeout(r,200));}
      return {ok:true,...await native({operation:'open-cache',ownerId,key:job.key||await cacheKey(ownerId,entry)})};
    }
    case 'create-folder': { const { ownerId, entry } = await resolve(params.path); await command(ownerId, { operation: 'create-folder', resourceId: entry.id, expectedVersion: entry.version, newName: String(params.newName) }); return fileCapability('stat', { path: `${params.path}\\${params.newName}` }); }
    case 'rename': { const { ownerId, parts, entry } = await resolve(params.path); await command(ownerId, { operation: 'rename', resourceId: entry.id, expectedVersion: entry.version, newName: String(params.newName) }); return { ok: true, operation, path: remotePath(ownerId, [...parts.slice(0, -1), String(params.newName)]) }; }
    case 'delete': { for (const target of paths) { const { ownerId, entry } = await resolve(target); await command(ownerId, { operation: 'delete', resourceId: entry.id, expectedVersion: entry.version }); } return { ok: true, operation }; }
    case 'copy': case 'move': {
      const owners = new Set([...paths, params.destination].map((p) => parse(p)?.ownerId ?? 'phone'));
      if (owners.size !== 1 || owners.has('phone')) return { ok: false, code: 'CROSS_DEVICE_UNSUPPORTED', message: 'From the phone, copy and move work within one device.' };
      const ownerId = [...owners][0];
      for (const target of paths) { const { entry } = await resolve(target); const destination = (await resolve(params.destination)).entry; await command(ownerId, { operation, resourceId: entry.id, expectedVersion: entry.version, destinationId: destination.id, destinationVersion: destination.version }); }
      return { ok: true, operation };
    }
    default: return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available on the phone.' };
  }
}
// A path shaped like any other (so As you Go previews it), holding the phone file's content:// address.
const PHONE_ROOT = '\\\\papers~phone\\';
const phonePath = uri => {
  if (uri.startsWith('content://com.android.externalstorage.documents/document/')) {
    const id = decodeURIComponent(new URL(uri).pathname.slice('/document/'.length)), colon = id.indexOf(':');
    if(colon>=0)return PHONE_ROOT + [id.slice(0,colon), ...id.slice(colon+1).split('/').filter(Boolean)].map(encodeURIComponent).join('\\');
  }
  return PHONE_ROOT + encodeURIComponent(uri);
};
const phoneUri = path => {
  const text=String(path||'');if(!text.toLowerCase().startsWith(PHONE_ROOT))return null;
  try { const tail=text.slice(PHONE_ROOT.length), old=decodeURIComponent(tail);if(old.startsWith('content://'))return old;
    const [volume,...parts]=tail.split('\\').map(decodeURIComponent);if(!volume)return null;
    return 'content://com.android.externalstorage.documents/document/'+encodeURIComponent(volume+':'+parts.join('/'));
  }catch{return null;}
};
function phoneDescription(info) {
  const path = phonePath(info.uri), dot = info.name.lastIndexOf('.');
  return { ...(String(info.name||'').startsWith('.')?{hidden:true}:{}), path, name: info.name, parent: info.parentUri ? phonePath(info.parentUri) : null, kind: info.kind || 'file', extension: info.kind === 'folder' || dot < 1 ? '' : info.name.slice(dot).toLowerCase(), size: info.size ?? null, createdAt: null, modifiedAt: typeof info.modifiedAt === 'number' ? info.modifiedAt : info.modifiedAt ? Date.parse(info.modifiedAt) : null, identity: info.uri, folder: info.folder || '' };
}

async function phoneFile(operation, uri, path) {
  const info = async () => uri.startsWith('content://com.android.externalstorage.documents/') ? native({operation:'phone-stat',uri}) : { ...(await native({operation:'uri-stat',uri})), uri, kind:'file' };
  switch (operation) {
    case 'stat': try{return { ok: true, entry: phoneDescription(await info()) };}catch(error){if(error.message==='PHONE_FILE_NOT_FOUND')return {ok:false,code:'ENOENT',message:'The phone file no longer exists.'};throw error;}
    case 'list': { const listing=await native({operation:'phone-list',uri});return {ok:true,entry:phoneDescription(listing.entry),items:listing.items.map(phoneDescription),truncated:false}; }
    case 'thumbnail': {const entry=phoneDescription(await info());return {ok:true,preview:entry.kind==='folder'?{kind:'none'}:await native({operation:'uri-thumbnail',uri})};}
    case 'preview': { const entry=phoneDescription(await info());return {ok:true,entry,preview:entry.kind==='folder'?{kind:'none'}:await native({operation:'uri-preview',uri})}; }
    case 'open': return { ok: true, ...(await native({ operation: 'uri-open', uri })) };
    case 'resolve-storage-path': {const result=await native({operation:'uri-storage-path',uri});return {ok:true,path:phonePath(result.uri)};}
    case 'reveal': return {ok:true,...await native({operation:'uri-reveal',uri})};
    case 'icon': return {ok:true,...await native({operation:'uri-icon',uri})};
    default: return { ok: false, code: 'UNAVAILABLE_ON_PHONE', message: 'Not available for a phone file.' };
  }
}

// One upload batch, observed by the existing compact phone transfer panel.
let uploadStatus=null;
async function copyDeviceToPhone(paths,destination) {
  if(uploadStatus&&['preparing','transferring','verifying','saving'].includes(uploadStatus.phase))throw Error('Wait for the current transfer to finish.');
  const target=await phoneFile('stat',phoneUri(destination),destination);if(!target.ok||target.entry.kind!=='folder')throw Error('Choose a writable phone folder.');
  const items=[],results=[];uploadStatus={id:crypto.randomUUID(),direction:'download',phase:'preparing',bytes:0,total:0,count:0,index:0,file:'',destination:{name:target.entry.name}};
  try {
    async function collect(path,relative,depth=0){if(depth>128||items.length>=100000)throw Error('The selected folder tree is too large.');const source=await resolve(path);if(!source.entry)throw Error('Choose files or folders, not a whole device.');items.push({...source,path,relative});if(source.entry.kind==='folder')for(const child of await listAll(source.ownerId,source.entry.id))await collect(path+'\\'+child.name,[...relative,child.name],depth+1);}
    for(const path of [...new Set(paths)]){const source=await resolve(path);if(!source.entry)throw Error('Choose files or folders first.');await collect(path,[source.entry.name]);}
    uploadStatus.count=items.filter(x=>x.entry.kind==='file').length;uploadStatus.total=items.reduce((n,x)=>n+(x.entry.size||0),0);
    const folders=new Map([['',destination]]);let done=0,index=0;
    for(const item of items){const parent=folders.get(item.relative.length===1?'':JSON.stringify(item.relative.slice(0,-1)));uploadStatus.file=item.relative.join('/');uploadStatus.index=index;
      if(item.entry.kind==='folder'){
        const listing=await phoneFile('list',phoneUri(parent),parent),names=new Set(listing.items.map(x=>x.name.toLowerCase()));let name=item.entry.name;for(let n=1;names.has(name.toLowerCase());n++)name=item.entry.name+' ('+n+')';
        await phoneChange('create-folder',{path:parent,newName:name});const path=parent+'\\'+encodeURIComponent(name);folders.set(JSON.stringify(item.relative),path);if(item.relative.length===1)results.push(path);continue;
      }
      const job=await native({operation:'download',ownerId:item.ownerId,entry:item.entry});
      for(;;){const current=await native({operation:'download-job',jobId:job.id});uploadStatus.phase=current.phase==='completed'?'saving':current.phase;uploadStatus.bytes=done+(current.bytes||0);if(current.phase==='failed')throw Error(current.error||'Download failed.');if(current.phase==='completed')break;await new Promise(r=>setTimeout(r,200));}
      const saved=await native({operation:'phone-save-cache',ownerId:item.ownerId,entry:item.entry,destinationUri:phoneUri(parent)});done+=item.entry.size;index++;if(item.relative.length===1)results.push(saved.path);
    }
    uploadStatus.phase='completed';uploadStatus.bytes=uploadStatus.total;return {ok:true,operation:'copy',paths:results};
  }catch(error){uploadStatus.phase='failed';uploadStatus.error=error.message;throw error;}
}
async function copyPhoneToDevice(paths,destination) {
  if(uploadStatus&&['preparing','transferring','verifying','saving'].includes(uploadStatus.phase))throw Error('Wait for the current upload to finish.');
  const target=await resolve(destination);if(target.entry?.kind!=='folder')throw Error('Choose a folder on the PC.');
  const ownerId=target.ownerId,items=[],results=[];
  uploadStatus={id:crypto.randomUUID(),direction:'upload',phase:'preparing',bytes:0,total:0,count:0,index:0,file:'',destination:{name:destination}};
  try {
    async function collect(path,relative,depth=0){
      if(depth>128||items.length>=100000)throw Error('The selected folder tree is too large.');
      const stat=await phoneFile('stat',phoneUri(path),path);if(!stat.ok)throw Error(stat.message||'The phone file is unavailable.');
      const entry=stat.entry;items.push({path,relative,entry});
      if(entry.kind==='folder'){const listing=await phoneFile('list',phoneUri(path),path);for(const child of listing.items)await collect(child.path,[...relative,child.name],depth+1);}
    }
    for(const path of [...new Set(paths)]){const stat=await phoneFile('stat',phoneUri(path),path);if(!stat.ok)throw Error(stat.message||'The phone file is unavailable.');await collect(path,[stat.entry.name]);}
    uploadStatus.count=items.filter(x=>x.entry.kind==='file').length;uploadStatus.total=items.reduce((n,x)=>n+(x.entry.size||0),0);
    const folders=new Map([['',destination]]);let done=0,index=0;
    for(const item of items){
      const key=JSON.stringify(item.relative),parentKey=item.relative.length===1?'':JSON.stringify(item.relative.slice(0,-1)),parent=folders.get(parentKey);
      uploadStatus.file=item.relative.join('/');uploadStatus.index=index;
      if(item.entry.kind==='folder'){
        const resolved=await resolve(parent);if(!resolved.entry)throw Error('Choose a shared folder on the PC.');
        const names=new Set((await listAll(ownerId,resolved.entry.id)).map(x=>x.name.toLowerCase()));let name=item.entry.name;for(let n=1;names.has(name.toLowerCase());n++)name=item.entry.name+' ('+n+')';
        await command(ownerId,{operation:'create-folder',resourceId:resolved.entry.id,expectedVersion:resolved.entry.version,newName:name});
        const created=parent+'\\'+name;folders.set(key,created);if(item.relative.length===1)results.push(created);continue;
      }
      const folder=await resolve(parent);if(folder.entry?.kind!=='folder')throw Error('The PC destination folder is unavailable.');
      const job=await native({operation:'phone-upload-start',ownerId,folderId:folder.entry.id,uri:phoneUri(item.path),name:item.entry.name});
      for(;;){const current=await native({operation:'download-job',jobId:job.id});uploadStatus.phase=current.phase;uploadStatus.bytes=done+(current.bytes||0);if(current.phase==='failed')throw Error(current.error||'Upload failed.');if(current.phase==='completed'){uploadStatus.phase='saving';done+=current.entry.size;index++;if(item.relative.length===1)results.push(parent+'\\'+current.entry.name);break;}await new Promise(r=>setTimeout(r,200));}
      forget(ownerId);
    }
    uploadStatus.phase='completed';uploadStatus.bytes=uploadStatus.total;return {ok:true,operation:'copy',paths:results};
  }catch(error){uploadStatus.phase='failed';uploadStatus.error=error.message;throw error;}
}
async function phoneChange(action,params) {
  const paths=['rename','create-folder'].includes(action)?[params.path]:[...new Set(params.paths||[])];
  if(!paths.length||paths.some(path=>!phoneUri(path)))throw Error('Select phone files first.');
  if(['copy','move'].includes(action)&&!phoneUri(params.destination))throw Error('Choose a phone folder destination.');
  for(const path of paths) {
    const commandId=crypto.randomUUID();
    await native({operation:'phone-change',commandId,action,uri:phoneUri(path),...(params.newName?{newName:params.newName}:{}),...(params.destination?{destinationUri:phoneUri(params.destination)}:{})});
    for(;;){const job=await native({operation:'phone-change-status',commandId});if(job.phase==='completed')break;if(['failed','uncertain'].includes(job.phase))throw Error(job.error||'The phone could not confirm this change.');await new Promise(r=>setTimeout(r,200));}
  }
  return {ok:true,operation:action};
}

let selfName = null;
async function phoneName() { if (!selfName) selfName = (await native({ operation: 'self' })).name; return selfName; }
async function remoteFiles(params) {
  const ownerId = params.ownerId;
  switch (params.operation) {
    case 'working-folder': {const result=await native({operation:'working-folder'});return {path:phonePath(result.uri)};}
    case 'download-folder': case 'download-folder-pick': case 'public-download-status': case 'public-download-pause': case 'public-download-resume': return native({operation:params.operation});
    case 'public-download-start': {
      const destination=await native({operation:'download-folder'});if(!destination.valid)throw Error('Choose a writable Download folder in the device menu first.');
      const items=[],seen=new Set();
      async function collect(ownerId,entry,relative){const key=ownerId+'|'+entry.id;if(seen.has(key))return;seen.add(key);if(entry.kind==='file'){items.push({ownerId,entry,relative});return;}if(entry.kind!=='folder')return;const children=await listAll(ownerId,entry.id);if(!children.length)items.push({ownerId,entry:{...entry,size:0},relative,directory:true});for(const child of children)await collect(ownerId,child,relative+'/'+child.name);}
      for(const path of params.paths||[]){const target=parse(path)?path:ownerId&&/^[A-Za-z]:[\\/]/.test(path)?remotePath(ownerId,path.replace(/\//g,'\\').split('\\')):path;const resolved=await resolve(target);if(resolved.entry)await collect(resolved.ownerId,resolved.entry,resolved.entry.name);}
      if(!items.length)throw Error('Selection contains no downloadable files.');
      return native({operation:'public-download-start',items});
    }
    case 'receive-to-phone': {const folder=await native({operation:'download-folder'});if(!folder.valid)throw Error('Choose a writable Download folder in the device menu first.');let uri=folder.uri;if(uri.includes('/tree/')){const id=decodeURIComponent(new URL(uri).pathname.split('/tree/')[1].split('/')[0]);uri='content://com.android.externalstorage.documents/document/'+encodeURIComponent(id);}return (await copyDeviceToPhone(params.paths,phonePath(uri))).paths;}
    case 'upload-status': return uploadStatus||{phase:'idle'};
    case 'send-to-inbox': {const inbox=await remoteFiles({operation:'inbox',ownerId});const copied=await fileCapability('copy',{paths:params.paths,destination:inbox.path});return copied.paths;}
    case 'status': { const result = await status(); return { ...result, owner: { name: await phoneName() } }; }
    case 'workspaces': return native({ operation: 'workspaces', ownerId });
    case 'workspace-load': return native({ operation: 'workspace-load', ownerId, workspaceId: params.workspaceId });
    case 'workspace-icon': return native({ operation: 'workspace-icon', ownerId, workspaceId: params.workspaceId, name: params.name });
    case 'workspace-save': return native({ operation: 'workspace-save', ownerId, workspaceId: params.workspaceId, state: params.state, revision: params.revision });
    case 'inbox': {
      let chosen = null; try { chosen = JSON.parse(localStorage.getItem(inboxKey(ownerId)) || 'null'); } catch {}
      if (chosen) return { path: remotePath(ownerId, chosen), parts: chosen, chosen: true };
      const fallback = await native({ operation: 'inbox', ownerId });
      return { path: remotePath(ownerId, fallback.parts), parts: fallback.parts, chosen: false };
    }
    case 'inbox-set': {
      const text = typeof params.path === 'string' ? params.path.trim() : '';
      if (!text) { try { localStorage.removeItem(inboxKey(ownerId)); } catch {} return remoteFiles({ operation: 'inbox', ownerId }); }
      const parts = text.replace(/\//g, '\\').split('\\').filter(Boolean);
      if (!/^[A-Za-z]:$/.test(parts[0] || '')) throw new Error('Type a folder path on that device, like C:\\Users\\me\\Inbox.');
      parts[0] = parts[0].toUpperCase();
      try { localStorage.setItem(inboxKey(ownerId), JSON.stringify(parts)); } catch {}
      return { path: remotePath(ownerId, parts), parts, chosen: true };
    }
    default: throw new Error('Not available on the phone.');
  }
}

// The phone's own As you Go document.
// A phone document without a theme of its own takes the theme of the computers' As you Go.
const THEME_KEY = 'papers-phone-computer-theme';
async function computerTheme() {
  let theme = null; try { theme = localStorage.getItem(THEME_KEY); } catch {}
  if (theme) return theme;
  try {
    for (const device of (await status()).devices || []) {
      const [workspace] = await native({ operation: 'workspaces', ownerId: device.id });
      if (!workspace) continue;
      const loaded = await native({ operation: 'workspace-load', ownerId: device.id, workspaceId: workspace.id });
      theme = loaded.state?.view?.preferences?.theme;
      if (theme) break;
    }
  } catch {}
  theme ||= 'dark';
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  return theme;
}
async function loadOwn() {
  const loaded = await native({ operation: 'local-state-load' });
  const state = loaded.state ? JSON.parse(loaded.state) : structuredClone(EMPTY_STATE);
  if (!state.view?.preferences?.theme) state.view = { ...(state.view || {}), preferences: { ...(state.view?.preferences || {}), theme: await computerTheme() } };
  return { state: JSON.stringify(state), revision: loaded.revision };
}
async function handle(type, request) {
  switch (type) {
    case 'papers:project:state-load-versioned': return loadOwn();
    case 'papers:project:as-you-go-load': return { state: (await loadOwn()).state };
    case 'papers:project:state-save-checked': return { stateSave: await native({ operation: 'local-state-save', state: request.state, revision: request.revision }) };
    case 'papers:project:as-you-go-launch': {
      const loaded=await loadOwn();const item=JSON.parse(loaded.state).shortcuts?.find(item=>item.id===request.actionId);if(!item)throw Error('The file link is unavailable.');
      const uri=phoneUri(item.target) || (String(item.target).startsWith('content://')?item.target:null);
      if(uri)return {opened:await native({operation:'uri-open',uri})};
      throw Error('This link cannot be opened on the phone.');
    }
    case 'papers:project:as-you-go-save': { const current = await loadOwn(); await native({ operation: 'local-state-save', state: request.state, revision: current.revision }); return {}; }
    case 'papers:project:workspace-writer-lease-acquire': return { writerLease: null };
    case 'papers:project:workspace-writer-lease-release': return {};
    case 'papers:phone:pick-files': return { picked: (await native({ operation: 'pick-files' })).map((file) => ({ ...file, target: phonePath(file.target) })) };
    case 'papers:project:file-capability': return { fileCapability: await fileCapability(request.operation, request.params || {}).catch((error) => ({ ok: false, code: 'FILE_OPERATION_FAILED', message: error.message })) };
    case 'papers:project:open-new-surface': {
      // A device's As you Go opens over the phone's own; Android back returns to it.
      const next = new URL(request.url);
      openLayer(next.pathname.replace(/^\//, '') + next.search);
      return {};
    }
    default: throw new Error('Not available on the phone.');
  }
}
// The phone's own As you Go stays loaded; Proxima and a device's As you Go open in a layer over it
// that appears only once painted in its theme, and back just removes the layer (no reload, no flash).
function injectScript(frame, name) {
  const doc = frame.contentDocument; if (!doc?.head) return;
  const script = doc.createElement('script'); script.src = new URL(name, location.href).href; doc.head.append(script);
}
let layer = null;
// The open layer is remembered, so the app comes back where it was left.
const LAST_LAYER = 'papers-phone-last-layer';
function openLayer(src) {
  const previous = layer;
  const next = document.createElement('iframe');
  next.className = 'papers-layer'; next.title = 'Papers'; next.style.visibility = 'hidden';
  next.src = src; document.body.append(next); layer = next;
  try { localStorage.setItem(LAST_LAYER, src); } catch {}
  const started = Date.now();
  const reveal = () => {
    if (layer !== next) return;
    const root = next.contentDocument?.documentElement;
    // As you Go marks its theme once its document is installed; Proxima says when it has drawn the
    // device's own data (never its default layout first), and slides in.
    const proxima = src.startsWith('proxima/');
    const ready = root && next.contentDocument.readyState === 'complete' && (proxima ? next.dataset.ready === 'true' : root.dataset.theme);
    if (next.style.visibility === 'visible') return;
    if (ready || Date.now() - started > (proxima ? 16000 : 6000)) {
      if (proxima) next.classList.add('is-entering');
      next.style.visibility = 'visible';
      if(pendingLocation)next.contentWindow.postMessage({type:'papers:phone:restore-location',visit:pendingLocation},location.origin);
      historyState();
      // The previous layer stays under the incoming one until its slide-in has finished.
      if (previous) setTimeout(() => previous.remove(), proxima ? 260 : 0);
    } else setTimeout(reveal, 50);
  };
  next.addEventListener('load', reveal);
  // Every layer gets the phone mouse; Proxima also gets its own gestures (inertia, strips, calendar zoom).
  next.addEventListener('load', () => {
    injectScript(next, 'phone-mouse.js');
    if (src.startsWith('proxima/')) injectScript(next, 'proxima-phone.js');
  });
}
function closeLayer() {
  if (!layer) return false;
  setTimeout(()=>frame.contentWindow.postMessage({type:'papers:phone:report-location'},location.origin),0);
  // Proxima fades out over As you Go; other layers just go.
  for (const node of document.querySelectorAll('.papers-layer')) {
    if (node.getAttribute('src')?.startsWith('proxima/') && node.style.visibility === 'visible') { node.classList.add('is-leaving'); setTimeout(() => node.remove(), 200); }
    else node.remove();
  }
  layer = null; try { localStorage.removeItem(LAST_LAYER); } catch {} return true;
}
// Proxima on the phone shows another machine's Proxima: the last one viewed, else the first with one.
const PROXIMA_DEVICE = 'papers-phone-proxima-device';
async function proximaShare(ownerId) {
  const list = await native({ operation: 'backpacks', ownerId });
  const share = (list.entries || []).find((item) => item.kind === 'proxima');
  if (!share) throw new Error('That computer has no Proxima to show.');
  return share;
}
const LOCAL_PROXIMA = 'local';
async function openProxima(ownerId) {
  if (!ownerId) {
    let remembered = null; try { remembered = localStorage.getItem(PROXIMA_DEVICE); } catch {}
    const known = (await status()).devices || [];
    ownerId = remembered === LOCAL_PROXIMA || known.some((d) => d.id === remembered) ? remembered : known[0]?.id ?? LOCAL_PROXIMA;
  }
  try { localStorage.setItem(PROXIMA_DEVICE, ownerId); } catch {}
  // The phone's own Proxima keeps its facts on the phone; a computer's opens with control.
  if (ownerId === LOCAL_PROXIMA) openLayer('proxima/index.html?papers-phone=1');
  else openLayer('proxima/index.html?papers-phone=1&papers-control=1&papers-device=' + ownerId);
}
async function proximaRequest(request) {
  // The device switcher lists this phone (its own Proxima) first, then the computers.
  if (request.operation === 'devices') return [{ id: LOCAL_PROXIMA, name: await phoneName() }, ...((await status()).devices || [])];
  // The phone controls Proxima the way a computer's remote view does: the live owner's view, and
  // commands the owner applies and confirms. Nothing is saved or queued on the phone.
  if (request.operation === 'snapshot' || request.operation === 'command') {
    const share = await proximaShare(request.ownerId);
    const result = request.operation === 'command'
      ? await native({ operation: 'backpack-command', ownerId: request.ownerId, resourceId: share.id, command: request.command })
      : await native({ operation: 'backpack-view', ownerId: request.ownerId, resourceId: share.id });
    // Restored at launch, Proxima can ask before the device list is loaded: load it for the name.
    if (!devices.some((d) => d.id === request.ownerId)) await status();
    return { ...result, name: deviceName(request.ownerId) };
  }
  // The phone's own Proxima: published to the computers to view, replacing a computer's (confirmed on
  // the phone), and taking a replacement a computer left for the phone.
  if (request.operation === 'publish') return native({ operation: 'publish-proxima', snapshot: { ...request.snapshot, deviceName: await phoneName() } });
  if (request.operation === 'replace') { const share = await proximaShare(request.ownerId); return native({ operation: 'backpack-replace', ownerId: request.ownerId, resourceId: share.id, snapshot: request.snapshot }); }
  if (request.operation === 'replacement') return native({ operation: 'peer-replacement' });
  if (request.operation === 'replacement-done') return native({ operation: 'peer-replacement-done', ownerId: request.from });
  throw new Error('Not available on the phone.');
}
window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.type!=='papers:phone:owner-changed')return;
  if(layer)layer.contentWindow.postMessage({type:'papers:phone:owner-changed'},location.origin);
});
const fromPage = (source) => source === frame.contentWindow || (layer && source === layer.contentWindow);
window.addEventListener('message', (event) => {
  if (!fromPage(event.source)) return;
  const reply = (message) => event.source.postMessage(message, location.origin);
  if (event.data?.type === 'papers:phone:proxima' || event.data?.type === 'papers:proxima-device:open') { void openProxima(event.data.ownerId).catch((error) => console.error(error)); return; }
  // "This device" in a device's As you Go returns to the phone's own.
  // A place chosen in the pill there (AYG device-modes.js) is carried out by the phone's own page.
  if(event.data?.type==='papers:phone:location'){
    if(event.source!==(layer||frame).contentWindow)return;
    const visit={...event.data.visit,surface:layer?new URL(layer.src).pathname.slice(1)+new URL(layer.src).search:null};
    if(!visit||!['ayg','machine'].includes(visit.mode))return;
    if(pendingLocation&&!locationHistory.matches(visit))return;
    pendingLocation=null;locationHistory.record(visit);historyState();return;
  }
  if(event.data?.type==='papers:phone:history-go'){
    if(event.source!==(layer||frame).contentWindow||pendingLocation)return;
    const delta=Number(event.data.delta);if(![-1,1].includes(delta))return;
    const visit=locationHistory.go(delta);if(!visit)return;pendingLocation=visit;historyState();
    if(!visit.surface){closeLayer();frame.contentWindow.postMessage({type:'papers:phone:restore-location',visit},location.origin);}
    else if(layer&&new URL(layer.src).pathname.slice(1)+new URL(layer.src).search===visit.surface)layer.contentWindow.postMessage({type:'papers:phone:restore-location',visit},location.origin);
    else openLayer(visit.surface);
    return;
  }
  if (event.data?.type === 'papers:phone:this-device') { closeLayer(); const navigate = event.data.navigate; if (navigate && typeof navigate === 'object') frame.contentWindow.postMessage({ type: 'papers:phone:navigate', navigate: { device: String(navigate.device || ''), mode: String(navigate.mode || '') } }, location.origin); return; }
  if (event.data?.type === 'proxima:device-view-ready') { if (layer && event.source === layer.contentWindow) layer.dataset.ready = 'true'; return; }
  if (event.data?.type === 'papers:proxima-device:request') {
    const { requestId } = event.data;
    proximaRequest(event.data).then(
      (result) => reply({ type: 'papers:proxima-device:result', requestId, ok: true, result }),
      (error) => reply({ type: 'papers:proxima-device:result', requestId, ok: false, error: String(error?.message || error) }),
    );
    return;
  }
  if (typeof event.data?.type !== 'string' || !event.data.requestId) return;
  const { type, requestId } = event.data;
  handle(type, event.data).then(
    (payload) => reply({ type: 'papers:host:result', requestId, ok: true, ...(payload || {}) }),
    (error) => reply({ type: 'papers:host:result', requestId, ok: false, error: String(error?.message || error) }),
  );
});
// Android back: close an open preview first, then the layer (Proxima or a device), then leave.
window.papersBack = () => {
  const page = (layer || frame).contentWindow;
  if (page?.papersPhoneBack?.()) return true;
  return closeLayer();
};
// The phone's As you Go shows only once painted in its theme (no white page at launch), and the
// screen that was open when the app was left opens again over it.
frame.addEventListener('load', () => injectScript(frame, 'phone-mouse.js'));
frame.src = 'ayg/workspace-20260730b.html?papers-phone=1';
{
  const started = Date.now();
  const reveal = () => {
    if (frame.contentDocument?.documentElement?.dataset.theme || Date.now() - started > 6000) frame.style.visibility = 'visible'; else setTimeout(reveal, 50);
  };
  reveal();
  let last = null; try { last = localStorage.getItem(LAST_LAYER); } catch {}
  // Proxima opened before phone control existed is reopened with control.
  if (last?.startsWith('proxima/') && last.includes('papers-device=') && !last.includes('papers-control=')) last = last.replace('papers-phone=1', 'papers-phone=1&papers-control=1');
  if (last && /^(proxima|ayg)\//.test(last)) openLayer(last);
}
