/**
 * Optional real-repository demonstration. Run with:
 *   PAPERS_RUN_LOGSEQ_DEMO=1 PAPERS_TEST_LIBREOFFICE=1 npx vitest run \
 *     --config vitest.e2e.config.ts tests/e2e/logseq-demonstration.e2e.ts
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const repoRoot = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.resolve(repoRoot, '..', 'papers3-fixtures', 'logseq');
const evidencePath = path.join(repoRoot, 'docs', 'evidence', 'logseq-demonstration.json');
const pinnedCommit = 'a4963dca579f42817135d8473166a03fa7ea2409';
const enabled = process.env['PAPERS_RUN_LOGSEQ_DEMO'] === '1';
const launchLibreOffice = process.env['PAPERS_TEST_LIBREOFFICE'] === '1';

let launched: LaunchedApp;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: fixtureRoot,
    windowsHide: true,
    timeout: 120_000,
  });
  return stdout.trim();
}

function setInput(selector: string, value: string): string {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

async function captureRange(
  app: LaunchedApp['app'],
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<void> {
  await evalInProgram(app, setInput('input[placeholder="Filter files…"]', filePath));
  await waitFor(
    () => evalInProgram<boolean>(app, `[...document.querySelectorAll('.file-row button')].some((button) => button.textContent === ${JSON.stringify(filePath)})`),
    10_000,
    `${filePath} filtered`,
  );
  await evalInProgram(app, `(() => {
    const button = [...document.querySelectorAll('.file-row button')]
      .find((candidate) => candidate.textContent === ${JSON.stringify(filePath)});
    button?.click();
    return Boolean(button);
  })()`);
  await waitFor(
    () => evalInProgram<boolean>(app, `document.querySelector('tr[data-line="${endLine}"]') !== null`),
    20_000,
    `${filePath} rendered`,
  );
  await evalInProgram(app, `(() => {
    document.querySelector('tr[data-line="${startLine}"] .gutter button').click();
    document.querySelector('tr[data-line="${endLine}"] .gutter button').dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    return document.getElementById('sel-range-label').textContent;
  })()`);
  await evalInProgram(app, clickScript('button', 'Capture evidence'));
  await waitFor(
    () => evalInProgram<boolean>(app, `(document.getElementById('toasts')?.textContent ?? '').includes(${JSON.stringify(`${filePath}:${startLine}-${endLine}`)})`),
    10_000,
    `${filePath} evidence captured`,
  );
}

beforeAll(async () => {
  if (!enabled) return;
  expect(await git('rev-parse', 'HEAD')).toBe(pinnedCommit);
  expect(await git('status', '--porcelain')).toBe('');
  expect(await git('remote', 'get-url', '--push', 'origin')).toBe('DISABLED-no-push');
  launched = await launchPapers();
}, 120_000);

afterAll(async () => {
  await launched?.close();
});

describe.skipIf(!enabled)('pinned Logseq creator demonstration', () => {
  it('turns exact Logseq ranges into an editable provenance-backed report', async () => {
    const { app } = launched;
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.home h1') !== null`),
      20_000,
      'home screen',
    );
    await evalInHost(app, setInput('.create-row input', 'Logseq Repository Lab'));
    await evalInHost(app, clickScript('.create-row button', 'Create Backpack'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelectorAll('.backpack-card').length === 1`),
      10_000,
      'Logseq Backpack created',
    );
    await evalInHost(app, clickScript('.backpack-card button', 'Enter'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.topbar') !== null`),
      20_000,
      'Logseq canvas frame',
    );
    await evalInHost(app, clickScript('.program-card', 'Repository Research'));
    await waitFor(async () => (await programViewCount(app)) === 1, 20_000, 'program attached');
    await waitFor(
      () => evalInProgram<boolean>(app, `document.body.dataset.ready === 'true'`),
      20_000,
      'Repository Research ready',
    );

    await evalInProgram(app, setInput('input[placeholder^="Absolute path"]', fixtureRoot));
    await evalInProgram(app, setInput('input[placeholder^="Display name"]', 'Logseq pinned fixture'));
    await evalInProgram(app, clickScript('button', 'Register repository'));
    await waitFor(
      () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('resources.register')`),
      20_000,
      'repository permission',
    );
    await evalInHost(app, clickScript('.modal footer button', 'Allow for this program'));
    await waitFor(
      () => evalInProgram<boolean>(app, `(document.getElementById('content')?.textContent ?? '').includes('Logseq pinned fixture')`),
      30_000,
      'Logseq registered',
    );

    await evalInProgram(app, clickScript('.nav-btn', 'Explorer'));
    await waitFor(
      () => evalInProgram<boolean>(app, `[...document.querySelectorAll('.file-row button')].some((button) => button.textContent === 'README.md')`),
      30_000,
      'Logseq file list',
    );
    await captureRange(app, 'README.md', 8, 18);
    await captureRange(app, 'src/electron/electron/core.cljs', 1, 22);
    await captureRange(app, 'src/main/frontend/core.cljs', 1, 22);

    await evalInProgram(app, clickScript('.nav-btn', 'Evidence'));
    await waitFor(
      () => evalInProgram<boolean>(app, `document.querySelectorAll('.evidence-grid .card').length === 3`),
      20_000,
      'three evidence cards',
    );
    await evalInProgram(app, `(() => {
      for (const input of document.querySelectorAll('.evidence-grid .card input[type="checkbox"]')) input.click();
      return document.querySelectorAll('.evidence-grid .card input[type="checkbox"]:checked').length;
    })()`);
    await waitFor(
      () => evalInProgram<boolean>(app, `(document.getElementById('tray')?.textContent ?? '').includes('3 evidence')`),
      10_000,
      'exact evidence selection',
    );
    await evalInProgram(app, clickScript('#tray button', 'Suggest an outline'));
    await waitFor(
      () => evalInHost<boolean>(app, `(document.querySelector('.modal header')?.textContent ?? '').includes('Agent invocation preview')`),
      20_000,
      'Logseq invocation preview',
    );
    const preview = await evalInHost<string>(app, `document.querySelector('.modal').textContent`);
    expect(preview).toContain('README.md:8-18');
    expect(preview).toContain('src/electron/electron/core.cljs:1-22');
    expect(preview).toContain('src/main/frontend/core.cljs:1-22');
    expect(preview).toContain('sha256');
    await evalInHost(app, clickScript('.modal footer button', 'Invoke Hermes'));

    await waitFor(
      () => evalInProgram<boolean>(app, `(document.querySelector('#modal-root .modal header')?.textContent ?? '').includes('Agent result: Suggest an outline')`),
      300_000,
      'Hermes outline proposal',
      1_000,
    );
    await evalInProgram(app, clickScript('#modal-root footer button', 'Accept'));

    const run = await evalInHost<{
      runId: string;
      sessionId: string;
      state: string;
    }>(app, `window.papersHost.runs.list().then((runs) => runs.find((run) => run.actionLabel === 'Suggest an outline'))`);
    expect(run.state).toBe('completed');
    expect(run.sessionId).toMatch(/[0-9a-f-]{36}/);

    await evalInProgram(app, clickScript('.nav-btn', 'Draft'));
    await waitFor(
      () => evalInProgram<boolean>(app, `document.querySelector('.section-card') !== null`),
      20_000,
      'agent-created draft',
    );
    await evalInProgram(app, setInput('.two-col > .stack > .card:first-child input[type="text"]', 'Logseq Architecture and Implementation Report'));
    for (let index = 0; index < 3; index += 1) {
      await evalInProgram(app, `(() => {
        const section = document.querySelector('.section-card');
        const input = section?.querySelector('.field input[type="checkbox"]:not(:checked)');
        if (!input) return false;
        input.click();
        return true;
      })()`);
    }
    await waitFor(
      () => evalInProgram<boolean>(app, `document.querySelector('.section-card')?.querySelectorAll('.field input[type="checkbox"]:checked').length === 3`),
      10_000,
      'all evidence attached to draft',
    );
    await evalInProgram(app, clickScript('button', 'Generate editable report'));
    await waitFor(
      () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('resources.create')`),
      20_000,
      'artifact permission',
    );
    await evalInHost(app, clickScript('.modal footer button', 'Allow for this program'));
    await evalInProgram(app, clickScript('.nav-btn', 'Artifacts'));
    await waitFor(
      () => evalInProgram<boolean>(app, `(document.getElementById('content')?.textContent ?? '').includes('.fodt')`),
      30_000,
      'Logseq report artifact',
    );
    const artifactPath = await evalInProgram<string>(app, `document.querySelector('#content .prov').textContent`);
    const fodt = await fs.readFile(artifactPath, 'utf8');
    const artifactHash = createHash('sha256').update(fodt, 'utf8').digest('hex');
    const artifactStat = await fs.stat(artifactPath);
    expect(fodt).toContain('office:document');
    expect(fodt).toContain('Logseq Architecture and Implementation Report');
    expect(fodt).toContain(`README.md@${pinnedCommit} lines 8–18`);
    expect(fodt).toContain(`src/electron/electron/core.cljs@${pinnedCommit} lines 1–22`);
    expect(fodt).toContain(`src/main/frontend/core.cljs@${pinnedCommit} lines 1–22`);
    expect(fodt.match(/sha256 [0-9a-f]{64}/g)).toHaveLength(3);

    let libreOfficeLaunched = false;
    if (launchLibreOffice) {
      await evalInProgram(app, clickScript('button', 'Open in LibreOffice Writer'));
      await waitFor(
        () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('external.launch-approved')`),
        20_000,
        'LibreOffice permission',
      );
      await evalInHost(app, clickScript('.modal footer button', 'Allow once'));
      await waitFor(
        () => evalInProgram<boolean>(app, `(document.getElementById('toasts')?.textContent ?? '').includes('Opened in LibreOffice Writer')`),
        30_000,
        'LibreOffice launch',
      );
      libreOfficeLaunched = true;
    }

    expect(await git('rev-parse', 'HEAD')).toBe(pinnedCommit);
    expect(await git('status', '--porcelain')).toBe('');
    expect(await git('remote', 'get-url', '--push', 'origin')).toBe('DISABLED-no-push');

    await fs.mkdir(path.dirname(evidencePath), { recursive: true });
    await fs.writeFile(evidencePath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      fixture: {
        path: fixtureRoot,
        commit: pinnedCommit,
        cleanAfter: true,
        pushDisabled: true,
      },
      selections: [
        { filePath: 'README.md', startLine: 8, endLine: 18 },
        { filePath: 'src/electron/electron/core.cljs', startLine: 1, endLine: 22 },
        { filePath: 'src/main/frontend/core.cljs', startLine: 1, endLine: 22 },
      ],
      run,
      artifact: {
        title: 'Logseq Architecture and Implementation Report',
        path: artifactPath,
        bytes: artifactStat.size,
        sha256: artifactHash,
        structuralValidationPassed: true,
        provenanceEntries: 3,
      },
      libreOfficeLaunched,
    }, null, 2));
  }, 600_000);
});
