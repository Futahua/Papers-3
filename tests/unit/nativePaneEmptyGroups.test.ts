import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
it.skipIf(process.platform !== 'win32')('removes emptied source groups without losing retained tabs or the final group', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-empty-group-'));
  const compiler = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const names = ['chrome-window-session', 'pane-group', 'pane-layout', 'pane-presentation', 'pane-coordinator', 'pane-coordinator-hub', 'pane-documents', 'pane-mount', 'pane-region-contract', 'pane-host-region', 'pane-chrome-resolver', 'pane-coordinator-host'];
  const exe = path.join(temp, 'test.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', '/main:EmptyGroupsRegression', `/out:${exe}`, '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll', ...['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'].map(n => `/r:${path.join(path.dirname(compiler), 'WPF', n + '.dll')}`), ...names.map(n => path.resolve('resources/native', n + '.cs')), path.resolve('tests/fixtures/pane-empty-group-regression.cs')], { windowsHide: true, timeout: 15000 });
  expect(execFileSync(exe, [], { encoding: 'utf8', windowsHide: true, timeout: 15000 })).toContain('final group verified');
}, 40000);
