import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
it.skipIf(process.platform!=='win32')('dead tab cleanup preserves pane topology and documents',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'papers-span-test-'));
 try {
  const compiler=path.join(process.env.SystemRoot??'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const names=['chrome-window-session','pane-group','pane-layout','pane-presentation','pane-coordinator','pane-coordinator-hub','pane-documents','pane-mount','pane-region-contract','pane-host-region','pane-chrome-resolver','pane-coordinator-host'];
  const exe=path.join(temp,'span.exe');
  execFileSync(compiler,['/nologo','/target:exe','/main:DiscardRegression',`/out:${exe}`,'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll',...['UIAutomationClient','UIAutomationTypes','WindowsBase'].map(n=>`/r:${path.join(path.dirname(compiler),'WPF',n+'.dll')}`),...names.map(n=>path.resolve('resources/native',n+'.cs')),path.resolve('tests/fixtures/pane-discard-regression.cs')],{windowsHide:true,timeout:15000});
  expect(execFileSync(exe,[],{encoding:'utf8',windowsHide:true,timeout:15000})).toContain('saved cleanup verified');
 } finally { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500); fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
},40000);
