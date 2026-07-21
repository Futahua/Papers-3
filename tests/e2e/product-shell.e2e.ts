/**
 * Production Papers shell: Basic (Backpacks, Tools, Settings) plus the global
 * existing Hermes surface. Runs with fixtures OFF so it validates exactly what
 * the creator sees in the shipped product.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clickScript, evalInHost, launchPapers, programViewCount, waitFor, type LaunchedApp } from './helpers';

let launched: LaunchedApp;

beforeAll(async () => {
  launched = await launchPapers(undefined, { fixtures: false });
}, 120_000);

afterAll(async () => {
  await launched?.close();
});

/** Set a controlled React input's value and fire the input event. */
function setInput(selector: string, value: string): string {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

describe('production Papers shell', () => {
  it('shows Basic with Backpacks, Tools and Settings and hosts Hermes own chat', async () => {
    const { app } = launched;

    // The permanent Basic control is present with the Papers wordmark.
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.wordmark')?.textContent?.includes('Papers') === true`),
      20_000,
      'Papers wordmark',
    );

    // Open Basic and confirm it contains Backpacks, Tools and Settings.
    await evalInHost(app, clickScript('.pill-button', 'Basic'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `(() => {
            const rows = [...document.querySelectorAll('.basic-menu .basic-row')].map(r => r.textContent);
            return rows.some(t => t.includes('Backpacks')) && rows.some(t => t.includes('Tools')) && rows.some(t => t.includes('Settings'));
          })()`,
        ),
      10_000,
      'Basic menu destinations',
    );
    // Close Basic (land on default Backpacks view).
    await evalInHost(app, clickScript('.basic-row', 'Backpacks'));

    // No Programs, Agent Runs, permissions or validation UI anywhere.
    expect(
      await evalInHost<boolean>(
        app,
        `document.querySelector('.program-card') === null && document.querySelector('.side-panel') === null && !document.body.textContent.includes('Agent Runs')`,
      ),
    ).toBe(true);

    // Add a Backpack — name only, no folder/cover/type prompt.
    await evalInHost(app, setInput('.create-row input', 'Visual Writing'));
    await evalInHost(app, clickScript('.create-row button', 'Add Backpack'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelectorAll('.backpack-card').length === 1`),
      10_000,
      'created Backpack tile',
    );
    // Creation asked for nothing but a name: no file dialog / cover picker rendered.
    expect(
      await evalInHost<boolean>(
        app,
        `!document.body.textContent.includes('Choose folder') && document.querySelector('.scene-preview') === null`,
      ),
    ).toBe(true);

    // Enter the empty Backpack → the exact honest warning, quoting the name.
    await evalInHost(app, clickScript('.backpack-card button', 'Enter'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `document.querySelector('.warning-message')?.textContent?.trim() === 'Nothing here yet. Create something under \\u201cVisual Writing\\u201d.'`,
        ),
      10_000,
      'exact empty-Backpack warning',
    );
    // Dismiss returns to the shell (warning gone, Backpacks list intact).
    await evalInHost(app, clickScript('.warning-card button', 'Back to Papers'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.warning-scrim') === null && document.querySelectorAll('.backpack-card').length === 1`),
      10_000,
      'warning dismissed',
    );

    // Tools is a real permanent destination with an honest empty state.
    await evalInHost(app, clickScript('.pill-button', 'Basic'));
    await evalInHost(app, clickScript('.basic-row', 'Tools'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.tools-empty') !== null && document.querySelector('.pane-head h1')?.textContent === 'Tools'`),
      10_000,
      'Tools empty state',
    );
    // Tools does not imply it belongs to a Backpack.
    expect(await evalInHost<boolean>(app, `!document.querySelector('.tools-empty').textContent.includes('Backpack ')`)).toBe(true);

    // The Backpack name persists (still listed after navigating away and back).
    await evalInHost(app, clickScript('.pill-button', 'Basic'));
    await evalInHost(app, clickScript('.basic-row', 'Backpacks'));
    await waitFor(
      () => evalInHost<boolean>(app, `(document.querySelector('.backpack-card .name')?.textContent ?? '') === 'Visual Writing'`),
      10_000,
      'Backpack name retained',
    );

    // Hermes opens globally from the shell and embeds Hermes own /chat surface.
    await evalInHost(app, clickScript('.pill-button.solid', 'Hermes'));
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
