import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';

import {
  CapabilityBroker,
  CapabilityFailure,
} from '../../src/main/capabilities/capabilityBroker';
import { PermissionStore } from '../../src/main/capabilities/permissionStore';
import { papersPaths } from '../../src/main/persistence/paths';
import type { ProgramSenderIdentity } from '../../src/main/canvas/canvasRuntime';
import type { PendingPermissionPrompt, PermissionDecision } from '../../src/shared/types';

let dir: string;
let store: PermissionStore;
let decisions: PermissionDecision[];
let prompts: PendingPermissionPrompt[];
let broker: CapabilityBroker;

const identity = (programId = 'prog-a', capabilities = ['clipboard.write']): ProgramSenderIdentity => ({
  backpackId: 'bp-1',
  programId,
  manifest: {
    id: programId,
    name: 'Test',
    version: '1.0.0',
    apiVersion: 1,
    entry: 'index.html',
    stateSchemaVersion: 1,
    capabilities,
  },
});

const request = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  invocationId: 'inv-1',
  backpackId: 'bp-1',
  programId: 'prog-a',
  capability: 'clipboard.write',
  arguments: { text: 'hello' },
  reason: 'test',
  ...overrides,
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'papers3-broker-'));
  store = new PermissionStore(papersPaths(dir));
  await store.initialize();
  decisions = [];
  prompts = [];
  broker = new CapabilityBroker({
    permissionStore: store,
    prompter: {
      prompt: async (p) => {
        prompts.push(p);
        return decisions.shift() ?? 'deny';
      },
    },
    logFile: path.join(dir, 'log.jsonl'),
  });
  broker.register({
    capability: 'clipboard.write',
    policy: 'prompt',
    argumentsSchema: z.object({ text: z.string().max(100) }).strict(),
    summarize: () => 'copy text',
    execute: async (args) => ({ echoed: (args as { text: string }).text }),
  });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function expectFailure(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable('expected CapabilityFailure');
  } catch (err) {
    expect(err).toBeInstanceOf(CapabilityFailure);
    expect((err as CapabilityFailure).capabilityError.code).toBe(code);
  }
}

describe('CapabilityBroker', () => {
  it('rejects requests without a registered sender', async () => {
    await expectFailure(broker.handle(null, request()), 'invalid-sender');
  });

  it('rejects identity spoofing', async () => {
    await expectFailure(
      broker.handle(identity(), request({ programId: 'other-program' })),
      'invalid-sender',
    );
  });

  it('rejects undeclared capabilities', async () => {
    await expectFailure(
      broker.handle(identity('prog-a', ['storage.read-own']), request()),
      'not-declared',
    );
  });

  it('rejects malformed requests and arguments', async () => {
    await expectFailure(broker.handle(identity(), { nonsense: true }), 'invalid-arguments');
    await expectFailure(
      broker.handle(identity(), request({ arguments: { text: 'x'.repeat(200) } })),
      'invalid-arguments',
    );
    await expectFailure(
      broker.handle(identity(), request({ capability: 'not.a.capability' })),
      'invalid-arguments',
    );
  });

  it('prompts, executes on allow-once, and does not persist the grant', async () => {
    decisions.push('allow-once');
    const result = await broker.handle(identity(), request());
    expect(result).toEqual({ echoed: 'hello' });
    expect(prompts).toHaveLength(1);
    expect(store.hasProgramGrant('bp-1', 'prog-a', 'clipboard.write')).toBe(false);

    // Next request prompts again.
    decisions.push('deny');
    await expectFailure(broker.handle(identity(), request()), 'denied');
    expect(prompts).toHaveLength(2);
  });

  it('persists allow-program grants and skips later prompts; revocation restores prompting', async () => {
    decisions.push('allow-program');
    await broker.handle(identity(), request());
    expect(store.hasProgramGrant('bp-1', 'prog-a', 'clipboard.write')).toBe(true);

    // No prompt needed now.
    await broker.handle(identity(), request());
    expect(prompts).toHaveLength(1);

    await store.revoke('bp-1', 'prog-a', 'clipboard.write');
    decisions.push('deny');
    await expectFailure(broker.handle(identity(), request()), 'denied');
    expect(prompts).toHaveLength(2);
  });

  it('never logs raw arguments', async () => {
    decisions.push('allow-once');
    await broker.handle(identity(), request({ arguments: { text: 'SUPER-SECRET-VALUE' } }));
    const log = await fs.readFile(path.join(dir, 'log.jsonl'), 'utf8');
    expect(log).not.toContain('SUPER-SECRET-VALUE');
    expect(log).toContain('clipboard.write');
  });

  it('returns unavailable for unimplemented capabilities', async () => {
    await expectFailure(
      broker.handle(
        identity('prog-a', ['external.open']),
        request({ capability: 'external.open', arguments: { target: 'url', url: 'https://x.dev' } }),
      ),
      'unavailable',
    );
  });
});
