/**
 * ExternalApplicationBridge (plan section 17) — verified open/launch for
 * files, URLs, the system file browser, and LibreOffice. Paths are validated
 * against granted resources; processes launch with structured argument
 * arrays; opening a document never implies it was saved.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { shell } from 'electron';
import { z } from 'zod';

import type { CapabilityBroker } from '../capabilities/capabilityBroker';
import type { ResourceService } from '../resources/resourceService';

const LIBREOFFICE_CANDIDATES = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
];

export async function findLibreOffice(): Promise<string | null> {
  for (const candidate of LIBREOFFICE_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

const openArgs = z.discriminatedUnion('target', [
  z.object({ target: z.literal('url'), url: z.string().url().max(2_000) }).strict(),
  z.object({ target: z.literal('resource'), resourceId: z.string().max(128) }).strict(),
  z
    .object({ target: z.literal('show-in-folder'), resourceId: z.string().max(128) })
    .strict(),
]);

const launchArgs = z
  .object({
    application: z.enum(['libreoffice-writer', 'libreoffice-calc']),
    resourceId: z.string().max(128),
  })
  .strict();

export interface ExternalExecutorDeps {
  broker: CapabilityBroker;
  resources: ResourceService;
}

export function registerExternalExecutors(deps: ExternalExecutorDeps): void {
  const { broker, resources } = deps;

  broker.register({
    capability: 'external.open',
    policy: 'prompt',
    argumentsSchema: openArgs,
    summarize: (args) => {
      const a = args as z.infer<typeof openArgs>;
      if (a.target === 'url') return `Open ${a.url} in the default browser`;
      if (a.target === 'show-in-folder') return 'Reveal a granted file in the system file browser';
      return 'Open a granted file with its default application';
    },
    execute: async (args, identity) => {
      const a = args as z.infer<typeof openArgs>;
      if (a.target === 'url') {
        const parsed = new URL(a.url);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          throw new Error('only http(s) URLs may be opened');
        }
        await shell.openExternal(parsed.toString());
        return { opened: true };
      }
      const entry = await resources.requireGranted(
        identity.backpackId,
        identity.programId,
        a.resourceId,
      );
      if (a.target === 'show-in-folder') {
        shell.showItemInFolder(path.resolve(entry.path));
        return { opened: true };
      }
      const result = await shell.openPath(path.resolve(entry.path));
      if (result) throw new Error(`system could not open the file: ${result}`);
      return { opened: true };
    },
  });

  broker.register({
    capability: 'external.launch-approved',
    policy: 'prompt',
    argumentsSchema: launchArgs,
    summarize: (args) => {
      const a = args as z.infer<typeof launchArgs>;
      const app = a.application === 'libreoffice-writer' ? 'LibreOffice Writer' : 'LibreOffice Calc';
      return `Launch ${app} with a granted document. Papers does not track edits you make there; register the final file explicitly when done.`;
    },
    execute: async (args, identity) => {
      const a = args as z.infer<typeof launchArgs>;
      const entry = await resources.requireGranted(
        identity.backpackId,
        identity.programId,
        a.resourceId,
      );
      const soffice = await findLibreOffice();
      if (!soffice) {
        throw new Error(
          'LibreOffice is not installed at a known location (checked Program Files). Install LibreOffice or open the file another way.',
        );
      }
      const documentPath = path.resolve(entry.path);
      await fs.access(documentPath);
      const moduleFlag = a.application === 'libreoffice-writer' ? '--writer' : '--calc';
      const child = spawn(soffice, [moduleFlag, documentPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      const launched = await new Promise<boolean>((resolve) => {
        child.once('spawn', () => resolve(true));
        child.once('error', () => resolve(false));
      });
      if (!launched) throw new Error('LibreOffice failed to start');
      child.unref();
      return { launched: true, executable: soffice };
    },
  });
}
