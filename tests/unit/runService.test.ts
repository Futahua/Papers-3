import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { AgentRunService, type InvocationPreview } from '../../src/main/agents/runService';
import { papersPaths } from '../../src/main/persistence/paths';
import type { HermesAdapter } from '../../src/main/hermes/hermesAdapter';
import type { AgentInvocation, AgentRunSnapshot } from '../../src/shared/types';

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

class FakeAdapter extends EventEmitter {
  sessions = 0;
  promptBehavior: 'succeed' | 'fail' | 'hang' = 'succeed';
  activePrompt: { sessionId: string; resolve: (v: unknown) => void } | null = null;
  lastPrompt = '';

  async createSession(_cwd: string): Promise<string> {
    this.sessions += 1;
    return `fake-session-${this.sessions}`;
  }

  async prompt(sessionId: string, text: string): Promise<{ stopReason: string }> {
    this.lastPrompt = text;
    if (this.promptBehavior === 'fail') throw new Error('adapter exploded');
    if (this.promptBehavior === 'hang') {
      return new Promise((resolve) => {
        this.activePrompt = { sessionId, resolve: resolve as (v: unknown) => void };
      });
    }
    this.emit('session-update', {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answer. ' } },
    });
    this.emit('session-update', {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '```json\n{"noteTitle":"T"}\n```' },
      },
    });
    return { stopReason: 'end_turn' };
  }

  cancel(sessionId: string): void {
    if (this.activePrompt?.sessionId === sessionId) {
      this.activePrompt.resolve({ stopReason: 'cancelled' });
      this.activePrompt = null;
    }
  }
}

let dir: string;
let adapter: FakeAdapter;
let service: AgentRunService;
let previews: InvocationPreview[];
let previewAnswer: boolean;
let notifications: { programId: string; channel: string; payload: unknown }[];
let broadcasts: AgentRunSnapshot[];

const content = 'Shared research content.';

function invocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    version: 1,
    origin: { backpackId: 'bp-1', programId: 'prog-a', commandId: 'cmd.test' },
    action: { id: 'act', label: 'Test action' },
    selection: { type: 'things', references: [{ type: 'thing', id: 'thing-1' }] },
    sharedMaterial: [
      {
        reference: { type: 'thing', id: 'thing-1' },
        title: 'Thing one',
        mediaType: 'text/plain',
        preview: content.slice(0, 50),
        contentHash: sha256(content),
        content,
      },
    ],
    destination: { programId: 'prog-a', type: 'notes' },
    permissions: ['agent.invoke'],
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-runs-'));
  adapter = new FakeAdapter();
  previews = [];
  previewAnswer = true;
  notifications = [];
  broadcasts = [];
  service = new AgentRunService({
    paths: papersPaths(dir),
    adapter: adapter as unknown as HermesAdapter,
    previewConfirmer: async (preview) => {
      previews.push(preview);
      return previewAnswer;
    },
    isKnownProgram: (id) => id === 'prog-a' || id === 'prog-b',
    onRunsChanged: (snapshot) => broadcasts.push(snapshot),
    notifyProgram: (programId, channel, payload) =>
      notifications.push({ programId, channel, payload }),
    defaultCwd: () => dir,
  });
});

afterEach(async () => {
  await service.flush();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

async function waitState(runId: string, state: string, timeout = 5_000): Promise<AgentRunSnapshot> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const run = service.get(runId);
    if (run?.state === state) return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} never reached ${state}; is ${service.get(runId)?.state}`);
}

describe('AgentRunService', () => {
  it('previews, runs, projects events, and delivers a result proposal', async () => {
    const { runId } = await service.invoke('bp-1', 'prog-a', invocation());
    expect(previews).toHaveLength(1);
    expect(previews[0]?.composedPrompt).toContain('Test action');
    expect(previews[0]?.composedPrompt).toContain(content);

    const run = await waitState(runId, 'completed');
    expect(run.sessionId).toBe('fake-session-1');
    expect(run.events.some((e) => e.kind === 'agent_message_chunk')).toBe(true);
    expect(run.result?.summary).toContain('Answer.');
    expect(run.result?.structuredOutput).toEqual({ noteTitle: 'T' });

    const proposal = notifications.find((n) => n.channel === 'program:result-proposal');
    expect(proposal?.programId).toBe('prog-a');

    // Immutable record persisted with the exact composed prompt.
    const file = path.join(dir, 'PapersData', 'backpacks', 'bp-1', 'runs', `${runId}.json`);
    const record = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(record.composedPrompt).toBe(previews[0]?.composedPrompt);
    expect(record.snapshot.invocation.sharedMaterial[0].contentHash).toBe(sha256(content));
  });

  it('rejects hash mismatches, unknown destinations, and origin spoofing', async () => {
    const bad = invocation();
    bad.sharedMaterial[0]!.contentHash = sha256('different content');
    await expect(service.invoke('bp-1', 'prog-a', bad)).rejects.toThrow(/does not match its hash/);

    await expect(
      service.invoke('bp-1', 'prog-a', invocation({ destination: { programId: 'ghost', type: 'notes' } })),
    ).rejects.toThrow(/does not exist/);

    await expect(service.invoke('bp-1', 'prog-b', invocation())).rejects.toThrow(/origin/);
    expect(previews).toHaveLength(0);
  });

  it('rejects unconfirmed previews without creating a session', async () => {
    previewAnswer = false;
    await expect(service.invoke('bp-1', 'prog-a', invocation())).rejects.toThrow(/not confirmed/);
    expect(adapter.sessions).toBe(0);
    expect(service.list('bp-1')).toHaveLength(0);
  });

  it('discloses truncation and omission in the preview', async () => {
    const inv = invocation();
    inv.sharedMaterial[0]!.truncated = true;
    inv.sharedMaterial[0]!.originalByteLength = 999_999;
    inv.sharedMaterial.push({
      reference: { type: 'thing', id: 'thing-2' },
      title: 'Omitted thing',
      mediaType: 'text/plain',
      preview: 'preview only',
      contentHash: sha256('never shared'),
    });
    await service.invoke('bp-1', 'prog-a', inv);
    const disclosures = previews[0]?.disclosures.join('\n') ?? '';
    expect(disclosures).toContain('truncated');
    expect(disclosures).toContain('omitted');
  });

  it('cancels a running turn', async () => {
    adapter.promptBehavior = 'hang';
    const { runId } = await service.invoke('bp-1', 'prog-a', invocation());
    await waitState(runId, 'running');
    await service.cancel(runId);
    const run = await waitState(runId, 'cancelled');
    expect(run.completedAt).not.toBeNull();
  });

  it('marks failures with retry guidance and retries the same immutable invocation', async () => {
    adapter.promptBehavior = 'fail';
    const { runId } = await service.invoke('bp-1', 'prog-a', invocation());
    const failed = await waitState(runId, 'failed');
    expect(failed.failure?.component).toBe('hermes');
    expect(failed.failure?.retryUseful).toBe(true);

    adapter.promptBehavior = 'succeed';
    const { runId: retryId } = await service.retry(runId);
    expect(retryId).not.toBe(runId);
    const retried = await waitState(retryId, 'completed');
    expect(retried.invocation).toEqual(failed.invocation);
  });

  it('forwards permission requests as pending interactions and resumes on response', async () => {
    adapter.promptBehavior = 'hang';
    const { runId } = await service.invoke('bp-1', 'prog-a', invocation());
    await waitState(runId, 'running');

    let respondedWith: string | null = null;
    adapter.emit(
      'permission-request',
      {
        sessionId: 'fake-session-1',
        title: 'Run command',
        detail: '{"command":"do it"}',
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
      (optionId: string | null) => {
        respondedWith = optionId;
      },
    );

    const waiting = await waitState(runId, 'waiting-approval');
    expect(waiting.pendingInteraction?.title).toBe('Run command');

    await service.respondInteraction(
      runId,
      waiting.pendingInteraction!.requestId,
      'allow_once',
    );
    expect(respondedWith).toBe('allow_once');
    const resumed = await waitState(runId, 'running');
    expect(resumed.pendingInteraction).toBeNull();
    await service.cancel(runId);
  });

  it('appends exact worker delegation blocks for coding tasks', async () => {
    const { runId } = await service.invoke(
      'bp-1',
      'prog-a',
      invocation({
        execution: { cwd: 'D:\\tmp\\worktree', preferredWorker: 'opencode' },
      }),
    );
    await waitState(runId, 'completed');
    const prompt = previews[0]?.composedPrompt ?? '';
    expect(prompt).toContain('Worker delegation (OpenCode)');
    expect(prompt).toContain('opencode run --dir "D:\\tmp\\worktree"');
    expect(previews[0]?.disclosures.join(' ')).toContain('opencode');
  });

  it('marks interrupted runs failed on reload (restart honesty)', async () => {
    adapter.promptBehavior = 'hang';
    const { runId } = await service.invoke('bp-1', 'prog-a', invocation());
    await waitState(runId, 'running');
    // Wait for the run record to be persisted (throttled at 2s).
    await new Promise((r) => setTimeout(r, 2_300));

    const second = new AgentRunService({
      paths: papersPaths(dir),
      adapter: new FakeAdapter() as unknown as HermesAdapter,
      previewConfirmer: async () => true,
      isKnownProgram: () => true,
      onRunsChanged: () => undefined,
      notifyProgram: () => undefined,
      defaultCwd: () => dir,
    });
    await second.loadBackpackRuns('bp-1');
    const restored = second.get(runId);
    expect(restored?.state).toBe('failed');
    expect(restored?.failure?.code).toBe('interrupted');
    await service.cancel(runId);
  });
});
