import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';

it('lets the host backdrop show through the real workspace content in transparent mode', async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-transparency-'));
  let launched: LaunchedApp | undefined;
  try {
    const id = 'bp-11111111-1111-4111-8111-111111111111';
    const root = path.join(profile, 'neutral-project');
    const data = path.join(profile, 'PapersData');
    const backpack = { id, name: 'Transparent fixture', type: 'environment',
      createdAt: '2026-09-03T00:00:00.000Z', lastEnteredAt: null,
      archived: false, workspacePath: null };
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.mkdir(path.join(data, 'backpacks', id), { recursive: true });
    await fs.writeFile(path.join(root, 'project.json'), JSON.stringify({
      schemaVersion: 1, backpackId: id, entry: 'public/index.html',
    }));
    await fs.writeFile(path.join(root, 'public/index.html'), '<!doctype html><title>Transparent fixture</title>');
    await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify({ transparentWindow: true }));
    await fs.writeFile(path.join(data, 'registry.json'), JSON.stringify({
      schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null,
    }));
    await fs.writeFile(path.join(data, 'backpack-projects.json'), JSON.stringify({
      schemaVersion: 1, projects: { [id]: { root } },
    }));
    await fs.writeFile(path.join(data, 'backpacks', id, 'backpack.json'), JSON.stringify({ schemaVersion: 1, ...backpack }));
    launched = await launchPapers(profile, { fixtures: false });
    const app = launched.app;
    await waitFor(async () => evalInHost<boolean>(app, `Boolean(document.querySelector('.backpack-card'))`), 10_000, 'fixture card');
    expect(await evalInHost<string>(app, 'document.documentElement.dataset.transparentWindow')).toBe('true');
    await evalInHost(app, `([...document.querySelectorAll('.backpack-card button')].find(b => b.textContent.trim() === 'Enter')).click()`);
    await waitFor(async () => evalInHost<boolean>(app, `Boolean(document.querySelector('.backpack-project-frame'))`), 10_000, 'workspace panel');
    await waitFor(async () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(
      contents => contents.getURL().startsWith('papers-backpack://') && !contents.isLoading(),
    )), 10_000, 'transparent project renderer');
    expect(await app.evaluate(async ({ webContents }) => {
      const project = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('papers-backpack://'))!;
      const image = await project.capturePage({ x: 10, y: 10, width: 1, height: 1 });
      return image.toBitmap()[3];
    })).toBe(0);

    const layers = await evalInHost<Array<{ name: string; background: string }>>(app, `(() => {
      let element = document.querySelector('.backpack-project-frame');
      const layers = [];
      while (element) {
        layers.push({ name: element.className || element.tagName, background: getComputedStyle(element).backgroundColor });
        element = element.parentElement;
      }
      return layers;
    })()`);
    expect(layers.filter(layer => layer.background !== 'rgba(0, 0, 0, 0)')).toEqual([]);

    // Two synthetic backdrops prove actual host pixels, not just a CSS declaration.
    // Capture this app's host renderer only; never capture or control the desktop.
    for (const rgb of [[17, 83, 149], [191, 47, 103]]) {
      await evalInHost(app, `document.body.style.background = 'rgb(${rgb.join(',')})'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      const pixel = await app.evaluate(async ({ BaseWindow }) => {
        const host = BaseWindow.getAllWindows()[0]!.contentView.children[0] as Electron.WebContentsView;
        const point = await host.webContents.executeJavaScript(`(() => {
          const r = document.querySelector('.backpack-project-frame').getBoundingClientRect();
          return {x: Math.floor(r.x + r.width / 2), y: Math.floor(r.y + r.height / 2)};
        })()`);
        const image = await host.webContents.capturePage({ ...point, width: 1, height: 1 });
        const bgra = image.toBitmap();
        return [bgra[2], bgra[1], bgra[0], bgra[3]];
      });
      expect(pixel).toEqual([...rgb, 255]);
    }
    // Switching off transparency must retain an opaque workspace.
    expect(await evalInHost<string>(app, `(() => {
      document.body.style.background = '';
      document.documentElement.dataset.transparentWindow = 'false';
      return getComputedStyle(document.querySelector('.workspace-dock')).backgroundColor;
    })()`)).not.toBe('rgba(0, 0, 0, 0)');
  } finally {
    await launched?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}, 60_000);
