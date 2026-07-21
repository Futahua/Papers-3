/**
 * Worker comparison (plan section 16.3, done-criteria 15-17): the same real
 * coding task through (1) Hermes directly, (2) Hermes -> Codex CLI, and
 * (3) Hermes -> OpenCode CLI, each in its own disposable git worktree of a
 * throwaway fixture repository. Evidence is written to
 * docs/evidence/worker-comparison.json.
 *
 * These are real model/CLI runs; expect several minutes per lane.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';

import {
  clickScript,
  evalInHost,
  evalInProgram,
  launchPapers,
  waitFor,
  type LaunchedApp,
} from './helpers';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(__dirname, '..', '..');
const evidenceFile = path.join(repoRoot, 'docs', 'evidence', 'worker-comparison.json');

let fixtureDir: string;
let repo: string;
let launched: LaunchedApp;

interface LaneResult {
  lane: string;
  worker: string;
  runId: string;
  sessionId: string | null;
  finalState: string;
  durationMs: number;
  interventions: number;
  checksPassed: boolean;
  diffStat: string;
  baseRepoCleanAfter: boolean;
  papersRepoUnchanged: boolean;
  delegationProven: boolean;
  summarySnippet: string;
}

const laneResults: LaneResult[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, windowsHide: true, timeout: 120_000 });
  return stdout.trim();
}

async function papersWorkspaceFingerprint(): Promise<string> {
  const status = await git(repoRoot, 'status', '--porcelain=v1', '-uall');
  const trackedDiff = await git(repoRoot, 'diff', '--binary', 'HEAD', '--', '.');
  const untrackedRaw = await git(repoRoot, 'ls-files', '--others', '--exclude-standard', '-z');
  const untracked = untrackedRaw.split('\0').filter(Boolean).sort();
  const hash = createHash('sha256').update(status).update('\0').update(trackedDiff);
  for (const relativePath of untracked) {
    hash.update('\0').update(relativePath).update('\0');
    hash.update(await fs.readFile(path.join(repoRoot, relativePath)));
  }
  return hash.digest('hex');
}

beforeAll(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-workers-'));
  repo = path.join(fixtureDir, 'calc-repo');
  await fs.mkdir(repo, { recursive: true });
  await git(repo, 'init', '--initial-branch=main');
  await git(repo, 'config', 'user.email', 'fixture@papers3.test');
  await git(repo, 'config', 'user.name', 'Papers Fixture');
  await fs.writeFile(
    path.join(repo, 'util.js'),
    [
      "'use strict';",
      '// Small calculator utilities.',
      'function add(a, b) {',
      "  throw new Error('not implemented');",
      '}',
      'module.exports = { add };',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(repo, 'test.js'),
    [
      "'use strict';",
      "const { add } = require('./util.js');",
      "if (add(2, 3) !== 5) { console.error('FAIL: add(2,3)'); process.exit(1); }",
      "if (add(-1, 1) !== 0) { console.error('FAIL: add(-1,1)'); process.exit(1); }",
      "console.log('ALL TESTS PASS');",
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(repo, 'README.md'),
    '# calc-repo\n\nImplement util.js so `node test.js` prints ALL TESTS PASS.\n',
  );
  await git(repo, 'add', '-A');
  await git(repo, 'commit', '-m', 'fixture: failing add implementation');

  launched = await launchPapers();
  const { app } = launched;
  await waitFor(
    () => evalInHost<boolean>(app, `document.querySelector('.home h1') !== null`),
    20_000,
    'home screen',
  );
  await evalInHost(
    app,
    `(async () => {
      const b = await window.papersHost.backpacks.create('Worker Lab', 'canvas');
      await window.papersHost.backpacks.enter(b.id);
      await window.papersHost.programs.start('repository-research');
      return true;
    })()`,
  );
  await waitFor(
    () => evalInProgram<boolean>(app, `document.body.dataset.ready === 'true'`),
    20_000,
    'Repository Research program ready',
  );

  // Register the fixture through the real capability boundary. Worker
  // execution later references the granted worktree resource, never a path
  // supplied directly by sandboxed program code.
  await evalInProgram(
    app,
    `(async () => {
      const identity = await window.papers.identity();
      window.__workerBase = window.papers.capabilities.request({
        invocationId: crypto.randomUUID(),
        backpackId: identity.backpackId,
        programId: identity.programId,
        capability: 'resources.register',
        arguments: { type: 'git-repository', path: ${JSON.stringify(repo)}, name: 'Worker fixture' },
        reason: 'Register the disposable worker fixture',
      });
      return true;
    })()`,
  );
  await waitFor(
    () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('resources.register')`),
    20_000,
    'worker fixture registration permission',
  );
  await evalInHost(app, clickScript('.modal footer button', 'Allow for this program'));
  await waitFor(
    () => evalInProgram<boolean>(app, `window.__workerBase.then((value) => Boolean(value?.resourceId))`),
    20_000,
    'worker fixture registered',
  );
}, 120_000);

afterAll(async () => {
  await launched?.close();
  await fs.mkdir(path.dirname(evidenceFile), { recursive: true });
  await fs.writeFile(evidenceFile, JSON.stringify({ generatedAt: new Date().toISOString(), task: 'Implement add(a,b) in util.js so node test.js passes', lanes: laneResults }, null, 2));
  await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => undefined);
});

async function runLane(
  lane: string,
  worker: 'hermes' | 'codex' | 'opencode',
  worktreeName: string,
): Promise<void> {
  const { app } = launched;
  const baseHead = await git(repo, 'rev-parse', 'HEAD');
  const papersBefore = await papersWorkspaceFingerprint();

  await evalInProgram(
    app,
    `(async () => {
      const identity = await window.papers.identity();
      const base = await window.__workerBase;
      window.__workerWorktree = window.papers.capabilities.request({
        invocationId: crypto.randomUUID(),
        backpackId: identity.backpackId,
        programId: identity.programId,
        capability: 'resources.create',
        arguments: { kind: 'git-worktree', resourceId: base.resourceId, name: ${JSON.stringify(worktreeName)} },
        reason: 'Create an isolated worktree for this worker lane',
      });
      return true;
    })()`,
  );
  if (laneResults.length === 0) {
    await waitFor(
      () => evalInHost<boolean>(app, `(document.querySelector('.modal')?.textContent ?? '').includes('resources.create')`),
      20_000,
      `${lane}: worktree permission`,
    );
    await evalInHost(app, clickScript('.modal footer button', 'Allow for this program'));
  }
  const worktreeInfo = await evalInProgram<{ resourceId: string; worktreePath: string }>(
    app,
    `window.__workerWorktree`,
  );
  const worktree = worktreeInfo.worktreePath;

  const started = Date.now();
  let interventions = 0;

  // Submit the invocation from inside the sandboxed program.
  await evalInProgram(
    app,
    `(async () => {
      const task = ${JSON.stringify(
        'Implement the add(a, b) function in util.js (it currently throws) so that running `node test.js` prints ALL TESTS PASS. Keep the module.exports shape. Then run `node test.js` and report its output.',
      )};
      const data = new TextEncoder().encode(task);
      const digest = await crypto.subtle.digest('SHA-256', data);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const identity = await window.papers.identity();
      window.__laneDone = null;
      window.__laneRunId = null;
      window.__laneResult = null;
      window.papers.events.onResultProposal((p) => { window.__laneResult = p; });
      window.papers.agent.invoke({
        version: 1,
        origin: { backpackId: identity.backpackId, programId: identity.programId, commandId: 'repository-research.worker-lane' },
        action: {
          id: 'implement-task',
          label: ${JSON.stringify(`Worker lane: ${lane}`)},
          creatorInstruction: 'Complete the coding task described in the shared material inside the working directory. Work only there. When finished, report what changed and the test output, then include a json block {"checksPassed": true|false}.',
        },
        selection: { type: 'coding-task', references: [{ type: 'coding-task', id: ${JSON.stringify(worktreeName)} }] },
        sharedMaterial: [{
          reference: { type: 'coding-task', id: ${JSON.stringify(worktreeName)} },
          title: 'Coding task',
          mediaType: 'text/plain',
          preview: task.slice(0, 200),
          contentHash: hash,
          content: task,
        }],
        destination: { programId: identity.programId, type: 'result-display' },
        permissions: ['agent.invoke'],
        execution: { resourceId: ${JSON.stringify(worktreeInfo.resourceId)}, preferredWorker: ${JSON.stringify(worker)} },
      }).then(
        (r) => { window.__laneRunId = r.runId; },
        (e) => { window.__laneDone = 'invoke-rejected: ' + String(e && e.message || e); },
      );
      return true;
    })()`,
  );

  // Approve the invocation preview in the host.
  await waitFor(
    () =>
      evalInHost<boolean>(
        app,
        `(document.querySelector('.modal header')?.textContent ?? '').includes('Agent invocation preview')`,
      ),
    20_000,
    `${lane}: invocation preview`,
  );
  const previewText = await evalInHost<string>(app, `document.querySelector('.modal').textContent`);
  if (worker !== 'hermes') {
    expect(previewText.toLowerCase()).toContain(worker);
  }
  await evalInHost(app, clickScript('.modal footer button', 'Invoke Hermes'));

  await waitFor(
    () => evalInProgram<boolean>(app, `typeof window.__laneRunId === 'string'`),
    30_000,
    `${lane}: run accepted`,
  );
  const runId = await evalInProgram<string>(app, `window.__laneRunId`);
  expect(
    laneResults.some((previous) => previous.runId === runId),
    `${lane}: every lane must have its own Papers run`,
  ).toBe(false);

  // Pump: approve any pending interaction (Hermes terminal/edit approvals).
  const deadline = Date.now() + 20 * 60_000;
  let finalState = '';
  while (Date.now() < deadline) {
    const snapshot = await evalInHost<{ state: string; pending: { requestId: string; optionId: string | null } | null; sessionId: string | null }>(
      app,
      `window.papersHost.runs.get(${JSON.stringify(runId)}).then((r) => r && ({
        state: r.state,
        sessionId: r.sessionId,
        pending: r.pendingInteraction ? {
          requestId: r.pendingInteraction.requestId,
          optionId: (r.pendingInteraction.options.find((o) => /allow/i.test(o.optionId + o.kind + o.name)) || r.pendingInteraction.options[0] || {}).optionId ?? null,
        } : null,
      }))`,
    );
    if (!snapshot) throw new Error(`${lane}: run disappeared`);
    if (snapshot.pending?.optionId) {
      interventions += 1;
      await evalInHost(
        app,
        `window.papersHost.runs.respondInteraction(${JSON.stringify(runId)}, ${JSON.stringify(snapshot.pending.requestId)}, ${JSON.stringify(snapshot.pending.optionId)}).catch(() => undefined)`,
      );
    }
    if (['completed', 'failed', 'cancelled'].includes(snapshot.state)) {
      finalState = snapshot.state;
      break;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }

  const run = await evalInHost<{ state: string; sessionId: string | null; result: { summary: string } | null; failure: unknown }>(
    app,
    `window.papersHost.runs.get(${JSON.stringify(runId)})`,
  );

  // Ground truth: does the test pass in the worktree now?
  let checksPassed = false;
  try {
    const { stdout } = await execFileAsync(process.execPath, ['test.js'], {
      cwd: worktree,
      timeout: 30_000,
      windowsHide: true,
    });
    checksPassed = stdout.includes('ALL TESTS PASS');
  } catch {
    checksPassed = false;
  }
  const diffStat = await git(worktree, 'diff', '--stat', 'HEAD').catch(() => '(diff failed)');
  const baseCleanAfter =
    (await git(repo, 'status', '--porcelain')) === '' &&
    (await git(repo, 'rev-parse', 'HEAD')) === baseHead;
  const papersRepoUnchanged = (await papersWorkspaceFingerprint()) === papersBefore;
  const summary = run?.result?.summary ?? '';
  const delegationProven = worker === 'hermes' || (
    /"delegationSucceeded"\s*:\s*true/.test(summary) &&
    !/manual fix|applied directly|fallback/i.test(summary)
  );

  laneResults.push({
    lane,
    worker,
    runId,
    sessionId: run?.sessionId ?? null,
    finalState: run?.state ?? finalState,
    durationMs: Date.now() - started,
    interventions,
    checksPassed,
    diffStat,
    baseRepoCleanAfter: baseCleanAfter,
    papersRepoUnchanged,
    delegationProven,
    summarySnippet: (summary || JSON.stringify(run?.failure ?? '')).slice(0, 600),
  });

  expect(finalState, `${lane} final state`).toBe('completed');
  expect(checksPassed, `${lane}: node test.js must pass in the worktree`).toBe(true);
  expect(baseCleanAfter, `${lane}: base repository untouched`).toBe(true);
  expect(papersRepoUnchanged, `${lane}: Papers source checkout untouched`).toBe(true);
  expect(delegationProven, `${lane}: the selected worker itself must complete the task`).toBe(true);
}

describe('worker lanes (real integrations)', () => {
  it('lane 1: Hermes implements the task directly', async () => {
    await runLane('hermes-direct', 'hermes', 'lane-hermes');
  }, 1_500_000);

  it('lane 2: Hermes delegates to Codex CLI', async () => {
    await runLane('hermes-codex', 'codex', 'lane-codex');
  }, 1_500_000);

  it('lane 3: Hermes delegates to OpenCode CLI (different provider)', async () => {
    await runLane('hermes-opencode', 'opencode', 'lane-opencode');
  }, 1_500_000);
});
