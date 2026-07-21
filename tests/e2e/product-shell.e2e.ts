/** Production-facing shell: machine-wide Backpacks plus the existing Hermes UI. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  clickScript,
  evalInHost,
  launchPapers,
  programViewCount,
  waitFor,
  type LaunchedApp,
} from './helpers';

let launched: LaunchedApp;

beforeAll(async () => {
  launched = await launchPapers(undefined, { fixtures: false });
}, 120_000);

afterAll(async () => {
  await launched?.close();
});

describe('production Papers shell', () => {
  it('enters a visual environment and hosts Hermes own chat surface', async () => {
    const { app } = launched;
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.home h1')?.textContent === 'Papers'`),
      20_000,
      'Backpack chooser',
    );
    await evalInHost(app, `(() => {
      const input = document.querySelector('.create-row input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Visual Writing');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await evalInHost(app, clickScript('.create-row button', 'Create Backpack'));
    await waitFor(
      () => evalInHost<boolean>(app, `(document.querySelector('.backpack-card')?.textContent ?? '').includes('Machine-wide environment')`),
      10_000,
      'machine-wide Backpack tile',
    );
    await evalInHost(app, clickScript('.backpack-card button', 'Enter'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.environment-space')?.textContent.trim() === '(machine wide complex capability)'`),
      10_000,
      'neutral Backpack environment',
    );
    expect(await evalInHost<boolean>(app, `document.querySelector('.program-card') === null`)).toBe(true);
    expect(await evalInHost<boolean>(app, `!document.body.textContent.includes('Permissions') && !document.body.textContent.includes('Agent Runs')`)).toBe(true);

    await evalInHost(app, clickScript('button', 'Hermes sidebar'));
    await waitFor(async () => (await programViewCount(app)) === 1, 150_000, 'official Hermes view', 500);
    const hermesUrl = await app.evaluate(async ({ BaseWindow }) => {
      const win = BaseWindow.getAllWindows()[0];
      const views = win?.contentView.children as Electron.WebContentsView[];
      return views.at(-1)?.webContents.getURL() ?? '';
    });
    expect(hermesUrl).toMatch(/^http:\/\/127\.0\.0\.1:9119\/chat/);

    await evalInHost(app, clickScript('.hermes-dock button', 'Close'));
    await waitFor(async () => (await programViewCount(app)) === 0, 10_000, 'Hermes view closed');
  }, 240_000);
});
