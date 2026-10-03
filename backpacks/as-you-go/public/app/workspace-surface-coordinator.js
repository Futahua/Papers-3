/**
 * 0B: which surface may write the board.
 *
 * Papers can show this project in more than one surface at once. The store is
 * the single owner of history and persistence *within* one surface, and every
 * save carries the WHOLE board — so two surfaces saving independently means the
 * later save silently erases the earlier one. Papers refuses a save built on a
 * stale revision (0A), but a refusal is only a backstop: it says the write was
 * wrong, not who should have written.
 *
 * So exactly one surface writes. The election is a Web Lock, not a scheme of
 * our own: the browser releases it when a surface closes or crashes, which is
 * the case a peer heartbeat cannot decide safely. A "peer looks dead, take the
 * lock" rule would be precisely the split brain the lock exists to prevent.
 *
 * The writer broadcasts each committed snapshot; views install it WITHOUT the
 * writer's navigation session, so two windows genuinely show different places
 * in one board. Views never call save.
 *
 * Nothing here is merged. On a refused save the coordinator freezes durable
 * editing and hands the creator the choice, because only they know whether
 * their version or the other one should survive.
 *
 * Everything external is injected, so the whole protocol is testable without a
 * browser, a lock manager or Papers.
 */

export const SURFACE_DOCUMENT_CHANNEL = 'as-you-go:workspace-document';
export const SURFACE_DOCUMENT_LOCK = 'as-you-go:workspace-document-writer';

/** What this surface may currently do. */
export const SURFACE_ROLE = {
  /** Reading and following the writer. Durable editing is unavailable. */
  VIEW: 'view',
  /** Holds the lock. The only surface permitted to save. */
  WRITER: 'writer',
  /** Held the lock, lost a save to a newer revision. Durable editing frozen
   * until the creator chooses which version survives. */
  CONFLICT: 'conflict',
};

const SNAPSHOT_MESSAGE = 'committed';
const MUTATION_MESSAGE = 'mutation-request';
const MUTATION_ACK_MESSAGE = 'mutation-ack';
const MUTATION_CANCEL_MESSAGE = 'mutation-cancel';
const MUTATION_CANCEL_RETRY_LIMIT = 3;
const MUTATION_CANCEL_RETRY_DELAY_MS = 100;
const TERMINAL_AUTHORITY_RETRY_LIMIT = 3;

import { sameJson, isPlainObject, mergeSurfaceSnapshots, stripLocalViewFields } from './workspace-surface-merge.js';
export { mergeSurfaceSnapshots };

/**
 * The default lock adapter: a real Web Lock held for as long as this surface
 * is the writer. `navigator.locks.request` keeps the lock until the callback's
 * promise settles, so the callback parks on a promise that is resolved by
 * release(). A surface that dies never resolves it and the browser reclaims
 * the lock — which is the whole reason for using it.
 */
export function webLockAdapter(navigatorRef) {
  return {
    available: Boolean(navigatorRef && navigatorRef.locks),
    request(name) {
      let release = () => {};
      const held = new Promise((resolveHeld, rejectHeld) => {
        const parked = new Promise((resolveParked) => { release = resolveParked; });
        let requestPromise;
        try {
          requestPromise = navigatorRef.locks.request(name, () => { resolveHeld({ release }); return parked; });
        } catch (error) {
          rejectHeld(error);
          return;
        }
        Promise.resolve(requestPromise).catch(rejectHeld);
      });
      return held;
    },
  };
}

/**
 * Uses Papers' main-process lease service when a custom WebContents does not
 * expose the Web Locks API. The coordinator still owns VIEW forwarding and
 * ACK/CAS handling; Papers only arbitrates the single durable writer.
 */
export function hostWriterLeaseAdapter(host) {
  const available = typeof host?.acquireWorkspaceWriterLease === 'function'
    && typeof host?.releaseWorkspaceWriterLease === 'function';
  return {
    available,
    request() {
      if (!available) return Promise.reject(new Error('Host writer lease unavailable.'));
      return Promise.resolve(host.acquireWorkspaceWriterLease()).then(({ token }) => ({
        release() {
          void Promise.resolve(host.releaseWorkspaceWriterLease(token)).catch(() => undefined);
        },
      }));
    },
  };
}

/**
 * @param {object} options
 * @param {{ request(name: string): Promise<{ release(): void }> }} options.lock
 * @param {string} [options.lockName]
 * @param {{ postMessage(value: unknown): void, addEventListener?: Function }} options.channel
 * @param {{ loadVersioned(): Promise<{ state: object, revision: string }>,
 *           saveChecked(state: object, revision: string): Promise<object> }} options.host
 * @param {(snapshot: object) => void} options.installDocument
 *        Installs a document WITHOUT touching this surface's navigation session.
 * @param {(snapshot: object) => void} [options.installExternalDocument]
 *        Installs a peer/external document and may invalidate local history.
 * @param {(snapshot: object, revision: string) => void} [options.onHydrated]
 * @param {(stage: string, code: string, revision?: string) => void} [options.onHydrationFailed]
 * @param {(role: string, detail: object) => void} [options.onRoleChange]
 * @param {() => string} [options.newClientId]
 */
export function createSurfaceCoordinator({
  lock,
  lockName = SURFACE_DOCUMENT_LOCK,
  channel,
  host,
  installDocument,
  installExternalDocument = installDocument,
  onHydrated = () => {},
  onHydrationFailed = () => {},
  /** Reload the authoritative document before reporting a failed forwarded
   * mutation. Kept injectable only for deterministic timeout tests. */
  ackTimeoutMs = 30000,
  /** Abandons the store's queued saves and returns the newest serialized
   * snapshot of that generation. Called the moment a save is refused, so the
   * frozen "my version" is the creator's latest local work rather than
   * whichever snapshot happened to lose the race. */
  invalidatePendingSaves = () => null,
  onRoleChange = () => {},
  newClientId = () => `s-${Math.random().toString(36).slice(2, 10)}`,
}) {
  const clientId = newClientId();
  let role = SURFACE_ROLE.VIEW;
  let revision = null;
  /** The snapshot a refused save was carrying. Kept intact: it is the
   * creator's unsaved work and the only copy of it. */
  let frozenSnapshot = null;
  /** While an ownership handover is in flight elsewhere (the 018 detach
   * STOP -> ACTIVATE gap), an ordinary view must not be queued for the lock —
   * it could win the gap and become writer in the middle of the handshake. */
  let transferSuspended = false;
  let pendingAcquire = null;
  let held = null;
  let lastSerialized = null;
  let baselineReady = false;
  let baselinePromise = null;
  let conflictGeneration = null;
  let conflictNeedsLock = false;
  let recoveryPromise = null;
  // Validation sequencing is deliberately separate from authoritative
  // installation sequencing. Merely receiving a parent-aware frame starts a
  // validation read, but must not look like a newer authority to recovery or
  // conflict-resolution code that is already reading the host.
  let validationSequence = 0;
  let authoritativeEpoch = 0;
  // BroadcastChannel can deliver mutations from several views back-to-back.
  // Serialize them at the elected writer so each request rebases on the
  // revision committed immediately before it instead of racing two CAS calls
  // and silently dropping the loser.
  let mutationQueue = Promise.resolve();
  const ackEnabled = typeof channel?.addEventListener === 'function';
  let requestSequence = 0;
  const pendingRequests = new Map();
  const generationsNeedingRestore = new Set();
  const pendingLocalSnapshots = [];
  const appliedRequests = new Map();
  const inFlightRequests = new Set();
  const cancelledRequests = new Set();
  const rememberApplied = (key, result) => {
    if (!key) return;
    appliedRequests.set(key, result);
    while (appliedRequests.size > 512) appliedRequests.delete(appliedRequests.keys().next().value);
  };
  function overlayPendingSnapshots(serialized) {
    if (!pendingLocalSnapshots.length) return serialized;
    try {
      let merged = JSON.parse(serialized);
      const pendingInOrder = [...pendingLocalSnapshots].sort((left, right) => {
        const leftSequence = Number.isFinite(left.sequence) ? left.sequence : Number.MAX_SAFE_INTEGER;
        const rightSequence = Number.isFinite(right.sequence) ? right.sequence : Number.MAX_SAFE_INTEGER;
        return leftSequence - rightSequence;
      });
      for (const pending of pendingInOrder) {
        merged = mergeSurfaceSnapshots(
          JSON.parse(pending.baseSerialized ?? serialized),
          JSON.parse(pending.serialized),
          merged,
        );
      }
      return JSON.stringify(merged);
    } catch {
      return serialized;
    }
  }
  function installExternalPreservingPending(decoded) {
    const preserved = JSON.parse(overlayPendingSnapshots(JSON.stringify(decoded)));
    installExternalDocument(preserved, JSON.stringify(decoded));
  }
  function registerQueuedHints(metadata) {
    for (const hint of Array.isArray(metadata?.pendingSnapshots) ? metadata.pendingSnapshots : []) {
      if (typeof hint?.serialized !== 'string') continue;
      if (!pendingLocalSnapshots.some((pending) => (
        Number.isFinite(hint.sequence) && Number.isFinite(pending.sequence)
          ? pending.sequence === hint.sequence
          : pending.serialized === hint.serialized && pending.baseSerialized === hint.baseSerialized
      ))) {
        pendingLocalSnapshots.push({ ...hint, queuedHint: true });
      }
    }
  }
  function clearPendingGeneration(generation) {
    if (generation == null) return;
    for (let index = pendingLocalSnapshots.length - 1; index >= 0; index -= 1) {
      if (pendingLocalSnapshots[index].generation === generation) pendingLocalSnapshots.splice(index, 1);
    }
  }
  function removePendingOverlay(pending) {
    const index = pendingLocalSnapshots.indexOf(pending);
    if (index >= 0) pendingLocalSnapshots.splice(index, 1);
  }
  function settlePendingRequest(requestId, pending, outcome) {
    if (!pending || pending.settled) return false;
    pending.settled = true;
    clearTimeout(pending.timer);
    clearTimeout(pending.cancelTimer);
    clearTimeout(pending.authorityRetryTimer);
    pendingRequests.delete(requestId);
    removePendingOverlay(pending.localPending);
    pending.resolve(outcome);
    return true;
  }
  function requestMutationCancellation(requestId, pending) {
    if (!pending || pending.settled || pending.cancelRequested || pending.successObserved) return;
    pending.cancelRequested = true;
    pending.cancelAttempts = 0;
    const send = () => {
      if (!pendingRequests.has(requestId) || pending.settled || pending.successObserved) return;
      pending.cancelAttempts += 1;
      channel.postMessage({ type: MUTATION_CANCEL_MESSAGE, clientId, requestId });
      if (!pendingRequests.has(requestId) || pending.settled || pending.successObserved) return;
      if (pending.cancelAttempts >= MUTATION_CANCEL_RETRY_LIMIT) {
        pending.cancelTimer = setTimeout(() => {
          if (!pendingRequests.has(requestId) || pending.settled || pending.successObserved) return;
          // Cancellation could not be observed by any writer. Keep the
          // surface explicitly non-editable and settle as uncertain instead
          // of leaving a normal VIEW with speculative state forever.
          freezeFollowerFailure(pending);
          markForwardFailure(pending);
          settlePendingRequest(requestId, pending, {
            ok: false,
            code: 'MUTATION_UNCERTAIN',
            revision,
          });
        }, MUTATION_CANCEL_RETRY_DELAY_MS);
        pending.cancelTimer.unref?.();
        return;
      }
      pending.cancelTimer = setTimeout(() => {
        pending.cancelTimer = null;
        send();
      }, MUTATION_CANCEL_RETRY_DELAY_MS);
      pending.cancelTimer.unref?.();
    };
    send();
  }
  function markForwardFailure(pending) {
    if (pending?.generation != null) generationsNeedingRestore.add(pending.generation);
  }
  function pendingIntentIsDurable(pending, loaded) {
    if (!pending || !loaded) return false;
    try {
      const incoming = JSON.parse(pending.serialized);
      const base = pending.baseSerialized ? JSON.parse(pending.baseSerialized) : null;
      const authoritative = loaded.state;
      const merged = base ? mergeSurfaceSnapshots(base, incoming, authoritative) : incoming;
      return sameJson(merged, { ...authoritative, view: authoritative.view ?? {} });
    } catch { return false; }
  }
  function clearRecoveredConflict(pending) {
    const sameGeneration = conflictGeneration === (pending?.generation ?? null);
    const genericValidationConflict = conflictGeneration == null;
    if (role !== SURFACE_ROLE.CONFLICT || (!sameGeneration && !genericValidationConflict)) return;
    frozenSnapshot = null;
    conflictGeneration = null;
    conflictNeedsLock = false;
    setRole(held ? SURFACE_ROLE.WRITER : SURFACE_ROLE.VIEW, { revision });
  }
  function hasUnresolvedCancellation() {
    for (const pending of pendingRequests.values()) {
      if ((pending.cancelRequested || pending.successObserved) && !pending.settled) return true;
    }
    return false;
  }
  function freezeAuthorityValidationFailure(pending = null) {
    frozenSnapshot = pending?.serialized ?? lastSerialized;
    conflictGeneration = pending?.generation ?? null;
    conflictNeedsLock = !held;
    try {
      console.warn(`[AsYouGo] freeze cause=authority-validation revision=${revision} generation=${pending?.generation ?? 'none'} sequence=${pending?.sequence ?? 'none'} hasLock=${Boolean(held)}`);
    } catch { /* freeze trail is diagnostic-only */ }
    setRole(SURFACE_ROLE.CONFLICT, { revision });
  }
  function retrySuccessfulAckAuthority(requestId, pending, outcome, attempt = 0) {
    if (!pendingRequests.has(requestId) || pending.settled) return;
    void reloadAuthoritativeAfterFailedMutation(outcome.code, { forceFresh: true })
      .then((recovery) => {
        if (!pendingRequests.has(requestId) || pending.settled) return;
        if (!recovery.ok) {
          if (attempt < TERMINAL_AUTHORITY_RETRY_LIMIT) {
            pending.authorityRetryTimer = setTimeout(() => {
              pending.authorityRetryTimer = null;
              retrySuccessfulAckAuthority(requestId, pending, outcome, attempt + 1);
            }, MUTATION_CANCEL_RETRY_DELAY_MS);
            pending.authorityRetryTimer.unref?.();
            return;
          }
          pending.successObserved = false;
          freezeFollowerFailure(pending);
          markForwardFailure(pending);
          settlePendingRequest(requestId, pending, {
            ok: false,
            code: 'MUTATION_UNCERTAIN',
            revision: outcome.revision ?? revision,
          });
          return;
        }
        clearRecoveredConflict(pending);
        settlePendingRequest(requestId, pending, outcome);
      });
  }
  function freezeFollowerFailure(pending) {
    frozenSnapshot = pending?.serialized ?? frozenSnapshot;
    conflictGeneration = pending?.generation ?? null;
    // Promotion replay may fail after this surface has already acquired the
    // lock. Only an actual follower failure needs lock reacquisition.
    conflictNeedsLock = !held;
    setRole(SURFACE_ROLE.CONFLICT, { revision });
  }
  function settleFailedForward(requestId, pending, outcome, recovery, { cancelIfUnresolved = false } = {}) {
    const finish = () => {
      if (!pendingRequests.has(requestId) || pending.settled) return;
      // A writer may have rebased this request with a concurrent edit, so
      // equality with the submitted snapshot is too strict. If the three-way
      // merge of this request onto the loaded authority is byte-stable, the
      // request's intent is already durable there.
      const authoritativeMatch = recovery.ok && pendingIntentIsDurable(pending, recovery.loaded);
      if (authoritativeMatch) {
        clearRecoveredConflict(pending);
        settlePendingRequest(requestId, pending, {
          ok: true,
          revision: recovery.loaded.revision,
          via: 'recovery-authoritative',
        });
        return;
      }
      if (cancelIfUnresolved) {
        if (pending.successObserved) return;
        // An unresolved timeout is an explicit recovery state, not an
        // ordinary writable VIEW. Bounded cancellation retries give a newly
        // promoted writer a chance to observe the request; exhaustion settles
        // as uncertainty while remaining non-editable.
        freezeFollowerFailure(pending);
        requestMutationCancellation(requestId, pending);
        return;
      }
      if (!recovery.ok) freezeFollowerFailure(pending);
      markForwardFailure(pending);
      settlePendingRequest(requestId, pending, outcome);
    };
    // Promotion replay and timeout recovery share one terminal transaction:
    // never report failure while a replay that may commit is still queued.
    if (pending.replayPromise) void pending.replayPromise.then(finish, finish);
    else finish();
  }
  function retireQueuedHint(sequence, serialized, baseSerialized) {
    for (let index = pendingLocalSnapshots.length - 1; index >= 0; index -= 1) {
      const pending = pendingLocalSnapshots[index];
      const sameIdentity = Number.isFinite(sequence) && Number.isFinite(pending.sequence)
        ? pending.sequence === sequence
        : pending.serialized === serialized && (baseSerialized == null || pending.baseSerialized === baseSerialized);
      if (pending.queuedHint && sameIdentity) pendingLocalSnapshots.splice(index, 1);
    }
  }

  function setRole(next, detail = {}) {
    if (role === next) return;
    if (next === SURFACE_ROLE.CONFLICT || role === SURFACE_ROLE.CONFLICT) {
      try {
        console.warn(`[AsYouGo] role transition from=${role} to=${next} revision=${revision} detail=${JSON.stringify(detail && typeof detail === 'object' ? { ...detail, serialized: undefined, baseSerialized: undefined } : detail) ?? ''}`);
      } catch { /* role trail is diagnostic-only */ }
    }
    role = next;
    onRoleChange(role, detail);
  }

  /** A follower applies its edit optimistically before the writer ACKs it.
   * If delivery or the writer fails, never leave that speculative document
   * painted indefinitely: remove its overlay, reload the host-authoritative
   * generation, and preserve only this surface's local navigation/session. */
  function reloadAuthoritativeAfterFailedMutation(code, { forceFresh = false } = {}) {
    if (recoveryPromise) {
      if (!forceFresh) return recoveryPromise;
      const priorRecovery = recoveryPromise;
      return priorRecovery.catch(() => undefined).then(() => reloadAuthoritativeAfterFailedMutation(code));
    }
    const startedEpoch = authoritativeEpoch;
    recoveryPromise = (async () => {
      let loaded;
      try {
        loaded = await host.loadVersioned();
      } catch (error) {
        onHydrationFailed('recovery', 'versioned-load-failed', revision ?? undefined);
        throw error;
      }
      // A newer committed broadcast or promotion may have installed a later
      // generation while this load was in flight. Never let the older read
      // regress that already-visible authority.
      if (authoritativeEpoch !== startedEpoch) {
        // A newer broadcast already installed the best authority. Reuse that
        // in-memory generation for the semantic durability check instead of
        // treating the older load race as proof that the request failed.
        if (lastSerialized && revision) {
          try {
            return { ok: true, stale: true, loaded: { state: JSON.parse(lastSerialized), revision } };
          } catch { /* fall through: no comparable authority */ }
        }
        return { ok: true, stale: true };
      }
      try {
        installExternalPreservingPending(loaded.state);
      } catch (error) {
        onHydrationFailed('recovery', 'model-install-failed', loaded.revision);
        throw error;
      }
      revision = loaded.revision;
      lastSerialized = JSON.stringify(loaded.state);
      baselineReady = true;
      authoritativeEpoch += 1;
      onHydrated(loaded.state, revision);
      return { ok: true, loaded };
    })().catch((error) => {
      onHydrationFailed('mutation', code, revision ?? undefined);
      return { ok: false, error };
    }).finally(() => {
      recoveryPromise = null;
    });
    return recoveryPromise;
  }

  /** Every follower needs a versioned base before it can forward a durable
   * action; waiting for the writer lock is not a substitute for hydration. */
  async function ensureBaseline() {
    if (baselineReady) return;
    if (!baselinePromise) {
      const loadPromise = (async () => {
        let loaded;
        try {
          loaded = await host.loadVersioned();
        } catch (error) {
          onHydrationFailed('load', 'versioned-load-failed');
          throw error;
        }
        // A committed broadcast may have won the race while this load was in
        // flight. Never let the older load regress the already-installed base.
        if (baselineReady) return;
        try {
          installDocument(loaded.state);
        } catch (error) {
          onHydrationFailed('install', 'model-install-failed', loaded.revision);
          throw error;
        }
        revision = loaded.revision;
        lastSerialized = JSON.stringify(loaded.state);
        baselineReady = true;
        authoritativeEpoch += 1;
      })();
      baselinePromise = loadPromise.catch((error) => {
        // A transient load/install failure must be retryable; otherwise one
        // rejected promise permanently bricks this surface until restart.
        baselinePromise = null;
        throw error;
      });
    }
    return baselinePromise;
  }

  /** Broadcast the exact bytes that were committed. Views decode these; a
   * second representation built alongside the save could differ from what is
   * actually on disk. */
  function publish(serialized, atRevision, requestId = null, parentRevision = null) {
    lastSerialized = serialized;
    channel.postMessage({
      type: SNAPSHOT_MESSAGE,
      clientId,
      revision: atRevision,
      serialized,
      ...(requestId ? { requestId } : {}),
      ...(parentRevision ? { parentRevision } : {}),
    });
  }

  async function becomeWriter() {
    let loaded;
    try {
      loaded = await host.loadVersioned();
    } catch (error) {
      onHydrationFailed('load', 'versioned-load-failed');
      throw error;
    }
    // The lock may have been won after another writer committed, so the disk
    // is read BEFORE this surface is allowed to write. Never inherit a
    // revision observed before waiting.
    try {
      installExternalPreservingPending(loaded.state);
    } catch (error) {
      onHydrationFailed('install', 'model-install-failed', loaded.revision);
      throw error;
    }
    revision = loaded.revision;
    lastSerialized = JSON.stringify(loaded.state);
    baselineReady = true;
    authoritativeEpoch += 1;
    onHydrated(loaded.state, revision);
    setRole(SURFACE_ROLE.WRITER, { revision });
    // Promotion transfers physical write authority. Any follower timeout
    // conflict bookkeeping from the old writer must not survive that transfer
    // and later misclassify a writer-owned CAS conflict as lockless.
    frozenSnapshot = null;
    conflictGeneration = null;
    conflictNeedsLock = false;
    // Any follower mutations that were awaiting the old writer's ACK remain
    // recoverable across promotion. Replay them in request order against the
    // freshly hydrated authoritative base instead of silently discarding the
    // optimistic work on the promotion install.
    for (const [requestId, pending] of pendingRequests) {
      const replayTask = mutationQueue.then(async () => {
        try {
          if (!pendingRequests.has(requestId) || pending.settled) return;
          if (pending.revision !== revision) {
            if (pendingIntentIsDurable(pending, loaded)) {
              clearRecoveredConflict(pending);
              settlePendingRequest(requestId, pending, {
                ok: true,
                revision,
                via: 'promotion-authority',
              });
              return;
            }
            const outcome = { ok: false, code: 'PROMOTION_REPLAY_AMBIGUOUS' };
            markForwardFailure(pending);
            settlePendingRequest(requestId, pending, outcome);
            return;
          }
          const current = lastSerialized ? JSON.parse(lastSerialized) : loaded.state;
          const incoming = JSON.parse(pending.serialized);
          const base = pending.baseSerialized ? JSON.parse(pending.baseSerialized) : current;
          const decoded = mergeSurfaceSnapshots(base, incoming, current);
          const payload = JSON.stringify(decoded);
          let parentRevision = revision;
          const result = await host.saveChecked(payload, parentRevision);
          if (!result || result.ok !== true) {
            const outcome = { ok: false, code: 'PROMOTION_REPLAY_REFUSED' };
            const recovery = await reloadAuthoritativeAfterFailedMutation(outcome.code);
            if (!recovery.ok && pendingRequests.has(requestId)) {
              freezeFollowerFailure(pending);
            }
            markForwardFailure(pending);
            settlePendingRequest(requestId, pending, outcome);
            return;
          }
          removePendingOverlay(pending.localPending);
          const visible = JSON.parse(overlayPendingSnapshots(payload));
          installDocument(visible, payload);
          revision = result.revision;
          lastSerialized = payload;
          authoritativeEpoch += 1;
          publish(payload, revision, null, parentRevision);
          settlePendingRequest(requestId, pending, { ok: true, revision });
        } catch {
          const outcome = { ok: false, code: 'PROMOTION_REPLAY_FAILED' };
          const recovery = await reloadAuthoritativeAfterFailedMutation(outcome.code);
          if (!recovery.ok && pendingRequests.has(requestId)) {
            freezeFollowerFailure(pending);
          }
          markForwardFailure(pending);
          settlePendingRequest(requestId, pending, outcome);
        } finally {
          removePendingOverlay(pending.localPending);
        }
      });
      pending.replayPromise = replayTask;
      mutationQueue = replayTask;
    }
    return loaded;
  }

  return {
    get role() { return role; },
    get revision() { return revision; },
    get clientId() { return clientId; },
    get baselineReady() { return baselineReady; },
    get frozen() { return frozenSnapshot; },
    get transferSuspended() { return transferSuspended; },
    /** Refresh a document changed outside this coordination channel, including
     * a hand-edit to state.json or a save from another scoped view. The host
     * projects each scope independently, so reload from its own authority. */
    async refreshFromHost() {
      if (!baselineReady || role === SURFACE_ROLE.CONFLICT) return { changed: false };
      const refresh = async () => {
        const startedEpoch = authoritativeEpoch;
        const loaded = await host.loadVersioned();
        if (!loaded || loaded.revision === revision || startedEpoch !== authoritativeEpoch
          || role === SURFACE_ROLE.CONFLICT) return { changed: false };
        const parentRevision = revision;
        try { installExternalPreservingPending(loaded.state); } catch (error) {
          onHydrationFailed('install', 'model-install-failed', loaded.revision);
          throw error;
        }
        revision = loaded.revision;
        lastSerialized = JSON.stringify(loaded.state);
        authoritativeEpoch += 1;
        onHydrated(loaded.state, revision);
        if (role === SURFACE_ROLE.WRITER) publish(lastSerialized, revision, null, parentRevision);
        return { changed: true, revision };
      };
      // A writer's external read follows already queued saves. Later local
      // snapshots then rebase against the newly observed revision.
      if (role !== SURFACE_ROLE.WRITER) return refresh();
      mutationQueue = mutationQueue.catch(() => undefined).then(refresh);
      return mutationQueue;
    },
    retirePendingGeneration(generation, latestLocal = null) {
      clearPendingGeneration(generation);
      if (!generationsNeedingRestore.delete(generation) || !lastSerialized) return;
      // Store invalidation retires queued dependent overlays after the failed
      // request settles. Reinstall the exact authoritative bytes so R2 cannot
      // remain painted after it has been superseded.
      try {
        installExternalDocument(JSON.parse(lastSerialized), lastSerialized);
      } catch {
        onHydrationFailed('recovery', 'model-install-failed', revision ?? undefined);
      }
      // A follower conflict must offer the newest queued generation if the
      // authoritative reload itself failed; the store supplies it before
      // removing the queue entries.
      if (conflictNeedsLock && typeof latestLocal === 'string') frozenSnapshot = latestLocal;
    },

    /**
     * Queue for write ownership. Resolves when this surface becomes the
     * writer, which may be immediately or when the current writer goes away.
     *
     * `designated` is the surface a detach handoff is transferring ownership
     * TO. It is the one surface allowed through a reservation, because the
     * reservation exists to keep everyone ELSE out of the queue until the
     * handoff completes.
     */
    async start({ designated = false } = {}) {
      if (transferSuspended && !designated) return null;
      if (pendingAcquire) return pendingAcquire;
      pendingAcquire = (async () => {
        await ensureBaseline();
        held = await lock.request(lockName);
        try {
          return await becomeWriter();
        } catch (error) {
          // A failed post-lock load/install must not strand the Web Lock and
          // prevent every other surface from recovering ownership.
          held?.release?.();
          held = null;
          setRole(SURFACE_ROLE.VIEW, {});
          throw error;
        }
      })();
      try {
        return await pendingAcquire;
      } finally {
        pendingAcquire = null;
      }
    },

    /**
     * Save the board. The store owns serialization and ordering, so the
     * already-serialized snapshot arrives here as-is and is never decoded and
     * re-encoded on the way to disk.
     *
     * Only the writer may save; a view reaching here is a caller bug, not a
     * race to resolve.
     */
    async saveSerialized(serialized, metadata = {}) {
      registerQueuedHints(metadata);
      if (role === SURFACE_ROLE.VIEW) {
        // Views may edit optimistically. The elected writer serializes their
        // request and broadcasts the committed result back to every surface.
        // This keeps ordinary document actions usable from every window while
        // retaining one durable writer and CAS protection.
        if (!baselineReady) await ensureBaseline();
        const baseSerialized = typeof metadata.baseSerialized === 'string'
          ? metadata.baseSerialized : lastSerialized;
        serialized = stripLocalViewFields(serialized, baseSerialized);
        if (baseSerialized && sameJson(serialized, baseSerialized)) {
          retireQueuedHint(metadata.sequence, serialized, baseSerialized);
          return { ok: true, forwarded: true, unchanged: true, revision };
        }
        const requestId = ackEnabled ? `${clientId}:${++requestSequence}` : null;
        let acknowledgement = null;
        if (requestId) {
          acknowledgement = new Promise((resolve) => {
          const localPending = { serialized, baseSerialized, generation: metadata.generation, sequence: metadata.sequence };
          const hintIndex = pendingLocalSnapshots.findIndex((pending) => pending.queuedHint
            && (Number.isFinite(metadata.sequence) && Number.isFinite(pending.sequence)
              ? pending.sequence === metadata.sequence
              : pending.serialized === serialized && pending.baseSerialized === baseSerialized));
          if (hintIndex >= 0) pendingLocalSnapshots.splice(hintIndex, 1);
          pendingLocalSnapshots.push(localPending);
          const timer = setTimeout(() => {
            const pending = pendingRequests.get(requestId);
            if (!pending || pending.settled || pending.timedOut) return;
          pending.timedOut = true;
          removePendingOverlay(localPending);
          // Fail closed at the timeout boundary, before a potentially slow
          // versioned load can leave an ordinary VIEW accepting R2/R3.
          freezeFollowerFailure(pending);
            onHydrationFailed('mutation', 'writer-ack-timeout', revision ?? undefined);
            void reloadAuthoritativeAfterFailedMutation('writer-ack-timeout')
              .then((recovery) => settleFailedForward(requestId, pending, { ok: false, code: 'WRITER_ACK_TIMEOUT' }, recovery, { cancelIfUnresolved: true }));
          }, ackTimeoutMs);
          timer.unref?.();
          pendingRequests.set(requestId, { timer, resolve, serialized, baseSerialized, revision, localPending, generation: metadata.generation });
          });
        }
        const message = {
          type: MUTATION_MESSAGE,
          clientId,
          revision,
          serialized,
          baseSerialized,
        };
        if (requestId) message.requestId = requestId;
        channel.postMessage(message);
        const forwarded = { ok: true, forwarded: true, revision };
        if (acknowledgement) Object.defineProperty(forwarded, 'acknowledgement', {
          value: acknowledgement,
          enumerable: false,
        });
        return forwarded;
      }
      if (role !== SURFACE_ROLE.WRITER) throw new Error('This surface is not the writer and may not save the board.');
      const baseSerialized = typeof metadata.baseSerialized === 'string'
        ? metadata.baseSerialized : lastSerialized;
      serialized = stripLocalViewFields(serialized, baseSerialized);
      if (lastSerialized && sameJson(serialized, lastSerialized)) {
        retireQueuedHint(metadata.sequence, serialized, baseSerialized);
        return { ok: true, revision, unchanged: true };
      }
      const localPending = { serialized, baseSerialized, generation: metadata.generation, sequence: metadata.sequence };
      const hintIndex = pendingLocalSnapshots.findIndex((pending) => pending.queuedHint
        && (Number.isFinite(metadata.sequence) && Number.isFinite(pending.sequence)
          ? pending.sequence === metadata.sequence
          : pending.serialized === serialized && pending.baseSerialized === baseSerialized));
      if (hintIndex >= 0) pendingLocalSnapshots.splice(hintIndex, 1);
      pendingLocalSnapshots.push(localPending);
      mutationQueue = mutationQueue
        .catch(() => undefined)
        .then(async () => {
          let payload = serialized;
          if (baseSerialized && lastSerialized && !sameJson(baseSerialized, lastSerialized)) {
            try {
              payload = JSON.stringify(mergeSurfaceSnapshots(
                JSON.parse(baseSerialized),
                JSON.parse(serialized),
                JSON.parse(lastSerialized),
              ));
            } catch {
              payload = serialized;
            }
          }
          let parentRevision = revision;
          let result = await host.saveChecked(payload, parentRevision);
          if (result && result.ok !== true) {
            try {
              const parsed = JSON.parse(payload);
              console.warn(`[AsYouGo] host refused save code=${result && result.code} hostRevision=${result && result.revision} groups=[${(Array.isArray(parsed.groups) ? parsed.groups : []).map((group) => `${group?.id ?? '?'}^${group?.parentId ?? '?'}`).join(',')}]`);
            } catch { /* refusal trail is diagnostic-only */ }
          }
          // An automatic save (graph rest positions, surface locations,
          // icon and card sizes) can lose several CAS races in a row while
          // two writers persist around it. Retry it boundedly rather than
          // freezing the document on a write nobody intended: live rest-save
          // churn means one retry is not always enough.
          let lastObserved = null;
          for (let attempt = 0;
            result?.code === 'STALE_REVISION' && metadata.rebaseAutomaticSave === true && attempt < 3;
            attempt += 1) {
            try {
              const loaded = await host.loadVersioned();
              lastObserved = loaded;
              payload = JSON.stringify(mergeSurfaceSnapshots(
                JSON.parse(baseSerialized ?? lastSerialized),
                JSON.parse(serialized),
                loaded.state,
              ));
              parentRevision = loaded.revision;
              result = await host.saveChecked(payload, parentRevision);
            } catch { break; /* preserve the original conflict outcome */ }
          }
          if (result && result.ok === true) {
            revision = result.revision;
            lastSerialized = payload;
            authoritativeEpoch += 1;
            const pendingIndex = pendingLocalSnapshots.indexOf(localPending);
            if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
            try { installDocument(JSON.parse(overlayPendingSnapshots(payload)), payload); } catch { /* host bytes are already committed */ }
            publish(payload, revision, null, parentRevision);
            return { ok: true, revision, serialized: payload };
          }
          if ((result?.code === 'STALE_REVISION' || result?.code === 'SCOPE_VIOLATION') && metadata.rebaseAutomaticSave === true) {
            // Still racing after bounded retries, or shaped against a scope
            // that moved underneath: drop this cosmetic write instead of
            // freezing. Positions and view state are rewritten on the next
            // rest anyway; the document never freezes over them. The host
            // already refused the write, so the boundary holds regardless.
            // Fast-forward the revision bookkeeping to the latest observed
            // authority so the next save starts from a fresh base instead of
            // freezing on this stale one. The visible state converges through
            // the normal refresh; nothing is published because nothing here
            // was committed.
            if (lastObserved) {
              revision = lastObserved.revision;
              lastSerialized = JSON.stringify(lastObserved.state);
              authoritativeEpoch += 1;
            }
            return { ok: true, revision, serialized: lastSerialized, dropped: true };
          }
          // Fail closed, synchronously enough that no further durable mutation
          // is accepted: the role changes before this returns. Queued saves from
          // the same generation are abandoned without ever reaching persistence,
          // and the newest of them becomes the version the creator is offered.
          conflictGeneration = metadata.generation;
          conflictNeedsLock = false;
          clearPendingGeneration(conflictGeneration);
          const latestLocal = invalidatePendingSaves();
          frozenSnapshot = typeof latestLocal === 'string' ? latestLocal : payload;
          try {
            let inventory = '';
            try {
              const parsed = JSON.parse(payload);
              inventory = ` groups=[${(Array.isArray(parsed.groups) ? parsed.groups : []).map((group) => `${group?.id ?? '?'}^${group?.parentId ?? '?'}`).join(',')}]`;
            } catch { /* inventory is diagnostic-only */ }
            console.warn(`[AsYouGo] freeze cause=writer-stale revision=${revision} hostRevision=${result && result.revision} code=${result && result.code} generation=${metadata.generation ?? 'none'} sequence=${metadata.sequence ?? 'none'} automatic=${metadata.rebaseAutomaticSave === true}${inventory}`);
          } catch { /* freeze trail is diagnostic-only */ }
          setRole(SURFACE_ROLE.CONFLICT, { revision: result && result.revision });
          return { ok: false, code: result?.code ?? 'STALE_REVISION' };
        })
        .finally(() => {
          const pendingIndex = pendingLocalSnapshots.indexOf(localPending);
          if (pendingIndex >= 0) pendingLocalSnapshots.splice(pendingIndex, 1);
        });
      return mutationQueue;
    },

    /** Conflict recovery: abandon this surface's unsaved version. */
    async useLatest() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      if (hasUnresolvedCancellation()) return { ok: false, code: 'MUTATION_CANCELLATION_PENDING' };
      clearPendingGeneration(conflictGeneration);
      const startedEpoch = authoritativeEpoch;
      let loaded;
      try {
        loaded = await host.loadVersioned();
      } catch (error) {
        onHydrationFailed('load', 'versioned-load-failed');
        throw error;
      }
      let shouldInstall = true;
      if (conflictNeedsLock && authoritativeEpoch !== startedEpoch && lastSerialized) {
        loaded = { state: JSON.parse(lastSerialized), revision };
        shouldInstall = false;
      }
      if (shouldInstall) {
        try { installExternalDocument(loaded.state); } catch (error) {
          onHydrationFailed('install', 'model-install-failed', loaded.revision);
          throw error;
        }
      }
      revision = loaded.revision;
      lastSerialized = JSON.stringify(loaded.state);
      baselineReady = true;
      authoritativeEpoch += 1;
      frozenSnapshot = null;
      conflictGeneration = null;
      onHydrated(loaded.state, revision);
      if (conflictNeedsLock) {
        // A follower that failed recovery never held the Web Lock. Use latest
        // is therefore a view recovery and must not manufacture write
        // authority while the existing writer remains active.
        conflictNeedsLock = false;
        setRole(SURFACE_ROLE.VIEW, { revision });
      } else {
        setRole(SURFACE_ROLE.WRITER, { revision });
      }
      return loaded;
    },

    /**
     * Conflict recovery: keep this surface's version, replacing what was saved
     * elsewhere. Destructive, so the caller must confirm with the creator
     * first. Re-reads only to obtain the current revision — if that save is
     * refused too, the surface stays frozen rather than retrying, because a
     * loop here would be an unbounded fight with another live writer.
     */
    async keepMine() {
      if (role !== SURFACE_ROLE.CONFLICT) throw new Error('There is no conflict to resolve.');
      if (hasUnresolvedCancellation()) return { ok: false, code: 'MUTATION_CANCELLATION_PENDING' };
      const mineGeneration = conflictGeneration;
      clearPendingGeneration(conflictGeneration);
      if (conflictNeedsLock) {
        // Follower conflict recovery must acquire the same Web Lock before it
        // can perform the destructive Keep my version CAS. A successful CAS
        // alone does not grant write authority.
        const mine = frozenSnapshot;
        if (typeof mine !== 'string') return { ok: false, code: 'NO_FROZEN_SNAPSHOT' };
        try {
          await ensureBaseline();
          held = await lock.request(lockName);
          await becomeWriter();
        } catch {
          held?.release?.();
          held = null;
          return { ok: false, code: 'WRITER_LOCK_UNAVAILABLE' };
        }
        if (role !== SURFACE_ROLE.WRITER) return { ok: false, code: 'WRITER_LOCK_UNAVAILABLE' };
        conflictNeedsLock = false;
        const serialized = stripLocalViewFields(mine, lastSerialized);
        const parentRevision = revision;
        const result = await host.saveChecked(serialized, parentRevision);
        if (result && result.ok === true) {
          revision = result.revision;
          lastSerialized = serialized;
          authoritativeEpoch += 1;
          try { installDocument(JSON.parse(serialized), serialized); } catch { /* host bytes are already committed */ }
          frozenSnapshot = null;
          conflictGeneration = null;
          publish(serialized, revision, null, parentRevision);
          return { ok: true, revision };
        }
        conflictNeedsLock = !held;
        // becomeWriter() clears conflict metadata while it hydrates the
        // latest authority. If the checked replacement then loses a race,
        // restore the creator's exact Mine snapshot so a retry cannot erase
        // the only copy of their work.
        frozenSnapshot = mine;
        conflictGeneration = mineGeneration;
        setRole(SURFACE_ROLE.CONFLICT, { revision: result && result.revision });
        return { ok: false, code: 'STALE_REVISION' };
      }
      const loaded = await host.loadVersioned();
      const serialized = stripLocalViewFields(frozenSnapshot, JSON.stringify(loaded.state));
      const parentRevision = loaded.revision;
      const result = await host.saveChecked(serialized, parentRevision);
      if (result && result.ok === true) {
        revision = result.revision;
        lastSerialized = serialized;
        authoritativeEpoch += 1;
        try { installDocument(JSON.parse(serialized), serialized); } catch { /* host bytes are already committed */ }
        frozenSnapshot = null;
        conflictGeneration = null;
        publish(serialized, revision, null, parentRevision);
        setRole(SURFACE_ROLE.WRITER, { revision });
        return { ok: true, revision };
      }
      return { ok: false, code: 'STALE_REVISION' };
    },

    /** A committed snapshot from the writer. Views follow it; the writer
     * ignores its own echo, and a frozen surface ignores everything — its
     * unsaved work must not be overwritten behind the creator's back. */
    receive(message) {
      if (!isPlainObject(message) || typeof message.clientId !== 'string' || message.clientId === clientId) return false;
      if (message.type === MUTATION_MESSAGE) {
        if (role !== SURFACE_ROLE.WRITER || typeof message.serialized !== 'string') return false;
        const requestKey = typeof message.requestId === 'string'
          ? `${message.clientId}:${message.requestId}` : null;
        if (requestKey && inFlightRequests.has(requestKey)) return true;
        const hasPrior = requestKey ? appliedRequests.has(requestKey) : false;
        const prior = requestKey ? appliedRequests.get(requestKey) : null;
        if (hasPrior) {
          if (prior) channel.postMessage({
              type: MUTATION_ACK_MESSAGE,
              clientId,
              ackClientId: message.clientId,
              requestId: message.requestId,
              ok: prior.ok,
              revision: prior.revision,
              code: prior.code,
            });
          return true;
        }
        // Mark before queueing so duplicate delivery while this request is
        // still in flight cannot schedule a second durable save. The first
        // execution will emit the one correlated acknowledgement.
        if (requestKey) inFlightRequests.add(requestKey);
        mutationQueue = mutationQueue
          .catch(() => undefined)
          .then(async () => {
            if (requestKey && cancelledRequests.delete(requestKey)) {
              const cancelled = { ok: false, code: 'MUTATION_CANCELLED', revision };
              inFlightRequests.delete(requestKey);
              rememberApplied(requestKey, cancelled);
              channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...cancelled });
              return;
            }
            let serialized = message.serialized;
            try {
              const incoming = JSON.parse(message.serialized);
              let decoded = incoming;
              const base = typeof message.baseSerialized === 'string'
                ? JSON.parse(message.baseSerialized)
                : null;
              const current = lastSerialized ? JSON.parse(lastSerialized) : null;
              if (base && current && (message.revision !== revision || !sameJson(base, current))) {
                decoded = mergeSurfaceSnapshots(base, incoming, current);
                serialized = JSON.stringify(decoded);
              }
              let parentRevision = revision;
              let result = await host.saveChecked(serialized, parentRevision);
              if (!result || result.ok !== true) {
                // An external writer may have advanced the opaque host revision
                // despite our Web Lock. Reload, rebase this same request once,
                // and retry; never discard a queued peer action merely because
                // the first CAS observed a stale revision.
                const latest = await host.loadVersioned();
                installExternalPreservingPending(latest.state);
                revision = latest.revision;
                lastSerialized = JSON.stringify(latest.state);
                decoded = base
                  ? mergeSurfaceSnapshots(base, incoming, latest.state)
                  : incoming;
                serialized = JSON.stringify(decoded);
                const retryParentRevision = revision;
                result = await host.saveChecked(serialized, retryParentRevision);
                parentRevision = retryParentRevision;
              }
              if (!result || result.ok !== true) {
                onHydrationFailed('mutation', 'remote-save-stale', revision ?? undefined);
                if (requestKey) {
                  const failed = { ok: false, code: 'STALE_REVISION', revision };
                  cancelledRequests.delete(requestKey);
                  inFlightRequests.delete(requestKey);
                  rememberApplied(requestKey, failed);
                  channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...failed });
                }
                return;
              }
              installExternalPreservingPending(decoded);
              revision = result.revision;
              lastSerialized = serialized;
              authoritativeEpoch += 1;
              publish(serialized, revision, message.requestId, parentRevision);
              if (requestKey) {
                cancelledRequests.delete(requestKey);
                const committed = { ok: true, revision };
                inFlightRequests.delete(requestKey);
                rememberApplied(requestKey, committed);
                channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...committed });
              }
            } catch {
              onHydrationFailed('mutation', 'remote-save-failed', revision ?? undefined);
              if (requestKey) {
                const failed = { ok: false, code: 'REMOTE_SAVE_FAILED', revision };
                cancelledRequests.delete(requestKey);
                inFlightRequests.delete(requestKey);
                rememberApplied(requestKey, failed);
                channel.postMessage({ type: MUTATION_ACK_MESSAGE, clientId, ackClientId: message.clientId, requestId: message.requestId, ...failed });
              }
            }
          });
        return true;
      }
      if (message.type === MUTATION_CANCEL_MESSAGE) {
        if (role !== SURFACE_ROLE.WRITER) return false;
        if (typeof message.requestId !== 'string') return false;
        const requestKey = `${message.clientId}:${message.requestId}`;
        const prior = appliedRequests.get(requestKey);
        if (prior) {
          channel.postMessage({
            type: MUTATION_ACK_MESSAGE,
            clientId,
            ackClientId: message.clientId,
            requestId: message.requestId,
            ...prior,
          });
          return true;
        }
        cancelledRequests.add(requestKey);
        if (!inFlightRequests.has(requestKey)) {
          const cancelled = { ok: false, code: 'MUTATION_CANCELLED', revision };
          cancelledRequests.delete(requestKey);
          rememberApplied(requestKey, cancelled);
          channel.postMessage({
            type: MUTATION_ACK_MESSAGE,
            clientId,
            ackClientId: message.clientId,
            requestId: message.requestId,
            ...cancelled,
          });
        }
        return true;
      }
      if (message.type === MUTATION_ACK_MESSAGE) {
        if (message.ackClientId !== clientId || typeof message.requestId !== 'string') return false;
        const pending = pendingRequests.get(message.requestId);
        if (!pending) return false;
        clearTimeout(pending.timer);
        clearTimeout(pending.cancelTimer);
        pending.cancelTimer = null;
        const outcome = {
          ok: message.ok === true,
          revision: message.revision,
          ...(message.ok === true ? {} : { code: message.code ?? 'REMOTE_MUTATION_FAILED' }),
        };
        if (outcome.ok) pending.successObserved = true;
        // A successful or cancellation ACK is not itself proof that this
        // surface has the same authority: the committed broadcast may have
        // been dropped, and a cancellation ACK may carry a newer revision.
        // Reconcile first, then expose the result to the store. Ordinary
        // negative ACKs retain their semantic durability check below.
        removePendingOverlay(pending.localPending);
        if (outcome.ok) {
          retrySuccessfulAckAuthority(message.requestId, pending, outcome);
        } else if (outcome.code === 'MUTATION_CANCELLED') {
          void reloadAuthoritativeAfterFailedMutation(outcome.code, { forceFresh: true })
            .then((recovery) => settleFailedForward(message.requestId, pending, outcome, recovery));
        } else {
          void reloadAuthoritativeAfterFailedMutation(outcome.code, { forceFresh: true })
            .then((recovery) => settleFailedForward(message.requestId, pending, outcome, recovery));
        }
        return true;
      }
      if (message.type !== SNAPSHOT_MESSAGE) return false;
      if (role !== SURFACE_ROLE.VIEW && !(role === SURFACE_ROLE.CONFLICT && conflictNeedsLock)) return false;
      if (typeof message.revision !== 'string' || typeof message.serialized !== 'string') return false;
      let decoded;
      try {
        decoded = JSON.parse(message.serialized);
      } catch {
        onHydrationFailed('decode', 'broadcast-json-invalid', message.revision);
        // A malformed broadcast is ignored rather than installed: a view must
        // never replace a good document with something it could not read.
        return false;
      }
      if (!isPlainObject(decoded)) {
        onHydrationFailed('decode', 'broadcast-state-invalid', message.revision);
        return false;
      }
      // Every producer-issued frame carries a parent revision. Because Papers
      // revisions are content hashes (ABA is possible), parent equality alone
      // cannot establish lineage. Validate the frame against host authority
      // and fence the asynchronous result against any newer install.
      if (typeof message.parentRevision === 'string') {
        // Invalidate every older validation as soon as a newer frame enters
        // the pipeline, not only after that frame's asynchronous load wins.
        const validationEpoch = ++validationSequence;
        const authorityEpoch = authoritativeEpoch;
        void host.loadVersioned().then((loaded) => {
          if (validationSequence !== validationEpoch || authoritativeEpoch !== authorityEpoch || !loaded) return;
          const pending = typeof message.requestId === 'string'
            ? pendingRequests.get(message.requestId) : null;
          if (loaded.revision !== message.revision && loaded.revision === revision) return;
          try { installExternalPreservingPending(loaded.state); } catch {
            onHydrationFailed('install', 'model-install-failed', loaded.revision);
            if (validationSequence === validationEpoch && authoritativeEpoch === authorityEpoch
              && (role === SURFACE_ROLE.VIEW || pending)) {
              freezeAuthorityValidationFailure(pending);
            }
            return;
          }
          authoritativeEpoch += 1;
          revision = loaded.revision === message.revision ? message.revision : loaded.revision;
          lastSerialized = loaded.revision === message.revision ? message.serialized : JSON.stringify(loaded.state);
          baselineReady = true;
          onHydrated(loaded.revision === message.revision ? decoded : loaded.state, revision);
          if (pending) {
            if (pending && pendingIntentIsDurable(pending, { state: loaded.revision === message.revision ? decoded : loaded.state })) {
              clearRecoveredConflict(pending);
              settlePendingRequest(message.requestId, pending, {
                ok: true,
                revision,
                via: 'committed-authority-refresh',
              });
            }
          }
        }).catch(() => {
          if (validationSequence !== validationEpoch || authoritativeEpoch !== authorityEpoch
            || (role !== SURFACE_ROLE.VIEW && role !== SURFACE_ROLE.CONFLICT)) return;
          onHydrationFailed('recovery', 'committed-order-validation-failed', revision ?? undefined);
          const pending = typeof message.requestId === 'string'
            ? pendingRequests.get(message.requestId) : null;
          // A settled follower conflict already owns the only protected
          // creator snapshot. An unrelated validation failure must report
          // the fault without replacing that frozen Mine version.
          if (role === SURFACE_ROLE.CONFLICT && conflictNeedsLock && !pending) return;
          freezeAuthorityValidationFailure(pending);
        });
        return true;
      }
      try {
        installExternalPreservingPending(decoded);
      } catch {
        onHydrationFailed('install', 'model-install-failed', message.revision);
        return false;
      }
      authoritativeEpoch += 1;
      if (typeof message.requestId === 'string') {
        const pending = pendingRequests.get(message.requestId);
        if (pending) {
          clearRecoveredConflict(pending);
          settlePendingRequest(message.requestId, pending, { ok: true, revision: message.revision, via: 'committed-broadcast' });
        }
      }
      revision = message.revision;
      lastSerialized = message.serialized;
      baselineReady = true;
      onHydrated(decoded, revision);
      return true;
    },

    /**
     * 018 seam. DORMANT, deliberately kept.
     *
     * The legacy full-surface detach is retired from reachability -- see the
     * `windowLayoutDetachment` stub in the entry file, where mode is always
     * 'workspace'. Detach now opens the compact widget, which never writes the
     * store, so the ownership race this seam exists for cannot occur on the
     * live path. It is not wired to anything, and its tests stand as the
     * specification rather than as coverage of a running path.
     *
     * INVARIANT: if full-surface ownership transfer is ever made reachable
     * again, it MUST integrate this coordinator before shipping -- reserve
     * before FLUSH, release only after the flush settles, designated
     * acquisition after ACTIVATE, and the mandatory versioned reload. Enabling
     * that path without this is the split brain the Web Lock exists to prevent.
     *
     * The handoff ordering it supports, in full:
     *
     *   reserveTransfer()      ordinary surfaces leave the election
     *   ...FLUSH settles...    the old writer still owns the lock, so its one
     *                          authorized final save is still valid
     *   release()              only now is the lock given up
     *   ...ACTIVATE...         the designated surface starts
     *   start({designated})    it, and only it, may take the lock
     *   (reload from disk)     mandatory, never from cached state
     *   completeTransfer()     ordinary surfaces may queue again
     *
     * The reservation must be taken BEFORE the flush, and must outlive the
     * release: releasing while ordinary surfaces are queued would turn the
     * handoff into a free-for-all that the designated surface could lose.
     */
    reserveTransfer() { transferSuspended = true; },

    /** The handoff finished — ownership reached the designated surface. */
    completeTransfer() { transferSuspended = false; },

    /**
     * The handoff failed. If it failed before release(), this surface still
     * owns the lock and simply keeps writing. If it failed after, nobody owns
     * it and the next surface to elect itself still reloads from disk first —
     * an aborted transfer never leaves anyone writable from cached state.
     */
    abortTransfer() { transferSuspended = false; },

    /** Give up write ownership. The lock is released, so a waiting surface
     * elects itself and reloads from disk before it may write. */
    release() {
      if (held) held.release();
      held = null;
      setRole(SURFACE_ROLE.VIEW, {});
    },
  };
}
