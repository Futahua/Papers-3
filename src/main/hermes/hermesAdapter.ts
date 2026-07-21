/**
 * HermesAdapter (plan section 12) — owns connection startup, health, session
 * creation, turn submission, public-event subscription, approval forwarding,
 * cancellation, and structured result receipt. Nothing else.
 *
 * Secrets and transport stay here in the main process; programs only ever
 * see opaque run/session references.
 */
import { EventEmitter } from 'node:events';

import type { HermesHealth } from '@shared/types';
import { AtomicJsonStore } from '../persistence/atomicStore';
import type { PapersPaths } from '../persistence/paths';
import {
  AcpClient,
  type PermissionRequestPayload,
  type PromptResult,
  type SessionUpdatePayload,
} from './acpClient';

export interface HermesIntegrationState {
  schemaVersion: 1;
  /** Executable used to start `hermes acp`. */
  executable: string;
  lastConnectedAt: string | null;
  lastAgentVersion: string | null;
}

export interface HermesAdapterEvents {
  'health-changed': (health: HermesHealth) => void;
  'session-update': (payload: SessionUpdatePayload) => void;
  'permission-request': (
    payload: PermissionRequestPayload,
    respond: (optionId: string | null) => void,
  ) => void;
}

const DEFAULT_EXECUTABLE = 'hermes';

export class HermesAdapter extends EventEmitter {
  private client: AcpClient | null = null;
  private healthState: HermesHealth = { state: 'unavailable', detail: 'not started' };
  private readonly integrationStore: AtomicJsonStore;
  private integration: HermesIntegrationState = {
    schemaVersion: 1,
    executable: DEFAULT_EXECUTABLE,
    lastConnectedAt: null,
    lastAgentVersion: null,
  };
  private connecting: Promise<void> | null = null;

  constructor(paths: PapersPaths) {
    super();
    this.integrationStore = new AtomicJsonStore(paths.hermesIntegrationFile, {
      recoveryDir: paths.recoveryDir,
    });
  }

  get health(): HermesHealth {
    return this.healthState;
  }

  private setHealth(health: HermesHealth): void {
    this.healthState = health;
    this.emit('health-changed', health);
  }

  async initialize(): Promise<void> {
    const report = await this.integrationStore.load<HermesIntegrationState>();
    if (report.value && typeof report.value.executable === 'string') {
      this.integration = { ...this.integration, ...report.value };
    }
  }

  /** Connect (or reconnect) to `hermes acp`. Safe to call repeatedly. */
  async connect(): Promise<void> {
    if (this.client?.running && this.healthState.state === 'connected') return;
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    this.setHealth({ state: 'starting' });
    this.client?.stop();

    const client = new AcpClient(this.integration.executable);
    this.client = client;

    client.on('session-update', (payload) => this.emit('session-update', payload));
    client.on('permission-request', (payload, respond) =>
      this.emit('permission-request', payload, respond),
    );
    client.on('exit', (detail) => {
      if (this.client === client) {
        this.setHealth({ state: 'disconnected', detail });
      }
    });

    try {
      client.start();
      const init = await client.initialize();
      const agentName = init.agentInfo?.name ?? 'unknown-agent';
      const agentVersion = init.agentInfo?.version ?? 'unknown';
      this.integration.lastConnectedAt = new Date().toISOString();
      this.integration.lastAgentVersion = agentVersion;
      await this.integrationStore.save(this.integration);
      this.setHealth({
        state: 'connected',
        protocolVersion: init.protocolVersion,
        agentName: `${agentName} ${agentVersion}`,
      });
    } catch (err) {
      client.stop();
      this.setHealth({
        state: 'unavailable',
        detail:
          `Could not start "${this.integration.executable} acp": ${String(err)}. ` +
          'Ensure Hermes Agent is installed and on PATH.',
      });
      throw err;
    }
  }

  private requireClient(): AcpClient {
    if (!this.client?.running || this.healthState.state !== 'connected') {
      throw new Error('Hermes is not connected');
    }
    return this.client;
  }

  async createSession(cwd: string): Promise<string> {
    await this.connect();
    const result = await this.requireClient().newSession(cwd);
    if (!result.sessionId) throw new Error('Hermes did not return a session id');
    return result.sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    return this.requireClient().prompt(sessionId, text);
  }

  cancel(sessionId: string): void {
    this.requireClient().cancel(sessionId);
  }

  async shutdown(): Promise<void> {
    this.client?.stop();
    this.client = null;
    this.setHealth({ state: 'unavailable', detail: 'shut down' });
  }
}
