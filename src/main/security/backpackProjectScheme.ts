/**
 * papers-backpack:// serves static files only from explicitly bound local
 * Backpack projects. Each project receives its own origin via the Backpack ID.
 */
import { net, protocol } from 'electron';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BACKPACK_PROJECT_SCHEME,
  type BackpackProjectService,
} from '../backpacks/backpackProjectService';

const mimeByExtension: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function registerBackpackProjectSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BACKPACK_PROJECT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
      },
    },
  ]);
}

function contentSecurityPolicy(origin: string): string {
  return [
    `default-src 'none'`,
    `script-src ${origin}`,
    `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data:`,
    `font-src ${origin}`,
    `connect-src 'none'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-src 'none'`,
  ].join('; ');
}

export function installBackpackProjectProtocol(service: BackpackProjectService): void {
  protocol.handle(BACKPACK_PROJECT_SCHEME, async (request) => {
    const denied = (status: number, reason: string) =>
      new Response(`Denied: ${reason}`, {
        status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });

    try {
      const url = new URL(request.url);
      const backpackId = url.hostname;
      const file = await service.resolveAsset(backpackId, url.pathname);
      const extension = path.extname(file).toLowerCase();
      const mime = mimeByExtension[extension];
      if (!mime) return denied(415, `unsupported file type ${extension || '(none)'}`);
      const fileResponse = await net.fetch(pathToFileURL(file).toString());
      if (!fileResponse.ok) return denied(404, 'not found');
      return new Response(await fileResponse.arrayBuffer(), {
        status: 200,
        headers: {
          'content-type': mime,
          'content-security-policy': contentSecurityPolicy(
            `${BACKPACK_PROJECT_SCHEME}://${backpackId}`,
          ),
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return denied(403, 'project asset denied');
    }
  });
}
