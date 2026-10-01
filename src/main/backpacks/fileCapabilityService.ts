import { execFile, execFileSync } from 'node:child_process';
import { promises as fs, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { EverythingSearchBridge } from './everythingSearchBridge';
import { FILE_PREVIEW_SCHEME, type FilePreviewResourceRegistry } from './filePreviewResources';
import type { PdfPreviewHostBridge } from './pdfPreviewHostBridge';
import type { RevitPreviewBridge } from './revitPreviewBridge';
import type { ShellThumbnailBridge } from './shellThumbnailBridge';
import type { CalibrePreviewBridge } from './calibrePreviewBridge';
import type { AutoCadPreviewBridge } from './autoCadPreviewBridge';
import type { PreviewHostContext, PreviewRect, WindowsPreviewHandlerBridge } from './windowsPreviewHandlerBridge';

const MAX_PATH_BYTES = 32_768;
const MAX_SEARCH_BYTES = 2_048;
const MAX_BATCH = 64;
const MAX_LIST = 500;
const MAX_SEARCH = 500;
const TEXT_PREVIEW_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHUNK_BYTES = 8 * 1024 * 1024;
const BINARY_SAMPLE_BYTES = 32 * 1024;
const PREVIEW_RESOURCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.ndjson', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.log', '.csv', '.tsv', '.xml', '.html', '.htm', '.css', '.scss', '.less', '.js', '.mjs', '.cjs',
  '.ts', '.tsx', '.jsx', '.py', '.rb', '.rs', '.go', '.java', '.kt', '.kts', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.fs', '.fsx', '.vb', '.ps1', '.psm1', '.bat', '.cmd', '.sh', '.zsh', '.fish', '.sql', '.diff',
  '.patch', '.gitignore', '.gitattributes', '.editorconfig', '.env', '.vue', '.svelte', '.tex', '.bib',
]);
const OFFICE_EXTENSIONS = new Set(['.doc', '.docx', '.docm', '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx', '.pptm', '.odt', '.ods', '.odp', '.rtf', '.wps']);
const REVIT_EXTENSIONS = new Set(['.rvt', '.rfa', '.rte', '.rft']);
const IMAGE_MIME = new Map([['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.gif','image/gif'],['.webp','image/webp'],['.bmp','image/bmp'],['.svg','image/svg+xml'],['.ico','image/x-icon'],['.avif','image/avif']]);
const AUDIO_MIME = new Map([['.mp3','audio/mpeg'],['.wav','audio/wav'],['.ogg','audio/ogg'],['.m4a','audio/mp4'],['.aac','audio/aac'],['.flac','audio/flac'],['.opus','audio/ogg']]);
const VIDEO_MIME = new Map([['.mp4','video/mp4'],['.m4v','video/mp4'],['.webm','video/webm'],['.ogv','video/ogg'],['.mov','video/quicktime']]);

export interface FileCapabilityEntry {
  path: string; name: string; parent: string; kind: 'file' | 'folder'; extension: string;
  size: number | null; createdAt: number | null; modifiedAt: number | null; identity: string | null;
}
export interface FileCapabilityDeps {
  everythingSearch: EverythingSearchBridge | null;
  previewResources: FilePreviewResourceRegistry;
  pdfPreview: PdfPreviewHostBridge | null;
  revitPreview: RevitPreviewBridge | null;
  shellThumbnail: ShellThumbnailBridge | null;
  calibrePreview: CalibrePreviewBridge | null;
  autoCadPreview: AutoCadPreviewBridge | null;
  windowsPreview: WindowsPreviewHandlerBridge | null;
  dopusrtPath: string | null;
  libreOfficePath: string | null;
  openPath: (target: string) => Promise<string | void>;
  revealPath: (target: string) => void;
}
export interface FileCapabilityContext {
  backpackId: string;
  nativePreviewHost?: PreviewHostContext;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function boundedString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const text = value.trim();
  if (!text || Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`${label} is outside the allowed size.`);
  return text;
}
function absolutePath(value: unknown, label = 'path'): string {
  const target = boundedString(value, label, MAX_PATH_BYTES);
  if (!path.isAbsolute(target)) throw new Error(`${label} must be an absolute path.`);
  return path.normalize(target);
}
function pathList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH) throw new Error(`paths must contain between 1 and ${MAX_BATCH} items.`);
  return value.map((entry, index) => absolutePath(entry, `paths[${index}]`));
}
function boundedLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`limit must be an integer from 1 to ${max}.`);
  return value;
}
function previewRect(value: unknown): PreviewRect {
  if (!isRecord(value)) throw new Error('rect must be an object.');
  const rect = { x: Number(value.x), y: Number(value.y), width: Number(value.width), height: Number(value.height) };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0
    || Math.abs(rect.x) > 100_000 || Math.abs(rect.y) > 100_000
    || rect.width > 100_000 || rect.height > 100_000) throw new Error('rect is outside the allowed bounds.');
  return rect;
}
function previewSessionId(value: unknown): string {
  const id = boundedString(value, 'sessionId', 64);
  if (!PREVIEW_RESOURCE_ID_PATTERN.test(id)) throw new Error('sessionId is not valid.');
  return id;
}
function safeName(value: unknown): string {
  const name = boundedString(value, 'newName', 1_024);
  if (name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f]/.test(name)) throw new Error('newName is not a valid Windows file name.');
  return name;
}

function numberFromBigInt(value: bigint): number | null {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value < 0n || value > max) return null;
  return Number(value);
}
async function describe(target: string): Promise<FileCapabilityEntry> {
  const stats = await fs.stat(target, { bigint: true });
  const kind = stats.isDirectory() ? 'folder' : 'file';
  return {
    path: target,
    name: path.basename(target) || target,
    parent: path.dirname(target),
    kind,
    extension: kind === 'file' ? path.extname(target).toLowerCase() : '',
    size: kind === 'folder' ? null : numberFromBigInt(stats.size),
    createdAt: numberFromBigInt(stats.birthtimeMs),
    modifiedAt: numberFromBigInt(stats.mtimeMs),
    identity: stats.dev >= 0n && stats.ino >= 0n ? `${stats.dev.toString(16)}:${stats.ino.toString(16)}` : null,
  };
}
async function listDirectory(target: string, limit: number) {
  const entry = await describe(target);
  if (entry.kind !== 'folder') throw new Error('That path is not a folder.');
  const names = await fs.readdir(target);
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const selected = names.slice(0, limit);
  const settled = await Promise.allSettled(selected.map((name) => describe(path.join(target, name))));
  const items = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  items.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { entry, items, truncated: names.length > selected.length };
}
function mostlyText(buffer: Buffer): boolean {
  if (buffer.length === 0) return true;
  let printable = 0;
  for (const byte of buffer) {
    if (byte === 0) return false;
    if (byte === 9 || byte === 10 || byte === 13 || byte >= 32) printable += 1;
  }
  return printable / buffer.length >= 0.88;
}
function hexDump(buffer: Buffer): string {
  const rows: string[] = [];
  for (let offset = 0; offset < buffer.length; offset += 16) {
    const slice = buffer.subarray(offset, offset + 16);
    const hex = [...slice].map((byte) => byte.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = [...slice].map((byte) => byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.').join('');
    rows.push(`${offset.toString(16).padStart(8, '0')}  ${hex}  |${ascii}|`);
  }
  return rows.join('\n');
}
function extractStrings(buffer: Buffer): string[] {
  return (buffer.toString('latin1').match(/[ -~]{4,}/g) ?? []).slice(0, 80);
}
function dataUrl(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

interface ConvertedPreviewFile {
  filePath: string;
  cleanup: () => Promise<void>;
}

async function convertOfficeToPdf(source: string, soffice: string): Promise<ConvertedPreviewFile | null> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'papers-file-preview-'));
  try {
    const outputName = `${path.parse(source).name}.pdf`;
    await new Promise<void>((resolve, reject) => {
      execFile(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', tempRoot, source], {
        windowsHide: true,
        timeout: 30_000,
      }, (error) => error ? reject(error) : resolve());
    });
    const output = path.join(tempRoot, outputName);
    const stats = await fs.stat(output);
    if (!stats.isFile()) throw new Error('LibreOffice did not create a PDF preview.');
    return {
      filePath: output,
      cleanup: () => fs.rm(tempRoot, { recursive: true, force: true }),
    };
  } catch {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    return null;
  }
}

function resourcePreview(
  deps: FileCapabilityDeps,
  context: FileCapabilityContext,
  filePath: string,
  kind: 'image' | 'audio' | 'video' | 'pdf' | 'hosted-pdf',
  mime: string,
  cleanup?: () => void | Promise<void>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const grant = deps.previewResources.grant(context.backpackId, filePath, mime, cleanup);
  return {
    kind,
    mime,
    url: grant.url,
    resourceId: grant.id,
    transport: 'stream',
    ...extra,
  };
}

function safeUtf8End(bytes: Buffer): number {
  if (bytes.length === 0) return 0;
  let lead = bytes.length - 1;
  while (lead >= 0 && (bytes[lead]! & 0xc0) === 0x80) lead -= 1;
  if (lead < 0) return 0;
  const first = bytes[lead]!;
  const width = first < 0x80 ? 1
    : (first & 0xe0) === 0xc0 ? 2
      : (first & 0xf0) === 0xe0 ? 3
        : (first & 0xf8) === 0xf0 ? 4
          : 1;
  return lead + width <= bytes.length ? bytes.length : lead;
}

async function readTextChunk(target: string, offset: number, maxBytes: number): Promise<Record<string, unknown>> {
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error('That path is not a file.');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > stats.size) throw new Error('offset is outside the file.');
  const length = Math.min(maxBytes, Math.max(0, stats.size - offset));
  if (length === 0) return { text: '', byteOffset: offset, nextOffset: offset, eof: true };
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const chunk = buffer.subarray(0, bytesRead);
    const safeEnd = offset + bytesRead < stats.size ? safeUtf8End(chunk) : chunk.length;
    const usable = safeEnd > 0 ? chunk.subarray(0, safeEnd) : chunk;
    const nextOffset = offset + usable.length;
    return {
      text: usable.toString('utf8'),
      byteOffset: offset,
      nextOffset,
      eof: nextOffset >= stats.size,
    };
  } finally {
    await handle.close();
  }
}

async function previewFile(target: string, deps: FileCapabilityDeps, context: FileCapabilityContext): Promise<Record<string, unknown>> {
  const entry = await describe(target);
  if (entry.kind === 'folder') {
    const listing = await listDirectory(target, 200);
    return { ok: true, entry, preview: { kind: 'directory', items: listing.items, truncated: listing.truncated } };
  }
  const extension = entry.extension;
  const stats = await fs.stat(target);
  const mime = IMAGE_MIME.get(extension) ?? AUDIO_MIME.get(extension) ?? VIDEO_MIME.get(extension);
  if (mime) {
    const kind = IMAGE_MIME.has(extension) ? 'image' : AUDIO_MIME.has(extension) ? 'audio' : 'video';
    return { ok: true, entry, preview: resourcePreview(deps, context, target, kind, mime) };
  }
  if (extension === '.pdf') {
    return {
      ok: true,
      entry,
      preview: resourcePreview(
        deps,
        context,
        target,
        deps.pdfPreview && context.nativePreviewHost ? 'hosted-pdf' : 'pdf',
        'application/pdf',
      ),
    };
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    const chunk = await readTextChunk(target, 0, TEXT_PREVIEW_CHUNK_BYTES);
    return { ok: true, entry, preview: { kind: 'text', ...chunk } };
  }
  if (deps.windowsPreview) {
    const available = await deps.windowsPreview.probe(target);
    if (available.available) {
      return { ok: true, entry, preview: { kind: 'windows-preview-handler', provider: 'windows-preview-handler', clsid: available.clsid } };
    }
  }
  if (OFFICE_EXTENSIONS.has(extension) && deps.libreOfficePath) {
    const pdf = await convertOfficeToPdf(target, deps.libreOfficePath);
    if (pdf) {
      return {
        ok: true,
        entry,
        preview: resourcePreview(
          deps,
          context,
          pdf.filePath,
          deps.pdfPreview && context.nativePreviewHost ? 'hosted-pdf' : 'pdf',
          'application/pdf',
          pdf.cleanup,
          { convertedBy: 'libreoffice' },
        ),
      };
    }
  }
  if (deps.calibrePreview?.supports(extension)) {
    const pdf = await deps.calibrePreview.convertToPdf(target);
    if (pdf.ok) {
      return {
        ok: true,
        entry,
        preview: resourcePreview(
          deps,
          context,
          pdf.filePath,
          deps.pdfPreview && context.nativePreviewHost ? 'hosted-pdf' : 'pdf',
          'application/pdf',
          pdf.cleanup,
          { convertedBy: 'calibre', sourceFormat: extension },
        ),
      };
    }
  }
  if (deps.autoCadPreview?.supports(extension)) {
    const rendered = await deps.autoCadPreview.preview(target);
    if (rendered.ok) {
      return {
        ok: true,
        entry,
        preview: {
          kind: 'image',
          mime: 'image/png',
          dataUrl: dataUrl('image/png', rendered.png),
          extractedBy: 'autocad-core-console',
          provider: rendered.provider,
          width: rendered.width,
          height: rendered.height,
        },
      };
    }
  }
  if (deps.shellThumbnail) {
    const thumbnail = await deps.shellThumbnail.preview(target, 1600);
    if (thumbnail.ok) {
      return {
        ok: true,
        entry,
        preview: {
          kind: 'image',
          mime: 'image/png',
          dataUrl: dataUrl('image/png', thumbnail.png),
          extractedBy: 'windows-shell-thumbnail',
          width: thumbnail.width,
          height: thumbnail.height,
        },
      };
    }
  }
  if (REVIT_EXTENSIONS.has(extension) && deps.revitPreview) {
    const extracted = await deps.revitPreview.preview(target);
    if (extracted.ok) {
      return {
        ok: true,
        entry,
        preview: {
          kind: 'image',
          mime: 'image/png',
          dataUrl: dataUrl('image/png', extracted.png),
          extractedBy: 'revit-embedded-preview',
        },
      };
    }
  }
  const headHandle = await fs.open(target, 'r');
  let head: Buffer;
  try {
    const length = Math.min(BINARY_SAMPLE_BYTES, stats.size);
    head = Buffer.alloc(length);
    await headHandle.read(head, 0, length, 0);
  } finally {
    await headHandle.close();
  }
  if (mostlyText(head)) {
    const chunk = await readTextChunk(target, 0, TEXT_PREVIEW_CHUNK_BYTES);
    return { ok: true, entry, preview: { kind: 'text', ...chunk } };
  }
  return { ok: true, entry, preview: { kind: 'binary', hex: hexDump(head), strings: extractStrings(head), truncated: stats.size > head.length } };
}

function parseDopusAppPath(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const marker = line.indexOf('REG_SZ');
    if (marker < 0) continue;
    const value = line.slice(marker + 'REG_SZ'.length).trim();
    if (value.toLowerCase().endsWith('\\dopus.exe')) return value;
  }
  return null;
}

export function resolveDirectoryOpusRtPath(): string | null {
  for (const hive of ['HKLM', 'HKCU']) {
    try {
      const stdout = execFileSync('reg.exe', [
        'query',
        `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\dopus.exe`,
        '/ve',
      ], { encoding: 'utf8', windowsHide: true, timeout: 3_000 });
      const dopus = parseDopusAppPath(stdout);
      if (!dopus) continue;
      const rt = path.join(path.dirname(dopus), 'dopusrt.exe');
      if (statSync(rt).isFile()) return rt;
    } catch {
      // Try the next hive.
    }
  }
  return null;
}

export function resolveLibreOfficePath(): string | null {
  const candidates = [
    path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.exe'),
    path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LibreOffice', 'program', 'soffice.exe'),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next path.
    }
  }
  return null;
}

function runOpus(dopusrtPath: string, command: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(dopusrtPath, ['/cmd', ...command], { windowsHide: true, timeout: 10_000 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function operationViaOpus(
  deps: FileCapabilityDeps,
  operation: 'copy' | 'move' | 'rename' | 'delete',
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (operation === 'copy' || operation === 'move') {
    const sources = pathList(params.paths);
    const destination = absolutePath(params.destination, 'destination');
    if (!deps.dopusrtPath) return { ok: false, code: 'DOPUS_UNAVAILABLE', message: 'Directory Opus is unavailable.' };
    const command = ['Copy', ...sources];
    if (operation === 'move') command.push('MOVE');
    command.push('TO', destination, 'WHENEXISTS=ask');
    await runOpus(deps.dopusrtPath, command);
    return { ok: true, provider: 'directory-opus', operation };
  }

  if (operation === 'rename') {
    const target = absolutePath(params.path);
    const newName = safeName(params.newName);
    if (!deps.dopusrtPath) return { ok: false, code: 'DOPUS_UNAVAILABLE', message: 'Directory Opus is unavailable.' };
    await runOpus(deps.dopusrtPath, ['Rename', target, 'TO', newName, 'WHENEXISTS=ask']);
    return {
      ok: true,
      provider: 'directory-opus',
      operation,
      path: path.join(path.dirname(target), newName),
    };
  }

  const targets = pathList(params.paths);
  if (!deps.dopusrtPath) return { ok: false, code: 'DOPUS_UNAVAILABLE', message: 'Directory Opus is unavailable.' };
  await runOpus(deps.dopusrtPath, ['Delete', ...targets, 'RECYCLE', 'QUIET']);
  return { ok: true, provider: 'directory-opus', operation, recycle: true };
}

export function createFileCapabilityService(deps: FileCapabilityDeps): {
  call(request: unknown, context: FileCapabilityContext): Promise<Record<string, unknown>>;
} {
  return {
    async call(raw, context) {
      if (!isRecord(raw)) {
        return { ok: false, code: 'REQUEST_INVALID', message: 'File capability request must be an object.' };
      }
      const operation = typeof raw.operation === 'string' ? raw.operation : '';
      const params = isRecord(raw.params) ? raw.params : {};
      try {
        switch (operation) {
          case 'providers':
            return {
              ok: true,
              providers: {
                everything: Boolean(deps.everythingSearch),
                revitPreview: Boolean(deps.revitPreview),
                shellThumbnail: Boolean(deps.shellThumbnail),
                calibrePreview: Boolean(deps.calibrePreview),
                calibreFormats: deps.calibrePreview?.formats ?? [],
                autoCadPreview: Boolean(deps.autoCadPreview),
                windowsPreview: Boolean(deps.windowsPreview),
                directoryOpus: Boolean(deps.dopusrtPath),
                libreOffice: Boolean(deps.libreOfficePath),
              },
            };
          case 'stat':
            return { ok: true, entry: await describe(absolutePath(params.path)) };
          case 'list':
            return {
              ok: true,
              ...(await listDirectory(
                absolutePath(params.path),
                boundedLimit(params.limit, 200, MAX_LIST),
              )),
            };
          case 'search': {
            const query = boundedString(params.query, 'query', MAX_SEARCH_BYTES);
            const limit = boundedLimit(params.limit, 100, MAX_SEARCH);
            if (!deps.everythingSearch) {
              return {
                ok: false,
                code: 'EVERYTHING_UNAVAILABLE',
                message: 'Everything search is unavailable.',
                results: [],
              };
            }
            return await deps.everythingSearch.search(query, limit);
          }
          case 'preview':
            return await previewFile(absolutePath(params.path), deps, context);
          case 'preview-native-open': {
            if (!deps.windowsPreview || !context.nativePreviewHost) return { ok: false, code: 'WINDOWS_PREVIEW_UNAVAILABLE', message: 'Windows preview hosting is unavailable.' };
            return await deps.windowsPreview.open(context.nativePreviewHost, absolutePath(params.path), previewRect(params.rect));
          }
          case 'preview-native-move': {
            if (!deps.windowsPreview || !context.nativePreviewHost) return { ok: false, code: 'WINDOWS_PREVIEW_UNAVAILABLE', message: 'Windows preview hosting is unavailable.' };
            return { ok: deps.windowsPreview.move(context.nativePreviewHost.ownerKey, previewSessionId(params.sessionId), previewRect(params.rect)) };
          }
          case 'preview-native-focus': {
            if (!deps.windowsPreview || !context.nativePreviewHost) return { ok: false, code: 'WINDOWS_PREVIEW_UNAVAILABLE', message: 'Windows preview hosting is unavailable.' };
            return { ok: deps.windowsPreview.focus(context.nativePreviewHost.ownerKey, previewSessionId(params.sessionId)) };
          }
          case 'preview-native-close': {
            if (!deps.windowsPreview || !context.nativePreviewHost) return { ok: false, code: 'WINDOWS_PREVIEW_UNAVAILABLE', message: 'Windows preview hosting is unavailable.' };
            return { ok: deps.windowsPreview.close(context.nativePreviewHost.ownerKey, previewSessionId(params.sessionId)) };
          }
          case 'preview-pdf-open': {
            if (!deps.pdfPreview || !context.nativePreviewHost) return { ok: false, code: 'PDF_PREVIEW_UNAVAILABLE', message: 'PDF preview hosting is unavailable.' };
            const resourceId = boundedString(params.resourceId, 'resourceId', 64);
            if (!PREVIEW_RESOURCE_ID_PATTERN.test(resourceId)) throw new Error('resourceId is not a valid preview resource.');
            const record = deps.previewResources.resolve(context.backpackId, resourceId);
            if (!record || record.mime !== 'application/pdf') {
              return { ok: false, code: 'PDF_PREVIEW_UNAVAILABLE', message: 'PDF preview resource is unavailable.' };
            }
            const url = `${FILE_PREVIEW_SCHEME}://${context.backpackId}/${resourceId}/${encodeURIComponent(path.basename(record.filePath) || 'preview.pdf')}`;
            return await deps.pdfPreview.open(
              context.nativePreviewHost,
              url,
              previewRect(params.rect),
              () => { deps.previewResources.revoke(context.backpackId, resourceId); },
            );
          }
          case 'preview-pdf-move': {
            if (!deps.pdfPreview || !context.nativePreviewHost) return { ok: false, code: 'PDF_PREVIEW_UNAVAILABLE', message: 'PDF preview hosting is unavailable.' };
            return { ok: deps.pdfPreview.move(context.nativePreviewHost.ownerKey, previewSessionId(params.sessionId), previewRect(params.rect)) };
          }
          case 'preview-pdf-close': {
            if (!deps.pdfPreview || !context.nativePreviewHost) return { ok: false, code: 'PDF_PREVIEW_UNAVAILABLE', message: 'PDF preview hosting is unavailable.' };
            return { ok: deps.pdfPreview.close(context.nativePreviewHost.ownerKey, previewSessionId(params.sessionId)) };
          }
          case 'preview-text-chunk': {
            const target = absolutePath(params.path);
            const offset = params.offset === undefined ? 0 : Number(params.offset);
            const maxBytes = boundedLimit(params.maxBytes, TEXT_PREVIEW_CHUNK_BYTES, MAX_TEXT_CHUNK_BYTES);
            return { ok: true, ...(await readTextChunk(target, offset, maxBytes)) };
          }
          case 'preview-release': {
            const resourceId = boundedString(params.resourceId, 'resourceId', 64);
            if (!PREVIEW_RESOURCE_ID_PATTERN.test(resourceId)) throw new Error('resourceId is not a valid preview resource.');
            return { ok: true, released: deps.previewResources.revoke(context.backpackId, resourceId) };
          }
          case 'open': {
            const error = await deps.openPath(absolutePath(params.path));
            return typeof error === 'string' && error
              ? { ok: false, code: 'OPEN_FAILED', message: error }
              : { ok: true };
          }
          case 'reveal':
            deps.revealPath(absolutePath(params.path));
            return { ok: true };
          case 'copy':
          case 'move':
          case 'rename':
          case 'delete':
            return await operationViaOpus(deps, operation, params);
          default:
            return { ok: false, code: 'OPERATION_UNKNOWN', message: 'Unknown file capability operation.' };
        }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        return {
          ok: false,
          code: typeof code === 'string' ? code : 'FILE_OPERATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
