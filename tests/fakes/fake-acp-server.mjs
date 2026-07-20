#!/usr/bin/env node
/**
 * Minimal fake ACP server speaking the same subset the Hermes adapter uses.
 * Behaviors are keyed on prompt text:
 *  - contains "SLOW"        → keeps streaming until session/cancel arrives
 *  - contains "NEEDS-PERM"  → sends session/request_permission first
 *  - contains "FAIL"        → returns a JSON-RPC error
 *  - otherwise              → streams thought+message chunks, returns end_turn
 */
import * as readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
const cancelled = new Set();
let serverRequestId = 1000;
const pendingPermissions = new Map();

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function update(sessionId, updateObj) {
  notify('session/update', { sessionId, update: updateObj });
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // Responses to our server->client requests (permission outcomes).
  if (msg.id !== undefined && msg.method === undefined) {
    const resolver = pendingPermissions.get(msg.id);
    if (resolver) {
      pendingPermissions.delete(msg.id);
      resolver(msg.result ?? null);
    }
    return;
  }

  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'fake-hermes', version: '0.0.1' },
        agentCapabilities: { loadSession: true },
      },
    });
  } else if (method === 'session/new') {
    const sessionId = `fake-${Math.random().toString(16).slice(2, 10)}`;
    send({ jsonrpc: '2.0', id, result: { sessionId } });
  } else if (method === 'session/cancel') {
    cancelled.add(params.sessionId);
  } else if (method === 'session/prompt') {
    const { sessionId } = params;
    const text = params.prompt?.[0]?.text ?? '';
    void handlePrompt(id, sessionId, text);
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown ${method}` } });
  }
});

async function handlePrompt(id, sessionId, text) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (text.includes('FAIL')) {
    send({ jsonrpc: '2.0', id, error: { code: -32000, message: 'synthetic failure' } });
    return;
  }

  if (text.includes('NEEDS-PERM')) {
    const reqId = serverRequestId++;
    const outcome = await new Promise((resolve) => {
      pendingPermissions.set(reqId, resolve);
      send({
        jsonrpc: '2.0',
        id: reqId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { title: 'Run dangerous command', rawInput: { command: 'rm -rf /tmp/x' } },
          options: [
            { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
          ],
        },
      });
    });
    const selected = outcome?.outcome?.optionId ?? 'deny';
    update(sessionId, { sessionUpdate: 'tool_call_update', title: 'dangerous command', status: selected === 'deny' ? 'failed' : 'completed' });
    if (selected === 'deny') {
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Permission denied; stopping.' } });
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }
  }

  update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } });

  if (text.includes('SLOW')) {
    for (let i = 0; i < 600; i += 1) {
      if (cancelled.has(sessionId)) {
        send({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } });
        return;
      }
      update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${i} ` } });
      await sleep(50);
    }
  }

  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Result body. ' } });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '```json\n{"ok":true}\n```' } });
  send({
    jsonrpc: '2.0',
    id,
    result: { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5 } },
  });
}
