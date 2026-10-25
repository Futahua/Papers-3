// Usage: node tools/phoneDeviceCheck.mjs <config.json> with { owner, path, bigSha256, resumeSha256, ownerNotePath }; phone on USB with the debuggable app.
// Drives the phone app's own Java client (MobileFiles) through its debuggable WebView and
// runs the device checks against the desktop owner. Uses adb + DevTools; no taps needed.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const adb = (...args) => execFileSync('D:/Programs/AndroidSDK/platform-tools/adb.exe', ['-s', 'RF8M73S4NEM', ...args], { encoding: 'latin1', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = [];
async function check(name, run) {
  const started = Date.now();
  console.error('> ' + name);
  try { const detail = await run(); results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); }
  catch (error) { results.push({ name, ok: false, ms: Date.now() - started, error: String(error.message).slice(0, 400) }); }
}

adb('shell', 'am', 'force-stop', 'com.futahua.papers.mobile');
adb('shell', 'am', 'start', '-n', 'com.futahua.papers.mobile/.MainActivity');
await new Promise(r => setTimeout(r, 4000));
const pid = adb('shell', 'pidof', 'com.futahua.papers.mobile').trim();
adb('forward', 'tcp:9334', `localabstract:webview_devtools_remote_${pid}`);
const target = (await (await fetch('http://127.0.0.1:9334/json')).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const waiting = new Map();
ws.onmessage = event => { const data = JSON.parse(event.data); waiting.get(data.id)?.(data); waiting.delete(data.id); };
async function evaluate(body) {
  const id = ++seq;
  const reply = await new Promise(resolve => { waiting.set(id, resolve); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(async()=>{${body}})()`, awaitPromise: true, returnByValue: true } })); });
  if (reply.result?.exceptionDetails) throw Error(reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
}
// The app's bridge: PapersNative.request(id, json) answers via window.papersReply(id, {ok, result|message}).
await evaluate(`window.__check=p=>new Promise(r=>{window.__checkSeq=(window.__checkSeq||900000)+1;const id=window.__checkSeq;const prev=window.papersReply;window.papersReply=(i,res)=>{if(i===id){window.papersReply=prev;r(res);}else prev?.(i,res);};window.PapersNative.request(id,JSON.stringify(p));});return true;`);
async function call(params) {
  const started = Date.now();
  const reply = await Promise.race([evaluate(`return await window.__check(${JSON.stringify(params)});`), new Promise((_, reject) => setTimeout(() => reject(Error('no reply in 60 s to ' + params.operation)), 60000))]);
  if (Date.now() - started > 5000) console.error(`  slow ${params.operation}: ${Date.now() - started} ms`);
  if (!reply.ok) throw Error(reply.message);
  return reply.result;
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let owner, folder;
async function listAll(resourceId) {
  const entries = []; let offset = 0;
  for (;;) { const page = await call({ operation: 'browse', ownerId: owner, ...(resourceId ? { resourceId } : {}), offset }); if (page.online === false) throw Error('listing served from the saved copy on the phone: ' + page.error); entries.push(...page.entries); if (page.nextOffset == null) return entries; offset = page.nextOffset; }
}
const find = async name => { const e = (await listAll(folder.id)).find(i => i.name === name); if (!e) throw Error('missing ' + name); return e; };
async function walk() { let entries = await listAll(); let current; for (const name of config.path) { current = entries.find(i => i.name === name); if (!current) throw Error('missing ' + name); entries = await listAll(current.id); } folder = current; return current; }
async function waitDownload(id, cancelEarly) {
  for (let i = 0; i < 3000; i++) {
    const status = await call({ operation: 'status' });
    const job = status.jobs.find(j => j.id === id);
    if (cancelEarly && job?.bytes > 0 && job.phase === 'transferring') { await call({ operation: 'cancel', jobId: id }); cancelEarly = false; }
    if (job && ['completed', 'failed'].includes(job.phase)) return job;
    await sleep(200);
  }
  throw Error('download timed out');
}
// Read a cached copy straight from the app's private storage (debuggable build).
function cachedSha(entry) {
  const list = adb('shell', 'run-as', 'com.futahua.papers.mobile', 'find', 'files/remote-files', '-type', 'f', '-size', `${Math.ceil(entry.size / 512)}b`).split('\n').map(s => s.trim()).filter(Boolean);
  for (const file of list) { const bytes = Buffer.from(execFileSync('D:/Programs/AndroidSDK/platform-tools/adb.exe', ['-s', 'RF8M73S4NEM', 'exec-out', 'run-as', 'com.futahua.papers.mobile', 'cat', file], { maxBuffer: 256 * 1024 * 1024 })); if (bytes.length === entry.size) { const h = sha(bytes); if (h === config.bigSha256 || h === config.resumeSha256) return h; } }
  return null;
}
async function change(command) {
  const commandId = crypto.randomUUID();
  await call({ operation: 'change', ownerId: owner, command: { commandId, ...command } });
  for (let i = 0; i < 300; i++) {
    const job = (await call({ operation: 'changes', ownerId: owner })).find(j => j.commandId === commandId);
    if (job && ['completed', 'failed', 'uncertain'].includes(job.phase)) { if (job.phase !== 'completed') throw Error(command.operation + ' ' + job.phase + ' ' + (job.error ?? '')); return; }
    await sleep(200);
  }
  throw Error(command.operation + ' did not finish');
}

try {
  await check('phone connects with no code and drops stale test owners', async () => {
    const status = await call({ operation: 'status' });
    const desktop = status.devices.find(d => d.address === config.owner);
    if (!desktop) throw Error('not connected to ' + config.owner + '; has ' + JSON.stringify(status.devices.map(d => d.name + ' ' + d.address)));
    owner = desktop.id;
    return { devices: status.devices.map(d => d.name + ' ' + d.address) };
  });
  await check('list every shared drive root', async () => { const counts = {}; for (const s of await listAll()) counts[s.name] = (await listAll(s.id)).length; return counts; });
  await check('navigate to the fixture folder', async () => ({ entries: (await listAll((await walk()).id)).map(i => i.name) }));
  await check('download a large file and verify SHA-256', async () => {
    const big = await find('big.bin'); const started = Date.now();
    const job = await waitDownload((await call({ operation: 'download', ownerId: owner, entry: big })).id);
    if (job.phase !== 'completed') throw Error(job.error);
    const seconds = (Date.now() - started) / 1000;
    if (cachedSha(big) !== config.bigSha256) throw Error('cached content hash mismatch');
    return { mbps: +(big.size * 8 / seconds / 1e6).toFixed(1) };
  });
  await check('interrupt a download, resume it, verify', async () => {
    const r = await find('resume.bin');
    const first = await waitDownload((await call({ operation: 'download', ownerId: owner, entry: r })).id, true);
    if (first.phase === 'completed') return { note: 'finished before interruption' };
    const second = await waitDownload((await call({ operation: 'download', ownerId: owner, entry: r })).id);
    if (second.phase !== 'completed') throw Error(second.error);
    if (cachedSha(r) !== config.resumeSha256) throw Error('resumed hash mismatch');
    return { interruptedAt: first.bytes };
  });
  await check('file operations: create folder, copy, rename, move, delete', async () => {
    let parent = await walk();
    await change({ operation: 'create-folder', resourceId: parent.id, expectedVersion: parent.version, newName: 'phone-ops' });
    let ops = await find('phone-ops'); const note = await find('note.txt');
    await change({ operation: 'copy', resourceId: note.id, expectedVersion: note.version, destinationId: ops.id, destinationVersion: ops.version });
    const copied = (await listAll(ops.id)).find(i => i.name === 'note.txt'); if (!copied) throw Error('copy missing');
    await change({ operation: 'rename', resourceId: copied.id, expectedVersion: copied.version, newName: 'phone-renamed.txt' });
    const renamed = (await listAll(ops.id)).find(i => i.name === 'phone-renamed.txt'); if (!renamed) throw Error('rename missing');
    parent = await walk();
    await change({ operation: 'move', resourceId: renamed.id, expectedVersion: renamed.version, destinationId: parent.id, destinationVersion: parent.version });
    const moved = await find('phone-renamed.txt');
    await change({ operation: 'delete', resourceId: moved.id, expectedVersion: moved.version });
    ops = await find('phone-ops');
    await change({ operation: 'delete', resourceId: ops.id, expectedVersion: ops.version });
    return { finalEntries: (await listAll(folder.id)).map(i => i.name) };
  });
  await check('stale version is refused', async () => {
    const note = await find('note.txt');
    const job = await waitDownload((await call({ operation: 'download', ownerId: owner, entry: { ...note, version: 'f'.repeat(64) } })).id);
    if (job.phase === 'completed') throw Error('stale download accepted');
    return { refusal: job.error };
  });
  const writeWorking = (id, text) => adb('shell', `run-as com.futahua.papers.mobile sh -c "printf '%s' '${text}' > files/remote-edits/${id}/working.bin"`);
  const readWorking = id => adb('shell', 'run-as', 'com.futahua.papers.mobile', 'cat', `files/remote-edits/${id}/working.bin`);
  await check('edit a file on the phone and save it back', async () => {
    const note = await find('note.txt');
    const edit = await call({ operation: 'edit-begin', ownerId: owner, entry: note });
    const text = 'edited on the phone ' + Date.now();
    writeWorking(edit.id, text);
    const saved = await call({ operation: 'edit-save', editId: edit.id });
    if (saved.phase !== 'saved') throw Error('phase ' + saved.phase + ' ' + (saved.error ?? ''));
    const onOwner = readFileSync(config.ownerNotePath, 'utf8');
    if (onOwner !== text) throw Error('owner file has ' + JSON.stringify(onOwner));
  });
  await check('conflicting phone save is refused and the phone keeps its work', async () => {
    const note = await find('note.txt');
    const a = await call({ operation: 'edit-begin', ownerId: owner, entry: note });
    const b = await call({ operation: 'edit-begin', ownerId: owner, entry: note });
    writeWorking(a.id, 'first phone writer'); writeWorking(b.id, 'second phone writer');
    const first = await call({ operation: 'edit-save', editId: a.id });
    const second = await call({ operation: 'edit-save', editId: b.id }).catch(error => ({ phase: 'refused', error: error.message }));
    if (first.phase !== 'saved') throw Error('first save ' + first.phase);
    if (second.phase === 'saved') throw Error('second save overwrote the first');
    if (readWorking(b.id) !== 'second phone writer') throw Error('phone lost its second edit');
    if (readFileSync(config.ownerNotePath, 'utf8') !== 'first phone writer') throw Error('owner file is not the first save');
    return { secondOutcome: second.phase };
  });
  await check('read the owner\'s Proxima', async () => {
    const list = await call({ operation: 'backpacks', ownerId: owner });
    const p = (list.entries ?? []).find(i => i.kind === 'proxima'); if (!p) throw Error('no shared Proxima');
    const snap = await call({ operation: 'backpack-snapshot', ownerId: owner, resourceId: p.id });
    const r = snap.snapshot?.records ?? {};
    return { projects: r.projects?.length, tasks: r.tasks?.length, calendar: r.scheduleEvents?.length };
  });
} finally {
  ws.close();
  adb('forward', '--remove', 'tcp:9334');
  console.log(JSON.stringify({ passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, null, 1));
}
