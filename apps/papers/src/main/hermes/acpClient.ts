/**
 * Minimal Agent Client Protocol client over stdio (JSON-RPC, line-delimited)
 * for the Hermes ACP adapter (`hermes acp`, protocol v1).
 *
 * Implemented against the live adapter (verified 2026-07-20): responses carry
 * matching ids; `session/update` notifications stream turn progress;
 * `session/request_permission` arrives as a server->client request;
 * `session/cancel` is sent as a notification.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PermissionRequestPayload {
  sessionId: string;
  title: string;
  detail: string;
  options: PermissionOption[];
}

export interface SessionUpdatePayload {
  sessionId: string;
  update: Record<string, unknown> & { sessionUpdate: string };
}

export interface AcpClientEvents {
  'session-update': (payload: SessionUpdatePayload) => void;
  'permission-request': (
    payload: PermissionRequestPayload,
    respond: (optionId: string | null) => void,
  ) => void;
  exit: (detail: string) => void;
  stderr: (line: string) => void;
}

export interface InitializeResult {
  protocolVersion: number;
  agentInfo?: { name?: string; version?: string };
  agentCapabilities?: Record<string, unknown>;
}

export interface NewSessionResult {
  sessionId: string;
  _meta?: Record<string, unknown>;
  models?: { currentModelId?: string };
  modes?: { currentModeId?: string };
}

export interface PromptResult {
  stopReason: string;
  usage?: Record<string, unknown>;
}

const REQUEST_TIMEOUT_MS = 30_000;
/** Prompt turns can legitimately run for a long time (worker delegation). */
const PROMPT_TIMEOUT_MS = 60 * 60_000;

export class AcpClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly executable: string,
    private readonly args: string[] = ['acp'],
  ) {
    super();
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  start(): void {
    if (this.running) return;
    const child = spawn(this.executable, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) this.emit('stderr', line.trim());
      }
    });
    child.on('error', (err) => {
      this.failAllPending(`hermes acp process error: ${err.message}`);
      this.child = null;
      this.emit('exit', `spawn error: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      this.failAllPending(`hermes acp exited (code ${code}, signal ${signal ?? 'none'})`);
      this.child = null;
      this.emit('exit', `exited with code ${code}`);
    });
  }

  stop(): void {
    if (this.child && this.child.exitCode === null) {
      this.child.kill();
    }
    this.child = null;
  }

  private failAllPending(message: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }

  private consume(text: string): void {
    this.buffer += text;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    // Response to one of our requests.
    if (msg.id !== undefined && msg.method === undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    // Notification.
    if (msg.id === undefined && msg.method === 'session/update') {
      const params = msg.params as SessionUpdatePayload;
      if (params?.sessionId && params.update?.sessionUpdate) {
        this.emit('session-update', params);
      }
      return;
    }

    // Server -> client request.
    if (msg.id !== undefined && msg.method === 'session/request_permission') {
      const params = msg.params as {
        sessionId?: string;
        options?: PermissionOption[];
        toolCall?: { title?: string; rawInput?: unknown; kind?: string };
      };
      const payload: PermissionRequestPayload = {
        sessionId: params?.sessionId ?? '',
        title: params?.toolCall?.title ?? 'Hermes requests permission',
        detail:
          params?.toolCall?.rawInput !== undefined
            ? JSON.stringify(params.toolCall.rawInput).slice(0, 4_000)
            : '',
        options: (params?.options ?? []).map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        })),
      };
      const requestId = msg.id;
      let responded = false;
      const respond = (optionId: string | null): void => {
        if (responded) return;
        responded = true;
        const result =
          optionId === null
            ? { outcome: { outcome: 'cancelled' } }
            : { outcome: { outcome: 'selected', optionId } };
        this.writeMessage({ jsonrpc: '2.0', id: requestId, result });
      };
      if (this.listenerCount('permission-request') === 0) {
        respond(null);
      } else {
        this.emit('permission-request', payload, respond);
      }
      return;
    }

    // Any other server -> client request: method not supported.
    if (msg.id !== undefined && msg.method !== undefined) {
      this.writeMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `client does not support ${msg.method}` },
      });
    }
  }

  private writeMessage(msg: JsonRpcMessage): void {
    if (!this.child || this.child.exitCode !== null) {
      throw new Error('hermes acp process is not running');
    }
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  request<T>(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      try {
        this.writeMessage({ jsonrpc: '2.0', id, method, params });
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.writeMessage({ jsonrpc: '2.0', method, params });
  }

  initialize(): Promise<InitializeResult> {
    return this.request<InitializeResult>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      clientInfo: { name: 'papers', version: '1.0.0' },
    });
  }

  newSession(cwd: string): Promise<NewSessionResult> {
    return this.request<NewSessionResult>('session/new', { cwd, mcpServers: [] });
  }

  loadSession(sessionId: string, cwd: string): Promise<unknown> {
    return this.request('session/load', { sessionId, cwd, mcpServers: [] });
  }

  prompt(sessionId: string, text: string): Promise<PromptResult> {
    return this.request<PromptResult>(
      'session/prompt',
      { sessionId, prompt: [{ type: 'text', text }] },
      PROMPT_TIMEOUT_MS,
    );
  }

  cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId });
  }
}
