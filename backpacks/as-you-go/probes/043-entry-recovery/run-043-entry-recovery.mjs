import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectToTarget, sleep } from '../015r3-live-proof/cdp.mjs';

const repo = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const papersRepo = 'D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3';
const electron = path.join(papersRepo, 'node_modules', 'electron', 'dist', 'electron.exe');
const backpackId = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-043-entry-'));
const project = path.join(data, 'ayg-project-copy');
const papersData = path.join(data, 'PapersData');
const stdout = path.join(data, 'papers.stdout.log');
const stderr = path.join(data, 'papers.stderr.log');
const resultPath = path.join(data, 'result.json');
const inventoryPath = path.join(data, 'process-inventory.jsonl');
const cdpPath = path.join(data, 'cdp-events.jsonl');
const port = 64939;

function now() { return new Date().toISOString(); }
function inventory(label, rootPid) {
  let value = [];
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$root=${Number(rootPid)}; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $root -or $_.ParentProcessId -eq $root } | Select-Object ProcessId,ParentProcessId,Name,CommandLine,CreationDate | ConvertTo-Json -Compress`], { encoding: 'utf8', timeout: 10000 }).trim();
    if (raw) { const parsed = JSON.parse(raw); value = Array.isArray(parsed) ? parsed : [parsed]; }
  } catch (error) { value = [{ error: String(error) }]; }
  fs.appendFileSync(inventoryPath, `${JSON.stringify({ at: now(), label, rootPid, processes: value })}\n`);
  return value;
}
function cdpEvent(label, detail = {}) {
  fs.appendFileSync(cdpPath, `${JSON.stringify({ at: now(), label, ...detail })}\n`);
}

fs.cpSync(repo, project, { recursive: true, filter: (source) => !source.includes(`${path.sep}.git`) && !source.includes(`${path.sep}probes`) && !source.endsWith(`${path.sep}state.json`) });
fs.mkdirSync(path.join(papersData, 'backpacks', backpackId), { recursive: true });
fs.writeFileSync(path.join(papersData, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [{ id: backpackId, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }], lastActiveBackpackId: null }));
fs.writeFileSync(path.join(papersData, 'backpacks', backpackId, 'backpack.json'), JSON.stringify({ schemaVersion: 1, id: backpackId, name: 'As you Go', type: 'environment', createdAt: '2026-07-29T15:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null }));
fs.writeFileSync(path.join(papersData, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [backpackId]: { root: project } } }));

const out = fs.openSync(stdout, 'w');
const err = fs.openSync(stderr, 'w');
const child = spawn(electron, ['.', `--papers-data-dir=${data}`, `--remote-debugging-port=${port}`], {
  cwd: papersRepo,
  env: { ...process.env, PAPERS_TEST_USER_DATA: data, ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', out, err],
});
inventory('start', child.pid);
const startedAt = Date.now();
let transitioned = false;
let transitionError = null;
try {
  let target = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((entry) => entry.url.includes('index.html')) ?? null;
      if (target) break;
    } catch { }
    await sleep(250);
  }
  if (!target) throw new Error('CDP shell target did not appear');
  const client = await connectToTarget(target, port);
  cdpEvent('shell-target', { url: target.url, title: target.title });
  await client.evaluate("document.querySelector('.backpack-card button')?.click()");
  transitioned = true;
  inventory('transition', child.pid);
  client.close();
} catch (error) {
  transitionError = String(error);
}
let disappearedAt = null;
const exit = await new Promise((resolve) => {
  if (child.exitCode !== null) return resolve({ code: child.exitCode, signal: null });
  child.once('exit', (code, signal) => resolve({ code, signal }));
  const timer = setInterval(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await response.json();
      if (list.length === 0 && disappearedAt === null) {
        disappearedAt = now();
        cdpEvent('targets-disappeared', { targetCount: 0 });
        inventory('cdp-disappearance', child.pid);
      }
    } catch {
      if (disappearedAt === null) {
        disappearedAt = now();
        cdpEvent('cdp-unreachable');
        inventory('cdp-unreachable', child.pid);
      }
    }
  }, 250);
  setTimeout(() => { clearInterval(timer); resolve({ code: child.exitCode, signal: 'timeout' }); }, 30_000);
});
const cdps = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()).catch(() => []);
const crashArtifacts = [];
for (const root of [data, path.join(papersRepo, 'out'), path.join(data, 'Crashpad'), path.join(data, 'crashpad')]) {
  if (!fs.existsSync(root)) continue;
  try {
    for (const entry of fs.readdirSync(root, { recursive: true })) {
      if (String(entry).toLowerCase().includes('crash') || String(entry).toLowerCase().includes('dump')) crashArtifacts.push(path.join(root, String(entry)));
    }
  } catch { }
}
inventory('final', child.pid);
const result = { data, project, stdout, stderr, inventoryPath, cdpPath, crashArtifacts, pid: child.pid, command: `${electron} . --papers-data-dir=${data} --remote-debugging-port=${port}`, testEnv: 'PAPERS_TEST_USER_DATA', transitioned, transitionError, exit, disappearedAt, elapsedMs: Date.now() - startedAt, remainingCdpTargets: cdps.length };
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
