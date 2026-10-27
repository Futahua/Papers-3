/**
 * Flow embed exchange: the bounded mailbox between native Flow and Proxima for
 * portable file embeds. Flow writes what it needs (files to import, managed
 * entries to resolve); Proxima's page takes those requests, answers them through
 * its existing workspace replica (identity, versions, conflicts, transfer, cache)
 * and publishes the answers here for Flow to read.
 *
 * This module owns only the two small JSON files in Flow's local profile folder.
 * It never copies, hashes or transfers file content; WorkspaceFiles and the
 * Proxima replica remain the owners of the bytes.
 *
 * It also carries explicit save/load requests from interactive embeds: one JSON
 * document per embed, stored by Proxima's existing checked document store
 * (replica readDocument/saveDocument). Raw browser storage is never synced.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FLOW_EMBED_WORKSPACE = 'flow-embeds';
const REQUESTS = 'papers-embed-requests.json';
const RESOLUTIONS = 'papers-embed-resolutions.json';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DOCS = 50;
const MAX_DOCUMENT_CHARS = 2 * 1024 * 1024;
const MAX_IMPORTS = 200;
const MAX_WANTS = 2000;
const STATUSES = new Set(['ready', 'downloading', 'waiting', 'conflict', 'missing', 'deleted', 'error']);

const identity = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length <= max ? value : undefined;
const documentIdentity = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
/** A JSON object within the document store's size limit, or undefined. */
const documentContent = (value: unknown): Record<string, unknown> | null | undefined => {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try { return JSON.stringify(value).length <= MAX_DOCUMENT_CHARS ? value as Record<string, unknown> : undefined; } catch { return undefined; }
};

export interface FlowEmbedImport { requestId: string; path: string }
export interface FlowEmbedWant { workspaceId: string; entryId: string; retry: number }
export interface FlowEmbedDocumentRequest { requestId: string; op: 'load' | 'save'; documentId: string; content?: Record<string, unknown>; revision?: string | null }

export interface FlowEmbedExchange {
  take(): { ok: true; imports: FlowEmbedImport[]; wants: FlowEmbedWant[]; docs: FlowEmbedDocumentRequest[] };
  publish(payload: unknown): { ok: boolean; code?: string };
}

function readJson(file: string): unknown {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function createFlowEmbedExchange(input: { flowDirectory: string | null; storageRoot: string }): FlowEmbedExchange {
  const directory = () => {
    if (!input.flowDirectory) throw Error('Local Flow profile is unavailable.');
    fs.mkdirSync(input.flowDirectory, { recursive: true });
    return input.flowDirectory;
  };
  let lastWritten = '';
  return {
    take() {
      const raw = readJson(path.join(directory(), REQUESTS)) as { version?: unknown; imports?: unknown; wants?: unknown; docs?: unknown } | null;
      if (!raw || raw.version !== 1) return { ok: true, imports: [], wants: [], docs: [] };
      const imports: FlowEmbedImport[] = [];
      for (const item of Array.isArray(raw.imports) ? raw.imports.slice(0, MAX_IMPORTS) : []) {
        const requestId = item?.requestId, source = text(item?.path, 1024);
        // Only absolute local paths; WorkspaceFiles rejects anything that is not a regular file.
        if (identity(requestId) && source && path.win32.isAbsolute(source) && !source.startsWith('\\\\')) imports.push({ requestId, path: source });
      }
      const wants: FlowEmbedWant[] = [];
      for (const item of Array.isArray(raw.wants) ? raw.wants.slice(0, MAX_WANTS) : []) {
        if (identity(item?.workspaceId) && identity(item?.entryId)) wants.push({ workspaceId: item.workspaceId, entryId: item.entryId, retry: Number.isSafeInteger(item?.retry) ? item.retry : 0 });
      }
      const docs: FlowEmbedDocumentRequest[] = [];
      for (const item of Array.isArray(raw.docs) ? raw.docs.slice(0, MAX_DOCS) : []) {
        if (!identity(item?.requestId) || !documentIdentity(item?.documentId)) continue;
        if (item.op === 'load') docs.push({ requestId: item.requestId, op: 'load', documentId: item.documentId });
        if (item.op === 'save') {
          const content = documentContent(item.content);
          const revision = item.revision === null || item.revision === undefined ? null : text(item.revision, 128);
          if (content && revision !== undefined) docs.push({ requestId: item.requestId, op: 'save', documentId: item.documentId, content, revision });
        }
      }
      return { ok: true, imports, wants, docs };
    },
    publish(payload) {
      const value = payload as { imports?: unknown; files?: unknown; docs?: unknown; device?: unknown } | null;
      if (!value || typeof value !== 'object') return { ok: false, code: 'INVALID_EMBED_RESOLUTIONS' };
      const imports: Record<string, unknown> = {};
      for (const [requestId, result] of Object.entries(value.imports && typeof value.imports === 'object' ? value.imports : {}).slice(0, MAX_IMPORTS)) {
        const r = result as Record<string, unknown>;
        if (!identity(requestId) || !r || typeof r !== 'object') continue;
        imports[requestId] = r.ok === true && identity(r.workspaceId) && identity(r.entryId)
          ? { ok: true, workspaceId: r.workspaceId, entryId: r.entryId, name: text(r.name, 220) ?? '', origin: text(r.origin, 80) ?? '' }
          : { ok: false, message: text(r.message, 300) ?? 'The file could not be stored.' };
      }
      const files: Record<string, unknown> = {};
      for (const [key, result] of Object.entries(value.files && typeof value.files === 'object' ? value.files : {}).slice(0, MAX_WANTS)) {
        const [workspaceId, entryId, extra] = key.split('/'), r = result as Record<string, unknown>;
        if (extra !== undefined || !identity(workspaceId) || !identity(entryId) || !r || typeof r !== 'object' || !STATUSES.has(String(r.status))) continue;
        const local = text(r.path, 1024);
        files[key] = {
          status: r.status,
          ...(local && path.win32.isAbsolute(local) ? { path: local } : {}),
          ...(text(r.name, 220) ? { name: r.name } : {}),
          ...(text(r.message, 300) ? { message: r.message } : {}),
          ...(Number.isSafeInteger(r.retry) ? { retry: r.retry } : {}),
        };
      }
      const docs: Record<string, unknown> = {};
      for (const [requestId, result] of Object.entries(value.docs && typeof value.docs === 'object' ? value.docs : {}).slice(0, MAX_DOCS)) {
        const r = result as Record<string, unknown>;
        if (!identity(requestId) || !r || typeof r !== 'object') continue;
        const content = documentContent(r.content), revision = text(r.revision, 128);
        docs[requestId] = {
          ok: r.ok === true,
          ...(content !== undefined ? { content } : {}),
          ...(revision ? { revision } : {}),
          ...(text(r.code, 40) ? { code: r.code } : {}),
          ...(text(r.message, 300) ? { message: r.message } : {}),
        };
      }
      const body = JSON.stringify({ version: 1, storageRoot: input.storageRoot, device: text(value.device, 80) ?? '', imports, files, docs });
      if (body === lastWritten) return { ok: true };
      const target = path.join(directory(), RESOLUTIONS), temp = target + '.tmp';
      fs.writeFileSync(temp, body, 'utf8');
      fs.renameSync(temp, target);
      lastWritten = body;
      return { ok: true };
    },
  };
}
