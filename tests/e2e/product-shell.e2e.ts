/**
 * Production Papers shell: Basic (Backpacks, Tools, Settings) plus the global
 * existing Hermes surface. Runs with fixtures OFF so it validates exactly what
 * the creator sees in the shipped product.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { clickScript, evalInHost, launchPapers, waitFor, type LaunchedApp } from './helpers';

const AS_YOU_GO_ID = 'bp-4c43caab-6fc6-44e9-ab87-25b291d1cc0d';
let launched: LaunchedApp;
let localLaunchMarker: string;
let protectedFixtureFiles: string[];
let protectedFixtureHashes: string[];

async function hashFile(file: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

beforeAll(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-as-you-go-e2e-'));
  const backpack = {
    id: AS_YOU_GO_ID,
    name: 'As you Go',
    type: 'environment',
    createdAt: '2026-07-29T15:00:00.000Z',
    lastEnteredAt: null,
    archived: false,
    workspacePath: null,
  };
  const backpackDir = path.join(userDataDir, 'PapersData', 'backpacks', AS_YOU_GO_ID);
  await fs.mkdir(backpackDir, { recursive: true });
  const registryFile = path.join(userDataDir, 'PapersData', 'registry.json');
  const backpackFile = path.join(backpackDir, 'backpack.json');
  await fs.writeFile(
    registryFile,
    JSON.stringify({ schemaVersion: 1, backpacks: [backpack], lastActiveBackpackId: null }),
    'utf8',
  );
  await fs.writeFile(
    backpackFile,
    JSON.stringify({ schemaVersion: 1, ...backpack }),
    'utf8',
  );

  const localLaunchScript = path.join(userDataDir, 'as-you-go-local-action.cmd');
  localLaunchMarker = path.join(userDataDir, 'as-you-go-launched.txt');
  await fs.writeFile(localLaunchScript, `@echo launched>"${localLaunchMarker}"\r\n`, 'utf8');
  const manifestDir = path.join(userDataDir, 'Shared', 'backpacks', AS_YOU_GO_ID);
  await fs.mkdir(manifestDir, { recursive: true });
  const manifestFile = path.join(manifestDir, 'buttons.json');
  const preparedActions = [
    ['button-a3ea849d-dfc7-486f-b6d8-5b2c12d89246', 'CLIPS'],
    ['button-7b551853-0471-4e3e-9cc1-421338db3469', 'SLOPTOP MODE'],
    ['button-26dbe75c-e79b-4a9e-a232-74c1dadd1bbc', 'slop_engine'],
    ['button-2929b1b4-6054-4b4a-a71f-b1bd5b1ff358', 'usb'],
  ] as const;
  await fs.writeFile(
    manifestFile,
    JSON.stringify(
      {
        schemaVersion: 1,
        buttons: preparedActions.map(([id, label], index) => ({
          id,
          label,
          target: localLaunchScript,
          createdAt: `2026-07-29T15:0${index}:00.000Z`,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  protectedFixtureFiles = [registryFile, backpackFile, manifestFile];
  protectedFixtureHashes = await Promise.all(protectedFixtureFiles.map(hashFile));

  launched = await launchPapers(userDataDir, { fixtures: false });
}, 120_000);

afterAll(async () => {
  await launched?.close();
  if (launched?.userDataDir) {
    await fs.rm(launched.userDataDir, { recursive: true, force: true });
  }
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
  it('enters only the local As you Go workflow with its prepared actions and no editor', async () => {
    const { app } = launched;
    const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((item) =>
      item.querySelector('.name')?.textContent?.trim() === name
    )`;

    await waitFor(
      () => evalInHost<boolean>(app, `Boolean((${card})('As you Go'))`),
      20_000,
      'As you Go Backpack card',
    );
    await evalInHost(
      app,
      `(() => [...(${card})('As you Go').querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === 'Enter')?.click())()`,
    );
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `document.querySelector('.as-you-go-workspace h1')?.textContent?.trim() === 'As you Go'`,
        ),
      10_000,
      'local As you Go workspace',
    );

    const visible = await evalInHost<{
      labels: string[];
      hasEditor: boolean;
      leaksPath: boolean;
    }>(
      app,
      `(() => ({
        labels: [...document.querySelectorAll('.as-you-go-action .label')].map((item) => item.textContent?.trim() ?? ''),
        hasEditor: [...document.querySelectorAll('button')].some((button) =>
          ['Add button', 'Remove', 'Choose file', 'Choose folder', 'Save button'].includes(button.textContent?.trim() ?? '')
        ),
        leaksPath: document.querySelector('.as-you-go-workspace')?.textContent?.includes('as-you-go-local-action.cmd') ?? false,
      }))()`,
    );
    expect(visible.labels).toEqual(['CLIPS', 'SLOPTOP MODE', 'slop_engine', 'usb']);
    expect(visible.hasEditor).toBe(false);
    expect(visible.leaksPath).toBe(false);

    await evalInHost(app, clickScript('.as-you-go-action', 'CLIPS'));
    await waitFor(
      async () => {
        try {
          return (await fs.readFile(localLaunchMarker, 'utf8')).trim() === 'launched';
        } catch {
          return false;
        }
      },
      10_000,
      'prepared local As you Go action',
    );

    await evalInHost(app, clickScript('.as-you-go-workspace button', 'Back to Papers'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.as-you-go-workspace') === null`),
      10_000,
      'return from As you Go',
    );
    expect(await Promise.all(protectedFixtureFiles.map(hashFile))).toEqual(protectedFixtureHashes);
  }, 60_000);

  it('shows Basic with Backpacks, Tools and Settings and hosts Hermes own chat', async () => {
    const { app } = launched;

    // The shell uses a slim custom title bar (no wordmark, no File/Edit/View/
    // Window menu). The permanent Basic control shows only the section name.
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `document.querySelector('.titlebar') !== null &&
           document.querySelector('.wordmark') === null &&
           (document.querySelector('.titlebar .pill-button')?.textContent ?? '').trim() === 'Backpacks'`,
        ),
      20_000,
      'slim title bar with section-name control (no wordmark)',
    );

    // Open the Basic menu and confirm it contains Backpacks, Tools and Settings.
    await evalInHost(app, clickScript('.pill-button', 'Backpacks'));
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
      () =>
        evalInHost<boolean>(
          app,
          `[...document.querySelectorAll('.backpack-card .name')].some((name) => name.textContent?.trim() === 'Visual Writing')`,
        ),
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
    await evalInHost(
      app,
      `(() => {
        const card = [...document.querySelectorAll('.backpack-card')].find(
          (item) => item.querySelector('.name')?.textContent?.trim() === 'Visual Writing'
        );
        [...(card?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.trim() === 'Enter')?.click();
      })()`,
    );
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
      () => evalInHost<boolean>(app, `document.querySelector('.warning-scrim') === null && document.querySelectorAll('.backpack-card').length === 2`),
      10_000,
      'warning dismissed',
    );

    // Tools is a real permanent destination with an honest empty state.
    await evalInHost(app, clickScript('.pill-button', 'Backpacks'));
    await evalInHost(app, clickScript('.basic-row', 'Tools'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.tools-empty') !== null && document.querySelector('.pane-head h1')?.textContent === 'Tools'`),
      10_000,
      'Tools empty state',
    );
    // Tools does not imply it belongs to a Backpack.
    expect(await evalInHost<boolean>(app, `!document.querySelector('.tools-empty').textContent.includes('Backpack ')`)).toBe(true);

    // The Backpack name persists (still listed after navigating away and back).
    await evalInHost(app, clickScript('.pill-button', 'Tools'));
    await evalInHost(app, clickScript('.basic-row', 'Backpacks'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `[...document.querySelectorAll('.backpack-card .name')].some((name) => name.textContent?.trim() === 'Visual Writing')`,
        ),
      10_000,
      'Backpack name retained',
    );

    // Hermes controls: exactly two compact SVG toggles (sidebar + window),
    // and NONE of the old redundant controls — no dotted status pill, no
    // "Hermes window" / "Hermes" text buttons, no embedded /chat surface.
    expect(
      await evalInHost<number>(app, `document.querySelectorAll('.hermes-controls .hermes-toggle').length`),
    ).toBe(2);

    // Each toggle carries an accessible name and starts inactive (Hermes closed).
    const toggleState = await evalInHost<{ labels: string[]; pressed: string[] }>(
      app,
      `(() => {
        const btns = [...document.querySelectorAll('.hermes-controls .hermes-toggle')];
        return {
          labels: btns.map((b) => b.getAttribute('aria-label') ?? ''),
          pressed: btns.map((b) => b.getAttribute('aria-pressed') ?? ''),
        };
      })()`,
    );
    expect(toggleState.labels.some((l) => /sidebar/i.test(l))).toBe(true);
    expect(toggleState.labels.some((l) => /window/i.test(l))).toBe(true);
    expect(toggleState.pressed).toEqual(['false', 'false']);

    // The obsolete duplicate Hermes UI is gone from the shell.
    expect(
      await evalInHost<boolean>(
        app,
        `document.querySelector('.hermes-badge') === null &&
         document.querySelector('.hermes-dock') === null &&
         ![...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Hermes window')`,
      ),
    ).toBe(true);
  }, 240_000);

  it('deletes an archived Backpack only after confirming that exact name', async () => {
    const { app } = launched;
    const backpackName = 'Temporary deletion check';
    const card = `(name) => [...document.querySelectorAll('.backpack-card')].find((item) =>
      item.querySelector('.name')?.textContent?.trim() === name
    )`;

    await evalInHost(app, setInput('.create-row input', backpackName));
    await evalInHost(app, clickScript('.create-row button', 'Add Backpack'));
    await waitFor(
      () => evalInHost<boolean>(app, `Boolean((${card})(${JSON.stringify(backpackName)}))`),
      10_000,
      'temporary Backpack card',
    );

    // Active Backpacks may be entered, renamed, or archived, but never deleted.
    expect(
      await evalInHost<boolean>(
        app,
        `(() => {
          const item = (${card})(${JSON.stringify(backpackName)});
          return ![...item.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Delete');
        })()`,
      ),
    ).toBe(true);

    await evalInHost(
      app,
      `(() => [...(${card})(${JSON.stringify(backpackName)}).querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === 'Archive')?.click())()`,
    );
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `[...document.querySelectorAll('.pane-footer button')].some((button) => button.textContent?.trim() === 'Show archived')`,
        ),
      10_000,
      'archived Backpack control',
    );
    await evalInHost(app, clickScript('.pane-footer button', 'Show archived'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `(() => {
            const item = (${card})(${JSON.stringify(backpackName)});
            return Boolean(item) && [...item.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Delete');
          })()`,
        ),
      10_000,
      'Delete action for archived Backpack',
    );

    const clickCardAction = (label: string): string =>
      `(() => [...(${card})(${JSON.stringify(backpackName)}).querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === ${JSON.stringify(label)})?.click())()`;
    await evalInHost(app, clickCardAction('Delete'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `(${card})(${JSON.stringify(backpackName)})?.textContent?.includes('Delete “${backpackName}”?') ?? false`,
        ),
      10_000,
      'named deletion confirmation',
    );
    // Restoring dismisses the confirmation; an active card must never retain
    // a destructive action from its archived state.
    await evalInHost(app, clickCardAction('Restore'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `(() => {
            const item = (${card})(${JSON.stringify(backpackName)});
            return Boolean(item) && !item.textContent?.includes('Delete Backpack') &&
              ![...item.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Delete');
          })()`,
        ),
      10_000,
      'restored Backpack without stale deletion controls',
    );
    await evalInHost(app, clickCardAction('Archive'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `[...(${card})(${JSON.stringify(backpackName)}).querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Delete')`,
        ),
      10_000,
      're-archived Backpack delete action',
    );
    await evalInHost(app, clickCardAction('Delete'));
    await evalInHost(app, clickCardAction('Cancel'));
    expect(await evalInHost<boolean>(app, `Boolean((${card})(${JSON.stringify(backpackName)}))`)).toBe(true);

    await evalInHost(app, clickCardAction('Delete'));
    await evalInHost(app, clickCardAction('Delete Backpack'));
    await waitFor(
      () => evalInHost<boolean>(app, `!(${card})(${JSON.stringify(backpackName)})`),
      10_000,
      'removed Backpack card',
    );

    // A fresh application process reads the same isolated profile and still
    // must not restore the deleted Backpack.
    const profile = launched.userDataDir;
    await launched.close();
    launched = await launchPapers(profile, { fixtures: false });
    await waitFor(
      () => evalInHost<boolean>(launched.app, `document.querySelector('.backpack-list') !== null`),
      20_000,
      'restarted production shell',
    );
    expect(
      await evalInHost<boolean>(launched.app, `![...document.querySelectorAll('.backpack-card .name')].some((name) => name.textContent?.trim() === ${JSON.stringify(backpackName)})`),
    ).toBe(true);
  }, 120_000);
});
