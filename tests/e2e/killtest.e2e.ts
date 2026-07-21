/**
 * Phase A vertical kill test (plan section 24, Phase A) against the built
 * application and the REAL installed Hermes:
 *
 * - sandboxed program loads;
 * - program state persists and restores;
 * - prompted capability succeeds;
 * - program crash leaves the Canvas frame alive; restart works;
 * - a real Hermes session/turn runs through ACP with public events;
 * - cancellation works mid-turn;
 * - a structured result returns;
 * - the session is visible to Hermes' own session store;
 * - last-active Backpack restores after relaunch.
 */
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  clickScript,
  crashActiveProgram,
  evalInHost,
  evalInProgram,
  launchPapers,
  programViewCount,
  waitFor,
  type LaunchedApp,
} from './helpers';

const execFileAsync = promisify(execFile);

describe('vertical kill test', () => {
  let launched: LaunchedApp;

  it('runs the complete vertical slice', async () => {
    launched = await launchPapers();
    const { app } = launched;

    // ---------------------------------------------------------------- home
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.home h1') !== null`),
      20_000,
      'home screen',
    );

    // Create and enter a Backpack through the real UI.
    await evalInHost(
      app,
      `(() => {
        const input = document.querySelector('.create-row input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Kill Test Lab');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    await evalInHost(app, clickScript('.create-row button', 'Create Backpack'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelectorAll('.backpack-card').length === 1`),
      10_000,
      'backpack card',
    );
    await evalInHost(app, clickScript('.backpack-card button', 'Enter'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.topbar') !== null`),
      10_000,
      'canvas frame',
    );

    // ------------------------------------------------------- start program
    await evalInHost(app, clickScript('.program-card', 'Kill Test'));
    await waitFor(async () => (await programViewCount(app)) === 1, 20_000, 'program view attached');
    await waitFor(
      () => evalInProgram<boolean>(app, `document.getElementById('counter') !== null`),
      20_000,
      'program UI ready',
    );
    await waitFor(
      () => evalInProgram<boolean>(app, `document.getElementById('counter').textContent === '0'`),
      10_000,
      'counter initialized',
    );

    // ------------------------------------------------ state save + restore
    await evalInProgram(app, clickScript('#increment'));
    await evalInProgram(app, clickScript('#increment'));
    await waitFor(
      () => evalInProgram<boolean>(app, `document.getElementById('counter').textContent === '2'`),
      5_000,
      'counter incremented',
    );

    // ------------------------------------------------- prompted capability
    await evalInProgram(app, clickScript('#clipboard'));
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.modal') !== null`),
      10_000,
      'permission prompt',
    );
    const promptText = await evalInHost<string>(
      app,
      `document.querySelector('.modal').textContent`,
    );
    expect(promptText).toContain('clipboard.write');
    expect(promptText).toContain('kill-test');
    await evalInHost(app, clickScript('.modal footer button', 'Allow once'));
    await waitFor(
      () =>
        evalInProgram<boolean>(
          app,
          `document.getElementById('clipboard-result').textContent.includes('copied')`,
        ),
      10_000,
      'clipboard capability executed',
    );

    // ------------------------------------------------------ crash isolation
    await crashActiveProgram(app);
    await waitFor(async () => (await programViewCount(app)) === 0, 15_000, 'program view removed');
    await waitFor(
      () => evalInHost<boolean>(app, `document.querySelector('.recovery') !== null`),
      15_000,
      'crash recovery UI',
    );
    const recoveryText = await evalInHost<string>(
      app,
      `document.querySelector('.recovery').textContent`,
    );
    expect(recoveryText).toContain('crashed');
    expect(recoveryText).toContain('intact');

    // Restart and verify persisted state survived the crash.
    await evalInHost(app, clickScript('.recovery button', 'Restart program'));
    await waitFor(async () => (await programViewCount(app)) === 1, 20_000, 'program restarted');
    await waitFor(
      () => evalInProgram<boolean>(app, `document.getElementById('counter')?.textContent === '2'`),
      20_000,
      'state restored after crash',
    );

    // -------------------------------------------------- real Hermes / ACP
    await evalInProgram(app, clickScript('#invoke'));
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `(document.querySelector('.modal header')?.textContent ?? '').includes('Agent invocation preview')`,
        ),
      15_000,
      'invocation preview',
    );
    const previewText = await evalInHost<string>(app, `document.querySelector('.modal').textContent`);
    expect(previewText).toContain('Summarize the shared note');
    expect(previewText).toContain('sha256');
    expect(previewText).toContain('kill-test (result-display)');
    await evalInHost(app, clickScript('.modal footer button', 'Invoke Hermes'));

    // The run must reach completed with a real session id and a result.
    await waitFor(
      () =>
        evalInProgram<boolean>(
          app,
          `document.getElementById('run-log').textContent.includes('completed')`,
        ),
      300_000,
      'hermes run completed',
      1_000,
    );
    const resultJson = await evalInProgram<string>(
      app,
      `document.getElementById('result').textContent`,
    );
    const result = JSON.parse(resultJson) as {
      sessionId: string;
      summary: string;
      structuredOutput: unknown;
    };
    expect(result.sessionId).toMatch(/[0-9a-f-]{36}/);
    expect(result.summary.length).toBeGreaterThan(10);

    // ----------------------- session visible in Hermes' own session store
    const { stdout } = await execFileAsync('hermes', ['sessions', 'list', '--limit', '10'], {
      shell: false,
      windowsHide: true,
      timeout: 60_000,
    });
    expect(stdout).toContain(result.sessionId.slice(0, 8));

    // ------------------------------------------------- cancellation (real)
    await evalInProgram(
      app,
      `(async () => {
        const note = 'Cancellation test note. ' + 'x'.repeat(50);
        const data = new TextEncoder().encode(note);
        const digest = await crypto.subtle.digest('SHA-256', data);
        const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const identity = await window.papers.identity();
        window.__cancelRun = window.papers.agent.invoke({
          version: 1,
          origin: { backpackId: identity.backpackId, programId: identity.programId, commandId: 'kill-test.cancel-probe' },
          action: {
            id: 'slow-task',
            label: 'Slow task for cancellation',
            creatorInstruction: 'Write out the numbers from 1 to 400, one per line, with a short sentence for each. Do not use tools.',
          },
          selection: { type: 'test-notes', references: [{ type: 'test-note', id: 'note-2' }] },
          sharedMaterial: [{
            reference: { type: 'test-note', id: 'note-2' },
            title: 'Cancellation note',
            mediaType: 'text/plain',
            preview: note.slice(0, 80),
            contentHash: hash,
            content: note,
          }],
          destination: { programId: identity.programId, type: 'result-display' },
          permissions: ['agent.invoke'],
        }).then((r) => { window.__cancelRunId = r.runId; return r; });
        return true;
      })()`,
    );
    await waitFor(
      () =>
        evalInHost<boolean>(
          app,
          `(document.querySelector('.modal header')?.textContent ?? '').includes('Agent invocation preview')`,
        ),
      15_000,
      'second invocation preview',
    );
    await evalInHost(app, clickScript('.modal footer button', 'Invoke Hermes'));
    await waitFor(
      () => evalInProgram<boolean>(app, `typeof window.__cancelRunId === 'string'`),
      30_000,
      'second run accepted',
    );
    // Wait until it is actually running (session created), then cancel.
    await waitFor(
      () =>
        evalInProgram<boolean>(
          app,
          `document.getElementById('run-log').textContent.includes('→ running')`,
        ),
      60_000,
      'second run running',
    );
    await evalInProgram(app, `window.papers.agent.cancel(window.__cancelRunId).then(() => true)`);
    await waitFor(
      () =>
        evalInProgram<boolean>(
          app,
          `document.getElementById('run-log').textContent.includes('→ cancelled')`,
        ),
      60_000,
      'run cancelled',
      500,
    );

    // ------------------------------------------------------- relaunch test
    const { userDataDir } = launched;
    await launched.close();

    const relaunched = await launchPapers(userDataDir);
    try {
      await waitFor(
        () =>
          evalInHost<boolean>(
            relaunched.app,
            `(document.querySelector('.topbar .backpack-name')?.textContent ?? '') === 'Kill Test Lab'`,
          ),
        30_000,
        'last-active backpack restored after relaunch',
      );
      // The last active program must auto-restore (done-criterion 4) and its
      // state must have survived the full restart.
      await waitFor(
        () =>
          evalInProgram<boolean>(
            relaunched.app,
            `document.getElementById('counter')?.textContent === '2'`,
          ),
        30_000,
        'last-active program and state restored after relaunch',
      );
    } finally {
      await relaunched.close();
    }
  });
});
