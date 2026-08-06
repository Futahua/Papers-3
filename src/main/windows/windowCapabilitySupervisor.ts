/**
 * The typed window-capability SUPERVISOR (Assignment 010).
 *
 * Owns the abstract helper lifecycle: stopped / starting / ready /
 * stopping / crashed. start() creates the transport and the capability
 * client; crash() and stop() reject every pending request exactly once
 * with helper-unavailable and tear the client down. A restart builds a
 * FRESH client with an empty pending map, so a move, minimize, restore or
 * close command is never silently replayed after a restart.
 *
 * Nothing here spawns a process; the transport factory is injected (tests
 * use an in-memory fake). No raw protocol send, arbitrary Win32, shell
 * execution or arbitrary process launch is exposed.
 */

import { createWindowCapabilityClient, type WindowCapabilityClient } from './windowCapabilityClient';
import type { WindowTransport } from './windowCapabilityTypes';

export type WindowSupervisorState =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'crashed';

export interface WindowCapabilitySupervisor {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Test/lifecycle hook: simulates the helper dying. */
  crash(): Promise<void>;
  getState(): WindowSupervisorState;
  /** The capability client while ready; null in every other state, so
   * callers fail closed rather than guessing. */
  getClient(): WindowCapabilityClient | null;
}

export function createWindowCapabilitySupervisor({
  createTransport,
  timeoutMs,
  maxPending,
}: {
  createTransport: () => WindowTransport;
  timeoutMs?: number;
  maxPending?: number;
}): WindowCapabilitySupervisor {
  let state: WindowSupervisorState = 'stopped';
  let transport: WindowTransport | null = null;
  let client: WindowCapabilityClient | null = null;

  async function start(): Promise<void> {
    if (state === 'starting' || state === 'ready') return;
    state = 'starting';
    let constructed: WindowTransport | null = null;
    let constructedClient: WindowCapabilityClient | null = null;
    try {
      constructed = createTransport();
      constructedClient = createWindowCapabilityClient({ transport: constructed, timeoutMs, maxPending });
    } catch (error) {
      // Construction or subscription failure: best-effort close anything
      // that was built, clear every reference, fail into `crashed` with no
      // client, and let start() reject so the caller knows the helper never
      // came up. A later start builds a fresh transport and replays nothing.
      if (constructed) {
        await constructed.close().catch(() => undefined);
      }
      constructed = null;
      constructedClient = null;
      transport = null;
      client = null;
      state = 'crashed';
      throw error;
    }
    transport = constructed;
    client = constructedClient;
    state = 'ready';
  }

  async function teardown(): Promise<void> {
    const current = client;
    const currentTransport = transport;
    client = null;
    transport = null;
    // Reject every pending request exactly once before the transport goes.
    current?.rejectAllPending('helper-unavailable', 'helper unavailable');
    await currentTransport?.close().catch(() => undefined);
  }

  async function stop(): Promise<void> {
    if (state === 'stopped') return;
    state = 'stopping';
    await teardown();
    state = 'stopped';
  }

  async function crash(): Promise<void> {
    if (state !== 'ready' && state !== 'starting') return;
    state = 'crashed';
    await teardown();
  }

  function getClient(): WindowCapabilityClient | null {
    return state === 'ready' ? client : null;
  }

  return { start, stop, crash, getState: () => state, getClient };
}
