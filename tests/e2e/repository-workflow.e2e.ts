/**
 * Creator-facing Repository Research workflow. Unlike the kill test, this
 * exercises the primary program, generated report, cross-program summary,
 * and restart restoration without spending an additional Hermes turn.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  clickScript,
  evalInHost,
  evalInProgram,
  launchPapers,
  programViewCount,
  waitFor,
  type LaunchedApp,
} from './helpers';

const execFileAsync = promisify(execFile);
let fixtureRoot: string;

async function git(...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd: fixtureRoot, windowsHide: true, shell: false });
}

function setInput(selector: string, value: string): string {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-research-fixture-'));
  await fs.mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(fixtureRoot, 'src', 'core.ts'),
    [
      'export interface Backpack {',
      '  id: string;',
      '  name: string;',
      '}',
      '',
      'export function enterBackpack(value: Backpack): string {',
      '  return `entered:${value.id}`;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(fixtureRoot, 'README.md'), '# Fixture\n\nA tiny repository.\n', 'utf8');
  await git('init', '--initial-branch=main');
  await git('config', 'user.email', 'fixture@papers3.test');
  await git('config', 'user.name', 'Papers Fixture');
  await git('add', '-A');
  await git('commit', '-m', 'fixture: initial');
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe('Repository Research primary workflow', () => {
  it('registers, selects, produces, shares, and restores research', async () => {
    let launched: LaunchedApp = await launchPapers();
    const userDataDir = launched.userDataDir;
    let app = launched.app;

    try {
      await waitFor(
        () => evalInHost<boolean>(app, `document.querySelector('.home h1') !== null`),
        20_000,
        'home screen',
      );
      await evalInHost(app, setInput('.create-row input', 'Repository Lab'));
      await evalInHost(app, clickScript('.create-row button', 'Create Backpack'));
      await waitFor(
        () => evalInHost<boolean>(app, `document.querySelectorAll('.backpack-card').length === 1`),
        10_000,
        'backpack created',
      );
      await evalInHost(app, clickScript('.backpack-card button', 'Enter'));
      await waitFor(
        () => evalInHost<boolean>(app, `document.querySelector('.topbar') !== null`),
        10_000,
        'canvas frame',
      );

      await evalInHost(app, clickScript('.program-card', 'Repository Research'));
      await waitFor(async () => (await programViewCount(app)) === 1, 20_000, 'program attached');
      await waitFor(
        () => evalInProgram<boolean>(app, `document.body.dataset.ready === 'true' && document.querySelector('.grid-counts') !== null && [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Register repository')) && !document.body.textContent.includes('failed to start')`),
        20_000,
        'Repository Research controller ready',
      );

      // Register the disposable repository through the real program and host
      // permission boundary.
      await evalInProgram(app, setInput('input[placeholder^="Absolute path"]', fixtureRoot));
      await evalInProgram(app, setInput('input[placeholder^="Display name"]', 'Tiny Fixture'));
      await evalInProgram(app, clickScript('button', 'Register repository'));
      await waitFor(
        () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('resources.register')`),
        10_000,
        'repository permission',
      );
      await evalInHost(app, clickScript('.modal footer button', 'Allow for this program'));
      await waitFor(
        () => evalInProgram<boolean>(app, `(document.querySelector('#content')?.textContent ?? '').includes('Tiny Fixture')`),
        20_000,
        'repository registered',
      );
      await evalInProgram(app, clickScript('.nav-btn', 'Explorer'));
      await waitFor(
        () => evalInProgram<boolean>(app, `document.querySelector('.nav-btn.active')?.dataset.view === 'explorer'`),
        20_000,
        'explorer opened',
      );
      await waitFor(
        () => evalInProgram<boolean>(app, `[...document.querySelectorAll('.file-row button')].some((b) => b.textContent === 'src/core.ts')`),
        20_000,
        'tracked files listed',
      );

      await evalInProgram(app, clickScript('.file-row button', 'src/core.ts'));
      await waitFor(
        () => evalInProgram<boolean>(app, `document.querySelectorAll('table.code tr').length >= 8`),
        10_000,
        'source file rendered',
      );
      await evalInProgram(app, `(() => {
        document.querySelector('tr[data-line="1"] .gutter button').click();
        document.querySelector('tr[data-line="4"] .gutter button').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        return true;
      })()`);
      await evalInProgram(app, clickScript('button', 'Capture evidence'));
      await evalInProgram(app, clickScript('.nav-btn', 'Evidence'));
      await waitFor(
        () => evalInProgram<boolean>(app, `(document.querySelector('#content')?.textContent ?? '').includes('src/core.ts:1-4')`),
        10_000,
        'hash-provenanced evidence captured',
      );

      // Add a creator note.
      await evalInProgram(app, clickScript('.nav-btn', 'Notes'));
      await evalInProgram(app, clickScript('button', 'New note'));
      await evalInProgram(app, setInput('.two-col .card input[type="text"]', 'Backpack boundary'));
      await evalInProgram(app, setInput('.two-col .card textarea', 'Entering a Backpack is not the same as invoking an agent action.'));
      await waitFor(
        () => evalInProgram<boolean>(app, `document.querySelector('.two-col .card input[type="text"]')?.value === 'Backpack boundary' && document.querySelector('.two-col .card textarea')?.value.includes('invoking an agent action')`),
        5_000,
        'note created',
      );

      // Build an editable FODT artifact with the captured evidence attached.
      await evalInProgram(app, clickScript('.nav-btn', 'Draft'));
      await evalInProgram(app, clickScript('button', 'New draft'));
      await waitFor(
        () => evalInProgram<boolean>(app, `document.querySelector('.section-card') !== null`),
        5_000,
        'draft editor',
      );
      await evalInProgram(app, setInput('.two-col > .stack > .card:first-child input[type="text"]', 'Repository Architecture Report'));
      await evalInProgram(app, `(() => {
        const boxes = [...document.querySelectorAll('.section-card input[type="checkbox"]')];
        const box = boxes.at(-1);
        box.click();
        return box.checked;
      })()`);
      await evalInProgram(app, clickScript('button', 'Generate editable report'));
      await waitFor(
        () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('resources.create')`),
        10_000,
        'artifact permission',
      );
      await evalInHost(app, clickScript('.modal footer button', 'Allow for this program'));
      await evalInProgram(app, clickScript('.nav-btn', 'Artifacts'));
      await waitFor(
        () => evalInProgram<boolean>(app, `(document.querySelector('#content')?.textContent ?? '').includes('Repository Architecture Report') && (document.querySelector('#content')?.textContent ?? '').includes('.fodt')`),
        20_000,
        'artifact produced',
      );

      // Visual Dashboard may read only the explicitly published summary.
      await evalInHost(app, clickScript('.topbar button', 'Visual Dashboard'));
      await waitFor(
        () => evalInProgram<boolean>(app, `document.body.dataset.ready === 'true' && document.getElementById('stage') !== null`),
        20_000,
        'dashboard started',
      );
      await evalInProgram(app, clickScript('#load'));
      await waitFor(
        () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('program.read-shared-summary')`),
        10_000,
        'shared-summary permission',
      );
      await evalInHost(app, clickScript('.modal footer button', 'Allow once'));
      await waitFor(
        () => evalInProgram<boolean>(app, `(document.getElementById('status')?.textContent ?? '').includes('summary loaded')`),
        10_000,
        'explicit summary loaded',
      );

      // Relaunch with the same data and prove the creator's research survives.
      await launched.close();
      launched = await launchPapers(userDataDir);
      app = launched.app;
      await waitFor(
        () => evalInHost<boolean>(app, `(document.querySelector('.backpack-name')?.textContent ?? '') === 'Repository Lab'`),
        30_000,
        'Backpack restored',
      );
      await evalInHost(app, clickScript('.topbar button', 'Repository Research'));
      await waitFor(
        () => evalInProgram<boolean>(app, `document.body.dataset.ready === 'true' && document.querySelector('.grid-counts') !== null`),
        20_000,
        'research program restored',
      );
      const restored = await evalInProgram<string>(app, `document.querySelector('.grid-counts').textContent`);
      expect(restored).toContain('1notes');
      expect(restored).toContain('1evidence');
      expect(restored).toContain('1artifacts');
    } finally {
      await launched.close();
    }
  });
});
