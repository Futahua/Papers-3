import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  resolveWindowHelperResourcePaths,
  validateWindowHelperResource,
  WINDOW_HELPER_PROTOCOL_VERSION,
  WINDOW_HELPER_RESOURCE_DIRECTORY_NAME,
  WINDOW_HELPER_SCRIPT_FILE,
  WINDOW_HELPER_ADAPTER_FILE,
  WINDOW_HELPER_MANIFEST_FILE,
  WINDOW_HELPER_EXPECTED_HASHES,
} from '../../src/main/windows/windowHelperResource';

const REPO_ROOT = path.join(__dirname, '../..');

function realPaths(): ReturnType<typeof resolveWindowHelperResourcePaths> {
  return resolveWindowHelperResourcePaths({ appPath: REPO_ROOT, resourcesPath: '', packaged: false });
}

function makeResourceDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-resource-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function validManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protocolVersion: WINDOW_HELPER_PROTOCOL_VERSION,
    executable: 'powershell.exe',
    spawnArguments: ['-NoProfile', '-NonInteractive', '-File'],
    files: [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE],
    hashes: WINDOW_HELPER_EXPECTED_HASHES,
    ...overrides,
  });
}

function pathsFor(dir: string): ReturnType<typeof resolveWindowHelperResourcePaths> {
  return {
    directory: dir,
    helperPath: path.join(dir, WINDOW_HELPER_SCRIPT_FILE),
    adapterPath: path.join(dir, WINDOW_HELPER_ADAPTER_FILE),
    manifestPath: path.join(dir, WINDOW_HELPER_MANIFEST_FILE),
  };
}

/** A temp copy of the REAL resource with one byte flipped in a script. */
function mutatedResourceDir(): { dir: string; fileName: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-resource-'));
  for (const file of [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE, WINDOW_HELPER_MANIFEST_FILE]) {
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', file), path.join(dir, file));
  }
  const target = path.join(dir, WINDOW_HELPER_SCRIPT_FILE);
  const bytes = fs.readFileSync(target);
  bytes[Math.floor(bytes.length / 2)] = bytes[Math.floor(bytes.length / 2)]! ^ 0x01;
  fs.writeFileSync(target, bytes);
  return { dir, fileName: WINDOW_HELPER_SCRIPT_FILE };
}

describe('windowHelperResource path resolution', () => {
  it('resolves the explicit dev layout under appPath/resources', () => {
    const paths = resolveWindowHelperResourcePaths({ appPath: 'C:\\repo', resourcesPath: 'C:\\ignored', packaged: false });
    expect(paths.directory).toBe(path.join('C:\\repo', 'resources', WINDOW_HELPER_RESOURCE_DIRECTORY_NAME));
    expect(paths.helperPath).toBe(path.join(paths.directory, WINDOW_HELPER_SCRIPT_FILE));
    expect(paths.adapterPath).toBe(path.join(paths.directory, WINDOW_HELPER_ADAPTER_FILE));
    expect(paths.manifestPath).toBe(path.join(paths.directory, WINDOW_HELPER_MANIFEST_FILE));
  });

  it('resolves the explicit packaged layout under resourcesPath', () => {
    const paths = resolveWindowHelperResourcePaths({ appPath: 'C:\\ignored', resourcesPath: 'C:\\res', packaged: true });
    expect(paths.directory).toBe(path.join('C:\\res', WINDOW_HELPER_RESOURCE_DIRECTORY_NAME));
    expect(paths.helperPath).toBe(path.join(paths.directory, WINDOW_HELPER_SCRIPT_FILE));
    expect(paths.adapterPath).toBe(path.join(paths.directory, WINDOW_HELPER_ADAPTER_FILE));
    expect(paths.manifestPath).toBe(path.join(paths.directory, WINDOW_HELPER_MANIFEST_FILE));
  });
});

describe('windowHelperResource provenance validation', () => {
  it('leaves same-process Papers observations to the trusted host gate while hover excludes its parent', () => {
    const adapter = fs.readFileSync(realPaths().adapterPath, 'utf8');
    expect(adapter).not.toContain("if ($processName -eq 'Papers')");
    expect(adapter).toContain('([int]$_.ProcessId -ne $parentPid)');
  });

  it('accepts the real Papers-owned resource in the dev layout', () => {
    const result = validateWindowHelperResource(realPaths());
    expect(result.ok).toBe(true);
  });

  it('rejects a missing manifest before any spawn', () => {
    const dir = makeResourceDir({});
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('manifest');
  });

  it('rejects an unreadable manifest', () => {
    const dir = makeResourceDir({ [WINDOW_HELPER_MANIFEST_FILE]: 'this is not json' });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
  });

  it('rejects a wrong protocol version', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ protocolVersion: '000000' }),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('version');
  });

  it('rejects a tampered manifest executable', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ executable: 'cmd.exe' }),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('executable');
  });

  it('rejects a tampered manifest argument prefix', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ spawnArguments: ['-EncodedCommand'] }),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('argument');
  });

  it('rejects a manifest file list missing an entry', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_SCRIPT_FILE] }),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file list');
  });

  it('rejects a manifest file list with an extra entry', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE, 'evil.ps1'] }),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file list');
  });

  it('rejects a duplicate file list entry at the file-list gate (real helper bytes, missing adapter)', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_SCRIPT_FILE] }),
    });
    // Real accepted helper bytes: without the uniqueness gate this list
    // could pass and skip all validation of the missing adapter.
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_SCRIPT_FILE), path.join(dir, WINDOW_HELPER_SCRIPT_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file list');
  });

  it('rejects the symmetric adapter duplicate at the file-list gate', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_ADAPTER_FILE, WINDOW_HELPER_ADAPTER_FILE] }),
    });
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_ADAPTER_FILE), path.join(dir, WINDOW_HELPER_ADAPTER_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file list');
  });

  it('rejects a mixed duplicate in helper-first order at the file-list gate', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE, WINDOW_HELPER_SCRIPT_FILE] }),
    });
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_SCRIPT_FILE), path.join(dir, WINDOW_HELPER_SCRIPT_FILE));
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_ADAPTER_FILE), path.join(dir, WINDOW_HELPER_ADAPTER_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file list');
  });

  it('rejects a mixed duplicate in adapter-first order at the file-list gate', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_ADAPTER_FILE, WINDOW_HELPER_SCRIPT_FILE, WINDOW_HELPER_ADAPTER_FILE] }),
    });
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_SCRIPT_FILE), path.join(dir, WINDOW_HELPER_SCRIPT_FILE));
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_ADAPTER_FILE), path.join(dir, WINDOW_HELPER_ADAPTER_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('file list');
  });

  it('accepts the reversed unique order (order is irrelevant)', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [WINDOW_HELPER_ADAPTER_FILE, WINDOW_HELPER_SCRIPT_FILE] }),
    });
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_SCRIPT_FILE), path.join(dir, WINDOW_HELPER_SCRIPT_FILE));
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_ADAPTER_FILE), path.join(dir, WINDOW_HELPER_ADAPTER_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(true);
  });

  it('rejects traversal or separators in the file list', () => {
    for (const bad of ['../evil.ps1', 'sub/x.ps1', 'C:\\evil.ps1', 'a\\b.ps1']) {
      const dir = makeResourceDir({
        [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ files: [bad, WINDOW_HELPER_ADAPTER_FILE] }),
        [WINDOW_HELPER_SCRIPT_FILE]: 'x',
        [WINDOW_HELPER_ADAPTER_FILE]: 'y',
      });
      const result = validateWindowHelperResource(pathsFor(dir));
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a manifest hash that diverges from the compiled pin', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({
        hashes: { ...WINDOW_HELPER_EXPECTED_HASHES, [WINDOW_HELPER_ADAPTER_FILE]: 'a'.repeat(64) },
      }),
    });
    // Real script bytes so validation reaches the manifest-hash check for
    // the adapter before any byte-hash failure on the script.
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_SCRIPT_FILE), path.join(dir, WINDOW_HELPER_SCRIPT_FILE));
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_ADAPTER_FILE), path.join(dir, WINDOW_HELPER_ADAPTER_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('manifest hash mismatch');
  });

  it('rejects malformed hash values', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest({ hashes: { ...WINDOW_HELPER_EXPECTED_HASHES, [WINDOW_HELPER_ADAPTER_FILE]: 'not-a-hash' } }),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
  });

  it('rejects a one-byte script mutation (resource hash mismatch)', () => {
    const { dir, fileName } = mutatedResourceDir();
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('resource hash mismatch');
    expect(result.reason).toContain(fileName);
  });

  it('rejects an empty listed file without disclosing contents', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest(),
      [WINDOW_HELPER_SCRIPT_FILE]: '',
      [WINDOW_HELPER_ADAPTER_FILE]: 'x',
    });
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(WINDOW_HELPER_SCRIPT_FILE);
  });

  it('rejects a missing listed file', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest(),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
    });
    // Real script bytes so the script passes its byte hash and the missing
    // adapter is the one caught.
    fs.copyFileSync(path.join(REPO_ROOT, 'resources', 'window-helper', WINDOW_HELPER_SCRIPT_FILE), path.join(dir, WINDOW_HELPER_SCRIPT_FILE));
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain(WINDOW_HELPER_ADAPTER_FILE);
  });

  it('rejects path objects that do not match the canonical layout', () => {
    const dir = makeResourceDir({
      [WINDOW_HELPER_MANIFEST_FILE]: validManifest(),
      [WINDOW_HELPER_SCRIPT_FILE]: 'x',
      [WINDOW_HELPER_ADAPTER_FILE]: 'y',
    });
    const outside = path.join(dir, 'elsewhere.ps1');
    const result = validateWindowHelperResource({
      directory: dir,
      helperPath: outside,
      adapterPath: path.join(dir, WINDOW_HELPER_ADAPTER_FILE),
      manifestPath: path.join(dir, WINDOW_HELPER_MANIFEST_FILE),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('canonical');
  });

  it('keeps validation errors bounded and free of script contents', () => {
    const dir = makeResourceDir({});
    const result = validateWindowHelperResource(pathsFor(dir));
    expect(result.ok).toBe(false);
    expect(result.reason!.length).toBeLessThan(200);
  });
});
