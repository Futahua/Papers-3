#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { connectPapersControl, readDescriptor } from './papersControlClient.mjs';

export const PAPERS_MCP_TOOL = 'papers_control';

/**
 * Thin MCP-to-control adapter. It deliberately knows no Papers command
 * schemas or business rules: method and params cross unchanged, and the
 * reviewed local control server remains the only validation/authority layer.
 */
export function createPapersMcpServer({
  descriptorPath,
  readControlDescriptor = readDescriptor,
  connectControl = connectPapersControl,
} = {}) {
  if (!descriptorPath) throw new Error('PAPERS_DEV_CONTROL_DESCRIPTOR or --descriptor is required');

  let connectionPromise = null;
  const connection = async () => {
    if (!connectionPromise) {
      connectionPromise = Promise.resolve(readControlDescriptor(descriptorPath))
        .then((descriptor) => connectControl(descriptor))
        .catch((error) => {
          connectionPromise = null;
          throw error;
        });
    }
    return connectionPromise;
  };
  const closeControl = async () => {
    const pending = connectionPromise;
    connectionPromise = null;
    if (!pending) return;
    const active = await pending.catch(() => null);
    active?.close();
  };

  const server = new McpServer({ name: 'papers-control', version: '1.0.0' });
  server.registerTool(PAPERS_MCP_TOOL, {
    title: 'Papers semantic control',
    description: 'Call one existing Papers developer-control protocol method with its exact explicit parameters. Papers validates authority, targets, redaction, and destructive confirmations.',
    inputSchema: {
      method: z.string().min(1).describe('Exact Papers control protocol method name.'),
      params: z.record(z.string(), z.unknown()).default({}).describe('Exact method parameters; no current/focused target inference is performed.'),
    },
  }, async ({ method, params }, extra) => {
    const active = await connection();
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      // Revokes any connection-bound destructive challenge and prevents a
      // cancelled MCP request from leaving approval state behind.
      void closeControl();
    };
    extra.signal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await active.call(method, params);
      if (cancelled) throw new Error('Papers MCP request was cancelled.');
      if (!response?.ok) {
        return {
          isError: true,
          content: [{ type: 'text', text: String(response?.error ?? 'Papers control request failed.') }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(response.result) }],
      };
    } finally {
      extra.signal.removeEventListener('abort', cancel);
    }
  });

  return {
    server,
    async close() {
      await closeControl();
      await server.close();
    },
  };
}

function valueAfter(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runPapersMcp(args = process.argv.slice(2)) {
  const descriptorPath = valueAfter(args, '--descriptor') ?? process.env.PAPERS_DEV_CONTROL_DESCRIPTOR;
  const adapter = createPapersMcpServer({ descriptorPath });
  const transport = new StdioServerTransport();
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await adapter.close();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  process.stdin.once('end', () => { void close(); });
  await adapter.server.connect(transport);
  return adapter;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPapersMcp().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
