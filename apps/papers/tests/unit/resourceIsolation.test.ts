import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ResourceService } from '../../src/main/resources/resourceService';
import { validateArtifactContent } from '../../src/main/resources/resourceExecutors';
import { ProgramStateService } from '../../src/main/persistence/programStateService';
import { papersPaths } from '../../src/main/persistence/paths';

let dir: string;
let resources: ResourceService;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-res-'));
  resources = new ResourceService(papersPaths(dir));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resource grant isolation', () => {
  it('only granted programs can resolve a resource', async () => {
    const entry = await resources.register('bp-1', {
      type: 'git-repository',
      name: 'repo',
      path: 'D:\\somewhere\\repo',
      grants: ['prog-a'],
      meta: {},
    });

    await expect(resources.requireGranted('bp-1', 'prog-a', entry.id)).resolves.toMatchObject({
      id: entry.id,
    });
    await expect(resources.requireGranted('bp-1', 'prog-b', entry.id)).rejects.toThrow(/no grant/);
    expect(await resources.listGranted('bp-1', 'prog-b')).toHaveLength(0);
  });

  it('resources are isolated per Backpack', async () => {
    const entry = await resources.register('bp-1', {
      type: 'git-repository',
      name: 'repo',
      path: 'D:\\somewhere\\repo',
      grants: ['prog-a'],
      meta: {},
    });
    await expect(resources.requireGranted('bp-2', 'prog-a', entry.id)).rejects.toThrow(
      /does not exist/,
    );
  });

  it('re-registering the same path extends grants instead of duplicating', async () => {
    const first = await resources.register('bp-1', {
      type: 'git-repository',
      name: 'repo',
      path: 'D:\\Repo',
      grants: ['prog-a'],
      meta: {},
    });
    const second = await resources.register('bp-1', {
      type: 'git-repository',
      name: 'repo again',
      path: 'd:\\repo',
      grants: ['prog-b'],
      meta: {},
    });
    expect(second.id).toBe(first.id);
    await expect(resources.requireGranted('bp-1', 'prog-b', first.id)).resolves.toBeTruthy();
  });
});

describe('program state and summary isolation', () => {
  it('separates state by backpack and program identity', async () => {
    const state = new ProgramStateService(papersPaths(dir));
    await state.save('bp-1', 'prog-a', { secret: 'a1' });
    await state.save('bp-1', 'prog-b', { secret: 'b1' });
    await state.save('bp-2', 'prog-a', { secret: 'a2' });

    expect(await state.load('bp-1', 'prog-a')).toEqual({ secret: 'a1' });
    expect(await state.load('bp-1', 'prog-b')).toEqual({ secret: 'b1' });
    expect(await state.load('bp-2', 'prog-a')).toEqual({ secret: 'a2' });
    expect(await state.load('bp-2', 'prog-b')).toBeNull();
  });

  it('shared summaries are separate from full state', async () => {
    const state = new ProgramStateService(papersPaths(dir));
    await state.save('bp-1', 'prog-a', { private: 'full state' });
    expect(await state.readSummary('bp-1', 'prog-a')).toBeNull();
    await state.publishSummary('bp-1', 'prog-a', { counts: { notes: 3 } });
    expect(await state.readSummary('bp-1', 'prog-a')).toEqual({ counts: { notes: 3 } });
    expect(await state.load('bp-1', 'prog-a')).toEqual({ private: 'full state' });
  });
});

describe('artifact structural validation', () => {
  const goodFodt = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document xmlns:office="urn:x" office:version="1.2">',
    '<office:body><office:text><text:p>Hi &amp; hello</text:p></office:text></office:body>',
    '</office:document>',
  ].join('\n');

  it('accepts well-formed fodt and json', () => {
    expect(() => validateArtifactContent('report.fodt', goodFodt)).not.toThrow();
    expect(() => validateArtifactContent('data.json', '{"a":1}')).not.toThrow();
    expect(() => validateArtifactContent('notes.md', '# anything goes')).not.toThrow();
  });

  it('rejects malformed documents', () => {
    expect(() => validateArtifactContent('r.fodt', 'not xml at all')).toThrow(/not XML/);
    expect(() => validateArtifactContent('r.fodt', goodFodt.replace('</office:body>', ''))).toThrow(
      /unbalanced/,
    );
    expect(() => validateArtifactContent('r.fodt', goodFodt.replace('&amp;', '&'))).toThrow(
      /unescaped/,
    );
    expect(() => validateArtifactContent('d.json', '{oops')).toThrow(/invalid/);
  });
});
