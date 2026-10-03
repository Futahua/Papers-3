import { describe, expect, it, afterEach } from 'vitest';
import * as path from 'node:path';

import { AcpClient } from '../../src/main/hermes/acpClient';

const fakeServer = path.resolve(__dirname, '..', 'fakes', 'fake-acp-server.mjs');

let client: AcpClient;

function makeClient(): AcpClient {
  client = new AcpClient(process.execPath, [fakeServer]);
  client.start();
  return client;
}

afterEach(() => {
  client?.stop();
});

describe('AcpClient against a fake ACP server', () => {
  it('initializes and runs a prompt turn with streamed updates', async () => {
    const c = makeClient();
    const init = await c.initialize();
    expect(init.protocolVersion).toBe(1);
    expect(init.agentInfo?.name).toBe('fake-hermes');

    const updates: string[] = [];
    c.on('session-update', (payload) => updates.push(payload.update.sessionUpdate));

    const session = await c.newSession(process.cwd());
    expect(session.sessionId).toMatch(/^fake-/);

    const result = await c.prompt(session.sessionId, 'hello');
    expect(result.stopReason).toBe('end_turn');
    expect(updates).toContain('agent_thought_chunk');
    expect(updates).toContain('agent_message_chunk');
  });

  it('cancels a slow turn via session/cancel', async () => {
    const c = makeClient();
    await c.initialize();
    const session = await c.newSession(process.cwd());
    const promptPromise = c.prompt(session.sessionId, 'SLOW turn');
    await new Promise((r) => setTimeout(r, 300));
    c.cancel(session.sessionId);
    const result = await promptPromise;
    expect(result.stopReason).toBe('cancelled');
  });

  it('forwards permission requests and outcomes', async () => {
    const c = makeClient();
    await c.initialize();
    const session = await c.newSession(process.cwd());

    const seen: { title: string; options: number }[] = [];
    c.on('permission-request', (payload, respond) => {
      seen.push({ title: payload.title, options: payload.options.length });
      respond('allow_once');
    });

    const result = await c.prompt(session.sessionId, 'NEEDS-PERM please');
    expect(result.stopReason).toBe('end_turn');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.title).toBe('Run dangerous command');
    expect(seen[0]?.options).toBe(2);
  });

  it('auto-cancels permission requests with no listener', async () => {
    const c = makeClient();
    await c.initialize();
    const session = await c.newSession(process.cwd());
    const result = await c.prompt(session.sessionId, 'NEEDS-PERM no listener');
    // Fake server treats cancelled outcome as deny and still ends the turn.
    expect(result.stopReason).toBe('end_turn');
  });

  it('surfaces JSON-RPC errors as rejections', async () => {
    const c = makeClient();
    await c.initialize();
    const session = await c.newSession(process.cwd());
    await expect(c.prompt(session.sessionId, 'FAIL now')).rejects.toThrow(/synthetic failure/);
  });

  it('rejects pending requests when the process dies', async () => {
    const c = makeClient();
    await c.initialize();
    const session = await c.newSession(process.cwd());
    const promptPromise = c.prompt(session.sessionId, 'SLOW forever');
    await new Promise((r) => setTimeout(r, 200));
    c.stop();
    await expect(promptPromise).rejects.toThrow(/exited|not running|error/i);
  });
});
