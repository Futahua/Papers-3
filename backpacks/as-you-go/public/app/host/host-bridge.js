import {
  decodeWorkspaceState,
  encodeWorkspaceState,
} from './workspace-state-codec.js';

/** The papers:host:result message type the parent frame uses to answer a
 * request sent via postMessage. */
const HOST_RESULT = 'papers:host:result';

/** Owns the postMessage request/response protocol with the Papers host
 * frame. Every host call resolves a Promise when its requestId comes back,
 * and named methods below hide the protocol strings from the rest of the
 * workspace. */
export function createHostBridge(window) {
  const pending = new Map();
  const MAX_PENDING = 64;
  const REQUEST_TIMEOUT_MS = 15000;
  // Native direct-pick begin is setup, not the interactive pick itself. Papers
  // may spend two bounded 10s helper-list attempts preparing the seed set and
  // then up to 3s waiting for SlopTop to acknowledge activation. Do not let
  // the renderer's ordinary 15s RPC timeout pre-empt that native bounded
  // lifecycle; the final human-driven pick result is delivered separately.
  const PICK_BEGIN_REQUEST_TIMEOUT_MS = 30 * 1000;
  // The native candidate chooser is intentionally user-interactive: its
  // request remains pending while the creator searches and previews windows.
  // Keep it bounded, but do not let the ordinary quick-RPC timeout make a
  // still-open list silently reject after 15 seconds.
  const INTERACTIVE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
  const FILE_PREVIEW_REQUEST_TIMEOUT_MS = 45 * 1000;
  const FILE_MUTATION_REQUEST_TIMEOUT_MS = 30 * 1000;
  const pickListeners = new Set();
  const detachListeners = new Set();
  // The launcher overlay's invocation (the creator's "Alt+A anywhere", host side). A push, like the detach
  // lifecycle, so it is fanned out here rather than listened for by the page: every host-to-project message
  // arrives as a `message` event from `window.parent`, and this is the one place that checks the source.
  const commandSurfaceListeners = new Set();
  const widgetQuickRunSealListeners = new Set();
  const lifecycleListeners = new Set();
  const lifecycleBaselineListeners = new Set();
  const windowControlListeners = new Set();
  const windowControlShiftListeners = new Set();
  const windowControlUnavailableListeners = new Set();

  function parentOrigin() {
    try {
      const parsed = new URL(document.referrer);
      const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
      return origin && origin !== 'null' ? origin : '*';
    } catch {
      return '*';
    }
  }

  function request(type, detail = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (pending.size >= MAX_PENDING) {
      return Promise.reject(new Error('Host request capacity reached.'));
    }
    const requestId = crypto.randomUUID();
    if (type === 'papers:project:window-pick-begin') console.info('[045-direct-pick] host-request', requestId);
    window.parent.postMessage({ type, requestId, ...detail }, parentOrigin());
    return new Promise((resolve, reject) => {
      const timer = timeoutMs == null ? null : setTimeout(() => {
        pending.delete(requestId);
        console.warn(`[host-bridge] request timed out: ${type} ${requestId}`);
        reject(new Error('Host request timed out.'));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer, type });
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    // 016: the Papers-owned direct-pick session pushes one typed result.
    if (event.data?.type === 'papers:project:window-pick-result') {
      for (const listener of pickListeners) {
        listener(event.data.result);
      }
      return;
    }
    // 018X1: canonical detach lifecycle PUSH shape is FLAT:
    //   { type: 'papers:project:detach-*', transferId, reason? }
    // The legacy `{ detail: {...} }` wrapper is accepted too. The opaque token
    // never reaches page code.
    if (typeof event.data?.type === 'string'
      && event.data.type.startsWith('papers:project:detach-')
      && !event.data.requestId) {
      const detail = event.data.detail ?? event.data;
      for (const listener of detachListeners) {
        listener(event.data.type, detail);
      }
      return;
    }
    // The launcher overlay's invocation, relayed while the overlay window is up. Flat push shape like the
    // detach channel, and the same legacy `{ detail }` wrapper is accepted. The host does not know what a
    // command surface is - it reports the reason and the project decides.
    if (event.data?.type === 'papers:project:command-surface-invoke') {
      const detail = event.data.detail ?? event.data;
      for (const listener of commandSurfaceListeners) {
        listener(detail);
      }
      return;
    }
    if (event.data?.type === 'papers:project:widget-quick-run-seal-request') {
      const detail = event.data.detail ?? event.data;
      for (const listener of widgetQuickRunSealListeners) listener(detail);
      return;
    }
    if (event.data?.type === 'papers:project:window-lifecycle-event') {
      for (const listener of lifecycleListeners) listener(event.data.event);
      return;
    }
    if (event.data?.type === 'papers:project:window-lifecycle-baseline') {
      for (const listener of lifecycleBaselineListeners) listener(event.data.baseline);
      return;
    }
    if (event.data?.type === 'papers:project:window-control-event') {
      for (const listener of windowControlListeners) listener(event.data.event);
      return;
    }
    if (event.data?.type === 'papers:project:window-control-shift') {
      if (typeof event.data.held === 'boolean') {
        for (const listener of windowControlShiftListeners) listener(event.data.held);
      }
      return;
    }
    if (event.data?.type === 'papers:project:window-control-unavailable') {
      for (const listener of windowControlUnavailableListeners) listener(event.data.reason);
      return;
    }
    if (event.data?.type !== HOST_RESULT) return;
    const task = pending.get(event.data.requestId);
    if (!task) return;
    pending.delete(event.data.requestId);
    if (task.timer !== null) clearTimeout(task.timer);
    if (!event.data.ok) {
      const detail = typeof event.data.error === 'string' ? event.data.error.slice(0, 256)
        : typeof event.data.detail === 'string' ? event.data.detail.slice(0, 256) : '';
      task.reject(new Error(detail || 'The request could not be completed.'));
      return;
    }
    if (task.type === 'papers:project:state-load-versioned') {
      task.resolve({
        state: event.data.state,
        revision: event.data.revision,
      });
      return;
    }
    if (task.type === 'papers:project:state-save-checked') {
      task.resolve({ stateSave: event.data.stateSave });
      return;
    }
    if (task.type === 'papers:project:window-lifecycle-snapshot') {
      task.resolve({
        outcome: event.data.outcome,
        snapshot: event.data.snapshot ?? null,
        error: event.data.error ?? null,
      });
      return;
    }
    if ('writerLease' in event.data) {
      task.resolve(event.data.writerLease);
      return;
    }
    if (task.type === 'papers:project:window-thumbnail'
      || task.type === 'papers:project:window-thumbnail-cache') {
      // 019GR: the compact hover preview consumes ONLY the exact shared result.
      // Success is exactly { outcome, imageUrl, width, height }; a fallback is
      // exactly { outcome } plus an optional bounded error - never generic
      // capability fields such as observation:null.
      if ('imageUrl' in event.data) {
        task.resolve({
          outcome: event.data.outcome,
          imageUrl: event.data.imageUrl,
          width: event.data.width,
          height: event.data.height,
        });
      } else {
        task.resolve({
          outcome: event.data.outcome,
          ...(event.data.error !== undefined ? { error: event.data.error } : {}),
        });
      }
      return;
    }
    if (task.type === 'papers:project:window-candidate-picker-update') {
      task.resolve({
        outcome: event.data.outcome,
        ...(event.data.delivery !== undefined ? { delivery: event.data.delivery } : {}),
      });
      return;
    }
    if ('target' in event.data && 'icon' in event.data) {
      task.resolve({ target: event.data.target, icon: event.data.icon });
      return;
    }
    if ('finalOrigin' in event.data) {
      task.resolve({
        icon: event.data.icon,
        mime: event.data.mime,
        finalOrigin: event.data.finalOrigin,
        title: event.data.title ?? null,
      });
      return;
    }
    if ('fileCapability' in event.data) {
      task.resolve(event.data.fileCapability);
      return;
    }
    if ('candidates' in event.data) {
      task.resolve({
        outcome: event.data.outcome,
        candidates: event.data.candidates ?? [],
        error: event.data.error ?? null,
      });
      return;
    }
    if ('capability' in event.data || 'observation' in event.data) {
      task.resolve({
        outcome: event.data.outcome,
        capability: event.data.capability ?? null,
        descriptor: event.data.descriptor ?? null,
        observation: event.data.observation ?? null,
        error: event.data.error ?? null,
      });
      return;
    }
    if ('outcome' in event.data) {
      task.resolve({
        outcome: event.data.outcome,
        observation: event.data.observation ?? null,
        // `results` is the per-member answer the control sync returns, and this
        // branch used to drop it - so even a successful sync arrived with no
        // members in it. Added only when the reply carries it, so every other
        // channel keeps exactly the shape it had.
        ...(event.data.results !== undefined ? { results: event.data.results } : {}),
        error: event.data.error ?? null,
      });
      return;
    }
    if ('widget' in event.data) {
      // 019C: the compact-widget host wraps its typed result under one key so
      // the protocol-level ok flag is never shadowed by the session's own ok.
      task.resolve({
        ok: event.data.widget?.ok === true,
        reused: event.data.widget?.reused === true,
        error: event.data.widget?.error ?? null,
      });
      return;
    }
    if ('menu' in event.data) {
      task.resolve({ action: event.data.menu?.action === 'remove' ? 'remove' : 'cancel' });
      return;
    }
    if ('picker' in event.data) {
      const action = event.data.picker?.action;
      task.resolve({
        action: action === 'select' || action === 'remove' || action === 'close' || action === 'terminate' || action === 'direct-pick'
          ? action
          : 'cancel',
        candidateId: event.data.picker?.candidateId ?? null,
        ...(Array.isArray(event.data.picker?.retiredWindowInstanceIds)
          ? { retiredWindowInstanceIds: event.data.picker.retiredWindowInstanceIds.filter((id) => typeof id === 'string' && /^W[0-9a-f]{16}$/i.test(id)).slice(0, 64) }
          : {}),
      });
      return;
    }
    task.resolve(
      event.data.state
      ?? event.data.icon
      ?? event.data.target
      ?? event.data.targets
      ?? undefined,
    );
  });

  return {
    loadWorkspace: () => request('papers:project:as-you-go-load').then(decodeWorkspaceState),
    saveWorkspace: (state) => request('papers:project:as-you-go-save', {
      state: encodeWorkspaceState(state),
    }),
    // 0B: the versioned pair. `loadVersioned` reports the revision the surface
    // observed; `saveChecked` offers a save built on that revision, and Papers
    // refuses it if the board changed elsewhere first. The refusal arrives
    // wrapped under `stateSave`, so its own `ok: false` is a real answer rather
    // than a failed request.
    loadWorkspaceVersioned: () => request('papers:project:state-load-versioned')
      .then((payload) => {
        const decoded = decodeWorkspaceState(payload.state);
        return {
          state: typeof decoded === 'string' ? JSON.parse(decoded) : decoded,
          revision: payload.revision,
        };
      }),
    saveWorkspaceChecked: (state, revision) => request('papers:project:state-save-checked', {
      state: encodeWorkspaceState(state),
      revision,
    }).then((payload) => payload.stateSave),
    acquireWorkspaceWriterLease: () => request('papers:project:workspace-writer-lease-acquire', {}, null),
    releaseWorkspaceWriterLease: (token) => request('papers:project:workspace-writer-lease-release', { token }),
    launchShortcut: (actionId) => request('papers:project:as-you-go-launch', { actionId }),
    revealShortcut: (actionId) => request('papers:project:as-you-go-reveal', { actionId }),
    openWebLink: (url) => request('papers:project:open-web-link', { url }),
    dismissCommandSurface: ({ destination = 'restore' } = {}) =>
      request('papers:project:command-surface-dismiss', { destination }),
    openNewSurface: (url) => request('papers:project:open-new-surface', { url }),
    pickTarget: (kind) => request('papers:project:as-you-go-pick-target', { kind }),
    shortcutIcon: (detail) => request('papers:project:as-you-go-shortcut-icon', detail),
    resolveWebIcon: (url) => request('papers:project:resolve-web-link-icon', { url }),
    resolveDroppedTargets: (files) =>
      request('papers:project:resolve-dropped-targets', { files }),
    copyText: (text) => request('papers:project:copy-text', { text }),
    fileCapability: (operation, params = {}) =>
      request(
        'papers:project:file-capability',
        { operation, params },
        operation === 'native-drag'
          ? null
          : operation === 'preview'
            ? FILE_PREVIEW_REQUEST_TIMEOUT_MS
            : ['copy', 'move', 'rename', 'delete'].includes(operation)
              ? FILE_MUTATION_REQUEST_TIMEOUT_MS
              : REQUEST_TIMEOUT_MS,
      ),
    windowCandidates: ({ includeNativeIcons } = {}) => request('papers:project:window-candidates',
      typeof includeNativeIcons === 'boolean' ? { includeNativeIcons } : {}),
    windowLifecycleSnapshot: () => request('papers:project:window-lifecycle-snapshot'),
    onWindowLifecycleEvent: (callback) => {
      lifecycleListeners.add(callback);
      return () => lifecycleListeners.delete(callback);
    },
    onWindowLifecycleBaseline: (callback) => {
      lifecycleBaselineListeners.add(callback);
      return () => lifecycleBaselineListeners.delete(callback);
    },
    windowControlSync: (controls) => request('papers:project:window-control-sync', { controls }),
    windowControlActivate: (layoutId, memberId) =>
      request('papers:project:window-control-activate', { layoutId, memberId }),    windowControlGroup: (layoutId, actions) =>
      request('papers:project:window-control-group', { layoutId, actions }),
    onWindowControlEvent: (callback) => {
      windowControlListeners.add(callback);
      return () => windowControlListeners.delete(callback);
    },
    onWindowControlShift: (callback) => {
      windowControlShiftListeners.add(callback);
      return () => windowControlShiftListeners.delete(callback);
    },
    onWindowControlUnavailable: (callback) => {
      windowControlUnavailableListeners.add(callback);
      return () => windowControlUnavailableListeners.delete(callback);
    },
    bindWindowCandidate: (candidateId) =>
      request('papers:project:window-bind-candidate', { candidateId }),
    activateWindowCapability: (capability) =>
      request('papers:project:window-activate-capability', { capability }),
    observeWindowCapability: (capability) =>
      request('papers:project:window-observe-capability', { capability }),
    /** Hover intent: while this is held, Papers keeps its periodic desktop scan
     * off, so a scan cannot start during the preview dwell and land in front of
     * the capture. Reference counted by the caller; paired with the release. */
    windowPreviewHold: () =>
      request('papers:project:window-preview-hold', {}),
    windowPreviewRelease: () =>
      request('papers:project:window-preview-release', {}),
    /** The project's own hover preview, in Papers' always-on-top preview window
     * rather than an in-page popover: a popover can only ever be as visible as
     * this window, so another application could hide it. */
    windowPreviewShow: (imageUrl, title, width, height, anchor) =>
      request('papers:project:window-preview-show', { imageUrl, title, width, height, anchor }),
    windowPreviewHide: () =>
      request('papers:project:window-preview-hide', {}),
    minimizeWindowCapability: (capability) =>
      request('papers:project:window-minimize-capability', { capability }),
    /** One request: the helper reads the live state and minimizes or restores
     * accordingly, answering with the direction taken plus the PRE-mutation
     * observation. Replaces observe -> decide here -> mutate, which put a full
     * renderer round trip between the decision and the act. */
    toggleWindowCapability: (capability) =>
      request('papers:project:window-toggle-capability', { capability }),
    restoreWindowCapability: (capability) =>
      request('papers:project:window-restore-capability', { capability }),
    closeWindowCapability: (capability) =>
      request('papers:project:window-close-capability', { capability }),
    endProcessWindowCapability: (capability) =>
      request('papers:project:window-end-process-capability', { capability }),
    applyWindowCapability: (capability, bounds) =>
      request('papers:project:window-apply-capability', { capability, bounds }),
    resolveWindowDescriptor: (descriptor) =>
      request('papers:project:window-resolve-descriptor', { descriptor }),
    resolveWindowInstance: (instanceId) =>
      request('papers:project:window-resolve-instance', { instanceId }),
    // 016: direct onscreen pick. Begin waits only for Papers/SlopTop bounded
    // setup; the eventual human commit/cancel arrives on the result push.
    pickWindowBegin: (members) =>
      request('papers:project:window-pick-begin', { members }, PICK_BEGIN_REQUEST_TIMEOUT_MS),
    // 022: active picker keyboard controls are handled by the Papers picker
    // session; the page only requests stage/commit and never mutates state.
    pickWindowStage: () => request('papers:project:window-pick-stage'),
    pickWindowCommit: () => request('papers:project:window-pick-commit'),
    pickWindowCancel: () => request('papers:project:window-pick-cancel'),
    onPickResult: (callback) => {
      pickListeners.add(callback);
      return () => pickListeners.delete(callback);
    },
    // 018A1/018X1 frozen detach lifecycle (As You Go half). Every call is an
    // enumerated argument-free request in the existing project vocabulary; the
    // opaque transferId/projectId are attached by the Papers preload, never by
    // page data. The preload answers one-way ACK sends with an immediate OK
    // host result, so these resolve without the 15s timeout.
    detachOpen: () => request('papers:project:detach-open'),
    // 018V2: the exact two-sided-latch page request. A fresh DETACHED page
    // reports renderer lifecycle-ready exactly once, AFTER its detach-message
    // listener is installed and BEFORE it waits for ACTIVATE/load/bootstrap.
    // The page carries NO token/transfer; the preload latches token + READY.
    detachReady: () => request('papers:project:detach-ready'),
    // 018V4: receipt-confirmed ACTIVATE. The detached page ACKs every valid
    // ACTIVATE push for the active transfer (duplicate resends included) with
    // the exact request below; the preload validates it against the hidden
    // token/transfer and returns an immediate OK host result.
    detachActivatedAck: (transferId) =>
      request('papers:project:detach-activated-ack', { transferId }),
    detachStopAck: (transferId) => request('papers:project:detach-stop-ack', { transferId }),
    detachFlushAck: (transferId) => request('papers:project:detach-flush-ack', { transferId }),
    detachReattach: () => request('papers:project:detach-reattach'),
    detachFocus: () => request('papers:project:detach-focus'),
    detachResumedAck: (transferId) => request('papers:project:detach-resumed-ack', { transferId }),
    onDetachMessage: (callback) => {
      detachListeners.add(callback);
      return () => detachListeners.delete(callback);
    },
    /** The launcher overlay's invocation. One subscription per page; the page decides the meaning. */
    onCommandSurfaceInvoke: (callback) => {
      commandSurfaceListeners.add(callback);
      return () => commandSurfaceListeners.delete(callback);
    },
    acknowledgeCommandSurfaceInput: (captureId) => request('papers:project:command-surface-input-ack', { captureId }),
    onWidgetQuickRunSealRequest: (callback) => {
      widgetQuickRunSealListeners.add(callback);
      return () => widgetQuickRunSealListeners.delete(callback);
    },
    acknowledgeWidgetQuickRunSeal: (generation) => request('papers:project:widget-quick-run-seal-ack', { generation }),
    // 019C: compact widget surface (one native widget per layout). open/focus/
    // minimize/close are workspace requests carrying the opaque bounded key;
    // widgetCloseSelf is the WIDGET page's token-attached self-close; ready is
    // the two-sided-latch page request the preload answers with the hidden
    // token (019B).
    widgetOpen: (layoutKey, options = {}) => request('papers:project:widget-open', { layoutKey, ...options }),
    widgetFocus: (layoutKey) => request('papers:project:widget-focus', { layoutKey }),
    widgetMinimize: (layoutKey) => request('papers:project:widget-minimize', { layoutKey }),
    widgetClose: (layoutKey) => request('papers:project:widget-close', { layoutKey }),
    widgetCloseSelf: () => request('papers:project:widget-close'),
    widgetReady: () => request('papers:project:widget-ready'),
    setWidgetHoverPolicy: (enabled, blockedBindings) => request('papers:project:widget-hover-policy', { enabled, blockedBindings }),
    widgetQuickRunInput: (phase, text) => request('papers:project:widget-quick-run-input', { phase, text }),
    // 024: the compact-widget page reports its bounded card content size after
    // each render so the host refits the frameless window to the compact card.
    widgetReportSize: (width, height) => request('papers:project:widget-report-size', { width, height }),
    widgetPreviewShow: (imageUrl, title, width, height, anchor) => request('papers:project:widget-preview-show', {
      imageUrl, title, width, height, anchor,
    }),
    widgetPreviewHide: () => request('papers:project:widget-preview-hide'),
    widgetContextMenu: () => request('papers:project:widget-context-menu'),
    windowCandidatePicker: (candidates, pickerId) => request(
      'papers:project:window-candidate-picker',
      { candidates, ...(typeof pickerId === 'string' ? { pickerId } : {}) },
      INTERACTIVE_REQUEST_TIMEOUT_MS,
    ),
    windowCandidatePickerUpdate: (candidates, pickerId) =>
      request('papers:project:window-candidate-picker-update', { candidates, pickerId }),
    windowCandidatePickerClose: () => request('papers:project:window-candidate-picker-close'),
    // 019G: real window thumbnail (Windows-taskbar-like hover preview). Consumes
    // ONLY the exact shared API: page request `papers:project:window-thumbnail`
    // with `{ capability, options: { maxWidth, maxHeight } }` (defaults 240x135;
    // Papers clamps/rejects above 320x180). The result is a strict data-PNG
    // success or a payload-free typed fallback.
    windowThumbnailCapability: (capability, options = {}) => request('papers:project:window-thumbnail', {
      capability,
      options: {
        maxWidth: options.maxWidth ?? 240,
        maxHeight: options.maxHeight ?? 135,
      },
    }),
    // Read the safe persisted frame for an already freshly resolved live
    // capability. This never triggers capture; the following thumbnail request
    // replaces it in the same preview window when fresh pixels arrive.
    windowThumbnailCacheCapability: (capability) => request('papers:project:window-thumbnail-cache', { capability }),
    // Fixed enum-only telemetry; never include a window title, path, identity or image.
    windowLayoutDiagnostic: ({ stage, outcome } = {}) => {
      const stages = new Set(['auto-add-resolve', 'auto-add-observe', 'auto-add-commit']);
      const outcomes = new Set(['success', 'missing', 'ambiguous', 'helper-unavailable', 'timeout', 'failed', 'skipped']);
      if (!stages.has(stage) || !outcomes.has(outcome)) return Promise.resolve({ outcome: 'skipped' });
      return request('papers:project:window-diagnostic', { stage, outcome });
    },
    windowPeekBeginCapability: (capability) => request('papers:project:window-peek-begin', { capability }),
    windowPeekEnd: () => request('papers:project:window-peek-end'),
  };
}
