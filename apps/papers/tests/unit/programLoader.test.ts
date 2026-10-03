import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { loadProgramCatalog } from '../../src/main/canvas/programLoader';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-loader-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeProgram(id: string, manifest: unknown, entry = 'index.html'): Promise<void> {
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  if (entry) await fs.writeFile(path.join(dir, entry), '<!doctype html>', 'utf8');
}

async function writeAsset(id: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, id, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, 'utf8');
}

const validManifest = (id: string): Record<string, unknown> => ({
  id,
  name: 'Valid Program',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.html',
  stateSchemaVersion: 1,
  capabilities: ['storage.read-own'],
});

describe('loadProgramCatalog', () => {
  it('loads valid programs', async () => {
    await writeProgram('good-one', validManifest('good-one'));
    const catalog = await loadProgramCatalog(root);
    expect([...catalog.programs.keys()]).toEqual(['good-one']);
    expect(catalog.issues).toHaveLength(0);
  });

  it('rejects undeclared capabilities', async () => {
    await writeProgram('bad-cap', {
      ...validManifest('bad-cap'),
      capabilities: ['filesystem.raw-access'],
    });
    const catalog = await loadProgramCatalog(root);
    expect(catalog.programs.size).toBe(0);
    expect(catalog.issues[0]?.problem).toContain('capabilities');
  });

  it('rejects id/directory mismatch', async () => {
    await writeProgram('dir-name', validManifest('other-id'));
    const catalog = await loadProgramCatalog(root);
    expect(catalog.programs.size).toBe(0);
    expect(catalog.issues[0]?.problem).toContain('must match directory');
  });

  it('rejects entry traversal', async () => {
    await writeProgram('traversal', { ...validManifest('traversal'), entry: '../../evil.html' });
    const catalog = await loadProgramCatalog(root);
    expect(catalog.programs.size).toBe(0);
  });

  it('rejects missing entry file and invalid JSON', async () => {
    await writeProgram('no-entry', validManifest('no-entry'), '');
    const dir = path.join(root, 'bad-json');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'manifest.json'), '{not json', 'utf8');
    const catalog = await loadProgramCatalog(root);
    expect(catalog.programs.size).toBe(0);
    expect(catalog.issues).toHaveLength(2);
  });

  it('rejects unknown manifest fields (strict schema)', async () => {
    await writeProgram('extra-fields', { ...validManifest('extra-fields'), nodeAccess: true });
    const catalog = await loadProgramCatalog(root);
    expect(catalog.programs.size).toBe(0);
  });

  it('rejects HTML entries that reference a missing local script or stylesheet', async () => {
    await writeProgram('missing-script', validManifest('missing-script'));
    await writeAsset(
      'missing-script',
      'index.html',
      '<!doctype html><link rel="stylesheet" href="style.css"><script type="module" src="main.js"></script>',
    );
    await writeAsset('missing-script', 'style.css', 'body { color: black }');

    const catalog = await loadProgramCatalog(root);
    expect(catalog.programs.size).toBe(0);
    expect(catalog.issues[0]?.problem).toContain('main.js');
  });

  it('follows static ES-module imports and accepts a complete local asset graph', async () => {
    await writeProgram('complete-program', validManifest('complete-program'));
    await writeAsset(
      'complete-program',
      'index.html',
      '<!doctype html><link rel="stylesheet" href="style.css"><script type="module" src="main.js"></script>',
    );
    await writeAsset('complete-program', 'style.css', 'body { color: black }');
    await writeAsset('complete-program', 'main.js', "import { start } from './lib/start.js'; start();");
    await writeAsset('complete-program', 'lib/start.js', 'export function start() {}');

    const catalog = await loadProgramCatalog(root);
    expect([...catalog.programs.keys()]).toEqual(['complete-program']);
    expect(catalog.issues).toHaveLength(0);
  });
});
