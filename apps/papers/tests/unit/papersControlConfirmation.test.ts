import { describe, expect, it } from 'vitest';

import { createPapersControlConfirmationBroker } from '../../src/main/control/papersControlConfirmation';

describe('Papers control destructive confirmations', () => {
  it('binds one exact operation and target to one connection', () => {
    const broker = createPapersControlConfirmationBroker({
      now: () => 1_000,
      createId: () => '11111111-1111-4111-8111-111111111111',
    });
    const challenge = broker.issue('connection-a', 'backpack.remove', {
      projectId: 'bp-a', name: 'Alpha',
    });

    expect(challenge).toEqual({
      challengeId: '11111111-1111-4111-8111-111111111111',
      action: 'backpack.remove',
      target: { projectId: 'bp-a', name: 'Alpha' },
      confirmationText: 'DELETE BACKPACK "Alpha"',
      expiresAt: new Date(301_000).toISOString(),
    });
    expect(() => broker.consume('connection-b', challenge.challengeId, challenge.confirmationText))
      .toThrow(/another control connection/);
    expect(() => broker.consume('connection-a', challenge.challengeId, challenge.confirmationText))
      .toThrow(/missing or expired/);
  });

  it('consumes a wrong phrase and refuses expiry and disconnect replay', () => {
    let now = 1_000;
    let next = 0;
    const broker = createPapersControlConfirmationBroker({
      now: () => now,
      createId: () => `${String(++next).padStart(8, '0')}-1111-4111-8111-111111111111`,
      ttlMs: 100,
    });
    const wrong = broker.issue('connection-a', 'backpack.archive', { projectId: 'bp-a', name: 'A\nB' });
    expect(wrong.confirmationText).toBe('ARCHIVE BACKPACK "A\\nB"');
    expect(() => broker.consume('connection-a', wrong.challengeId, 'ARCHIVE BACKPACK "A B"'))
      .toThrow(/did not exactly match/);
    expect(() => broker.consume('connection-a', wrong.challengeId, wrong.confirmationText))
      .toThrow(/missing or expired/);

    const expired = broker.issue('connection-a', 'backpack.archive', { projectId: 'bp-a', name: 'Alpha' });
    now += 101;
    expect(() => broker.consume('connection-a', expired.challengeId, expired.confirmationText))
      .toThrow(/missing or expired/);

    const disconnected = broker.issue('connection-a', 'backpack.archive', { projectId: 'bp-a', name: 'Alpha' });
    broker.revokeConnection('connection-a');
    expect(() => broker.consume('connection-a', disconnected.challengeId, disconnected.confirmationText))
      .toThrow(/missing or expired/);
  });

  it('returns a valid challenge exactly once', () => {
    const broker = createPapersControlConfirmationBroker({
      now: () => 1_000,
      createId: () => '11111111-1111-4111-8111-111111111111',
    });
    const challenge = broker.issue('connection-a', 'backpack.archive', { projectId: 'bp-a', name: 'Alpha' });
    expect(broker.consume('connection-a', challenge.challengeId, challenge.confirmationText)).toEqual(challenge);
    expect(() => broker.consume('connection-a', challenge.challengeId, challenge.confirmationText))
      .toThrow(/missing or expired/);
  });
});
