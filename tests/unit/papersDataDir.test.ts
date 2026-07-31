import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { papersDataDirArgument } from '../../src/main/papersDataDir';

describe('Papers data-directory launch argument', () => {
  it('accepts one explicit absolute data directory', () => {
    expect(
      papersDataDirArgument([
        'Papers.exe',
        '--papers-data-dir=D:\\Letters\\MatTroiSeConMoc\\Papers\\Data',
      ]),
    ).toBe(path.resolve('D:\\Letters\\MatTroiSeConMoc\\Papers\\Data'));
  });

  it('rejects relative, empty, or repeated data directories', () => {
    expect(() => papersDataDirArgument(['Papers.exe', '--papers-data-dir=relative']))
      .toThrow(/absolute path/i);
    expect(() => papersDataDirArgument(['Papers.exe', '--papers-data-dir=']))
      .toThrow(/absolute path/i);
    expect(() => papersDataDirArgument([
      'Papers.exe',
      '--papers-data-dir=C:\\one',
      '--papers-data-dir=D:\\two',
    ])).toThrow(/one absolute path/i);
  });
});
