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
import type { ProgramStateService } from '../persistence/programStateService';

export interface CoreExecutorDeps {
  broker: CapabilityBroker;
  paths: PapersPaths;
  facade: PapersHostFacade;
  stateService: ProgramStateService;
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
    capability: 'program.read-shared-summary',
    policy: 'prompt',
    argumentsSchema: z
      .object({ sourceProgramId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })
      .strict(),
    summarize: (args, identity) =>
      `Let ${identity.programId} read the summary that "${(args as { sourceProgramId: string }).sourceProgramId}" explicitly publishes (never its full state)`,
    execute: async (args, identity) => {
      const source = (args as { sourceProgramId: string }).sourceProgramId;
      if (source === identity.programId) throw new Error('a program already owns its own summary');
      return {
        sourceProgramId: source,
        summary: await deps.stateService.readSummary(identity.backpackId, source),
      };
    },
  });
}
