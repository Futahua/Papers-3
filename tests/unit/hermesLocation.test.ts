import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  describeMissingHermes,
  findHermes,
  rememberHermesLocation,
  resolveHermesCommand,
  resolveHermesRoot,
} from '../../src/main/hermes/hermesLocation';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-hermes-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const EXE_SUFFIX = ['hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'Hermes.exe'];

/** Create a believable Hermes install under `<dir>/<name>/.hermes` and return its exe. */
async function makeHermes(name: string, withVenv = false): Promise<string> {
  const home = path.join(dir, name, '.hermes');
  const exe = path.join(home, ...EXE_SUFFIX);
  await fs.mkdir(path.dirname(exe), { recursive: true });
  await fs.writeFile(exe, 'stand-in for Hermes.exe');
  if (withVenv) {
    const scripts = path.join(home, 'hermes-agent', 'venv', 'Scripts');
    await fs.mkdir(scripts, { recursive: true });
    await fs.writeFile(path.join(scripts, 'hermes.exe'), 'stand-in for the backend launcher');
  }
  return exe;
}

describe('findHermes', () => {
  it('finds Hermes from HERMES_HOME, which both machines already set', async () => {
    const exe = await makeHermes('HermesAI');
    const home = path.join(dir, 'HermesAI', '.hermes');

    const { location } = findHermes(null, null, { HERMES_HOME: home });

    expect(location?.desktopExe).toBe(exe);
    expect(location?.source).toBe('HERMES_HOME');
    // The root is the folder holding venv\Scripts\hermes.exe, not the .hermes home.
    expect(location?.hermesRoot).toBe(path.join(home, 'hermes-agent'));
    expect(location?.hermesHome).toBe(home);
  });

  it('prefers an explicit PAPERS_HERMES_DESKTOP_EXE override over everything else', async () => {
    const overrideExe = await makeHermes('Elsewhere');
    const homeExe = await makeHermes('HermesAI');
    expect(overrideExe).not.toBe(homeExe);

    const { location } = findHermes(null, null, {
      PAPERS_HERMES_DESKTOP_EXE: overrideExe,
      HERMES_HOME: path.join(dir, 'HermesAI', '.hermes'),
    });

    expect(location?.desktopExe).toBe(overrideExe);
    expect(location?.source).toBe('override');
  });

  it('ignores an override that points at nothing and falls through to HERMES_HOME', async () => {
    const exe = await makeHermes('HermesAI');

    const { location } = findHermes(null, null, {
      PAPERS_HERMES_DESKTOP_EXE: path.join(dir, 'gone', 'Hermes.exe'),
      HERMES_HOME: path.join(dir, 'HermesAI', '.hermes'),
    });

    expect(location?.desktopExe).toBe(exe);
    expect(location?.source).toBe('HERMES_HOME');
  });

  it('finds a HermesAI folder sitting beside the Papers installation, with no settings at all', async () => {
    const exe = await makeHermes('HermesAI');
    // Papers installs as <root>\Papers\App, so pass that shape as the exe folder.
    const papersInstallDir = path.join(dir, 'Papers', 'App');
    await fs.mkdir(papersInstallDir, { recursive: true });

    const { location } = findHermes(null, papersInstallDir, {});

    expect(location?.desktopExe).toBe(exe);
    expect(location?.source).toBe('probe');
  });

  it('remembers a resolved location and reuses it after the setting disappears', async () => {
    const exe = await makeHermes('HermesAI');
    const home = path.join(dir, 'HermesAI', '.hermes');

    const first = findHermes(dir, null, { HERMES_HOME: home });
    expect(first.location).not.toBeNull();
    rememberHermesLocation(dir, first.location!);

    // Same machine, next launch, but HERMES_HOME is gone from the environment.
    const second = findHermes(dir, null, {});

    expect(second.location?.desktopExe).toBe(exe);
    expect(second.location?.source).toBe('remembered');
  });

  it('does not trust a remembered location once Hermes moves away from it', async () => {
    const oldExe = await makeHermes('OldPlace');
    rememberHermesLocation(dir, {
      desktopExe: oldExe,
      hermesRoot: 'ignored',
      hermesHome: 'ignored',
      source: 'probe',
    });
    await fs.rm(path.join(dir, 'OldPlace'), { recursive: true, force: true });

    const newExe = await makeHermes('NewPlace');
    const { location } = findHermes(dir, null, {
      HERMES_HOME: path.join(dir, 'NewPlace', '.hermes'),
    });

    expect(location?.desktopExe).toBe(newExe);
    expect(location?.source).toBe('HERMES_HOME');
  });

  it('reports every path it tried when Hermes is nowhere to be found', async () => {
    const { location, attempts } = findHermes(dir, path.join(dir, 'Papers', 'App'), {
      HERMES_HOME: path.join(dir, 'nothing-here'),
    });

    expect(location).toBeNull();
    expect(attempts.length).toBeGreaterThan(1);

    const message = describeMissingHermes(attempts);
    for (const attempt of attempts) {
      expect(message).toContain(attempt.path);
    }
    expect(message).toContain('HERMES_HOME');
  });

  it('never contains a path baked in from the machine that built Papers', async () => {
    // The old bug: a build-time absolute path that is correct on one computer.
    const { location } = findHermes(null, null, {});
    expect(location).toBeNull();
  });
});

describe('resolveHermesCommand', () => {
  it('runs the interpreter beside the located Hermes rather than trusting PATH', async () => {
    await makeHermes('HermesAI', true);
    const home = path.join(dir, 'HermesAI', '.hermes');
    const { location } = findHermes(null, null, { HERMES_HOME: home });

    const command = resolveHermesCommand(resolveHermesRoot(location!, {}));

    // PATH is machine setup a build cannot carry; the venv sits beside the code
    // we already found, so it is the trustworthy answer.
    expect(command).toBe(path.join(home, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'));
  });

  it('falls back to PATH when there is no venv to point at', async () => {
    // A differently-arranged Hermes: Desktop present, no venv beside it.
    await makeHermes('HermesAI', false);
    const home = path.join(dir, 'HermesAI', '.hermes');
    const { location } = findHermes(null, null, { HERMES_HOME: home });

    expect(resolveHermesCommand(resolveHermesRoot(location!, {}))).toBe('hermes');
  });
});

describe('resolveHermesRoot', () => {
  it('uses the folder derived from the exe when nothing is configured', async () => {
    const exe = await makeHermes('HermesAI', true);
    const { location } = findHermes(null, null, {
      HERMES_HOME: path.join(dir, 'HermesAI', '.hermes'),
    });
    expect(location).not.toBeNull();

    const root = resolveHermesRoot(location!, {});

    expect(root).toBe(path.join(path.dirname(exe), '..', '..', '..', '..'));
    expect(root).toBe(path.join(dir, 'HermesAI', '.hermes', 'hermes-agent'));
  });

  it('corrects a PAPERS_HERMES_ROOT aimed at the .hermes home instead of hermes-agent', async () => {
    await makeHermes('HermesAI', true);
    const home = path.join(dir, 'HermesAI', '.hermes');
    const { location } = findHermes(null, null, { HERMES_HOME: home });

    // This is exactly how the machine-local stopgap was set, and it would have
    // sent the update helper looking for venv\Scripts\hermes.exe one level too high.
    const root = resolveHermesRoot(location!, { PAPERS_HERMES_ROOT: home });

    expect(root).toBe(path.join(home, 'hermes-agent'));
  });

  it('honours a PAPERS_HERMES_ROOT that already points at the right folder', async () => {
    await makeHermes('HermesAI', true);
    const home = path.join(dir, 'HermesAI', '.hermes');
    const agent = path.join(home, 'hermes-agent');
    const { location } = findHermes(null, null, { HERMES_HOME: home });

    expect(resolveHermesRoot(location!, { PAPERS_HERMES_ROOT: agent })).toBe(agent);
  });
});
