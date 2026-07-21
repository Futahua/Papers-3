/**
 * AgentRunService — exact agent invocation and run observation
 * (plan sections 13, 14, 15).
 *
 * Validates invocations structurally (schema, hashes, sizes, destination,
 * declared permissions), requires a host-side preview confirmation, records
 * the invocation immutably (including the exact composed prompt), submits it
 * through the HermesAdapter, projects public events, forwards approvals,
 * supports cancellation and retry, and delivers result proposals to the
 * originating program. Papers never interprets program-specific types.
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type {
  AgentInvocation,
  AgentPendingInteraction,
  AgentResultProposal,
  AgentRunEvent,
  AgentRunSnapshot,
  AgentRunState,
  RunFailure,
} from '@shared/types';
import { agentInvocationSchema, maxSharedMaterialBytes } from '@shared/schemas';
import { AtomicJsonStore } from '../persistence/atomicStore';
import { runFile, runsDir, type PapersPaths } from '../persistence/paths';
import type { HermesAdapter } from '../hermes/hermesAdapter';
import type { SessionUpdatePayload } from '../hermes/acpClient';
import { buildWorkerDelegationBlock } from './workerCommands';

export interface InvocationPreview {
  previewId: string;
  runId: string;
  invocation: AgentInvocation;
  composedPrompt: string;
  /** Disclosure lines: truncation, omissions, sizes. */
  disclosures: string[];
}

export interface RunServiceOptions {
  paths: PapersPaths;
  adapter: HermesAdapter;
  /** Ask the creator to confirm an invocation preview. Resolves approval. */
  previewConfirmer: (preview: InvocationPreview) => Promise<boolean>;
  /** Destination/program existence check (program catalog). */
  isKnownProgram: (programId: string) => boolean;
  onRunsChanged: (snapshot: AgentRunSnapshot) => void;
  /** Deliver an event to the originating program if it is running. */
  notifyProgram: (programId: string, channel: string, payload: unknown) => void;
  /** Default working directory for sessions of a given backpack. */
  defaultCwd: (backpackId: string) => string;
  /** Resolve and authorize a program-selected git-worktree resource. */
  resolveExecutionCwd: (
    backpackId: string,
    programId: string,
    resourceId: string,
  ) => Promise<string>;
}

const MAX_EVENTS_PER_RUN = 500;
const PERSIST_THROTTLE_MS = 2_000;

interface RunRecord {
  schemaVersion: 1;
  snapshot: AgentRunSnapshot;
  composedPrompt: string;
  retryOf?: string;
}

export class AgentRunService {
  private readonly runs = new Map<string, AgentRunSnapshot>();
  private readonly composedPrompts = new Map<string, string>();
  private readonly sessionToRun = new Map<string, string>();
  private readonly pendingResponders = new Map<string, (optionId: string | null) => void>();
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();
  private loadedBackpacks = new Set<string>();

  constructor(private readonly options: RunServiceOptions) {
    this.options.adapter.on('session-update', (payload) => this.onSessionUpdate(payload));
    this.options.adapter.on('permission-request', (payload, respond) =>
      this.onPermissionRequest(payload, respond),
    );
  }

  // -------------------------------------------------------------------------
  // Validation and invocation
  // -------------------------------------------------------------------------

  private validate(originBackpackId: string, originProgramId: string, raw: unknown): AgentInvocation {
    const parsed = agentInvocationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `invocation failed validation: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }
    const invocation = parsed.data as AgentInvocation;

    if (
      invocation.origin.backpackId !== originBackpackId ||
      invocation.origin.programId !== originProgramId
    ) {
      throw new Error('invocation origin does not match the requesting program');
    }
    if (!this.options.isKnownProgram(invocation.destination.programId)) {
      throw new Error(`destination program ${invocation.destination.programId} does not exist`);
    }

    let totalBytes = 0;
    for (const item of invocation.sharedMaterial) {
      if (item.content !== undefined) {
        const hash = createHash('sha256').update(item.content, 'utf8').digest('hex');
        if (hash !== item.contentHash) {
          throw new Error(`shared material "${item.title}" content does not match its hash`);
        }
        totalBytes += Buffer.byteLength(item.content, 'utf8');
      }
    }
    if (totalBytes > maxSharedMaterialBytes) {
      throw new Error(
        `shared material totals ${totalBytes} bytes, over the ${maxSharedMaterialBytes} limit`,
      );
    }
    return invocation;
  }

  /** Deterministic, inspectable prompt composition. Recorded with the run. */
  static composePrompt(invocation: AgentInvocation): { prompt: string; disclosures: string[] } {
    const lines: string[] = [];
    const disclosures: string[] = [];

    lines.push(`# ${invocation.action.label}`);
    if (invocation.action.creatorInstruction) {
      lines.push('', invocation.action.creatorInstruction);
    }

    lines.push('', `## Selection (${invocation.selection.type}, ${invocation.selection.references.length} item(s))`);
    for (const ref of invocation.selection.references) {
      const detail = ref.detail !== undefined ? ` ${JSON.stringify(ref.detail)}` : '';
      lines.push(`- ${ref.type}: ${ref.id}${detail}`);
    }

    if (invocation.sharedMaterial.length > 0) {
      lines.push('', '## Shared material');
      for (const item of invocation.sharedMaterial) {
        lines.push('', `### ${item.title}`, `(type: ${item.mediaType}, sha256: ${item.contentHash})`);
        if (item.content !== undefined) {
          if (item.truncated) {
            const original = item.originalByteLength ?? 0;
            disclosures.push(
              `"${item.title}" was truncated to ${Buffer.byteLength(item.content, 'utf8')} of ${original} bytes.`,
            );
            lines.push('(truncated content follows)');
          }
          lines.push('```', item.content, '```');
        } else {
          disclosures.push(`"${item.title}" content was omitted; only its reference and hash are shared.`);
          lines.push('(content omitted; preview only)', `> ${item.preview}`);
        }
      }
    } else {
      disclosures.push('No content is shared with this invocation beyond the listed references.');
    }

    lines.push(
      '',
      '## Response handling',
      `The response will be returned to program "${invocation.destination.programId}" as destination type "${invocation.destination.type}".`,
      'If you produce a structured result, place it in a single fenced ```json block; free-form analysis belongs outside it.',
    );

    return { prompt: lines.join('\n'), disclosures };
  }

  async invoke(
    originBackpackId: string,
    originProgramId: string,
    raw: unknown,
  ): Promise<{ runId: string; sessionId: string | null }> {
    const invocation = this.validate(originBackpackId, originProgramId, raw);
    if (invocation.execution?.preferredWorker || invocation.execution?.resourceId) {
      const resourceId = invocation.execution.resourceId;
      if (!resourceId) {
        throw new Error('worker execution requires a granted git-worktree resource');
      }
      const cwd = await this.options.resolveExecutionCwd(
        originBackpackId,
        originProgramId,
        resourceId,
      );
      invocation.execution = { ...invocation.execution, cwd };
    }
    const runId = `run-${randomUUID()}`;
    // eslint-disable-next-line prefer-const
    let { prompt, disclosures } = AgentRunService.composePrompt(invocation);

    // Hermes also receives the ACP process directory in its system context.
    // State the host-resolved boundary explicitly so model-authored absolute
    // paths agree with the per-session tool cwd.
    const trustedCwd = invocation.execution?.cwd ?? this.options.defaultCwd(originBackpackId);
    prompt += [
      '',
      '## Execution boundary',
      `The host-resolved working directory for this run is exactly: ${trustedCwd}`,
      'Use this directory as the only filesystem workspace. Before the first filesystem or terminal action, verify the working directory. Use paths relative to it and do not read or write the Papers application source checkout.',
    ].join('\n');
    disclosures = [
      ...disclosures,
      `Hermes will run with the host-resolved working directory “${trustedCwd}”.`,
    ];

    // Worker delegation: the exact CLI instruction is part of the previewed
    // prompt (plan section 16, decision D-007).
    const worker = invocation.execution?.preferredWorker;
    if (worker === 'codex' || worker === 'opencode') {
      prompt += `\n${await buildWorkerDelegationBlock(worker, trustedCwd)}`;
      disclosures = [
        ...disclosures,
        `Hermes will be instructed to delegate implementation to the ${worker} CLI inside the isolated worktree.`,
      ];
    }

    const preview: InvocationPreview = {
      previewId: randomUUID(),
      runId,
      invocation,
      composedPrompt: prompt,
      disclosures,
    };
    const approved = await this.options.previewConfirmer(preview);
    if (!approved) {
      throw new Error('invocation was not confirmed');
    }

    const snapshot: AgentRunSnapshot = {
      runId,
      backpackId: invocation.origin.backpackId,
      programId: invocation.origin.programId,
      actionLabel: invocation.action.label,
      state: 'queued',
      sessionId: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      events: [],
      pendingInteraction: null,
      failure: null,
      invocation,
      result: null,
    };
    this.runs.set(runId, snapshot);
    this.composedPrompts.set(runId, prompt);
    await this.persist(runId, true);
    this.broadcast(runId);

    void this.execute(runId, prompt);
    return { runId, sessionId: null };
  }

  /** Retry re-submits the same immutable invocation as a new run. */
  async retry(runId: string): Promise<{ runId: string }> {
    const source = this.runs.get(runId);
    if (!source) throw new Error(`run ${runId} not found`);
    if (source.state !== 'failed' && source.state !== 'cancelled') {
      throw new Error('only failed or cancelled runs can be retried');
    }
    const newRunId = `run-${randomUUID()}`;
    const prompt = this.composedPrompts.get(runId) ?? AgentRunService.composePrompt(source.invocation).prompt;
    const snapshot: AgentRunSnapshot = {
      ...structuredClone(source),
      runId: newRunId,
      state: 'queued',
      sessionId: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      events: [],
      pendingInteraction: null,
      failure: null,
      result: null,
    };
    this.runs.set(newRunId, snapshot);
    this.composedPrompts.set(newRunId, prompt);
    await this.persist(newRunId, true, runId);
    this.broadcast(newRunId);
    void this.execute(newRunId, prompt);
    return { runId: newRunId };
  }

  private async execute(runId: string, prompt: string): Promise<void> {
    const snapshot = this.runs.get(runId);
    if (!snapshot) return;
    try {
      const cwd =
        snapshot.invocation.execution?.cwd ?? this.options.defaultCwd(snapshot.backpackId);
      const sessionId = await this.options.adapter.createSession(cwd);
      snapshot.sessionId = sessionId;
      this.sessionToRun.set(sessionId, runId);
      this.transition(runId, 'running');

      const result = await this.options.adapter.prompt(sessionId, prompt);

      if (result.stopReason === 'cancelled') {
        this.transition(runId, 'cancelled');
      } else if (result.stopReason === 'refusal') {
        this.fail(runId, {
          component: 'hermes',
          code: 'refusal',
          message: 'Hermes refused the session or prompt',
          retryUseful: true,
        });
      } else {
        const summary = this.collectFinalMessage(snapshot);
        const proposal: AgentResultProposal = {
          invocationId: runId,
          sessionId,
          summary,
          structuredOutput: extractJsonBlock(summary),
        };
        snapshot.result = proposal;
        this.transition(runId, 'completed');
        this.options.notifyProgram(snapshot.programId, 'program:result-proposal', proposal);
      }
    } catch (err) {
      this.fail(runId, {
        component: 'hermes',
        code: 'turn-failed',
        message: String(err),
        retryUseful: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Event projection
  // -------------------------------------------------------------------------

  private onSessionUpdate(payload: SessionUpdatePayload): void {
    const runId = this.sessionToRun.get(payload.sessionId);
    if (!runId) return;
    const snapshot = this.runs.get(runId);
    if (!snapshot) return;

    const kind = payload.update.sessionUpdate;
    const text = renderUpdate(payload.update);
    if (text === null) return;

    const last = snapshot.events[snapshot.events.length - 1];
    if (last && last.kind === kind && isCoalescable(kind)) {
      last.text = (last.text + text).slice(-20_000);
      last.timestamp = new Date().toISOString();
    } else {
      snapshot.events.push({
        runId,
        sequence: snapshot.events.length,
        timestamp: new Date().toISOString(),
        kind,
        text: text.slice(0, 20_000),
      });
      if (snapshot.events.length > MAX_EVENTS_PER_RUN) {
        snapshot.events.splice(0, snapshot.events.length - MAX_EVENTS_PER_RUN);
      }
    }
    this.schedulePersist(runId);
    this.broadcast(runId);
  }

  private collectFinalMessage(snapshot: AgentRunSnapshot): string {
    const parts = snapshot.events.filter((e) => e.kind === 'agent_message_chunk');
    const last = parts[parts.length - 1];
    return last?.text ?? '';
  }

  private onPermissionRequest(
    payload: { sessionId: string; title: string; detail: string; options: { optionId: string; name: string; kind: string }[] },
    respond: (optionId: string | null) => void,
  ): void {
    const runId = this.sessionToRun.get(payload.sessionId);
    if (!runId) {
      respond(null);
      return;
    }
    const snapshot = this.runs.get(runId);
    if (!snapshot) {
      respond(null);
      return;
    }
    const requestId = randomUUID();
    const interaction: AgentPendingInteraction = {
      kind: 'approval',
      requestId,
      title: payload.title,
      detail: payload.detail,
      options: payload.options,
    };
    snapshot.pendingInteraction = interaction;
    this.pendingResponders.set(requestId, (optionId) => {
      snapshot.pendingInteraction = null;
      respond(optionId);
      this.transition(runId, 'running');
    });
    this.transition(runId, 'waiting-approval');
  }

  async respondInteraction(runId: string, requestId: string, optionId: string): Promise<void> {
    const snapshot = this.runs.get(runId);
    if (!snapshot) throw new Error(`run ${runId} not found`);
    if (snapshot.pendingInteraction?.requestId !== requestId) {
      throw new Error('interaction is no longer pending');
    }
    const responder = this.pendingResponders.get(requestId);
    if (!responder) throw new Error('interaction responder missing');
    this.pendingResponders.delete(requestId);
    responder(optionId);
  }

  async cancel(runId: string): Promise<void> {
    const snapshot = this.runs.get(runId);
    if (!snapshot) throw new Error(`run ${runId} not found`);
    if (snapshot.sessionId && (snapshot.state === 'running' || snapshot.state === 'waiting-approval')) {
      // Resolve any pending approval as cancelled first.
      if (snapshot.pendingInteraction) {
        const responder = this.pendingResponders.get(snapshot.pendingInteraction.requestId);
        this.pendingResponders.delete(snapshot.pendingInteraction.requestId);
        responder?.(null);
        snapshot.pendingInteraction = null;
      }
      this.options.adapter.cancel(snapshot.sessionId);
      // State moves to cancelled when the prompt returns stopReason=cancelled.
    } else if (snapshot.state === 'queued') {
      this.transition(runId, 'cancelled');
    }
  }

  /** Continue a completed run's session with a follow-up (clarification answer). */
  async continueRun(runId: string, text: string): Promise<void> {
    const snapshot = this.runs.get(runId);
    if (!snapshot) throw new Error(`run ${runId} not found`);
    if (snapshot.state !== 'completed') throw new Error('only completed runs can be continued');
    if (!snapshot.sessionId) throw new Error('run has no session');
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 10_000) throw new Error('reply must be 1..10000 chars');
    this.transition(runId, 'running');
    try {
      const result = await this.options.adapter.prompt(snapshot.sessionId, trimmed);
      if (result.stopReason === 'cancelled') {
        this.transition(runId, 'cancelled');
        return;
      }
      const summary = this.collectFinalMessage(snapshot);
      snapshot.result = {
        invocationId: runId,
        sessionId: snapshot.sessionId,
        summary,
        structuredOutput: extractJsonBlock(summary),
      };
      this.transition(runId, 'completed');
      this.options.notifyProgram(snapshot.programId, 'program:result-proposal', snapshot.result);
    } catch (err) {
      this.fail(runId, {
        component: 'hermes',
        code: 'turn-failed',
        message: String(err),
        retryUseful: true,
      });
    }
  }

  // -------------------------------------------------------------------------
  // State, persistence, listing
  // -------------------------------------------------------------------------

  private transition(runId: string, state: AgentRunState): void {
    const snapshot = this.runs.get(runId);
    if (!snapshot) return;
    snapshot.state = state;
    if (state === 'completed' || state === 'failed' || state === 'cancelled') {
      snapshot.completedAt = new Date().toISOString();
      if (snapshot.sessionId) this.sessionToRun.delete(snapshot.sessionId);
      void this.persist(runId, true);
    } else {
      this.schedulePersist(runId);
    }
    this.broadcast(runId);
    this.options.notifyProgram(snapshot.programId, 'program:run-update', {
      runId,
      state,
      sessionId: snapshot.sessionId,
    });
  }

  private fail(runId: string, failure: RunFailure): void {
    const snapshot = this.runs.get(runId);
    if (!snapshot) return;
    snapshot.failure = failure;
    this.transition(runId, 'failed');
  }

  private broadcast(runId: string): void {
    const snapshot = this.runs.get(runId);
    if (snapshot) this.options.onRunsChanged(snapshot);
  }

  private schedulePersist(runId: string): void {
    if (this.persistTimers.has(runId)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(runId);
      void this.persist(runId, false);
    }, PERSIST_THROTTLE_MS);
    this.persistTimers.set(runId, timer);
  }

  private readonly inflightPersists = new Set<Promise<void>>();

  private async persist(runId: string, immediate: boolean, retryOf?: string): Promise<void> {
    const snapshot = this.runs.get(runId);
    if (!snapshot) return;
    if (immediate) {
      const timer = this.persistTimers.get(runId);
      if (timer) {
        clearTimeout(timer);
        this.persistTimers.delete(runId);
      }
    }
    const record: RunRecord = {
      schemaVersion: 1,
      snapshot,
      composedPrompt: this.composedPrompts.get(runId) ?? '',
      ...(retryOf ? { retryOf } : {}),
    };
    const store = new AtomicJsonStore(runFile(this.options.paths, snapshot.backpackId, runId), {
      recoveryDir: this.options.paths.recoveryDir,
    });
    const write = store.save(record);
    this.inflightPersists.add(write);
    try {
      await write;
    } finally {
      this.inflightPersists.delete(write);
    }
  }

  /** Persist all dirty runs and wait for outstanding writes (shutdown/tests). */
  async flush(): Promise<void> {
    const dirty = [...this.persistTimers.keys()];
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    await Promise.all(dirty.map((runId) => this.persist(runId, false)));
    await Promise.all([...this.inflightPersists]);
  }

  /** Load persisted runs for a backpack (restart restoration). */
  async loadBackpackRuns(backpackId: string): Promise<void> {
    if (this.loadedBackpacks.has(backpackId)) return;
    this.loadedBackpacks.add(backpackId);
    const dir = runsDir(this.options.paths, backpackId);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.backup'));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        const raw = await fs.readFile(path.join(dir, file), 'utf8');
        const record = JSON.parse(raw) as RunRecord;
        const snapshot = record.snapshot;
        if (!snapshot?.runId || this.runs.has(snapshot.runId)) continue;
        // Runs interrupted by an app exit are honestly marked failed.
        if (
          snapshot.state === 'running' ||
          snapshot.state === 'queued' ||
          snapshot.state === 'waiting-approval' ||
          snapshot.state === 'waiting-clarification'
        ) {
          snapshot.state = 'failed';
          snapshot.failure = {
            component: 'papers',
            code: 'interrupted',
            message: 'Papers exited while this run was in progress',
            retryUseful: true,
          };
          snapshot.pendingInteraction = null;
        }
        this.runs.set(snapshot.runId, snapshot);
        this.composedPrompts.set(snapshot.runId, record.composedPrompt ?? '');
      } catch {
        // Corrupt run files are skipped; the atomic store quarantines on write.
      }
    }
  }

  list(backpackId: string | null): AgentRunSnapshot[] {
    const all = [...this.runs.values()];
    const filtered = backpackId ? all.filter((r) => r.backpackId === backpackId) : all;
    return filtered
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => structuredClone(r));
  }

  get(runId: string): AgentRunSnapshot | null {
    const snapshot = this.runs.get(runId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  composedPrompt(runId: string): string {
    return this.composedPrompts.get(runId) ?? '';
  }
}

function isCoalescable(kind: string): boolean {
  return kind === 'agent_message_chunk' || kind === 'agent_thought_chunk' || kind === 'user_message_chunk';
}

/** Render a public Hermes session update without inventing information. */
function renderUpdate(update: Record<string, unknown> & { sessionUpdate: string }): string | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk':
    case 'user_message_chunk': {
      const content = update.content as { text?: string } | undefined;
      return content?.text ?? null;
    }
    case 'tool_call': {
      const title = (update.title as string) ?? (update.kind as string) ?? 'tool call';
      return `→ ${title}`;
    }
    case 'tool_call_update': {
      const status = (update.status as string) ?? 'update';
      const title = (update.title as string) ?? '';
      return `· ${title || 'tool'}: ${status}`;
    }
    case 'plan': {
      const entries = (update.entries as { content?: string; status?: string }[]) ?? [];
      return entries.map((e) => `[${e.status ?? '?'}] ${e.content ?? ''}`).join('\n');
    }
    case 'usage_update':
    case 'available_commands_update':
    case 'session_info_update':
      return null;
    default:
      return null;
  }
}

function extractJsonBlock(text: string): unknown {
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(text);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}
