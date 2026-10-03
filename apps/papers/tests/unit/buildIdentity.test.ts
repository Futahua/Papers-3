import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * `buildIdentity` reads Electron's app object and the OS hostname. Both are
 * stubbed so this stays a plain unit test, the way the other unit tests here do
 * not require a running Electron.
 */
const appStub = {
  getVersion: vi.fn(() => '1.0.0'),
  isPackaged: true,
  getPath: vi.fn((key: string) =>
    key === 'exe' ? 'D:\\Letters\\Papers\\App\\Papers.exe' : 'D:\\Letters\\Papers\\Data',
  ),
};

vi.mock('electron', () => ({ app: appStub }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  hostname: () => 'MINH-DESKTOP',
}));

beforeEach(() => {
  vi.stubGlobal('__PAPERS_COMMIT__', 'a1b2c3d');
  vi.stubGlobal('__PAPERS_BRANCH__', 'main');
  vi.stubGlobal('__PAPERS_BUILT_AT__', '2026-07-27T10:00:00.000Z');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function load() {
  return (await import('../../src/main/buildIdentity')).buildIdentity();
}

describe('buildIdentity', () => {
  it('reports the stamped commit so two machines can be compared', async () => {
    const identity = await load();

    expect(identity.version).toBe('1.0.0');
    expect(identity.commit).toBe('a1b2c3d');
    expect(identity.branch).toBe('main');
    expect(identity.builtAt).toBe('2026-07-27T10:00:00.000Z');
  });

  it('puts version, commit and machine in one short comparable line', async () => {
    const identity = await load();

    expect(identity.summary).toBe('1.0.0 · a1b2c3d · MINH-DESKTOP');
  });

  it('reads the install and data folders at run time, never from the build', async () => {
    const identity = await load();

    // These are per-machine facts, so they must come from the running app.
    expect(identity.installDir).toBe('D:\\Letters\\Papers\\App');
    expect(identity.dataDir).toBe('D:\\Letters\\Papers\\Data');
    expect(identity.machine).toBe('MINH-DESKTOP');
  });

  it('says "unknown" rather than inventing a commit for an unstamped build', async () => {
    vi.stubGlobal('__PAPERS_COMMIT__', '');
    vi.stubGlobal('__PAPERS_BRANCH__', '');
    vi.stubGlobal('__PAPERS_BUILT_AT__', '');

    const identity = await load();

    expect(identity.commit).toBe('unknown');
    expect(identity.branch).toBe('unknown');
    expect(identity.builtAt).toBe('unknown');
  });

  it('distinguishes two builds that share the frozen 1.0.0 version', async () => {
    const first = await load();

    vi.stubGlobal('__PAPERS_COMMIT__', '9f8e7d6');
    vi.resetModules();
    const second = await load();

    // The version alone cannot tell these apart — this is the whole problem.
    expect(first.version).toBe(second.version);
    expect(first.commit).not.toBe(second.commit);
    expect(first.summary).not.toBe(second.summary);
  });
});
