import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';

const AHK = 'C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe';
const PW = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const SCRIPT = 'D:\\333\\SlopTop\\sloptop_engine.ahk';
const SHARED = 'C:\\Users\\Public\\Documents\\PapersNativeBridgeReceipts';
const token = crypto.randomUUID();
const root = fs.mkdtempSync(path.join(process.env.TEMP ?? 'C:\\Windows\\Temp', 'gazelle-054-'));
const artifacts = path.join(root, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
fs.mkdirSync(SHARED, { recursive: true });
const ps1 = `${SHARED}\\diagnostic-${token}.ps1`;
const output = `${SHARED}\\child-output-${token}.log`;
const exit = `${SHARED}\\child-exit-${token}.txt`;
const receipt = `${SHARED}\\startup-${token}.receipt`;
const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
const body = [
  `$ahk = ${q(AHK)}`,
  `$script = ${q(SCRIPT)}`,
  `$receipt = ${q(receipt)}`,
  `$token = ${q(token)}`,
  `$output = ${q(output)}`,
  `$exit = ${q(exit)}`,
  `try { & $ahk '/force' '/ErrorStdOut' $script $receipt $token 'startup-diagnostic' 2>&1 | Out-File -LiteralPath $output -Encoding utf8; $code = $LASTEXITCODE; Set-Content -LiteralPath $exit -Value ([string]$code) -Encoding ascii } catch { $_ | Out-File -LiteralPath $output -Encoding utf8; Set-Content -LiteralPath $exit -Value 'PS_EXCEPTION' -Encoding ascii; exit 1 }`,
].join('\r\n') + '\r\n';
fs.writeFileSync(ps1, body, 'utf8');
const before = new Set(fs.readdirSync(SHARED));
const command = `$p=Start-Process -FilePath ${q(PW)} -ArgumentList @('-NoProfile','-NonInteractive','-File',${q(ps1)}) -Verb RunAs -PassThru; $p.Id`;
const launcher = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const launcherOutput = [];
launcher.stdout.on('data', (c) => launcherOutput.push(String(c)));
launcher.stderr.on('data', (c) => launcherOutput.push(String(c)));
await new Promise((resolve) => launcher.on('close', resolve));
const elevatedPid = Number(launcherOutput.join('').trim());
const started = Date.now();
while (Date.now() - started < 15000 && !fs.existsSync(receipt) && !fs.existsSync(output) && !fs.existsSync(exit)) await new Promise((resolve) => setTimeout(resolve, 150));
while (Date.now() - started < 30000) {
  if (!elevatedPid) break;
  const check = spawn(PW, ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${elevatedPid} -ErrorAction SilentlyContinue) -ne $null`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let alive = '';
  check.stdout.on('data', (c) => alive += String(c));
  await new Promise((resolve) => check.on('close', resolve));
  if (!alive.trim().toLowerCase().startsWith('true')) break;
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const evidence = { token, launcherPid: launcher.pid, elevatedPowerShellPid: elevatedPid, ps1, output, exit, receipt, script: SCRIPT, stdout: read(output), childExit: read(exit), startupReceipt: read(receipt), preexisting: [...before], artifactRoot: artifacts, finishedAt: new Date().toISOString() };
fs.writeFileSync(path.join(artifacts, 'elevated-powershell-diagnosis.json'), JSON.stringify(evidence, null, 2));
for (const file of [ps1, output, exit, receipt]) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(artifacts, path.basename(file)));
console.log(JSON.stringify(evidence));
for (const file of [ps1, output, exit, receipt]) try { fs.rmSync(file, { force: true }); } catch {}
const required = elevatedPid && evidence.childExit.trim() === '0' && evidence.startupReceipt.includes(`"token":"${token}"`);
process.exitCode = required ? 0 : 1;
