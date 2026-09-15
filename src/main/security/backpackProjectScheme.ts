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

/**
 * `connect-src` is the ONE relaxation, and it is deliberately narrow.
 *
 * Every other directive stays as tight as it was: no remote scripts, no remote
 * styles, no frames, no forms, no base. What changes is that a project page may
 * open a connection to a service on THIS MACHINE.
 *
 * Why loopback rather than 'none': a Backpack that talks to a service the
 * creator runs is a legitimate shape, and the alternative - a bespoke hole per
 * project - is exactly what this avoids. Why not remote origins: a project page
 * reaching the network at large is a different capability with different risk,
 * and nothing has asked for it.
 *
 * Measured before this change, with a listener on loopback: with
 * `connect-src 'none'` the listener received ZERO requests and the page saw
 * `TypeError: Failed to fetch` - refused before the network layer was reached.
 * Chrome additionally IGNORES a directive carrying the `'none'` keyword
 * alongside source expressions, so `'none'` is removed rather than merely
 * outnumbered.
 *
 * This alone does NOT let a project page use a loopback service: the request
 * then carries `Origin: papers-backpack://<projectId>`, which an ordinary
 * service refuses, and a page cannot read a credential file. The credential and
 * the request itself travel through `localServiceBridge` in the main process.
 */
export function contentSecurityPolicy(origin: string): string {
  return [
    `default-src 'none'`,
    `script-src ${origin}`,
    `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data:`,
    `font-src ${origin}`,
    `connect-src http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`,
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
