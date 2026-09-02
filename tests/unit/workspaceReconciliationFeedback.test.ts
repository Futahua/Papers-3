import { describe, expect, it } from 'vitest';

import { createWorkspaceReconciliationFeedbackGate } from '../../src/host/workspaceReconciliationFeedback';

describe('workspace Dockview reconciliation feedback', () => {
  it('suppresses only callbacks inside the canonical apply operation', () => {
    const gate = createWorkspaceReconciliationFeedbackGate();
    const callbacks: string[] = [];
    const emit = (name: string): void => {
      if (!gate.isSuppressed()) callbacks.push(name);
    };

    gate.apply(() => {
      emit('move');
      emit('active');
      emit('layout');
    });

    expect(callbacks).toEqual([]);
    emit('user-move');
    expect(callbacks).toEqual(['user-move']);
  });

  it('restores feedback immediately and supports nested canonical operations', () => {
    const gate = createWorkspaceReconciliationFeedbackGate();
    const states: boolean[] = [];

    gate.apply(() => {
      states.push(gate.isSuppressed());
      gate.apply(() => states.push(gate.isSuppressed()));
      states.push(gate.isSuppressed());
    });
    states.push(gate.isSuppressed());

    expect(states).toEqual([true, true, true, false]);
  });
});
