import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AtomicJsonStore } from '../../src/main/persistence/atomicStore';
import { papersPaths } from '../../src/main/persistence/paths';

describe('Papers settings persistence', () => {
  it('writes and reloads transparentWindow at the PapersData settings path', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-settings-'));
    try {
      const paths = papersPaths(baseDir);
      const store = new AtomicJsonStore(paths.settingsFile, { recoveryDir: paths.recoveryDir });

      await store.save({ transparentWindow: true });
      expect(JSON.parse(await fs.readFile(paths.settingsFile, 'utf8'))).toEqual({ transparentWindow: true });
      expect((await store.load<{ transparentWindow: boolean }>()).value).toEqual({ transparentWindow: true });

      await store.save({ transparentWindow: false });
      expect((await store.load<{ transparentWindow: boolean }>()).value).toEqual({ transparentWindow: false });
    } finally {
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });
});
