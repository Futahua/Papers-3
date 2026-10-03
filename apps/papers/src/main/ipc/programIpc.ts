/**
 * IPC surface for sandboxed program renderers. Every handler resolves the
 * caller's identity from the main-process sender registry; renderer-supplied
 * identity is never trusted. Arguments are schema-validated here even though
 * programs are first-party.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';

import { programCommandSchema, shelfContributionSchema } from '@shared/schemas';
import type { ProgramIdentity, SaveStatus } from '@shared/types';
import type { CanvasRuntime, ProgramSenderIdentity } from '../canvas/canvasRuntime';
import type { CanvasSessionState } from '../canvas/canvasState';
import { CapabilityFailure, type CapabilityBroker } from '../capabilities/capabilityBroker';
import type { ProgramStateService } from '../persistence/programStateService';

export interface ProgramIpcDeps {
  runtime: CanvasRuntime;
  canvasState: CanvasSessionState;
  broker: CapabilityBroker;
  stateService: ProgramStateService;
  emitSaveStatus: (status: SaveStatus, detail?: string) => void;
  agentInvoke: (identity: ProgramSenderIdentity, invocation: unknown) => Promise<unknown>;
  agentCancel: (identity: ProgramSenderIdentity, runId: string) => Promise<void>;
}

/** Serialize CapabilityFailure into a structured, renderer-consumable error. */
function rethrow(err: unknown): never {
  if (err instanceof CapabilityFailure) {
    throw new Error(`capability-error:${JSON.stringify(err.capabilityError)}`);
  }
  if (err instanceof Error) throw err;
  throw new Error(String(err));
}

export function registerProgramIpc(deps: ProgramIpcDeps): void {
  const identify = (event: IpcMainInvokeEvent): ProgramSenderIdentity => {
    const identity = deps.runtime.identify(event.sender);
    if (!identity) {
      throw new Error('capability-error:{"code":"invalid-sender","message":"unregistered sender"}');
    }
    return identity;
  };

  const requireDeclared = (identity: ProgramSenderIdentity, capability: string): void => {
    if (!identity.manifest.capabilities.includes(capability)) {
      throw new Error(
        `capability-error:${JSON.stringify({
          code: 'not-declared',
          message: `program ${identity.programId} does not declare ${capability}`,
          capability,
        })}`,
      );
    }
  };

  ipcMain.handle('program:identity', (event): ProgramIdentity => {
    const identity = identify(event);
    return {
      backpackId: identity.backpackId,
      programId: identity.programId,
      programName: identity.manifest.name,
      programVersion: identity.manifest.version,
      apiVersion: 1,
    };
  });

  ipcMain.handle('program:state:load', async (event) => {
    const identity = identify(event);
    requireDeclared(identity, 'storage.read-own');
    return deps.stateService.load(identity.backpackId, identity.programId);
  });

  ipcMain.handle('program:state:save', async (event, value: unknown) => {
    const identity = identify(event);
    requireDeclared(identity, 'storage.write-own');
    deps.emitSaveStatus('saving');
    try {
      await deps.stateService.save(identity.backpackId, identity.programId, value);
      deps.emitSaveStatus('saved');
    } catch (err) {
      deps.emitSaveStatus('error', String(err));
      rethrow(err);
    }
  });

  ipcMain.handle('program:shelf:contribute', (event, rawItems: unknown) => {
    const identity = identify(event);
    const items = z.array(shelfContributionSchema).max(8).parse(rawItems);
    deps.canvasState.setShelf(identity.programId, items);
  });

  ipcMain.handle('program:shelf:clear', (event) => {
    const identity = identify(event);
    deps.canvasState.clearShelf(identity.programId);
  });

  ipcMain.handle('program:commands:register', (event, rawCommands: unknown) => {
    const identity = identify(event);
    const commands = z.array(programCommandSchema).max(64).parse(rawCommands);
    deps.canvasState.setCommands(identity.programId, commands);
  });

  ipcMain.handle('program:summary:publish', async (event, value: unknown) => {
    const identity = identify(event);
    requireDeclared(identity, 'storage.write-own');
    await deps.stateService.publishSummary(identity.backpackId, identity.programId, value);
  });

  ipcMain.handle('program:capability:request', async (event, request: unknown) => {
    const identity = identify(event);
    try {
      return await deps.broker.handle(identity, request);
    } catch (err) {
      rethrow(err);
    }
  });

  ipcMain.handle('program:agent:invoke', async (event, invocation: unknown) => {
    const identity = identify(event);
    requireDeclared(identity, 'agent.invoke');
    try {
      return await deps.agentInvoke(identity, invocation);
    } catch (err) {
      rethrow(err);
    }
  });

  ipcMain.handle('program:agent:cancel', async (event, runId: unknown) => {
    const identity = identify(event);
    requireDeclared(identity, 'agent.cancel-own');
    const parsed = z.string().min(1).max(128).parse(runId);
    try {
      await deps.agentCancel(identity, parsed);
    } catch (err) {
      rethrow(err);
    }
  });
}
