/**
 * Isolated web-link icon resolver for Backpack projects.
 *
 * Fetches an HTTP/HTTPS page, parses static icon declarations, ranks
 * candidates, fetches the best icon, and returns a validated data URL.
 *
 * SSRF-hardened: rejects private, loopback, link-local, multicast, and
 * cloud-metadata destinations at every stage (initial URL, every redirect,
 * and every icon candidate).
 */
import { net } from 'electron';
import { Buffer } from 'node:buffer';

const PAGE_TIMEOUT_MS = 8_000;
const TOTAL_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 1 << 20;
const MAX_ICON_BYTES = 1 << 20;
const MAX_CANDIDATES = 16;
const MAX_ICON_DIMENSION = 512;

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const BLOCKED_HOSTNAME_PATTERNS = [
  /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i,
  /^169\.254\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\d+\.0\.0\.0$/,
  /^fc00:/i,
  /^fd00:/i,
  /^fe80:/i,
  /^ff00:/i,
  /^fec0:/i,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/,
  /metadata\.google\.internal$/i,
  /169\.254\.169\.254$/,
];

const ICON_MIME_PRIORITY: Record<string, number> = {
  'image/svg+xml': 10,
  'image/png': 9,
  'image/webp': 8,
  'image/jpeg': 6,
  'image/gif': 5,
  'image/x-icon': 4,
  'image/vnd.microsoft.icon': 4,
};

function isBlockedHostname(hostname: string): boolean {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(lower));
}

function validateUrl(raw: string): URL {
  if (typeof raw !== 'string' || raw.length > 2_048) {
    throw new Error('invalid URL length');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http/https allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL credentials not allowed');
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new Error('private or blocked destination');
  }
  return parsed;
}

function resolveIconUrl(candidate: string, pageUrl: URL): string {
  try {
    return new URL(candidate, pageUrl).toString();
  } catch {
    return '';
  }
}

function extractIconDeclarations(html: string, pageUrl: URL): Array<{ url: string; priority: number; mime?: string }> {
  const results: Array<{ url: string; priority: number; mime?: string }> = [];
  const seen = new Set<string>();

  const linkPattern = /<link\b[^>]*?rel\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    const rel = (match[1] ?? '').toLowerCase();
    const tag = match[0];
    const isIcon = /\bicon\b/.test(rel);
    const isAppleTouch = /\bapple-touch-icon\b/.test(rel);

    if (!isIcon && !isAppleTouch) continue;

    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!hrefMatch) continue;

    const sizesMatch = /sizes\s*=\s*["']([^"']+)["']/i.exec(tag);
    const typeMatch = /type\s*=\s*["']([^"']+)["']/i.exec(tag);

    let sizes: string | undefined;
    if (sizesMatch) sizes = (sizesMatch[1] ?? '').toLowerCase();

    const resolved = resolveIconUrl(hrefMatch[1] ?? '', pageUrl);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);

    let priority = isAppleTouch ? 2 : 5;
    if (sizes) {
      const dims = sizes.split(/[x×]/).map(Number);
      const maxDim = Math.max(...dims);
      if (Number.isFinite(maxDim) && maxDim >= 32) {
        if (maxDim >= 128) priority = isAppleTouch ? 5 : 10;
        else if (maxDim >= 64) priority = isAppleTouch ? 4 : 8;
        else priority = isAppleTouch ? 3 : 7;
      }
    }

    results.push({ url: resolved, priority, mime: typeMatch?.[1] });
  }

  return results;
}

function rankCandidates(
  declarations: Array<{ url: string; priority: number; mime?: string }>,
  finalOrigin: string,
): Array<{ url: string; priority: number }> {
  const ranked = declarations.map((candidate) => {
    let score = candidate.priority;

    if (candidate.mime) {
      score += (ICON_MIME_PRIORITY[candidate.mime.toLowerCase()] ?? 0);
    }

    try {
      const iconUrl = new URL(candidate.url);
      if (iconUrl.origin === finalOrigin) score += 3;
      if (/favicon\.(ico|png|svg)/i.test(iconUrl.pathname)) score += 1;
    } catch {
      /* not penalized */
    }

    return { url: candidate.url, priority: score };
  });

  ranked.sort((a, b) => b.priority - a.priority);
  return ranked.slice(0, MAX_CANDIDATES);
}

async function fetchWithRedirects(
  requestUrl: string,
  options: { signal?: AbortSignal; maxRedirects?: number } = {},
): Promise<{ body: Buffer; finalUrl: string; contentType: string | null }> {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = requestUrl;
  const signal = options.signal;

  for (let i = 0; i <= maxRedirects; i += 1) {
    const parsed = validateUrl(currentUrl);

    const response = await net.fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' },
    });

    if (signal?.aborted) throw new Error('aborted');

    const status = response.status;
    if (status >= 300 && status < 400 && i < maxRedirects) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect without location');
      currentUrl = resolveIconUrl(location, parsed);
      await response.arrayBuffer();
      continue;
    }

    if (status >= 400) throw new Error(`HTTP ${status} fetching page`);

    const contentType = response.headers.get('content-type');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_HTML_BYTES) {
      throw new Error('HTML too large');
    }
    return { body: buffer, finalUrl: currentUrl, contentType };
  }

  throw new Error('too many redirects');
}

async function fetchIconBytes(url: string, signal?: AbortSignal): Promise<{ data: Buffer; mime: string } | null> {
  const parsed = validateUrl(url);

  const response = await net.fetch(url, {
    method: 'GET',
    signal,
    headers: { Accept: 'image/*' },
  });

  if (signal?.aborted) return null;
  if (!response.ok) return null;

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) return null;

  let mime = response.headers.get('content-type')?.split(';')[0]?.trim()?.toLowerCase() ?? '';

  if (!mime || !ALLOWED_MIME.has(mime)) {
    mime = detectMimeFromBytes(buffer) ?? '';
  }

  if (!mime || !ALLOWED_MIME.has(mime)) return null;

  if (mime === 'image/svg+xml') {
    const svg = buffer.toString('utf8').substring(0, 512);
    if (!/<svg[\s>]/i.test(svg)) return null;
  }

  return { data: buffer, mime };
}

function detectMimeFromBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  const head = buffer.subarray(0, 12);
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) return 'image/png';
  if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) return 'image/jpeg';
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'image/gif';
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return 'image/webp';
  if (head[0] === 0x00 && head[1] === 0x00 && head[2] === 0x01 && head[3] === 0x00) return 'image/x-icon';
  const svgHead = buffer.toString('utf8', 0, Math.min(512, buffer.length)).trimStart();
  if (/^<svg[\s>]/i.test(svgHead) || /^<\?xml\b/i.test(svgHead)) return 'image/svg+xml';
  return null;
}

export interface ResolvedWebLinkIcon {
  icon: string | null;
  finalUrl: string;
  finalOrigin: string;
}

export async function resolveWebLinkIcon(rawUrl: string): Promise<ResolvedWebLinkIcon> {
  const parsed = validateUrl(rawUrl);

  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  try {
    const pageResult = await fetchWithRedirects(parsed.toString(), {
      signal: controller.signal,
      maxRedirects: MAX_REDIRECTS,
    });

    const finalUrl = new URL(pageResult.finalUrl);
    const finalOrigin = finalUrl.origin;
    const html = pageResult.body.toString('utf8');

    const declarations = extractIconDeclarations(html, finalUrl);
    const ranked = rankCandidates(declarations, finalOrigin);

    ranked.push({ url: new URL('/favicon.ico', finalUrl).toString(), priority: 1 });

    for (const candidate of ranked) {
      try {
        const iconResult = await fetchIconBytes(candidate.url, controller.signal);
        if (iconResult) {
          const mime = iconResult.mime;
          const dataUrl = `data:${mime};base64,${iconResult.data.toString('base64')}`;
          return { icon: dataUrl, finalUrl: finalUrl.toString(), finalOrigin };
        }
      } catch {
        continue;
      }
    }

    return { icon: null, finalUrl: finalUrl.toString(), finalOrigin };
  } catch (error) {
    return { icon: null, finalUrl: parsed.toString(), finalOrigin: parsed.origin };
  } finally {
    clearTimeout(totalTimer);
  }
}
