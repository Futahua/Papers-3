import { describe, expect, it } from 'vitest';

import { parseFileLockerOutput } from '../../src/main/backpacks/fileLockerBridge';

const b64 = (value: string): string => Buffer.from(value, 'utf8').toString('base64');

describe('file locker helper output', () => {
  it('parses Restart Manager processes with their image names', () => {
    const stdout = `PROC\t4312\t${b64('Microsoft Word')}\t${b64('C:\\Office\\WINWORD.EXE')}\t1\r\nPROC\t9\t${b64('')}\t${b64('')}\t4\r\nDONE\t1\r\n`;
    expect(parseFileLockerOutput(stdout)).toEqual({ ok: true, lockers: [
      { pid: 4312, name: 'Microsoft Word', processName: 'WINWORD.EXE', imagePath: 'C:\\Office\\WINWORD.EXE', applicationType: 1 },
      { pid: 9, name: 'pid 9', processName: '', imagePath: '', applicationType: 4 },
    ] });
    expect(parseFileLockerOutput('DONE\t0\n')).toEqual({ ok: true, lockers: [] });
  });

  it('refuses errors, malformed lines and truncated output instead of guessing a holder', () => {
    expect(parseFileLockerOutput(`ERR\t${b64('RmRegisterResources failed: 5')}\n`)).toEqual({ ok: false, error: 'RmRegisterResources failed: 5' });
    expect(parseFileLockerOutput('PROC\tnot-a-pid\tx\ty\t1\nDONE\t1\n').ok).toBe(false);
    expect(parseFileLockerOutput(`PROC\t5\t${b64('App')}\t${b64('')}\t1\n`).ok).toBe(false);
  });
});
