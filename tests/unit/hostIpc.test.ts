import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { commandSurfaceDismissDestinationSchema, hostWorkspaceSurfaceMoveTargetSchema } from '../../src/main/ipc/hostIpc';

describe('authenticated host workspace-move IPC shape', () => {
  it('accepts only the logical surface and explicit destination fields', () => {
    expect(hostWorkspaceSurfaceMoveTargetSchema.parse({
      surfaceId: 'sf-moved', targetWindowId: 2, targetGroupId: 'group-main', targetIndex: 0,
    })).toEqual({
      surfaceId: 'sf-moved', targetWindowId: 2, targetGroupId: 'group-main', targetIndex: 0,
    });
  });

  it('rejects a renderer-supplied source window', () => {
    expect(() => hostWorkspaceSurfaceMoveTargetSchema.parse({
      surfaceId: 'sf-moved', sourceWindowId: 99,
      targetWindowId: 2, targetGroupId: 'group-main', targetIndex: 0,
    })).toThrow();
  });
});

describe('project native file drag IPC', () => {
  it('validates every supplied path before starting one native multi-file drag', async () => {
    const source = await readFile(new URL('../../src/main/ipc/hostIpc.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/parsedRequest\.operation === 'native-drag'/);
    expect(source).toMatch(/backpackProjectNativeDragPathsSchema\.parse\(parsedRequest\.params\?\.\['paths'\]\)/);
    expect(source).toMatch(/for \(const target of paths\)[\s\S]*operation: 'stat'[\s\S]*if \(checked\?\.ok !== true\) return checked/);
    expect(source).toMatch(/event\.sender\.startDrag\(\{ file: firstTarget, files: paths, icon \}\)/);
  });
});

describe('command-surface dismissal IPC shape', () => {
  it('accepts only the three explicit handoff destinations', () => {
    for (const destination of ['restore', 'external', 'papers']) {
      expect(commandSurfaceDismissDestinationSchema.parse(destination)).toBe(destination);
    }
    expect(() => commandSurfaceDismissDestinationSchema.parse('desktop')).toThrow();
  });
});
