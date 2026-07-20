/**
 * Core capability executors available to all programs that declare them.
 * Resource and Git executors are registered separately by the workflow
 * services that own them.
 */
import { clipboard } from 'electron';
import { z } from 'zod';

import type { CapabilityBroker } from './capabilityBroker';
import type { PapersPaths } from '../persistence/paths';
import type { PapersHostFacade } from '../hostFacade';

export interface CoreExecutorDeps {
  broker: CapabilityBroker;
  paths: PapersPaths;
  facade: PapersHostFacade;
}

export function registerCoreExecutors(deps: CoreExecutorDeps): void {
  deps.broker.register({
    capability: 'clipboard.write',
    policy: 'prompt',
    argumentsSchema: z.object({ text: z.string().max(1_000_000) }).strict(),
    summarize: (args) =>
      `Copy ${(args as { text: string }).text.length} characters to the clipboard`,
    execute: async (args) => {
      clipboard.writeText((args as { text: string }).text);
      return { ok: true };
    },
  });

  deps.broker.register({
    capability: 'external.open',
    policy: 'prompt',
    argumentsSchema: z
      .object({
        target: z.literal('url'),
        url: z.string().url().max(2_000),
      })
      .strict(),
    summarize: (args) => `Open ${(args as { url: string }).url} in the default browser`,
    execute: async (args) => {
      await deps.facade.openExternalUrl((args as { url: string }).url);
      return { ok: true };
    },
  });
}
