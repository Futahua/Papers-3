import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearHermesConnection,
  hermesUpdateProcessIds,
  independentHermesProcess,
  independentHermesStdio,
  leaveHermesRunning,
  readHermesConnection,
  writeHermesConnection,
} from '../../src/main/hermes/hermesLifecycle';
import { parseHermesBackendPid } from '../../src/main/hermes/hermesUpdater';

describe('Hermes lifecycle', () => {
  it('launches Hermes outside the Papers Windows process lifetime', () => {
    expect(independentHermesProcess()).toEqual({ detached: true });
    expect(independentHermesStdio(42)).toEqual(['ignore', 'ignore', 42]);
    expect(independentHermesStdio(null)).toEqual(['ignore', 'ignore', 'ignore']);
  });

  it('releases Papers ownership without terminating Hermes', () => {
    const desktop = { unref: vi.fn(), kill: vi.fn(), stderr: null };
    const backendStderr = { unref: vi.fn() };
    const backend = { unref: vi.fn(), kill: vi.fn(), stderr: backendStderr };

    leaveHermesRunning(desktop, backend);

    expect(desktop.unref).toHaveBeenCalledOnce();
    expect(backend.unref).toHaveBeenCalledOnce();
    expect(backendStderr.unref).toHaveBeenCalledOnce();
    expect(desktop.kill).not.toHaveBeenCalled();
    expect(backend.kill).not.toHaveBeenCalled();
  });

  it('retains only a validated authenticated connection for the next Papers process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'papers-hermes-lifecycle-'));
    const file = join(dir, 'connection.json');
    const connection = {
      schemaVersion: 1 as const,
      reportPort: 41231,
      controlPort: 41232,
      dockToken: 'secret',
      desktopPid: 1001,
    };

    writeHermesConnection(file, connection);

    expect(readHermesConnection(file)).toEqual(connection);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(connection);

    clearHermesConnection(file);
    expect(readHermesConnection(file)).toBeNull();
  });

  it('rejects a connection record with unsafe process identities', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'papers-hermes-lifecycle-'));
    const file = join(dir, 'connection.json');
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        reportPort: 41231,
        controlPort: 41232,
        dockToken: 'secret',
        desktopPid: -1,
      }),
    );

    expect(readHermesConnection(file)).toBeNull();
  });

  it('hands adopted Hermes processes to the managed updater after Papers restarts', () => {
    expect(
      hermesUpdateProcessIds({}, { desktopPid: 1001 }),
    ).toEqual([1001]);
    expect(
      parseHermesBackendPid(
        '  TCP    127.0.0.1:9119       0.0.0.0:0       LISTENING       1002',
      ),
    ).toBe(1002);
  });
});
