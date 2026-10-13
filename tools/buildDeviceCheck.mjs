// Builds a self-contained real-device check of the remote file machinery.
// It runs the real RemoteFileClient against a real owner's Papers gateway, joining as a
// separate same-account client ("<host> device check"), and changes files only inside
// a dedicated fixture folder that the owner prepared. Usage:
//   node tools/buildDeviceCheck.mjs <output dir>
//   node <output dir>/device-check.mjs '<json config>'
// Config: { owner: "http://100.x.y.z:48240", path: ["D:", "folder", ...], bigSha256, bigBytes, smallText }
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Supply an absolute output directory.');
await mkdir(output, { recursive: true });

const entry = `
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { RemoteFileClient } from ${JSON.stringify(path.join(repository, 'src/main/backpacks/remoteFileClient.ts'))};

// Config is inline JSON or a path to a JSON file (Windows PowerShell 5 strips quotes from native arguments).
const config = JSON.parse(process.argv[2].trim().startsWith('{') ? process.argv[2] : await fs.readFile(process.argv[2], 'utf8'));
const results = [];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function check(name, run) {
  const started = Date.now();
  try { const detail = await run(); results.push({ name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); }
  catch (error) { results.push({ name, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }); }
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-device-check-'));
const box = { seal: value => Buffer.from(value).toString('base64'), open: value => Buffer.from(value, 'base64').toString() };
const client = new RemoteFileClient(path.join(root, 'client'), box);
await client.initialize();
let owner, folder;

async function listAll(resourceId) {
  const entries = []; let offset = 0;
  for (;;) { const page = await client.browse(owner, resourceId, offset); entries.push(...page.entries); if (page.nextOffset == null) return entries; offset = page.nextOffset; }
}
async function find(name) { const entry = (await listAll(folder.id)).find(item => item.name === name); if (!entry) throw Error('missing ' + name); return entry; }
async function waitJob(id, cancelAtBytes) {
  for (let i = 0; i < 6000; i++) {
    const job = client.snapshot().jobs.find(item => item.id === id);
    if (cancelAtBytes && job.bytes >= cancelAtBytes && job.phase === 'transferring') { client.cancel(id); cancelAtBytes = 0; }
    if (job.phase === 'completed' || job.phase === 'failed') return job;
    await sleep(50);
  }
  throw Error('download timed out');
}
async function cachedSha(entry) {
  const copy = (await client.offline(owner)).find(item => item.entry.id === entry.id && item.entry.version === entry.version);
  if (!copy) throw Error('no verified offline copy');
  return sha(await fs.readFile(await client.cachedPath(owner, copy.key)));
}
async function change(command) {
  const commandId = command.commandId ?? randomUUID();
  await client.change(owner, { commandId, ...command });
  for (let i = 0; i < 600; i++) {
    const job = (await client.changes(owner)).find(item => item.commandId === commandId);
    if (job && ['completed', 'failed', 'uncertain'].includes(job.phase)) { if (job.phase !== 'completed') throw Error(command.operation + ' ' + job.phase + ': ' + (job.error ?? '')); return commandId; }
    await sleep(100);
  }
  throw Error(command.operation + ' did not finish');
}

try {
  await check('join without a code (same Tailscale account)', async () => {
    await client.join(config.owner, os.hostname() + ' device check');
    owner = client.snapshot().devices[0].id;
    return { owner: client.snapshot().devices[0].name };
  });
  await check('list every shared drive root', async () => {
    const shares = await listAll();
    const counts = {};
    for (const share of shares) { const names = (await listAll(share.id)).map(item => item.name); counts[share.name] = names.length; counts[share.name + ' names'] = names.join(' | '); }
    return counts;
  });
  await check('navigate to the fixture folder', async () => {
    let entries = await listAll();
    for (const name of config.path) { folder = entries.find(item => item.name === name); if (!folder) throw Error('missing ' + name); entries = await listAll(folder.id); }
    return { entries: entries.map(item => item.name) };
  });
  await check('download a large file and verify SHA-256', async () => {
    const big = await find('big.bin');
    const started = Date.now();
    const job = await waitJob(client.download(owner, big).id);
    if (job.phase !== 'completed') throw Error(job.error);
    if (await cachedSha(big) !== config.bigSha256) throw Error('content hash mismatch');
    const seconds = (Date.now() - started) / 1000;
    return { bytes: big.size, seconds, mbps: +(big.size * 8 / seconds / 1e6).toFixed(1) };
  });
  await check('interrupt a download, resume it, verify', async () => {
    const small = await find('resume.bin');
    const first = await waitJob(client.download(owner, small).id, 1);
    if (first.phase === 'completed') return { note: 'finished before it could be interrupted' };
    const second = await waitJob(client.download(owner, small).id);
    if (second.phase !== 'completed') throw Error(second.error);
    if (await cachedSha(small) !== config.resumeSha256) throw Error('resumed content hash mismatch');
    return { interruptedAt: first.bytes, size: small.size };
  });
  await check('file operations: create folder, copy, rename, move, delete', async () => {
    const parent = await refreshFolder();
    await change({ operation: 'create-folder', resourceId: parent.id, expectedVersion: parent.version, newName: 'ops' });
    let ops = await find('ops');
    const note = await find('note.txt');
    await change({ operation: 'copy', resourceId: note.id, expectedVersion: note.version, destinationId: ops.id, destinationVersion: ops.version });
    const copied = (await listAll(ops.id)).find(item => item.name === 'note.txt');
    if (!copied) throw Error('copy missing');
    await change({ operation: 'rename', resourceId: copied.id, expectedVersion: copied.version, newName: 'renamed.txt' });
    if (!(await listAll(ops.id)).some(item => item.name === 'renamed.txt')) throw Error('rename missing');
    const renamed = (await listAll(ops.id)).find(item => item.name === 'renamed.txt');
    const target = await refreshFolder();
    await change({ operation: 'move', resourceId: renamed.id, expectedVersion: renamed.version, destinationId: target.id, destinationVersion: target.version });
    if (!(await listAll(folder.id)).some(item => item.name === 'renamed.txt')) throw Error('move missing');
    const moved = await find('renamed.txt');
    await change({ operation: 'delete', resourceId: moved.id, expectedVersion: moved.version });
    ops = await find('ops');
    await change({ operation: 'delete', resourceId: ops.id, expectedVersion: ops.version });
    const names = (await listAll(folder.id)).map(item => item.name);
    if (names.includes('ops') || names.includes('renamed.txt')) throw Error('cleanup left ' + names.join(', '));
    return { finalEntries: names };
  });
  await check('retried command is applied once', async () => {
    const parent = await refreshFolder();
    const commandId = randomUUID();
    await change({ commandId, operation: 'create-folder', resourceId: parent.id, expectedVersion: parent.version, newName: 'once' });
    await client.retryChange(owner, commandId).catch(() => {});
    const count = (await listAll(folder.id)).filter(item => item.name.startsWith('once')).length;
    const once = await find('once');
    await change({ operation: 'delete', resourceId: once.id, expectedVersion: once.version });
    if (count !== 1) throw Error(count + ' folders created');
  });
  await check('stale version is refused', async () => {
    const note = await find('note.txt');
    const stale = { ...note, version: 'f'.repeat(64) };
    const job = await waitJob(client.download(owner, stale).id);
    if (job.phase === 'completed') throw Error('stale download was accepted');
    return { refusal: job.error };
  });
  await check('edit a file and save it back', async () => {
    const note = await find('note.txt');
    const edit = await client.beginEdit(owner, note);
    const text = 'edited by device check ' + new Date().toISOString();
    await fs.writeFile(await client.editPath(edit.id), text);
    const saved = await client.saveEdit(edit.id);
    if (saved.phase !== 'saved') throw Error('phase ' + saved.phase);
    const current = await find('note.txt');
    const job = await waitJob(client.download(owner, current).id);
    if (job.phase !== 'completed') throw Error(job.error);
    if (await cachedSha(current) !== sha(Buffer.from(text))) throw Error('owner content differs from saved edit');
  });
  await check('conflicting save is refused and both versions kept', async () => {
    const note = await find('note.txt');
    const first = await client.beginEdit(owner, note);
    const second = await client.beginEdit(owner, note);
    await fs.writeFile(await client.editPath(first.id), 'first writer');
    await fs.writeFile(await client.editPath(second.id), 'second writer');
    const a = await client.saveEdit(first.id);
    const b = await client.saveEdit(second.id).catch(error => ({ phase: 'refused', error: error.message }));
    if (a.phase !== 'saved') throw Error('first save ' + a.phase);
    if (b.phase === 'saved') throw Error('second save overwrote the first');
    const retained = await fs.readFile(await client.editPath(second.id), 'utf8');
    if (retained !== 'second writer') throw Error('second writer lost its local work');
    return { secondOutcome: b.phase, message: b.error };
  });
  await check('read the owner\\'s Proxima', async () => {
    const proxima = (await client.backpacks(owner)).entries.find(item => item.kind === 'proxima');
    if (!proxima) throw Error('no shared Proxima');
    const snapshot = await client.backpackSnapshot(owner, proxima.id);
    const summary = {};
    const walk = (value, prefix, depth) => { for (const [key, item] of Object.entries(value ?? {})) { if (Array.isArray(item)) summary[prefix + key] = item.length; else if (item && typeof item === 'object' && depth < 2) walk(item, prefix + key + '.', depth + 1); } };
    walk(snapshot, '', 0);
    return { backpack: proxima.name, online: snapshot.online, collections: summary };
  });
} finally {
  await client.close().catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
// Re-walks the path so the fixture folder's version is current before a checked command.
async function refreshFolder() {
  let entries = await listAll();
  let current;
  for (const name of config.path) { current = entries.find(item => item.name === name); entries = await listAll(current.id); }
  folder = current;
  return current;
}
console.log(JSON.stringify({ host: os.hostname(), owner: config.owner, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results }, null, 1));
`;
await build({ stdin: { contents: entry, resolveDir: repository }, outfile: path.join(output, 'device-check.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' });
console.log('device check bundle ready: ' + path.join(output, 'device-check.mjs'));
