/** Single owner of workspace history and persistence. All state mutations
 * route through this store: history-bearing edits go through commit(), and
 * non-historical view/position changes go through replace(). The document
 * state itself lives in the injected getState/setState pair so the entry can
 * keep its existing references while every write funnels through the store.
 *
 * prepare() (when provided) runs before installing a committed state — the
 * entry uses it to fold the current navigation session into the saved view.
 * The store clears the session selection directly before invoking prepare().
 * afterCommit() runs after the new state is installed but before persisting. */
/** A queued save that was abandoned because its generation was invalidated.
 * It never reached persistence. */
export const SUPERSEDED_SAVE = Object.freeze({ superseded: true });

/** User-visible sentence for a save refusal. Machine-readable codes stay on
 * the result objects; no raw code may reach status text or toasts. */
function humanSaveRefusal(outcome) {
  switch (outcome?.code) {
    case 'STALE_REVISION':
      return 'This board changed somewhere else before your change could save. Use the latest version or keep your version below.';
    case 'SCOPE_VIOLATION':
      return 'This change reaches outside the project scope and was refused. Nothing was saved.';
    case 'WRITER_ACK_TIMEOUT':
      return 'The editing view did not answer in time. Your change was not saved; try again.';
    case 'WRITER_DIED':
      return 'The editing view went away before confirming your change. Nothing was overwritten; try again.';
    case 'MUTATION_UNCERTAIN':
      return 'Your change could not be confirmed. Nothing was overwritten; try again.';
    case 'MUTATION_CANCELLATION_PENDING':
      return 'A previous change is still settling. Wait a moment and try again.';
    default:
      return typeof outcome?.message === 'string' && outcome.message
        ? outcome.message
        : 'The document was not committed.';
  }
}


export function createWorkspaceStore({
  getState,
  setState,
  persist,
  normalizeState,
  prepare,
  afterCommit,
  setStatus,
  initialSession = {},
  // 0B: document-write authority. A surface that is not the writer must stop
  // before it changes local document or history state -- not after, and never
  // by quietly dropping the save. A dropped save is the silent loss this whole
  // effort exists to remove. `install` is deliberately NOT gated: the writer's
  // broadcasts and conflict recovery must still be able to replace the
  // authoritative document, and session-only setters stay free so a view can
  // still navigate, select and expand.
  canMutateDocument = () => true,
  onMutationBlocked = () => {},
  onSaveGenerationInvalidated = () => {},
}) {
  let undoStack = [];
  let redoStack = [];
  let saveQueue = Promise.resolve();
  let lastSaveError = null;
  let lastPersistedSnapshot = null;
  let lastQueuedSnapshot = null;
  const queuedSaves = [];
  let saveSequence = 0;
  function invalidateGeneration(generation) {
    // Let coordination preserve the newest dependent local generation (R1 +
    // queued R2) before queue cleanup discards its entries.
    onSaveGenerationInvalidated(generation, latestQueuedSnapshot);
    for (let index = queuedSaves.length - 1; index >= 0; index -= 1) {
      if (queuedSaves[index].generation === generation) queuedSaves.splice(index, 1);
    }
    saveGeneration += 1;
    latestQueuedSnapshot = null;
    // The next generation must merge against authoritative bytes immediately;
    // asynchronous cleanup of abandoned promises cannot remain its base.
    lastQueuedSnapshot = lastPersistedSnapshot;
  }
  /**
   * 0B: persistence generation.
   *
   * A save that loses a compare-and-set is not the only save in flight —
   * later edits may already be queued behind it, and they carry snapshots
   * built on the same superseded document. Letting them run after the
   * creator resolves the conflict would write a prehistoric board over the
   * resolution. Throwing them away instead loses the creator's newest edit,
   * which may only exist in the last queued snapshot.
   *
   * So the queue is stamped with a generation. Invalidating it settles every
   * queued job as superseded WITHOUT calling persist, and hands back the
   * newest serialized snapshot from that generation so the conflict can offer
   * it as "my version".
   */
  let saveGeneration = 0;
  let latestQueuedSnapshot = null;
  const session = {
    selected: new Set(),
    // Sets are selected separately from items, and deliberately so: it lets
    // Delete mean two different things without either being a surprise —
    // removing a grouping and leaving its contents alone, or binning items.
    // A shared selection would have to guess which was meant.
    selectedSets: new Set(),
    selectionAnchor: null,
    currentId: null,
    binCurrentId: 'bin',
    binMode: false,
    graphExpanded: new Set(),
    // The active trail-expansion set for the CURRENT view context
    // (Assignment 007). Synced by the render path from
    // view.trailExpandedByContext; each view context has its own set and
    // defaults to empty. Never seeded from or written into graphExpanded.
    trailExpanded: new Set(),
    clipboard: null,
    ...initialSession,
  };

  function save(nextState = getState(), metadata) {
    const snapshot = JSON.stringify(nextState);
    const generation = saveGeneration;
    const baseSerialized = lastQueuedSnapshot ?? lastPersistedSnapshot;
    const sequence = ++saveSequence;
    const entry = { snapshot, generation, baseSerialized, sequence };
    queuedSaves.push(entry);
    lastQueuedSnapshot = snapshot;
    latestQueuedSnapshot = snapshot;
    const operation = saveQueue
      .catch(() => undefined)
      .then(async () => {
        // Checked when the job actually runs, not when it was queued: the
        // generation may have been invalidated while it waited.
        if (generation !== saveGeneration) return SUPERSEDED_SAVE;
        const queuedPending = queuedSaves
          .filter((candidate) => candidate !== entry && candidate.generation === generation)
          .map((candidate) => ({ serialized: candidate.snapshot, baseSerialized: candidate.baseSerialized, generation: candidate.generation, sequence: candidate.sequence }));
        const persistMetadata = metadata && typeof metadata === 'object'
          ? {
            ...metadata,
            generation,
            sequence,
            baseSerialized: metadata.baseSerialized ?? baseSerialized,
            pendingSnapshots: [...(metadata.pendingSnapshots ?? []), ...queuedPending],
          }
          : metadata === undefined
            ? { generation, sequence, baseSerialized, pendingSnapshots: queuedPending }
            : metadata;
        let result = await persist(snapshot, persistMetadata);
        let forwardedAcknowledged = false;
        // A coordinated follower returns an optimistic envelope plus a
        // correlated writer acknowledgement. Do not report the commit as
        // durable until that ACK arrives; writer death becomes an explicit
        // failed save instead of a silent success.
        if (result?.acknowledgement && typeof result.acknowledgement.then === 'function') {
          const acknowledgement = await result.acknowledgement;
          if (!acknowledgement?.ok) {
            // A follower ACK failure invalidates this whole dependent queue:
            // later snapshots were based on the failed optimistic document and
            // must not be reported successful while silently dropping it.
            if (result?.forwarded && generation === saveGeneration) {
              invalidateGeneration(generation);
            }
            throw new Error(humanSaveRefusal(acknowledgement));
          }
          result = { ...result, ...acknowledgement };
          forwardedAcknowledged = true;
        }
        if (result?.ok === false) {
          if (result?.forwarded && generation === saveGeneration) {
            invalidateGeneration(generation);
          }
          throw new Error(humanSaveRefusal(result));
        }
        // Forwarded view saves are only optimistic; their committed broadcast
        // (installExternal) is the durable acknowledgement. A writer save is
        // authoritative and advances the store's queue base here.
        if (!result?.forwarded && result?.ok !== false) {
          lastPersistedSnapshot = typeof result?.serialized === 'string' ? result.serialized : snapshot;
        }
        if (result?.forwarded && forwardedAcknowledged && result && typeof result === 'object') {
          Object.defineProperty(result, 'durablyAcknowledged', {
            value: true,
            enumerable: false,
          });
        }
        return result;
      });
    const cleanup = () => {
        const index = queuedSaves.indexOf(entry);
        if (index >= 0) queuedSaves.splice(index, 1);
        if (lastQueuedSnapshot === snapshot) lastQueuedSnapshot = queuedSaves.at(-1)?.snapshot ?? lastPersistedSnapshot;
    };
    // Keep the queue alive after a failed save, while returning the original
    // operation directly so callers observe failure without an extra finally
    // microtask delaying UI error reporting.
    saveQueue = operation.then((result) => {
      if (!result?.superseded) lastSaveError = null;
      cleanup();
      return result;
    }, (error) => {
      lastSaveError = error;
      cleanup();
      return undefined;
    });
    return operation;
  }

  function commit(nextState, {
    isUndo = false,
    isRedo = false,
    saveMetadata,
    requireDurable = false,
  } = {}) {
    if (!canMutateDocument()) {
      // Refused before the history stacks or the document are touched, so a
      // blocked edit leaves nothing behind to resurface later.
      onMutationBlocked('commit');
      return Promise.resolve(false);
    }
    const previous = getState();
    if (isUndo) {
      redoStack.push(previous);
    } else if (isRedo) {
      undoStack.push(previous);
    } else {
      undoStack.push(previous);
      redoStack.length = 0;
    }
    let final = normalizeState(nextState);
    // Selection is cleared only after the initial normalization succeeds, so
    // a malformed state that makes normalizeState throw does not destroy the
    // current selection.
    session.selected.clear();
    if (prepare) final = normalizeState(prepare(final, session) ?? final);
    setState(final);
    afterCommit?.();
    return save(final, saveMetadata)
      .then((result) => {
        if (result?.superseded) throw new Error('The document save was superseded by a failed queued mutation.');
        // Some automatic/cosmetic writes deliberately resolve as dropped after
        // bounded CAS retries. Callers that add durable document members need
        // to distinguish that result from an acknowledged save.
        if (requireDurable && (
          result?.ok !== true
          || result?.dropped === true
          || (result?.forwarded === true && result?.durablyAcknowledged !== true)
        )) return false;
        setStatus?.('');
        return true;
      })
      .catch((error) => {
        setStatus?.(error instanceof Error ? error.message : String(error));
        return false;
      });
  }

  async function undo() {
    if (!canMutateDocument()) { onMutationBlocked('undo'); return; }
    if (undoStack.length === 0) return;
    const previous = undoStack.pop();
    return commit(previous, { isUndo: true });
  }

  async function redo() {
    if (!canMutateDocument()) { onMutationBlocked('redo'); return; }
    if (redoStack.length === 0) return;
    const next = redoStack.pop();
    return commit(next, { isRedo: true });
  }

  return {
    getSnapshot: getState,
    // Resolve only after every save queued before the call is terminal. The
    // queue deliberately remains usable after a rejection, while this
    // barrier still reports that rejection to a close-time caller.
    flush: () => saveQueue.then(() => {
      if (lastSaveError) throw lastSaveError;
      return undefined;
    }),
    getSession: () => session,
    setSelection: (ids) => { session.selected = new Set(ids); },
    addToSelection: (id) => { session.selected.add(id); },
    removeFromSelection: (id) => { session.selected.delete(id); },
    clearSelection: () => { session.selected.clear(); },
    setSelectedSets: (ids) => { session.selectedSets = new Set(ids); },
    addToSelectedSets: (id) => { session.selectedSets.add(id); },
    clearSelectedSets: () => { session.selectedSets.clear(); },
    setSelectionAnchor: (anchor) => { session.selectionAnchor = anchor; },
    setNavigation: ({ currentId, binCurrentId, binMode } = {}) => {
      if (currentId !== undefined) session.currentId = currentId;
      if (binCurrentId !== undefined) session.binCurrentId = binCurrentId;
      if (binMode !== undefined) session.binMode = binMode;
    },
    setGraphExpanded: (ids) => { session.graphExpanded = new Set(ids); },
    toggleGraphExpanded: (id) => {
      if (session.graphExpanded.has(id)) session.graphExpanded.delete(id);
      else session.graphExpanded.add(id);
    },
    addToGraphExpanded: (id) => { session.graphExpanded.add(id); },
    removeFromGraphExpanded: (id) => { session.graphExpanded.delete(id); },
    setTrailExpanded: (ids) => { session.trailExpanded = new Set(ids); },
    setClipboard: (clipboard) => { session.clipboard = clipboard; },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    install(nextState, metadata = {}) {
      setState(normalizeState(nextState));
      lastPersistedSnapshot = typeof metadata.authoritativeSerialized === 'string'
        ? metadata.authoritativeSerialized : JSON.stringify(getState());
      if (queuedSaves.length === 0) lastQueuedSnapshot = lastPersistedSnapshot;
      return getState();
    },
    /** Install a peer/host document generation and invalidate snapshot history
     * that was based on the previous generation. Session navigation remains
     * untouched, but Undo/Redo must not replay an obsolete whole-board image. */
    installExternal(nextState, metadata = {}) {
      undoStack = [];
      redoStack = [];
      setState(normalizeState(nextState));
      lastPersistedSnapshot = typeof metadata.authoritativeSerialized === 'string'
        ? metadata.authoritativeSerialized : JSON.stringify(getState());
      if (queuedSaves.length === 0) lastQueuedSnapshot = lastPersistedSnapshot;
      return getState();
    },
    replace(nextState) {
      if (!canMutateDocument()) {
        onMutationBlocked('replace');
        return getState();
      }
      setState(nextState);
      return getState();
    },
    save,
    commit,
    undo,
    redo,
    /**
     * Abandon every queued save without running it, and report the newest
     * serialized snapshot that generation held — the creator's latest local
     * work, including edits queued behind the save that lost.
     */
    invalidatePendingSaves() {
      const latest = latestQueuedSnapshot;
      invalidateGeneration(saveGeneration);
      return latest;
    },
  };
}
