import { randomUUID } from 'node:crypto';

export const PAPERS_CONTROL_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type PapersControlDestructiveAction = 'backpack.archive' | 'backpack.remove';

export interface PapersControlConfirmationTarget {
  projectId: string;
  name: string;
}

export interface PapersControlConfirmationChallenge {
  challengeId: string;
  action: PapersControlDestructiveAction;
  target: PapersControlConfirmationTarget;
  confirmationText: string;
  expiresAt: string;
}

interface StoredChallenge extends PapersControlConfirmationChallenge {
  connectionId: string;
  expiresAtMs: number;
}

export interface PapersControlConfirmationBroker {
  issue(connectionId: string, action: PapersControlDestructiveAction, target: PapersControlConfirmationTarget): PapersControlConfirmationChallenge;
  consume(connectionId: string, challengeId: string, confirmationText: string): PapersControlConfirmationChallenge;
  revokeConnection(connectionId: string): void;
}

function expectedConfirmationText(action: PapersControlDestructiveAction, name: string): string {
  const verb = action === 'backpack.archive' ? 'ARCHIVE' : 'DELETE';
  return `${verb} BACKPACK ${JSON.stringify(name)}`;
}

/**
 * In-memory, connection-bound confirmation challenges.
 *
 * The descriptor token authenticates the control client; this second boundary
 * prevents an accidental or stale destructive call. A challenge names the
 * exact operation and target, expires quickly, cannot cross connections, and
 * is consumed by the first execution attempt whether that attempt succeeds or
 * fails. No challenge or approval survives a Papers restart.
 */
export function createPapersControlConfirmationBroker({
  now = () => Date.now(),
  createId = () => randomUUID(),
  ttlMs = PAPERS_CONTROL_CONFIRMATION_TTL_MS,
}: {
  now?: () => number;
  createId?: () => string;
  ttlMs?: number;
} = {}): PapersControlConfirmationBroker {
  const challenges = new Map<string, StoredChallenge>();

  function purgeExpired(at: number): void {
    for (const [challengeId, challenge] of challenges) {
      if (challenge.expiresAtMs <= at) challenges.delete(challengeId);
    }
  }

  return {
    issue(connectionId, action, target) {
      const issuedAt = now();
      purgeExpired(issuedAt);
      const challengeId = createId();
      const expiresAtMs = issuedAt + ttlMs;
      const challenge: StoredChallenge = {
        challengeId,
        action,
        target: { ...target },
        confirmationText: expectedConfirmationText(action, target.name),
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        connectionId,
      };
      challenges.set(challengeId, challenge);
      const { connectionId: _connectionId, expiresAtMs: _expiresAtMs, ...publicChallenge } = challenge;
      return publicChallenge;
    },

    consume(connectionId, challengeId, confirmationText) {
      const consumedAt = now();
      const challenge = challenges.get(challengeId);
      // Consume on the first attempt, including a wrong connection or phrase.
      // This prevents guessing and replay after any refusal.
      challenges.delete(challengeId);
      purgeExpired(consumedAt);
      if (!challenge || challenge.expiresAtMs <= consumedAt) {
        throw new Error('That confirmation challenge is missing or expired.');
      }
      if (challenge.connectionId !== connectionId) {
        throw new Error('That confirmation challenge belongs to another control connection.');
      }
      if (confirmationText !== challenge.confirmationText) {
        throw new Error('Confirmation text did not exactly match the requested destructive action.');
      }
      const { connectionId: _connectionId, expiresAtMs: _expiresAtMs, ...publicChallenge } = challenge;
      return publicChallenge;
    },

    revokeConnection(connectionId) {
      for (const [challengeId, challenge] of challenges) {
        if (challenge.connectionId === connectionId) challenges.delete(challengeId);
      }
    },
  };
}
