import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error -- the standalone adapter is plain ESM shipped with tools.
import { createPapersMcpServer, PAPERS_MCP_TOOL } from '../../tools/papersMcp.mjs';

async function harness() {
  const call = vi.fn(async (method: string, params: unknown) => ({
    id: 1, ok: true, result: { method, params },
  }));
  const close = vi.fn();
  const adapter = createPapersMcpServer({
    descriptorPath: 'ignored.json',
    readControlDescriptor: vi.fn(async () => ({ token: 'not-exposed' })),
    connectControl: vi.fn(async () => ({ call, close })),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'papers-mcp-test', version: '1.0.0' });
  await Promise.all([adapter.server.connect(serverTransport), client.connect(clientTransport)]);
  return { adapter, client, call, close };
}

describe('Papers stdio MCP adapter', () => {
  it('maps MCP input mechanically to one exact control call', async () => {
    const { adapter, client, call } = await harness();
    try {
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [expect.objectContaining({ name: PAPERS_MCP_TOOL })],
      });
      const params = {
        sourceWindowId: 1, surfaceId: 'sf-a', targetWindowId: 2,
        targetGroupId: 'group-main', targetIndex: 0,
      };
      const result = await client.callTool({
        name: PAPERS_MCP_TOOL,
        arguments: { method: 'layout.moveSurfaceToWindow', params },
      });
      expect(call).toHaveBeenCalledWith('layout.moveSurfaceToWindow', params);
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ method: 'layout.moveSurfaceToWindow', params }) }]);
    } finally {
      await client.close();
      await adapter.close();
    }
  });

  it('preserves the two-step destructive flow on the same connection', async () => {
    const { adapter, client, call } = await harness();
    try {
      await client.callTool({
        name: PAPERS_MCP_TOOL,
        arguments: { method: 'backpack.remove.prepare', params: { projectId: 'bp-a' } },
      });
      await client.callTool({
        name: PAPERS_MCP_TOOL,
        arguments: { method: 'confirmation.execute', params: {
          challengeId: '11111111-1111-4111-8111-111111111111',
          confirmationText: 'DELETE BACKPACK "Alpha"',
        } },
      });
      expect(call.mock.calls).toEqual([
        ['backpack.remove.prepare', { projectId: 'bp-a' }],
        ['confirmation.execute', {
          challengeId: '11111111-1111-4111-8111-111111111111',
          confirmationText: 'DELETE BACKPACK "Alpha"',
        }],
      ]);
    } finally {
      await client.close();
      await adapter.close();
    }
  });

  it('forwards every visual command family with exact method and params', async () => {
    const { adapter, client, call } = await harness();
    const visualCalls = [
      ['inspect.process', {}],
      ['inspect.visual.diagnostics', { windowId: 4, surfaceId: 'surface-a' }],
      ['inspect.visual.elements', { windowId: 4, surfaceId: 'surface-a' }],
      ['inspect.visual.timeline', { windowId: 4, surfaceId: 'surface-a', beforeMs: 1000 }],
      ['visual.assert', { windowId: 4, surfaceId: 'surface-a', assertions: [{ kind: 'visible', elementKey: 'canvas.root' }] }],
      ['visual.report.create', { windowId: 4, surfaceId: 'surface-a', beforeMs: 1000 }],
      ['visual.artifact.read', { artifactId: 'va-11111111-1111-4111-8111-111111111111', offset: 0, length: 1 }],
      ['capture.surface', { windowId: 4, surfaceId: 'surface-a' }],
      ['capture.element', { windowId: 4, surfaceId: 'surface-a', elementKey: 'canvas.root', paddingCssPx: 0 }],
      ['capture.window', { windowId: 4 }],
    ] as const;
    try {
      for (const [method, params] of visualCalls) {
        await client.callTool({ name: PAPERS_MCP_TOOL, arguments: { method, params } });
      }
      expect(call.mock.calls).toEqual(visualCalls);
    } finally {
      await client.close();
      await adapter.close();
    }
  });

  it('returns control refusals as MCP tool errors without widening them', async () => {
    const call = vi.fn(async () => ({ id: 1, ok: false, error: 'That surface is not open in that Papers window.' }));
    const adapter = createPapersMcpServer({
      descriptorPath: 'ignored.json',
      readControlDescriptor: async () => ({}),
      connectControl: async () => ({ call, close: vi.fn() }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'papers-mcp-test', version: '1.0.0' });
    await Promise.all([adapter.server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: PAPERS_MCP_TOOL,
        arguments: { method: 'inspect.surface', params: { windowId: 1, surfaceId: 'missing' } },
      });
      expect(result).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'That surface is not open in that Papers window.' }],
      });
    } finally {
      await client.close();
      await adapter.close();
    }
  });

  it('closes the underlying control connection when an MCP request is cancelled', async () => {
    let release!: () => void;
    const call = vi.fn(() => new Promise((resolve) => { release = () => resolve({ id: 1, ok: true, result: [] }); }));
    const close = vi.fn();
    const adapter = createPapersMcpServer({
      descriptorPath: 'ignored.json',
      readControlDescriptor: async () => ({}),
      connectControl: async () => ({ call, close }),
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'papers-mcp-test', version: '1.0.0' });
    await Promise.all([adapter.server.connect(serverTransport), client.connect(clientTransport)]);
    const controller = new AbortController();
    try {
      const pending = client.callTool({
        name: PAPERS_MCP_TOOL,
        arguments: { method: 'inspect.windows', params: {} },
      }, undefined, { signal: controller.signal });
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
      controller.abort();
      await expect(pending).rejects.toThrow();
      await vi.waitFor(() => expect(close).toHaveBeenCalled());
    } finally {
      release();
      await client.close();
      await adapter.close();
    }
  });

  it('never dispatches when cancellation occurs during control connection establishment', async () => {
    let releaseConnect!: () => void;
    const connectHeld = new Promise<void>((resolve) => { releaseConnect = resolve; });
    const call = vi.fn(async () => ({ id: 1, ok: true, result: { windowId: 2 } }));
    const close = vi.fn();
    let reachedConnect = false;
    const adapter = createPapersMcpServer({
      descriptorPath: 'ignored.json',
      readControlDescriptor: async () => ({}),
      connectControl: async () => {
        reachedConnect = true;
        await connectHeld;
        return { call, close };
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'papers-mcp-test', version: '1.0.0' });
    await Promise.all([adapter.server.connect(serverTransport), client.connect(clientTransport)]);
    const controller = new AbortController();
    try {
      const pending = client.callTool({
        name: PAPERS_MCP_TOOL,
        arguments: { method: 'window.create', params: {} },
      }, undefined, { signal: controller.signal });
      await vi.waitFor(() => expect(reachedConnect).toBe(true));
      controller.abort();
      await expect(pending).rejects.toThrow();
      releaseConnect();
      await vi.waitFor(() => expect(close).toHaveBeenCalled());
      expect(call).not.toHaveBeenCalled();
    } finally {
      releaseConnect();
      await client.close();
      await adapter.close();
    }
  });
});
