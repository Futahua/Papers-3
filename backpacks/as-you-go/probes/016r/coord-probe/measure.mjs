// 016R coordinate-space measurement (Winter, bounded): at one stationary
// point on the 100% primary and one on the scaled display, record in the
// same instant:
//   - native Win32 GetCursorPos (physical);
//   - Electron screen.getCursorScreenPoint() (DIP) + containing display
//     bounds and scaleFactor + ALL displays' bounds/scaleFactors;
//   - the helper hover resolution at the NATIVE point and at the ELECTRON
//     point (exact x/y sent and the HWND/bounds resolved);
//   - the overlay's calculated screen click x/y (from the pick session's
//     receipt lines in the app log after a real OS click).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AYG_REPO = 'D:\\Letters\\MatTroiSeConMoc\\Papers\\Backpack projects\\As you Go';
const PAPERS = 'D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const ELECTRON = path.join(PAPERS, 'node_modules\\electron\\dist\\electron.exe');
const HELPER = path.join(PAPERS, 'resources\\window-helper\\window-helper.ps1');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-coord-probe-'));
const marker = path.join(dataDir, 'marker.txt');

function runPwsh(script) {
  return new Promise((resolve, reject) => {
    const result = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    result.stdout.on('data', (c) => out.push(String(c)));
    result.stderr.on('data', (c) => out.push(String(c)));
    const timer = setTimeout(() => { result.kill(); reject(new Error('pwsh timeout')); }, 60000);
    result.on('error', reject);
    result.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`pwsh ${code}: ${out.join('').trim().slice(0, 400)}`));
      else resolve(out.join('').trim());
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function nativeCursor() {
  const raw = await runPwsh(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class NC { [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p); }' -ErrorAction SilentlyContinue; $p = New-Object NC+P; [NC]::GetCursorPos([ref]$p) | Out-Null; "$($p.X),$($p.Y)"`);
  const [x, y] = raw.trim().split(',').map(Number);
  return { x, y };
}
async function moveCursor(x, y) {
  await runPwsh(`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class MC { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }' -ErrorAction SilentlyContinue; [MC]::SetCursorPos(${x}, ${y}) | Out-Null`);
  await sleep(300);
}
function helperHover(x, y) {
  return new Promise((resolve, reject) => {
    const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', HELPER], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    helper.stdout.on('data', (c) => { out += String(c); });
    helper.stderr.on('data', () => { /* ignore */ });
    helper.on('error', reject);
    helper.on('close', (code) => {
      if (code !== 0) return resolve(`helper-exit-${code}`);
      try {
        const parsed = JSON.parse(out.trim().split(/\r?\n/)[0]);
        resolve(parsed.window ? { outcome: 'window', title: parsed.window.title, bounds: parsed.window.bounds, processId: parsed.window.processId } : { outcome: 'null' });
      } catch {
        resolve(`parse-fail: ${out.slice(0, 200)}`);
      }
    });
    helper.stdin.end(JSON.stringify({ requestId: 1, method: 'hover', x, y }));
  });
}

async function main() {
  console.log('=== 016R COORDINATE MEASUREMENT ===');
  const probe = spawn(ELECTRON, [path.join(__dirname, 'main.js'), marker, '--user-data-dir=' + path.join(dataDir, 'edata')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let probeLines = [];
  probe.stdout.on('data', (c) => { probeLines.push(...String(c).trim().split(/\r?\n/).filter(Boolean)); });
  probe.stderr.on('data', () => { /* ignore */ });
  await sleep(2500); // electron boot

  const points = {
    PRIMARY: { x: 500, y: 400 },
    SCALED: { x: 480, y: -810 },
  };
  for (const [label, point] of Object.entries(points)) {
    await moveCursor(point.x, point.y);
    const native = await nativeCursor();
    fs.writeFileSync(marker, label);
    await sleep(700);
    const electronHover = await helperHover(point.x, point.y);
    const nativeHover = await helperHover(native.x, native.y);
    console.log(JSON.stringify({ point: label, sent: point, native, electronHoverAtSent: electronHover, nativeHover: nativeHover }));
  }
  fs.writeFileSync(marker, 'DONE');
  await sleep(400);
  probe.kill();
  console.log('ELECTRON LINES:');
  for (const line of probeLines) console.log(line);
  console.log(`=== dataDir: ${dataDir}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
