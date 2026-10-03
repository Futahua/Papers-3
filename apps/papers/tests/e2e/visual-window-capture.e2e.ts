import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { evalInHost, evalInHostWindow, launchPapers, waitFor, type LaunchedApp } from './helpers';
// @ts-expect-error -- the shared control client is plain ESM shipped with the tools.
import { connectPapersControl, readDescriptor } from '../../tools/papersControlClient.mjs';

const PROJECT = 'bp-22222222-2222-4222-8222-222222222222';
let launched: LaunchedApp;
let descriptorPath: string;

async function call(method: string, params: unknown = {}): Promise<unknown> {
  const connection = await connectPapersControl(await readDescriptor(descriptorPath));
  try {
    const response = await connection.call(method, params) as { ok: boolean; result?: unknown; error?: string };
    if (!response.ok) throw new Error(response.error ?? 'control request failed');
    return response.result;
  } finally {
    connection.close();
  }
}

beforeAll(async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'papers3-window-capture-'));
  descriptorPath = join(userDataDir, 'dev-control.json');
  const dataDir = join(userDataDir, 'PapersData');
  const projectRoot = join(dataDir, 'native-capture-project');
  const backpackDir = join(dataDir, 'backpacks', PROJECT);
  const backpack = {
    id: PROJECT, name: 'Native capture project', type: 'environment',
    createdAt: '2026-09-02T00:00:00.000Z', lastEnteredAt: null, archived: false, workspacePath: null,
  };
  await mkdir(join(projectRoot, 'public'), { recursive: true });
  await mkdir(backpackDir, { recursive: true });
  await writeFile(join(dataDir, 'registry.json'), JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }));
  await writeFile(join(backpackDir, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
  await writeFile(join(dataDir, 'backpack-projects.json'), JSON.stringify({ schemaVersion: 1, projects: { [PROJECT]: { root: projectRoot } } }));
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ schemaVersion: 1, backpackId: PROJECT, entry: 'public/index.html' }));
  await writeFile(join(projectRoot, 'public', 'index.html'), '<!doctype html><style>body{background:#124;color:#fff}</style><main><h1>Native capture fixture</h1></main>');
  launched = await launchPapers(userDataDir, { fixtures: false, devControlDescriptor: descriptorPath });
  await waitFor(async () => {
    try { await readFile(descriptorPath, 'utf8'); return true; } catch { return false; }
  }, 10_000, 'window capture control descriptor');
}, 30_000);

afterAll(async () => {
  await launched?.close();
});

describe('composed visual window capture', () => {
  it('captures the exact native window source and reports real dimensions', async () => {
    const windowId = await launched.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]!.id);
    const opened = await evalInHost<{ url: string; surfaceId: string }>(
      launched.app,
      `window.papersHost.backpackProject.open(${JSON.stringify(PROJECT)})`,
    );
    await evalInHost(
      launched.app,
      `window.papersHost.backpackProject.showSurface(${JSON.stringify(opened.surfaceId)}, ${JSON.stringify(opened.url)}).then(() => true)`,
    );
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ surfaceId: string; presentation: string }>)
      .some((surface) => surface.surfaceId === opened.surfaceId && surface.presentation === 'visible'),
    10_000, 'native capture project presentation');
    // A second Papers window has the same native title. Its sibling surface
    // must not be pulled into the first window's composed observation.
    const secondary = await call('window.create') as { windowId: number };
    const secondOpened = await evalInHostWindow<{ url: string; surfaceId: string }>(
      launched.app,
      secondary.windowId,
      `window.papersHost.backpackProject.open(${JSON.stringify(PROJECT)})`,
    );
    await evalInHostWindow(
      launched.app,
      secondary.windowId,
      `window.papersHost.backpackProject.showSurface(${JSON.stringify(secondOpened.surfaceId)}, ${JSON.stringify(secondOpened.url)}).then(() => true)`,
    );
    await waitFor(async () => (await call('inspect.surfaces') as Array<{ surfaceId: string; windowId: number; presentation: string }>)
      .some((surface) => surface.surfaceId === secondOpened.surfaceId
        && surface.windowId === secondary.windowId && surface.presentation === 'visible'),
    10_000, 'native capture sibling presentation');
    const captured = await call('capture.window', { windowId }) as {
      target: { windowId: number };
      consistency: { status: string };
      nativeBounds: { width: number; height: number };
      pixelSize: { width: number; height: number };
      surfaces: Array<{ surfaceId: string; projectId: string; presentation: string }>;
      png: { mimeType: string; size: number; artifactId: string; sha256: string };
    };
    expect(captured.target).toEqual({ windowId });
    expect(captured.consistency).toEqual({ status: 'stable' });
    expect(captured.nativeBounds.width).toBeGreaterThan(0);
    expect(captured.nativeBounds.height).toBeGreaterThan(0);
    expect(captured.pixelSize.width).toBeGreaterThan(0);
    expect(captured.pixelSize.height).toBeGreaterThan(0);
    expect(captured.surfaces).toEqual([
      expect.objectContaining({ surfaceId: opened.surfaceId, projectId: PROJECT, presentation: 'visible' }),
    ]);
    expect(captured.surfaces.some((surface) => surface.surfaceId === secondOpened.surfaceId)).toBe(false);
    expect(captured.png).toEqual(expect.objectContaining({ mimeType: 'image/png', size: expect.any(Number) }));

    const chunks: Uint8Array[] = [];
    let offset = 0;
    let done = false;
    while (!done) {
      const chunk = await call('visual.artifact.read', {
        artifactId: captured.png.artifactId, offset, length: 1024,
      }) as { nextOffset: number; done: boolean; bytesBase64: string };
      chunks.push(new Uint8Array(Buffer.from(chunk.bytesBase64, 'base64')));
      offset = chunk.nextOffset;
      done = chunk.done;
    }
    const bytes = new Uint8Array(chunks.reduce((all, chunk) => [...all, ...chunk], [] as number[]));
    expect(bytes.byteLength).toBe(captured.png.size);
    expect(bytes[0]).toBe(137);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(captured.png.sha256);
  }, 30_000);
});
