// Standalone smoke test for coord-electron-probe.cjs (016R4).
// Launches the probe, moves the cursor, writes markers, reads the electron
// DIP cursor + display scale, then exits. No Papers, no windows.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PAPERS = 'D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3';
const ELECTRON = path.join(PAPERS, 'node_modules\\electron\\dist\\electron.exe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-smoke-'));
const marker = path.join(dir, 'marker.txt');
const ready = path.join(dir, 'ready.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function move(x, y) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MC2 { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }' -ErrorAction SilentlyContinue; [MC2]::SetCursorPos(${x}, ${y}) | Out-Null`], { windowsHide: true });
    p.on('close', () => resolve());
    p.on('error', reject);
  });
}

async function main() {
  const probe = spawn(ELECTRON, [path.join(__dirname, 'coord-electron-probe.cjs'), marker, ready,
    '--user-data-dir=' + path.join(dir, 'edata')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  probe.stdout.on('data', (c) => { out += String(c); });
  probe.stderr.on('data', () => { /* ignore */ });
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await sleep(200);
  console.log('ready: ' + fs.existsSync(ready));
  await sleep(500);
  await move(500, 400);
  await sleep(400);
  fs.writeFileSync(marker, 'PRIMARY-500-400');
  await sleep(900);
  const win = await new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MC3 { [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); }' -ErrorAction SilentlyContinue; $p = New-Object MC3+P; [MC3]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '';
    p.stdout.on('data', (c) => { o += String(c); });
    p.on('close', () => resolve(o.trim()));
  });
  console.log('win32 cursor after move: ' + win);
  fs.writeFileSync(marker, 'QUIT');
  await sleep(600);
  probe.kill();
  console.log('electron lines:');
  for (const line of out.split(/\r?\n/).filter((l) => l.trim().startsWith('{'))) console.log(line);
  console.log('dir: ' + dir);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
