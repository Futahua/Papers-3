/**
 * papers-program:// scheme — the only origin program renderers can load.
 *
 * Serves exclusively packaged first-party program files from the programs
 * root. Rejects traversal, absolute paths, and unknown programs. Applies a
 * restrictive Content Security Policy to every response (plan section 7).
 */
import { protocol, net } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROGRAM_SCHEME = 'papers-program';

/** Must be called before app.whenReady(). */
export function registerProgramSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROGRAM_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
      },
    },
  ]);
}

const mimeByExtension: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function programContentSecurityPolicy(programOrigin: string): string {
  return [
    `default-src 'none'`,
    `script-src ${programOrigin}`,
    `style-src ${programOrigin} 'unsafe-inline'`,
    `img-src ${programOrigin} data:`,
    `font-src ${programOrigin}`,
    `connect-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-src 'none'`,
  ].join('; ');
}

export interface ProgramSchemeOptions {
  programsRoot: string;
  /** Program ids allowed to be served (validated manifests only). */
  isKnownProgram: (programId: string) => boolean;
}

export function installProgramProtocolHandler(options: ProgramSchemeOptions): void {
  protocol.handle(PROGRAM_SCHEME, async (request) => {
    const denied = (status: number, reason: string) =>
      new Response(`Denied: ${reason}`, {
        status,
        headers: { 'content-type': 'text/plain' },
      });

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return denied(400, 'malformed URL');
    }

    const programId = url.hostname;
    if (!options.isKnownProgram(programId)) {
      return denied(403, 'unknown program');
    }

    const requestPath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    if (requestPath.includes('..') || requestPath.includes('\0') || path.isAbsolute(requestPath)) {
      return denied(403, 'invalid path');
    }

    const programDir = path.join(options.programsRoot, programId);
    const filePath = path.normalize(path.join(programDir, requestPath));
    const relative = path.relative(programDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return denied(403, 'path escapes program directory');
    }

    const extension = path.extname(filePath).toLowerCase();
    const mime = mimeByExtension[extension];
    if (!mime) {
      return denied(415, `unsupported file type ${extension || '(none)'}`);
    }

    const fileResponse = await net.fetch(pathToFileURL(filePath).toString());
    if (!fileResponse.ok) {
      return denied(404, 'not found');
    }
    const body = await fileResponse.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': mime,
        'content-security-policy': programContentSecurityPolicy(`${PROGRAM_SCHEME}://${programId}`),
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
