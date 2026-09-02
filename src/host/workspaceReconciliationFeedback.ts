/**
 * Scopes feedback suppression to the synchronous Dockview operation Papers is
 * currently applying. Dockview's structural and active-panel callbacks are
 * emitted from the API operation; keeping this boundary synchronous prevents
 * a later user action from being mistaken for reconciliation feedback.
 */
export interface WorkspaceReconciliationFeedbackGate {
  readonly isSuppressed: () => boolean;
  readonly apply: <T>(operation: () => T) => T;
}

export function createWorkspaceReconciliationFeedbackGate(): WorkspaceReconciliationFeedbackGate {
  let depth = 0;
  return {
    isSuppressed: () => depth > 0,
    apply: <T>(operation: () => T): T => {
      depth += 1;
      try {
        return operation();
      } finally {
        depth -= 1;
      }
    },
  };
}
