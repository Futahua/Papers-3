import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFlowEmbedExchange } from '../src/main/backpacks/flowEmbedExchange';

const roots: string[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-embed-exchange-'));
  roots.push(root);
  const flowDirectory = path.join(root, 'Flow');
  return { flowDirectory, exchange: createFlowEmbedExchange({ flowDirectory, storageRoot: 'D:\\Papers\\Data\\Workspace files' }) };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('flow embed exchange', () => {
  it('returns nothing until Flow has written requests', () => {
    const { exchange } = setup();
    expect(exchange.take()).toEqual({ ok: true, imports: [], wants: [], docs: [] });
  });

  it('keeps only valid imports and wants', () => {
    const { flowDirectory, exchange } = setup();
    fs.mkdirSync(flowDirectory, { recursive: true });
    fs.writeFileSync(path.join(flowDirectory, 'papers-embed-requests.json'), JSON.stringify({
      version: 1,
      imports: [
        { requestId: 'r1', path: 'D:\\sort\\quiz.html' },
        { requestId: 'r2', path: 'relative\\file.pdf' },
        { requestId: 'r3', path: '\\\\server\\share\\x.pdf' },
        { requestId: '../bad', path: 'D:\\a.pdf' },
      ],
      wants: [
        { workspaceId: 'flow-embeds', entryId: 'e1', retry: 2 },
        { workspaceId: 'flow-embeds', entryId: '../e2' },
        { workspaceId: 'flow-embeds', entryId: 'e3' },
      ],
    }));
    expect(exchange.take()).toEqual({
      ok: true,
      imports: [{ requestId: 'r1', path: 'D:\\sort\\quiz.html' }],
      wants: [{ workspaceId: 'flow-embeds', entryId: 'e1', retry: 2 }, { workspaceId: 'flow-embeds', entryId: 'e3', retry: 0 }],
      docs: [],
    });
  });

  it('ignores an unknown version or unreadable request file', () => {
    const { flowDirectory, exchange } = setup();
    fs.mkdirSync(flowDirectory, { recursive: true });
    fs.writeFileSync(path.join(flowDirectory, 'papers-embed-requests.json'), '{not json');
    expect(exchange.take().imports).toEqual([]);
    fs.writeFileSync(path.join(flowDirectory, 'papers-embed-requests.json'), JSON.stringify({ version: 2, imports: [{ requestId: 'r', path: 'D:\\x' }] }));
    expect(exchange.take().imports).toEqual([]);
  });

  it('publishes sanitized answers with the storage root and device', () => {
    const { flowDirectory, exchange } = setup();
    expect(exchange.publish({
      device: 'SlopTop',
      imports: {
        r1: { ok: true, workspaceId: 'flow-embeds', entryId: 'e1', name: 'quiz.html', origin: 'SlopTop' },
        r2: { ok: false, message: 'Choose a regular file.' },
        'bad/id': { ok: true, workspaceId: 'flow-embeds', entryId: 'e9' },
      },
      files: {
        'flow-embeds/e1': { status: 'ready', path: 'D:\\Papers\\Data\\Workspace files\\flow-embeds\\entries\\e1\\quiz.html', name: 'quiz.html' },
        'flow-embeds/e2': { status: 'waiting', message: 'Waiting for file from LapDog', retry: 1 },
        'flow-embeds/e3': { status: 'exploded' },
        'flow-embeds/e4': { status: 'ready', path: 'relative.html' },
        'a/b/c': { status: 'ready' },
      },
    })).toEqual({ ok: true });
    const written = JSON.parse(fs.readFileSync(path.join(flowDirectory, 'papers-embed-resolutions.json'), 'utf8'));
    expect(written).toEqual({
      version: 1,
      storageRoot: 'D:\\Papers\\Data\\Workspace files',
      device: 'SlopTop',
      imports: {
        r1: { ok: true, workspaceId: 'flow-embeds', entryId: 'e1', name: 'quiz.html', origin: 'SlopTop' },
        r2: { ok: false, message: 'Choose a regular file.' },
      },
      files: {
        'flow-embeds/e1': { status: 'ready', path: 'D:\\Papers\\Data\\Workspace files\\flow-embeds\\entries\\e1\\quiz.html', name: 'quiz.html' },
        'flow-embeds/e2': { status: 'waiting', message: 'Waiting for file from LapDog', retry: 1 },
        'flow-embeds/e4': { status: 'ready' },
      },
      docs: {},
    });
  });

  it('rejects a payload that is not an object', () => {
    const { exchange } = setup();
    expect(exchange.publish(null)).toEqual({ ok: false, code: 'INVALID_EMBED_RESOLUTIONS' });
  });

  it('keeps valid saved-data requests and drops oversized or malformed ones', () => {
    const { flowDirectory, exchange } = setup();
    fs.mkdirSync(flowDirectory, { recursive: true });
    fs.writeFileSync(path.join(flowDirectory, 'papers-embed-requests.json'), JSON.stringify({
      version: 1,
      docs: [
        { requestId: 'd1', op: 'load', documentId: 'flow-embed.e1' },
        { requestId: 'd2', op: 'save', documentId: 'flow-embed.e1', content: { score: 3 }, revision: 'rev-1' },
        { requestId: 'd3', op: 'save', documentId: 'flow-embed.e2', content: { first: true }, revision: null },
        { requestId: 'd4', op: 'save', documentId: 'flow-embed.e1', content: [1, 2] },
        { requestId: 'd5', op: 'save', documentId: 'flow-embed.e1', content: { big: 'x'.repeat(2 * 1024 * 1024) } },
        { requestId: 'd6', op: 'delete', documentId: 'flow-embed.e1' },
        { requestId: 'd7', op: 'load', documentId: '../escape' },
      ],
    }));
    expect(exchange.take().docs).toEqual([
      { requestId: 'd1', op: 'load', documentId: 'flow-embed.e1' },
      { requestId: 'd2', op: 'save', documentId: 'flow-embed.e1', content: { score: 3 }, revision: 'rev-1' },
      { requestId: 'd3', op: 'save', documentId: 'flow-embed.e2', content: { first: true }, revision: null },
    ]);
  });

  it('publishes saved-data answers including conflicts', () => {
    const { flowDirectory, exchange } = setup();
    exchange.publish({ docs: {
      d1: { ok: true, content: { score: 3 }, revision: 'rev-2' },
      d2: { ok: false, code: 'DOCUMENT_CHANGED', content: { score: 5 }, revision: 'rev-3' },
      d3: { ok: true, content: null, revision: null },
      'bad id': { ok: true },
    } });
    const written = JSON.parse(fs.readFileSync(path.join(flowDirectory, 'papers-embed-resolutions.json'), 'utf8'));
    expect(written.docs).toEqual({
      d1: { ok: true, content: { score: 3 }, revision: 'rev-2' },
      d2: { ok: false, content: { score: 5 }, revision: 'rev-3', code: 'DOCUMENT_CHANGED' },
      d3: { ok: true, content: null },
    });
  });
});
