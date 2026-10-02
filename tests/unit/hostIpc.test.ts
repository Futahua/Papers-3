import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { commandSurfaceDismissDestinationSchema, hostWorkspaceSurfaceMoveTargetSchema, parseWindowsClipboardFileDrop, parseWindowsClipboardFileNameW } from '../../src/main/ipc/hostIpc';

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

describe('Windows clipboard file parsing', () => {
  it('decodes a wide file-drop buffer', () => {
    const paths = ['C:\\one.txt', 'D:\\two.pdf'];
    const body = Buffer.from(`${paths.join('\0')}\0\0`, 'utf16le');
    const header = Buffer.alloc(20);
    header.writeUInt32LE(20, 0);
    header.writeUInt32LE(1, 16);
    expect(parseWindowsClipboardFileDrop(Buffer.concat([header, body]))).toEqual(paths);
  });

  it('decodes a wide file-name clipboard value', () => {
    expect(parseWindowsClipboardFileNameW(Buffer.from('D:\\phone\\photo.jpg\0', 'utf16le')))
      .toEqual(['D:\\phone\\photo.jpg']);
  });
});

describe('project native file drag IPC', () => {
  it('resolves native clipboard files and text paths before returning text', async () => {
    const source = await readFile(new URL('../../src/main/ipc/hostIpc.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/parsedRequest\.operation === 'clipboard-read'/);
    expect(source).toMatch(/clipboardPathCandidates\(formats\)/);
    expect(source).toMatch(/const possiblePath = unquoteClipboardPath\(text\)/);
    expect(source).toMatch(/kind: 'text', text, fingerprint/);
  });

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
