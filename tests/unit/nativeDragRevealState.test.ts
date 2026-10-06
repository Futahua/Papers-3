import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {it,expect} from 'vitest';
it('native reveal tracks Shift hold/release, cancellation, and repeat sessions without installing hooks',()=>{
 if(process.platform!=='win32')return;
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'papers-native-reveal-test-'));
 try{
  const compiler=path.join(process.env.SystemRoot!,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  const executable=path.join(directory,'test.exe');
  execFileSync(compiler,['/nologo','/main:NativeDragRevealTests',`/out:${executable}`,path.resolve('resources/native/hover-input-bridge.cs'),path.resolve('tests/native/native-drag-reveal.test.cs')],{windowsHide:true});
  expect(execFileSync(executable,[],{windowsHide:true,encoding:'utf8'})).toContain('Native reveal state passed');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
