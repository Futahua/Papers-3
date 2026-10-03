/**
 * CapabilityBroker — the single gate for every privileged program request:
 * identity validation, schema validation, grant checks,
 * prompting, constrained execution, structured errors, non-secret logging.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ZodType } from 'zod';

import type {
  CapabilityError,
  CapabilityRequest,
  PendingPermissionPrompt,
  PermissionDecision,
} from '@shared/types';
import { capabilityRequestSchema } from '@shared/schemas';
import type { ProgramSenderIdentity } from '../canvas/canvasRuntime';
import type { PermissionStore } from './permissionStore';

export class CapabilityFailure extends Error {
  constructor(public readonly capabilityError: CapabilityError) {
    super(capabilityError.message);
  }
}

export type PromptPolicy = 'implicit' | 'prompt';

export interface CapabilityExecutor {
  capability: string;
  policy: PromptPolicy;
  argumentsSchema: ZodType;
  /** One-line human summary of what allowing this request will do. */
  summarize: (args: unknown, identity: ProgramSenderIdentity) => string;
  execute: (args: unknown, identity: ProgramSenderIdentity, request: CapabilityRequest) => Promise<unknown>;
}

export interface PermissionPrompter {
  prompt(prompt: PendingPermissionPrompt): Promise<PermissionDecision>;
}

export interface BrokerOptions {
  permissionStore: PermissionStore;
  prompter: PermissionPrompter;
  logFile: string;
}

export class CapabilityBroker {
  private readonly executors = new Map<string, CapabilityExecutor>();

  constructor(private readonly options: BrokerOptions) {}

  register(executor: CapabilityExecutor): void {
    if (this.executors.has(executor.capability)) {
      throw new Error(`duplicate executor for ${executor.capability}`);
    }
    this.executors.set(executor.capability, executor);
  }

  /** Non-secret decision/result metadata log (plan 11.8). Arguments are never logged. */
  private async log(entry: Record<string, unknown>): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.options.logFile), { recursive: true });
      await fs.appendFile(
        this.options.logFile,
        `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
        'utf8',
      );
    } catch {
      // Logging must never break the request path.
    }
  }

  private fail(code: CapabilityError['code'], message: string, capability?: string): never {
    throw new CapabilityFailure({ code, message, capability });
  }

  /**
   * Handle a program capability request end to end. `identity` must come from
   * the main-process sender registry, never from renderer-supplied fields.
   */
  async handle(identity: ProgramSenderIdentity | null, rawRequest: unknown): Promise<unknown> {
    if (!identity) {
      this.fail('invalid-sender', 'request did not originate from a registered program view');
    }

    const parsed = capabilityRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      await this.log({ programId: identity.programId, outcome: 'invalid-request' });
      this.fail('invalid-arguments', `request failed validation: ${parsed.error.issues[0]?.message}`);
    }
    const request = parsed.data as CapabilityRequest;

    // The renderer-supplied identity fields must match the sender registry.
    if (request.programId !== identity.programId || request.backpackId !== identity.backpackId) {
      await this.log({
        programId: identity.programId,
        capability: request.capability,
        outcome: 'identity-mismatch',
      });
      this.fail(
        'invalid-sender',
        `request identity ${request.backpackId}/${request.programId} does not match sender ${identity.backpackId}/${identity.programId}`,
      );
    }

    if (!identity.manifest.capabilities.includes(request.capability)) {
      await this.log({
        programId: identity.programId,
        capability: request.capability,
        outcome: 'not-declared',
      });
      this.fail(
        'not-declared',
        `program ${identity.programId} does not declare capability ${request.capability}`,
        request.capability,
      );
    }

    const executor = this.executors.get(request.capability);
    if (!executor) {
      this.fail('unavailable', `capability ${request.capability} has no executor`, request.capability);
    }

    const argsParsed = executor.argumentsSchema.safeParse(request.arguments);
    if (!argsParsed.success) {
      await this.log({
        programId: identity.programId,
        capability: request.capability,
        outcome: 'invalid-arguments',
      });
      this.fail(
        'invalid-arguments',
        `arguments failed validation: ${argsParsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
        request.capability,
      );
    }

    // Grant check and prompting.
    if (executor.policy === 'prompt') {
      const granted = this.options.permissionStore.hasProgramGrant(
        request.backpackId,
        request.programId,
        request.capability,
      );
      if (!granted) {
        const prompt: PendingPermissionPrompt = {
          promptId: randomUUID(),
          request,
          summary: executor.summarize(argsParsed.data, identity),
        };
        const decision = await this.options.prompter.prompt(prompt);
        await this.log({
          programId: identity.programId,
          capability: request.capability,
          outcome: `decision:${decision}`,
        });
        if (decision === 'deny') {
          this.fail('denied', `permission denied for ${request.capability}`, request.capability);
        }
        if (decision === 'allow-program') {
          await this.options.permissionStore.grantProgram(
            request.backpackId,
            request.programId,
            request.capability,
          );
        }
      }
    }

    try {
      const result = await executor.execute(argsParsed.data, identity, request);
      await this.log({
        programId: identity.programId,
        capability: request.capability,
        outcome: 'ok',
      });
      return result;
    } catch (err) {
      if (err instanceof CapabilityFailure) {
        await this.log({
          programId: identity.programId,
          capability: request.capability,
          outcome: `error:${err.capabilityError.code}`,
        });
        throw err;
      }
      await this.log({
        programId: identity.programId,
        capability: request.capability,
        outcome: 'error:failed',
      });
      this.fail('failed', `capability execution failed: ${String(err)}`, request.capability);
    }
  }
}
