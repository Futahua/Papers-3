// Build marker. Papers runs from a packaged copy, so the first question when a
// change appears to have no effect is whether this file is the one running at
// all. Logged once at module load: if this line is absent from the console, the
// renderer is serving a different build and no amount of editing here will show.
console.info('[as-you-go] workspace module loaded: set-gravity branch, rings enabled');

import {
  ROOT_ID,
  binSelection,
  binnedItems,
  itemsInBinnedGroup,
  copySelection,
  createGroup,
  createDroppedShortcuts,
  createShortcut,
  createWebLink,
  isWebLink,
  itemsIntersectingMarquee,
  itemsIn,
  moveSelection,
  normalizeState,
  permanentlyDelete,
  renameItem,
  restoreSelection,
  setIconSize,
  updateGroup,
  updateShortcut,
  updateWebLink,
  updateWorkspaceView,
  graphContextId,
  getGraphPosition,
  setGraphPositions,
  getGraphRestPosition,
  setGraphRestPositions,
  removeGraphPositions,
  setToolbarPosition,
  getToolbarPosition,
  forkPlacement,
  collapsePlacements,
  placementCount,
  setItemSets,
  setTrailExpandedByContext,
  createWindowLayout,
  deleteWindowLayout,
  setWindowLayoutPill,
  setWindowLayoutTracking,
  setWindowLayoutInstanceSuppressed,
  addWindowLayoutMember,
  removeWindowLayoutMember,
  noteWindowLayoutDiagnostic,
  removeClosedWindowFromAllLayouts,
  reconcileWindowLayoutsAfterStartup,
  updateWindowLayoutMember,
  reorderWindowLayoutMember,
  setWindowLayoutCardSize,
  setActiveWindowLayoutId,
  setSurfaceLocation,
  surfaceLocationFor,
} from './workspace-model-20260730b.js';

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from './vendor/d3-force.js';
import { zoom, zoomIdentity, zoomTransform } from './vendor/d3-zoom.js';
import { select } from './vendor/d3-selection.js';
import { animate } from './vendor/anime.js';
import { visibleGraphItems, directSetMemberIdsVisible, inheritedSetMemberIdsVisible, graphEdges, binOriginEdges, seedPosition, assignSpatialFolderHues } from './graph-model-20260730b.js';
import { belongsToSet } from './sets-model.js';
import {
  reconcileRing,
  ringPath,
  ringHull,
  resampleHull,
  easeOutline,
  floorOutline,
  memberFloorHull,
  forceRingShape,
  ejectionTarget,
  outlineCentroid,
} from './set-ring-model.js';
import { forceSetGravity, forceSetExclusion, forceSetSeparation } from './set-gravity-model.js';
import { assignBranchRigidity, branchCenterGravityStrength, branchLinkDistance, branchLinkStrength, forceBranchUncross } from './branch-uncross-force.js';
import { glyphPath, layoutTitleGlyphs } from './set-glyph-model.js';
import { createSetEffectsController } from './set-effects-model.js';
import { createDragTrailController } from './drag-trail-model.js';
import { regionCentroid, regionPath } from './set-region-model.js';
import { createRegionLayout } from './set-region-layout.js';
import { hydrateIcons as hydrateIconsScoped, hydrateWebPreview } from './web-link-icon-20260730b.js';
import { createHostBridge } from './app/host/host-bridge.js?build=coordination-v18';
import { createFileCapabilityPanel, isAbsoluteWindowsPath } from './app/file-capability-panel.js';
import { createWorkspaceNavigator } from './app/workspace-navigator.js';
import { createWindowLayoutRecordingWiring, windowLayoutMemberKey, resolveWindowLayoutDescriptorWithFallback } from './app/window-layout-runtime.js';
import { createWindowLayoutAutoTracking } from './app/window-layout-auto-tracking.js';
import { openWindowLayoutPickerSession, toWindowLayoutPickerRows } from './app/window-layout-picker-session.js';
import { createWindowLayoutCandidateBinder } from './app/window-layout-candidate-binding.js';
import { endExactWindowCandidateProcess } from './app/window-layout-process-end.js';
import { createClickTwiceGuard } from './app/click-twice-guard.js';
import { createWidgetHoverPolicy, createWidgetHoverPolicyDiagnostics } from './app/widget-hover-policy.js';
import { handleWidgetClearActivation, handleWidgetDeleteActivation } from './app/widget-clear-activation.js';
import { planWindowLayoutShiftPeekTransition } from './app/window-layout-shift-peek.js';
import { createDetachSaveGate, createDetachReadOnlyInputGuards, createWindowLayoutMemberDrag, createWindowLayoutGroupActionRunner, toggleWindowLayoutMemberVisibility, createReadOnlyStatusSink, orderWindowLayoutMemberButtons, windowLayoutPresentationMode, windowLayoutContentSignature, DETACH_ACTIVATE_CANCELLED } from './app/window-layout-detached.js';
import { runBoundedConcurrent } from './app/window-layout-actions.js';
import { createWindowLayoutWidgetChannelWorkspace, createWindowLayoutWidgetChannelClient, windowLayoutWidgetSnapshot, windowLayoutWidgetRenderIdentity, windowLayoutWidgetCommittedStatus, createBoundedRetry, WINDOW_LAYOUT_WIDGET_CHANNEL, WINDOW_LAYOUT_CARD_MAX_WIDTH } from './app/window-layout-widget-channel.js';
import { createWindowLayoutWidgetLifecycle, windowLayoutWidgetOpenSucceeded } from './app/window-layout-widget-lifecycle.js';
import {
  createWindowLayoutPickApplier,
  createWindowLayoutRetirementWriter,
  windowLayoutPickApplyOutcome,
  windowLayoutPickForBoundCandidate,
  windowLayoutCandidateIsMember,
  windowLayoutHasValidInstanceId,
  windowLayoutPickMemberDescriptors,
} from './app/window-layout-workspace.js';
import { windowLayoutControlButton, windowLayoutMemberMarkup, windowLayoutMemberState } from './app/window-layout-control-icons.js';
import {
  WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED,
  memberNoteForOutcome,
  snapshotMemberNote,
} from './app/window-layout-member-note.js';
import { createWindowLayoutIsolateMode } from './app/window-layout-isolate-mode.js';
import { createWindowLayoutMemberPreview, windowLayoutPreviewHoverState } from './app/window-layout-preview.js';
import {
  createWindowLayoutIconHydration,
  reconcileWindowLayoutIconSnapshotCache,
  windowLayoutIconCacheEntry,
  windowLayoutIconFromCache,
} from './app/window-layout-icon-hydration.js';
import { compressIconFile } from './app/utilities/image-compression.js';
import { getWorkspaceElements } from './app/dom.js';
import { createToolbarController } from './app/components/toolbar-controller.js';
import { createStatusToast } from './app/components/status-toast.js';
import { createPromptLibraryDialog } from './app/components/prompt-library-dialog.js';
import { HOTKEY_CATALOG, HOTKEY_SCOPE_WORKSPACE, effectiveBindings, getBackdropOpacity, getBreadcrumbMiddleScale, getBreadcrumbRootScale, getEdgeOpacity, getOutlineOpacity, getRegionOpacity, getTheme, getTrailOpacity, getTransparentBackground, setBackdropOpacity } from './app/hotkeys-model.js';
import { collectIncludedPrompts, formatCopyConfirmation, resolveCopierAction } from './prompt-library-model.js';
import { createConfirmationDialog } from './app/components/confirmation-dialog.js';
import { createContextMenu } from './app/components/context-menu.js';
import { createEditorDialog } from './app/components/editor-dialog.js';
import { createBinControls } from './app/components/bin-controls.js';
import { createSetMembershipMode } from './app/components/set-membership-mode.js';
import { bootstrapWorkspace } from './app/bootstrap.js';
import { createVisualObservability, hydrationSummaryDisagrees, semanticKeyForItem } from './app/visual-observability.js';
import { createWorkspaceStore } from './app/workspace-store.js';
import { createWorkspaceCommands } from './app/workspace-commands.js';
import { resolveContextTarget } from './app/context-target-model.js';
import { createKeyboardController } from './app/interactions/keyboard-controller.js';
import { bindQuickRunWorkspace } from './app/quick-run/quick-run-workspace.js';
import {
  COMMAND_SURFACE_MODE,
  commandSurfaceModeFromUrl,
  planCommandSurfaceInvoke,
} from './app/quick-run/quick-run-command-surface.js';
import { planQuickRunTypeToRun } from './app/quick-run/quick-run-type-to-run.js';
import { createMarqueeController } from './app/interactions/marquee-controller.js';
import { createDropController } from './app/interactions/drop-controller.js';
import { createPointerController } from './app/interactions/pointer-controller.js';
import {
  SURFACE_DOCUMENT_CHANNEL,
  SURFACE_DOCUMENT_LOCK,
  SURFACE_ROLE,
  createSurfaceCoordinator,
  hostWriterLeaseAdapter,
  webLockAdapter,
} from './app/workspace-surface-coordinator.js?build=coordination-v18';
import {
  VIEW_BLOCKED_MESSAGE,
  createDocumentConflictPanel,
} from './app/components/document-conflict-panel.js';
import {
  scopeRootFromUrl,
  groupInScope,
  itemInScope,
  destinationInScope,
} from './workspace-scope.js';

const host = createHostBridge(window);
const bindWindowLayoutPickerCandidate = createWindowLayoutCandidateBinder({
  bindWindowCandidate: (candidateId) => host.bindWindowCandidate(candidateId),
  listWindowCandidates: () => host.windowCandidates({ includeNativeIcons: false }),
});
const PROJECT_SURFACE_KEY = (() => {
  const value = new URLSearchParams(window.location.search).get('papers-surface-key');
  return value && value.length <= 128 ? value : null;
})();
const SCOPE_ROOT_ID = scopeRootFromUrl(window.location);
const EMBEDDED_SURFACE = new URLSearchParams(window.location.search).get('papers-embedded-surface');

function embeddedParentOrigin() {
  try {
    const parsed = new URL(document.referrer);
    const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
    return origin && origin !== 'null' ? origin : '*';
  } catch {
    return '*';
  }
}

const PICKUP_PROMPT = `You are picking up Papers and its Backpack projects.

Canonical Papers repository: https://github.com/Futahua/Papers-3
Primary-machine source checkout: D:\\Letters\\MatTroiSeConMoc\\PAPERS 3\\Papers-3

Before acting, read AGENTS.md and HERMES.md completely from the current repository, then follow the document map in README.md. Treat those current files as authoritative over this copied orientation.

I do not code or design technical architecture. I describe the experience I want; you must construct it, test it, protect my data, and explain the result in plain language. Clicking buttons, entering information, choosing files, opening applications, organizing work, and confirming actions are normal use—not configuration or permission to invent editors, frameworks, or product-wide abstractions.

Treat Backpacks as independently developed projects, closest to plugins in ownership. Backpack interfaces, behavior, and implementation belong outside Papers' main binaries unless a concrete requirement genuinely needs a Papers-host change. A local Backpack is local in experience, implementation, and data; its ordinary development must not create a Papers version or update other machines.

My request:
[Describe what you want to experience.]`;

const elements = getWorkspaceElements(document);
const windowLayoutPillTray = document.getElementById('window-layout-pills');
const statusToast = createStatusToast({ element: elements.status, suppressWarnings: true });

// 019C: the compact-widget surface is the SAME project entry loaded by the
// Papers compact-widget host with `papers-surface=compact-widget` plus the
// opaque layout key (papers-layout-key is what Papers writes; layout-key is
// accepted for the assignment's literal URL). Only that named layout's card is
// rendered; the graph/workspace and the old 018 wait-for-ACTIVATE/read-only
// lifecycle never run here.
function windowLayoutWidgetSurfaceParams(locationRef) {
  const search = new URLSearchParams(locationRef.search);
  if (search.get('papers-surface') !== 'compact-widget') return null;
  const layoutId = search.get('papers-layout-key') ?? search.get('layout-key');
  if (!layoutId || layoutId.length === 0 || layoutId.length > 512) return null;
  return { layoutId };
}
const WIDGET_SURFACE = windowLayoutWidgetSurfaceParams(window.location);
if (WIDGET_SURFACE) document.documentElement.dataset.widgetSurface = 'true';
/** A channel stand-in that never listens and never posts. */
function createInertBroadcastChannel(name) {
  return { name, postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} };
}
function createSafeBroadcastChannel(name) {
  if (typeof BroadcastChannel !== 'function') return createInertBroadcastChannel(name);
  try {
    return new BroadcastChannel(name);
  } catch {
    return createInertBroadcastChannel(name);
  }
}
const windowLayoutWidgetSelectionChannel = createSafeBroadcastChannel('ayg-window-layout-widget-selection');
if (!WIDGET_SURFACE) {
  // A click back in the Backpack explicitly exits every detached widget's
  // ephemeral Ctrl/Shift selection, even when its always-on-top native window
  // was shown inactive and therefore has no reliable browser blur transition.
  window.addEventListener('pointerdown', () => {
    windowLayoutWidgetSelectionChannel?.postMessage({ type: 'clear-selection' });
  }, { capture: true });
}

const iconCache = new Map();
let state = normalizeState({ schemaVersion: 1, groups: [], shortcuts: [] });
const visualObservability = createVisualObservability(window);

// 018X7: the store's internal commit save-rejection handler must not paint a
// stale persistence error once a detach handoff is read-only. The sink checks
// the gate (declared later; only invoked on commit-save settle, so no TDZ).
const workspaceStoreStatus = createReadOnlyStatusSink({
  isReadOnly: () => detachSaveGate.isReadOnly(),
  show: (text, options) => statusToast.show(text, options),
});

// 0B: created after the store, because it needs the store's queue. Until it
// exists this surface behaves exactly as it always has -- a single writer.
let surfaceCoordinator = null;
// The host may ask a project to finish a bounded close-time persistence before
// destroying its renderer. This remains an optional project hook: Papers does
// not know the document schema or what the project considers durable.
let pendingRestSave = Promise.resolve();
let pendingSurfaceLocationSave = Promise.resolve();
// Coordination is fail-closed while startup is pending and when either
// primitive cannot be constructed. An uncoordinated surface must never fall
// back to the legacy unchecked host.saveWorkspace path.
let coordinationState = 'pending';

/** Does this surface currently own the shared document? */
function hasDocumentWriteAuthority() {
  // Every open As you Go surface accepts document actions. Non-writers send
  // their optimistic snapshot to the elected writer, which serializes the
  // durable save and broadcasts the merged result back to all surfaces.
  // A new view is gated until its coordinator has loaded a versioned base;
  // otherwise its first forwarded snapshot would carry revision:null and no
  // three-way merge could protect a writer edit that raced startup.
  if (coordinationState !== 'ready' || !surfaceCoordinator) return false;
  if (!surfaceCoordinator.baselineReady) return false;
  if (surfaceCoordinator.role === SURFACE_ROLE.CONFLICT) return false;
  return true;
}

/** Automatic host tracking is not an optimistic user mutation: only the
 * single elected writer may discover and add windows for Auto layouts. */
function isCurrentDocumentWriter() {
  return hasDocumentWriteAuthority()
    && !windowLayoutDetachment.isReadOnly()
    && surfaceCoordinator?.role === SURFACE_ROLE.WRITER;
}

const store = createWorkspaceStore({
  getState: () => state,
  setState: (next) => { state = next; },
  normalizeState,
  // 0B: a surface that does not own the document stops here, before any
  // document or history state changes. This is conjunctive with the 018
  // read-only gate below, not a replacement for it.
  canMutateDocument: hasDocumentWriteAuthority,
  onMutationBlocked: () => {
    // A plain view being blocked is ordinary, not a conflict: say so lightly
    // and leave the conflict panel for an actual refused save.
    if (surfaceCoordinator?.role === SURFACE_ROLE.VIEW) {
      statusToast.show(VIEW_BLOCKED_MESSAGE);
    }
  },
  onSaveGenerationInvalidated: (generation, latestLocal) => surfaceCoordinator?.retirePendingGeneration(generation, latestLocal),
  persist: (snapshot, metadata) => {
    // 018X1/018X8: every save funnels through the store's persist callback.
    // Persistence is blocked while read-only UNLESS the metadata carries the
    // gate's exact current flush permit (an older queued save has no token and
    // resolves as suppressed; the handoff FLUSH saves the final snapshot once).
    if (!detachSaveGate.permitsPersist(metadata)) return Promise.resolve();
    // 0B: the coordinator owns the revision and the compare-and-set, and
    // broadcasts the exact bytes that landed. The snapshot is already
    // serialized here, and is passed through untouched.
    if (surfaceCoordinator) return surfaceCoordinator.saveSerialized(snapshot, metadata);
    return Promise.reject(new Error('Shared document coordination is unavailable; durable editing is disabled.'));
  },
  setStatus: workspaceStoreStatus,
  initialSession: { currentId: ROOT_ID },
  prepare: (next, session) => captureWorkspaceViewFrom(next, session),
  afterCommit: () => {
    closeMenu();
    render();
  },
});
// 018X1 read-only gate: every workspace mutation funnels through commit/
// replace. While a layout controller is detached these are no-ops; the handoff
// flush temporarily raises the override so the final capture+save still runs.
const storeCommit = store.commit.bind(store);
const storeReplace = store.replace.bind(store);
const detachSaveGate = createDetachSaveGate({
  getState: () => state,
  replaceState: (next) => storeReplace(next),
  commitState: (next, options) => storeCommit(next, options),
  // 018X8: the flush permit token is carried through the REAL store save queue.
  saveState: (current, metadata) => store.save(current, metadata),
});
store.commit = (next, options) => detachSaveGate.commit(next, options);
store.replace = (next) => detachSaveGate.replace(next);
// 018X2 item 7: the store's exported undo/redo call the LEXICAL internal
// commit (not the monkeypatched wrapper), so they are gated explicitly while
// read-only. All other exported mutators are session-only (non-durable) except
// commit/replace (gated) and install (the load path, intentionally ungated).
const storeUndo = store.undo.bind(store);
const storeRedo = store.redo.bind(store);
store.undo = () => (detachSaveGate.isReadOnly())
  ? Promise.resolve(false)
  : storeUndo();
store.redo = () => (detachSaveGate.isReadOnly())
  ? Promise.resolve(false)
  : storeRedo();
const session = store.getSession();

let suppressBlankClick = false;
let suppressGraphClick = false;
let zoomTimer = null;
let fileCapabilityPanel = null;
let workspaceNavigator = null;

function setStatus(text = '', options) {
  statusToast.show(text, options);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[character]));
}

function group(groupId) {
  return state.groups.find((candidate) => candidate.id === groupId) ?? null;
}

function shortcut(shortcutId) {
  return state.shortcuts.find((candidate) => candidate.id === shortcutId) ?? null;
}

function item(itemId) {
  return group(itemId) ?? windowLayout(itemId) ?? shortcut(itemId);
}

// The embedded boundary is presented at AYG's synthetic ROOT_ID, but its
// graph positions belong to the real scoped project group. Keep that mapping
// local to the embedded surface so standalone AYG's global root context stays
// unchanged.
function scopedGraphContextId(currentGroupId, binMode) {
  if (SCOPE_ROOT_ID && !binMode && currentGroupId === ROOT_ID) return SCOPE_ROOT_ID;
  return graphContextId(currentGroupId, binMode);
}

/** A persisted window-layout record by its own id. Window layouts are
 * single-parent entities (like groups): one record, one location, their own
 * identity — never shortcut-style linked placements. */
function windowLayout(windowLayoutId) {
  return state.windowLayouts?.find((candidate) => candidate.id === windowLayoutId) ?? null;
}

/** Resolves a shortcut by either its shared record id or one of its
 * placement ids — bin-mode graph tiles are keyed by placement id (each
 * binned placement is its own independent tile), so looking a bin
 * shortcut tile up by shortcut() alone (which only matches the record id)
 * always misses. */
function shortcutByRecordOrPlacementId(candidateId) {
  return shortcut(candidateId)
    ?? state.shortcuts.find((record) => record.placements.some((placement) => placement.id === candidateId))
    ?? null;
}

/** Any one active (non-bin) placement id belonging to the given shortcut
 * identity — enough for the model layer's placement-scoped functions
 * (copySelection/moveSelection/collapsePlacements) to find the record. */
function anyActivePlacementId(shortcutId) {
  const record = shortcut(shortcutId);
  return record?.placements.find((placement) => !placement.bin)?.id ?? null;
}

function allActivePlacementIds(shortcutId) {
  const record = shortcut(shortcutId);
  return record?.placements.filter((placement) => !placement.bin).map((placement) => placement.id) ?? [];
}

/** The specific placement the user is currently looking at for this
 * shortcut — the one matching its visible parent in the currently
 * rendered graph node, falling back to any active placement if the node
 * isn't on screen. Must be resolved at gesture-start time (copy/cut,
 * drag start, bin move, editor open), not at commit time, since
 * navigation or selection changes between gesture and commit shouldn't
 * change which placement the action targets. */
function visiblePlacementIdFor(shortcutId) {
  const record = shortcut(shortcutId);
  const visibleParentId = graph._getNode(shortcutId)?.parentIds?.[0];

  return record?.placements.find((placement) =>
    !placement.bin
    && (!visibleParentId || placement.parentId === visibleParentId)
  )?.id ?? anyActivePlacementId(shortcutId);
}

/** Resolves a Bin-context id — a group id, or one specific placement id —
 * to its display name. Used for the Bin, where a tile's own id is the
 * placement, not the shared shortcut identity. */
function binItemName(binItemId) {
  const asGroup = group(binItemId);
  if (asGroup) return asGroup.name;
  const owner = state.shortcuts.find((candidate) =>
    candidate.placements.some((placement) => placement.id === binItemId));
  return owner?.name ?? null;
}

/** How many distinct folders the given shortcut is currently shown linked
 * into, in the graph node currently on screen for it — this is what decides
 * whether cutting it collapses every placement into one, or only moves the
 * one this view represents (per the creator's rule: 2+ visible edges means
 * "act on the whole shared thing," exactly 1 means "act on this location"). */
function visibleParentCountFor(shortcutId) {
  const node = graph._getNode(shortcutId);
  return node?.parentIds?.length ?? 1;
}

function isAvailableItem(itemId) {
  const candidate = item(itemId);
  if (!candidate || candidate.bin) return false;
  if (!itemInScope(state, itemId, SCOPE_ROOT_ID)) return false;
  let parent = group(candidate.parentId);
  while (parent) {
    if (parent.bin) return false;
    parent = group(parent.parentId);
  }
  return true;
}

function captureWorkspaceViewFrom(currentState, currentSession) {
  const captured = updateWorkspaceView(currentState, {
    currentGroupId: currentSession.currentId,
    graphExpandedGroupIds: [...currentSession.graphExpanded],
    selectedItemIds: [...currentSession.selected],
    binMode: currentSession.binMode,
  });
  return PROJECT_SURFACE_KEY && !currentSession.binMode
    ? setSurfaceLocation(captured, PROJECT_SURFACE_KEY, currentSession.currentId)
    : captured;
}

function captureWorkspaceView() {
  return captureWorkspaceViewFrom(state, session);
}

function restoreWorkspaceView() {
  const requestedFromUrl = new URLSearchParams(window.location.search).get('as-you-go-folder');
  const requestedCurrent = requestedFromUrl && group(requestedFromUrl)
    ? requestedFromUrl
    : (surfaceLocationFor(state, PROJECT_SURFACE_KEY)?.currentGroupId ?? state.view.currentGroupId);
  const scopedCurrent = SCOPE_ROOT_ID && group(SCOPE_ROOT_ID)
    ? (groupInScope(state, requestedCurrent, SCOPE_ROOT_ID) ? requestedCurrent : SCOPE_ROOT_ID)
    : requestedCurrent;
  store.setNavigation({
    currentId:
      SCOPE_ROOT_ID
        // A scoped surface opens inside its scope root, never one level
        // above it: the boundary guard (breadcrumbs, navigation, adds) holds
        // from the first paint instead of only after drilling in. There is
        // no lone-tile outer canvas where the project sits alone and
        // root-level adds are offered.
        ? (group(SCOPE_ROOT_ID) ? scopedCurrent : ROOT_ID)
        : (requestedCurrent === ROOT_ID || (group(requestedCurrent) && isAvailableItem(requestedCurrent))
          ? requestedCurrent
          : ROOT_ID),
    binMode: false,
  });
  store.setGraphExpanded(
    (state.view.graphExpandedGroupIds ?? []).filter((groupId) =>
      Boolean(group(groupId))),
  );
  const binnedIds = new Set(binnedItems(state).map((candidate) => candidate.id));
  store.setSelection(
    state.view.selectedItemIds.filter((itemId) =>
      store.getSession().binMode ? binnedIds.has(itemId) : isAvailableItem(itemId)),
  );
  store.setSelectionAnchor([...store.getSession().selected].at(-1) ?? null);
  state = store.replace(captureWorkspaceView());
}

function saveWorkspaceView({ persistSurfaceLocation = false } = {}) {
  if (detachSaveGate.isReadOnly()) return;
  // Navigation, selection, expansion, trail expansion and Bin mode belong to
  // the live surface. Update the in-memory fallback for this window only; no
  // store save or coordinator mutation request is generated.
  state = store.replace(captureWorkspaceView());
  if (persistSurfaceLocation && PROJECT_SURFACE_KEY) {
    pendingSurfaceLocationSave = store.save(state, { rebaseAutomaticSave: true }).catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }
}

/** 018A1/018X1 handoff flush: capture the current view into state and await the
 * REAL store save queue (the single write that completes before the stop/flush
 * ACK). The read-only gate's override is raised BEFORE the capture so the final
 * state is never discarded, and released in finally so no write can race the
 * ACK and no new gesture save can slip through. */
function flushWorkspaceSave() {
  return detachSaveGate.flush(() => captureWorkspaceView());
}

function pathTo(groupId) {
  const result = [];
  let cursor = group(groupId);
  while (cursor && cursor.id !== SCOPE_ROOT_ID) {
    result.unshift({ id: cursor.id, name: cursor.name });
    cursor = group(cursor.parentId);
  }
  if (SCOPE_ROOT_ID) {
    const root = group(SCOPE_ROOT_ID);
    return root ? [{ id: root.id, name: root.name }, ...result] : result;
  }
  return [{ id: ROOT_ID, name: 'As you Go' }, ...result];
}

const FULL_PAGE_TAB_IDENTITY = (() => {
  try {
    const token = new URL(window.location.href).searchParams.get('papers-file-preview');
    const raw = token ? window.localStorage.getItem('papers:file-preview:' + token) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    const previewTitle = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    const workspaceTitle = typeof parsed?.workspaceTitle === 'string' ? parsed.workspaceTitle.trim() : '';
    const title = previewTitle || workspaceTitle;
    const previewIcon = typeof parsed?.previewIcon === 'string' ? parsed.previewIcon : '';
    const workspaceIcon = typeof parsed?.workspaceIcon === 'string' ? parsed.workspaceIcon : '';
    const icon = previewIcon || workspaceIcon;
    return title ? { title, icon } : null;
  } catch {
    return null;
  }
})();

function generatedWorkspaceTabIcon(kind) {
  const body = kind === 'root'
    ? '<circle cx="16" cy="16" r="10" fill="none" stroke="#d8d1bf" stroke-width="3"/><path d="M16 4v12" stroke="#d8d1bf" stroke-width="3" stroke-linecap="round"/>'
    : '<path d="M3 8h10l3 3h13v15H3z" fill="#b99d54"/><path d="M3 8h10l3 3h13" fill="none" stroke="#e5d391" stroke-width="2"/>';
  return 'data:image/svg+xml;base64,' + btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' + body + '</svg>',
  );
}

function syncWorkspaceTabIdentity() {
  if (WIDGET_SURFACE) return;
  let title;
  let icon;
  if (FULL_PAGE_TAB_IDENTITY) {
    ({ title, icon } = FULL_PAGE_TAB_IDENTITY);
  } else if (session.binMode) {
    title = 'Bin';
    icon = generatedWorkspaceTabIcon('root');
  } else {
    const currentId = session.currentId ?? ROOT_ID;
    const current = currentId === ROOT_ID ? null : group(currentId);
    const scopedRoot = SCOPE_ROOT_ID ? group(SCOPE_ROOT_ID) : null;
    title = current?.name || scopedRoot?.name || 'Workspace';
    icon = current?.icon || scopedRoot?.icon || generatedWorkspaceTabIcon(current ? 'folder' : 'root');
  }
  if (document.title !== title) document.title = title;
  let favicon = document.head.querySelector('link[data-papers-tab-icon]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.setAttribute('data-papers-tab-icon', 'true');
    document.head.append(favicon);
  }
  if (favicon.getAttribute('href') !== icon) favicon.setAttribute('href', icon);
}

/** Breadcrumb path while drilled into a folder inside the Bin — walks up
 * from groupId through its real (original) ancestor chain, stopping at
 * the first folder that isn't itself binned (its own placement in the
 * Bin's top-level list), so the trail reads "Bin › outerBinnedFolder ›
 * ... › groupId" without ever crossing into the real explorer tree. */
function pathToBin(groupId) {
  const result = [];
  let cursor = group(groupId);
  while (cursor) {
    result.unshift({ id: cursor.id, name: cursor.name });
    if (cursor.bin) break;
    cursor = group(cursor.parentId);
  }
  return [{ id: 'bin', name: 'Bin' }, ...result];
}

/** The explicit view-context key for trail expansion (Assignment 007):
 * `folder:<id>` for explorer views (root is `folder:root`), `bin:<id>` for
 * Bin views (the Bin top level is `bin:bin`). Each key remembers its own
 * trail choices; a view with no entry defaults every trail folder to
 * collapsed. Never derived from or written into ordinary expansion. */
function currentTrailContextKey() {
  return session.binMode
    ? `bin:${session.binCurrentId ?? 'bin'}`
    : `folder:${session.currentId ?? ROOT_ID}`;
}

/** Persists THIS view context's trail-expansion ids and syncs the session
 * set. Empty collapses everything and drops the key. Callers render and
 * save through the normal paths. */
function setCurrentTrailExpanded(ids) {
  const unique = [...new Set(ids)];
  state = store.replace(setTrailExpandedByContext(state, currentTrailContextKey(), unique));
  store.setTrailExpanded(unique);
}

function iconMarkup(candidate) {
  if (candidate.kind === 'bin-origin') {
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
  if (candidate.kind === 'window-layout') {
    return '';
  }
  if (candidate.kind === 'group') {
    if (candidate.icon) {
      return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
    }
    return '<span class="folder-art" aria-hidden="true"><span></span></span>';
  }
  if (candidate.icon) {
    return `<img src="${escapeHtml(candidate.icon)}" alt="" />`;
  }
  if (isWebLink(candidate)) {
    return `<img data-web-icon="${escapeHtml(candidate.target)}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
  }
  return `<img data-default-icon="${candidate.id}" alt="" hidden /><span class="shortcut-fallback" aria-hidden="true">↗</span>`;
}

function linkMarkup(candidate) {
  return candidate.linked
    ? '<span class="link-badge" title="Linked into more than one folder" aria-hidden="true">⛓</span>'
    : '';
}

/** 024: a layout has no icon of its own (members carry the real icons), so its
 * card is content-sized - the empty icon box that would otherwise sit above the
 * name is omitted. Folders/shortcuts/groups keep their icon box. */
function iconItemMarkup(candidate) {
  if (candidate.kind === 'window-layout') return '';
  return `<div class="item-icon">${iconMarkup(candidate)}</div>`;
}

function descriptionMarkup(candidate) {
  return candidate.kind === 'shortcut' && candidate.description
    ? `<small>${escapeHtml(candidate.description)}</small>`
    : '';
}

/** 035: the attached workspace card becomes a greyed, noninteractive placeholder
 * while its compact widget is open (`options.detached`), or during the retired
 * full-detach handoff (`readonly`/`detached` presentation modes). The widget
 * surface itself is never a placeholder. One predicate so the card class and
 * the body markup cannot disagree. */
function windowLayoutCardPlaceholder(options) {
  if (options.widgetSurface === true) return false;
  return options.detached === true
    || windowLayoutDetachment.isReadOnly()
    || windowLayoutDetachment.getState().mode === 'detached';
}

function windowLayoutCardMarkup(candidate, options = {}) {
  const placeholder = windowLayoutCardPlaceholder(options);
  return `<div class="window-layout-card${placeholder ? ' window-layout-card--placeholder' : ''}" data-wl-card="${escapeHtml(candidate.id)}"${placeholder ? ' data-wl-placeholder="true"' : ''}>
    ${windowLayoutBodyMarkup(candidate, options)}
  </div>`;
}

/** 019B compact card live body inside a window-layout shell: a fixed-height,
 * one-row, taskbar-like icon strip (one compact icon button per persisted
 * member - every member is visible; large counts compact instead of clipping),
 * a single row of compact static inline-SVG controls, a picker host and a
 * status line. Buttons never begin outer graph dragging because the graph drag
 * excludes <button> pointerdowns by design (Assignment 015/016). No Activate
 * control and no affirmative Recording furniture (016 creator correction):
 * adding a member captures its bounds/state immediately and tracking is
 * implicit. 035: the attached placeholder shows the same greyed members and the
 * lock ONLY (reattach); the widget is the sole live card. */
function windowLayoutBodyMarkup(candidate, options = {}) {
  const emptyHint = (candidate.arrangement?.members ?? []).length === 0
    ? '<div class="window-layout-empty" data-wl-empty="true">No windows yet</div>'
    : '';
  const status = windowLayoutStatusText(candidate.id);
  // 018V7R3: one shared bounded presentation mode (readonly/detached/workspace)
  // so the body markup and the node content signatures cannot disagree.
  const presentationMode = windowLayoutPresentationMode({
    isReadOnly: windowLayoutDetachment.isReadOnly(),
    mode: windowLayoutDetachment.getState().mode,
  });
  const placeholder = windowLayoutCardPlaceholder(options);
  if (placeholder) {
    const members = (candidate.arrangement?.members ?? []).map((member) =>
      windowLayoutMemberMarkup(candidate.id, member, windowLayoutMemberIcon(candidate.id, member), true,
        windowLayoutMemberNote(candidate.id, member))).join('');
    // Inert greyed workspace summary while the widget is the sole live card:
    // disabled members and status, with one plain-click reattach lock.
    return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" data-wl-placeholder-body="true" aria-label="Window group (detached)">
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    <div class="window-layout-controls">${windowLayoutControlButton('reattach', 'Reattach this window-layout widget', 'data-wl-reattach', candidate.id)}</div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
  }
  const members = (candidate.arrangement?.members ?? []).map((member) =>
    windowLayoutMemberMarkup(candidate.id, member, windowLayoutMemberIcon(candidate.id, member), false,
      windowLayoutMemberNote(candidate.id, member))).join('');
  const widgetSurface = options.widgetSurface === true;
  const trackingControl = widgetSurface
    ? windowLayoutControlButton('tracking', candidate.tracking?.enabled === true ? 'Stop automatic window tracking' : 'Start automatic window tracking', 'data-wl-track', candidate.id, { toggle: true, active: candidate.tracking?.enabled === true, activeClass: 'tracking-enabled' })
    : '';
  return `<div class="window-layout-body" data-wl-layout="${escapeHtml(candidate.id)}" aria-label="Window group">
    ${widgetSurface ? `<button class="window-layout-delete" type="button" data-wl-delete="${escapeHtml(candidate.id)}" title="Click twice to delete this layout" aria-label="Click twice to delete this layout">×</button>` : ''}
    ${widgetSurface ? windowLayoutControlButton('clear', 'Click twice to clear all windows from this layout', 'data-wl-clear', candidate.id) : ''}
    <div class="window-layout-members" data-wl-members="${escapeHtml(candidate.id)}">${members}${emptyHint}</div>
    ${trackingControl}
    <div class="window-layout-controls">
      ${windowLayoutControlButton('list', 'Live-pick an onscreen window (hover for the list)', 'data-wl-list', candidate.id, { glyph: 'pick' })}
      ${windowLayoutControlButton('min-all', widgetSurface ? 'Minimize all members; middle-click to dock as an AYG pill' : 'Minimize all members; right-click to toggle isolate mode', 'data-wl-min-all', candidate.id, { toggle: true, active: windowLayoutRuntime.isolateMode.isActive(candidate.id) })}
      ${windowLayoutControlButton('restore-all', widgetSurface ? 'Restore/open all members' : 'Restore/open all members; middle-click to undock widget', 'data-wl-restore-all', candidate.id)}
    </div>
    <div class="window-layout-picker" data-wl-picker="${escapeHtml(candidate.id)}"></div>
    <div class="window-layout-status" data-wl-status="${escapeHtml(candidate.id)}">${escapeHtml(status)}</div>
  </div>`;
}

/** 019F: the four persistent controls and taskbar-like member button live in
 * ./app/window-layout-control-icons.js (static inline SVG, exact creator
 * mapping, stable data-wl-glyph identifiers). The body wires them with the
 * exact title/aria-label semantics and behavior data attributes. */

/** Picker list markup (016): a vertical list of compact rows from the host
 * candidate list. Every row toggles: a row whose title matches an existing
 * member removes it (data-only), any other row binds it. */
function windowLayoutPickerMarkup(layoutId, candidates) {
  const layout = windowLayoutFromState(layoutId);
  const members = layout?.arrangement?.members ?? [];
  const rows = candidates.map((candidate) => {
    const isCurrentMember = members.some((member) => candidate.title === member.descriptor.title);
    return `<button class="window-layout-pick-candidate${isCurrentMember ? ' current-member' : ''}" data-wl-pick-candidate="${escapeHtml(candidate.id)}" data-wl-pick="${escapeHtml(layoutId)}" type="button" title="${escapeHtml(candidate.title)}">
      ${candidate.icon
        ? `<img class="window-layout-pick-icon" src="${escapeHtml(candidate.icon)}" alt="">`
        : '<span class="window-layout-pick-icon placeholder" aria-hidden="true"></span>'}
      <span class="window-layout-pick-label">${escapeHtml(candidate.title)}</span>
      <span class="window-layout-pick-state ${escapeHtml(candidate.state)}">${isCurrentMember ? 'remove' : escapeHtml(candidate.state)}</span>
    </button>`;
  }).join('');
  return `<div class="window-layout-picker-panel">
    <div class="window-layout-picker-head">Choose an onscreen window (click a member row to remove it)
      <button class="window-layout-picker-close" data-wl-picker-close="true" type="button" title="Close picker">×</button>
    </div>
    <div class="window-layout-picker-list">${rows || '<div class="window-layout-empty">No eligible windows</div>'}</div>
  </div>`;
}

// ---- window-layout runtime (Assignment 015/016) ----------------------------
// One explicit active-recording layout at a time, tracked IMPLICITLY (no
// Activate button, no affirmative Recording furniture - 016 creator
// correction): adding a window captures its bounds/state immediately and
// recording follows the last-touched layout context. Capabilities and icons
// are ephemeral session state (never persisted); descriptors are the only
// durable member identity and resolve fail-closed against visible windows.
// 017I2: recording (switch, timer, observation, echo suppression) is owned
// exclusively by the pure controller in ./app/window-layout-runtime.js; this
// object keeps only the entry-side per-layout UI/interaction state.
// 040: capabilities and icons are keyed by the composite
// `layoutId\u0000memberId` identity (windowLayoutMemberKey) so two layouts
// referencing the same real window never share ephemeral state; every cache,
// DOM selector and removal path uses the composite key.
const windowLayoutRuntime = {
  capabilities: new Map(),   // `${layoutId}\u0000${memberId}` -> capability (ephemeral, entry-side only)
  // Live presentation state per member: the underline under an icon renders from
  // THIS, never from the persisted member state. `unknown` is a real value - a
  // member the app cannot observe must not masquerade as minimized.
  liveMemberState: new Map(),
  icons: new Map(),          // `${layoutId}\u0000${memberId}` -> data URL (ephemeral)
  pickerOpenFor: null,
  pickerGeneration: 0,
  pickerCandidates: null,
  pickLayoutId: null,
  saveTimer: null,
  selectedMembers: new Map(), // layoutId -> Set<memberId> (inner multiselect)
  selectionAnchor: new Map(), // layoutId -> memberId (Shift+click range anchor, 019B)
  isolateMode: createWindowLayoutIsolateMode(), // ephemeral; right-click minimize toggles it
  pickUnsubscribe: null,
};
const windowLayoutMemberToggleTails = new Map();

const WINDOW_LAYOUT_SAVE_DEBOUNCE_MS = 300;
const WINDOW_LAYOUT_LIST_DWELL_MS = 200;
let windowLayoutListDwell = null;

function cancelWindowLayoutListDwell() {
  if (windowLayoutListDwell) clearTimeout(windowLayoutListDwell);
  windowLayoutListDwell = null;
}

function scheduleWindowLayoutListDwell(button, open) {
  cancelWindowLayoutListDwell();
  windowLayoutListDwell = setTimeout(() => {
    windowLayoutListDwell = null;
    // Mouseout is the authoritative cancellation seam. Chromium's `:hover`
    // query is unreliable in transparent frameless widget surfaces and can
    // report false while the pointer is visibly stationary over this button.
    // A rerender may replace the node during the dwell, but the stable opener
    // already carries the layout identity and remains safe to invoke once.
    void open();
  }, WINDOW_LAYOUT_LIST_DWELL_MS);
}

/** Balance wrapped member rows against the card's actual live width. If one
 * more icon would create an 8+1 orphan, two near-even rows are chosen; a user
 * resize recomputes the columns continuously instead of relying on a hardcoded
 * member-count breakpoint. */
function balanceWindowLayoutMemberRows(card) {
  const members = card?.querySelector?.('[data-wl-members]');
  if (!members) return;
  const count = members.querySelectorAll('[data-wl-member]').length;
  if (count === 0) {
    members.style.removeProperty('--wl-balanced-member-width');
    return;
  }
  const available = Math.max(28, card.clientWidth - 16);
  const maxColumns = Math.max(1, Math.floor((available + 4) / 32));
  const rows = Math.max(1, Math.ceil(count / maxColumns));
  const columns = Math.ceil(count / rows);
  members.style.setProperty('--wl-balanced-member-width', `${(columns * 28) + ((columns - 1) * 4)}px`);
}

const windowLayoutCardResizeTimers = new WeakMap();
const windowLayoutCardResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const { target: card } of entries) {
      balanceWindowLayoutMemberRows(card);
      if (WIDGET_SURFACE || !card.isConnected || !card.style.width || card.matches('.window-layout-card--placeholder')) continue;
      const layoutId = card.dataset.wlCard;
      const width = Math.min(Math.round(card.getBoundingClientRect().width), WINDOW_LAYOUT_CARD_MAX_WIDTH);
      const height = Math.ceil(card.scrollHeight);
      const shell = card.closest('.window-layout-shell');
      if (shell) shell.style.setProperty('--wl-card-width', `${width}px`);
      const prior = windowLayoutCardResizeTimers.get(card);
      if (prior) clearTimeout(prior);
      windowLayoutCardResizeTimers.set(card, setTimeout(() => {
        windowLayoutCardResizeTimers.delete(card);
        const layout = windowLayoutFromState(layoutId);
        if (!layout || !card.isConnected) return;
        let next;
        try { next = setWindowLayoutCardSize(state, layoutId, width, height); } catch { return; }
        if (next === state) return;
        store.replace(next);
        void store.save(next, { rebaseAutomaticSave: true }).catch(() => undefined);
      }, 180));
    }
  })
  : null;

function installWindowLayoutCardPresentation(root) {
  for (const card of root?.querySelectorAll?.('.window-layout-card') ?? []) {
    balanceWindowLayoutMemberRows(card);
    windowLayoutCardResizeObserver?.observe(card);
  }
}

function removeWindowLayoutCardPresentation(root) {
  for (const card of root?.querySelectorAll?.('.window-layout-card') ?? []) {
    windowLayoutCardResizeObserver?.unobserve(card);
  }
}

/** Move a dragged member in visual row-major order. The old X-only comparator
 * was wrong after wrapping and made later drags appear to time out or jump. */
function moveWindowLayoutMemberButton(members, button, clientX, clientY) {
  const candidates = [...members.querySelectorAll('[data-wl-member]')].filter((candidate) => candidate !== button);
  let before = null;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (clientY < rect.top + (rect.height / 2)
      || (clientY <= rect.bottom && clientX < rect.left + (rect.width / 2))) {
      before = candidate;
      break;
    }
  }
  if (button.nextElementSibling === before || (!before && button === members.lastElementChild)) return false;
  members.insertBefore(button, before);
  return true;
}

function windowLayoutFromState(layoutId) {
  return state.windowLayouts?.find((candidate) => candidate.id === layoutId) ?? null;
}

function windowLayoutMemberFromState(layoutId, memberId) {
  return windowLayoutFromState(layoutId)?.arrangement?.members
    .find((member) => member.id === memberId) ?? null;
}

function windowLayoutStatusText(layoutId) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return '';
  if ((layout.arrangement?.members ?? []).length === 0) return 'Pick an onscreen window or open the list';
  // No affirmative Recording/Not-recording furniture; the status line is
  // reserved for missing, denied, partial or error outcomes.
  return '';
}

const windowLayoutTransientStatusTimers = new Map();
/** Consecutive independent positives that a member's window is gone. One is not
 * enough: a resolve can miss a window that is merely hidden or not enumerated. */
const windowLayoutGoneConfirmations = new Map();
function setWindowLayoutStatus(layoutId, text) {
  const previous = windowLayoutTransientStatusTimers.get(layoutId);
  if (previous) {
    clearTimeout(previous);
    windowLayoutTransientStatusTimers.delete(layoutId);
  }
  const status = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
  if (status) status.textContent = text;
  if (WIDGET_SURFACE && text) {
    const timer = setTimeout(() => {
      windowLayoutTransientStatusTimers.delete(layoutId);
      const current = document.querySelector(`[data-wl-status="${CSS.escape(layoutId)}"]`);
      if (current?.textContent === text) current.textContent = '';
    }, 2400);
    windowLayoutTransientStatusTimers.set(layoutId, timer);
  }
}

// Geometry and capability publication is background work. The resident native
// broker sees the physical press; these requests never run inside a click.
const windowControlReady = new Set();
let windowControlWidgetSnapshot = null;
/** The last eligibility count per sync, so "sent 0" can name which half failed. */
let windowControlLastCounts = null;
/** The last handle-resolution answer, surfaced in the widget title while this is
 * being proven: the widget cannot write the document, so its diagnostics have
 * nowhere else to go. */
/** The last control event, kept because the 200ms sync overwrites the title. */
let windowControlLastEvent = 'none';
/** The last recorded sync shape, so a 200ms loop cannot erase the journal. */
let windowControlLastSyncNote = '';
let windowControlSignature = '';
let windowControlNextSyncAt = 0;
let windowControlSyncPending = false;
let windowControlUnavailable = '';
function windowControlKey(layoutId, memberId) {
  return windowLayoutMemberKey(layoutId, memberId);
}
function windowControlEntries() {
  const entries = [];
  const counts = { buttons: 0, disabled: 0, noMember: 0, noCapability: 0, noRect: 0 };
  for (const button of document.querySelectorAll('[data-wl-member]')) {
    counts.buttons += 1;
    if (entries.length >= 32 || button.disabled || !button.isConnected) { counts.disabled += 1; continue; }
    const layoutId = button.dataset.wlLayout;
    const memberId = button.dataset.wlMember;
    const member = layoutId && memberId
      ? (WIDGET_SURFACE
        ? windowControlWidgetSnapshot?.members?.find((candidate) => candidate.id === memberId)
        : windowLayoutMemberFromState(layoutId, memberId))
      : null;
    if (!member) { counts.noMember += 1; continue; }
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) { counts.noRect += 1; continue; }
    const restore = member.bounds ?? null;
    // IDENTITY, not a capability. This surface knows which member each icon is
    // and where it sits; only Papers can turn that into a live window. Requiring
    // a resolved capability here meant the request was parked behind an authority
    // this surface does not hold, and the broker was never given a single slot.
    entries.push({
      layoutId, memberId, descriptor: member.descriptor,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      restore,
    });
  }
  windowControlLastCounts = counts;
  return entries;
}
async function syncWindowControls() {
  if (windowControlSyncPending || typeof host.windowControlSync !== 'function') return;
  const entries = windowControlEntries();
  const signature = JSON.stringify([window.screenX, window.screenY, entries]);
  if (signature === windowControlSignature && Date.now() < windowControlNextSyncAt) return;
  windowControlSyncPending = true;
  try {
    const response = await host.windowControlSync(entries);
    const allReady = response?.outcome === 'success'
      && (response.results ?? []).length === entries.length
      && (response.results ?? []).every((entry) => entry.ready);
    windowControlSignature = signature;
    windowControlNextSyncAt = allReady ? Infinity : Date.now() + 3000;
    windowControlReady.clear();
    if (response?.outcome === 'success') {
      windowControlUnavailable = '';
      for (const entry of response.results ?? []) {
        if (entry.ready) windowControlReady.add(windowControlKey(entry.layoutId, entry.memberId));
      }
    } else {
      windowControlUnavailable = response?.error || 'Native window control is unavailable';
    }
    // Recorded, because "the broker holds nothing" has to be readable rather than
    // inferred from an empty action log: it names how many members were sent, how
    // many the broker accepted, and why the rest were refused.
    recordControlSyncDiagnostic(entries.length, response);
  } catch (error) {
    windowControlSignature = signature;
    windowControlNextSyncAt = Date.now() + 3000;
    windowControlUnavailable = error instanceof Error ? error.message : 'Native window control is unavailable';
    // The widget cannot write the document, so its refusal goes in the title.
    try {
      if (WIDGET_SURFACE) document.title = 'WC error: ' + windowControlUnavailable.slice(0, 140);
    } catch { /* the report is a diagnostic */ }
    recordControlSyncDiagnostic(entries.length, null);
  } finally {
    windowControlSyncPending = false;
  }
}

/** One bounded entry per sync: what was sent, what was accepted, what was refused. */
function recordControlSyncDiagnostic(requested, response) {
  // The WIDGET surface has no document-write authority, so a record written there
  // can never appear - which is why every sync record so far came from the
  // workspace, where there are no member buttons at all. While this is being
  // proven, the widget states its own outcome in its window title, which is
  // readable from outside the app.
  try {
    if (WIDGET_SURFACE && response?.outcome !== 'success') {
      const counts = windowControlLastCounts ?? { buttons: 0, disabled: 0, noMember: 0, noCapability: 0, noRect: 0 };
      let shape = 'none';
      try { shape = JSON.stringify(response)?.slice(0, 90) ?? 'undefined'; } catch { shape = 'unserializable'; }
      document.title = 'ev ' + windowControlLastEvent + ' | sent ' + requested + ' | btn ' + counts.buttons
        + (windowControlUnavailable ? ' | err ' + String(windowControlUnavailable).slice(0, 90) : '');
    }
  } catch {
    /* diagnostics never fail the action they describe */
  }
  try {
    const ready = (response?.results ?? []).filter((entry) => entry.ready).length;
    const reason = response?.outcome !== 'success'
      ? String(response?.error ?? 'no response')
      : ready === requested ? 'all accepted' : (requested - ready) + ' refused';
    const note = 'window control[' + (WIDGET_SURFACE ? 'widget' : 'workspace') + ']: sent ' + requested
        + ', accepted ' + ready + ' (' + reason + ')'
        + (windowControlLastCounts
          ? ' [buttons ' + windowControlLastCounts.buttons + ', inert ' + windowControlLastCounts.disabled
            + ', no-member ' + windowControlLastCounts.noMember + ', no-handle ' + windowControlLastCounts.noCapability
            + ', no-rect ' + windowControlLastCounts.noRect + ']'
          : '');
    if (note === windowControlLastSyncNote) return;
    windowControlLastSyncNote = note;
    if (WIDGET_SURFACE) return;
    void store.commit(noteWindowLayoutDiagnostic(state, {
      reason: note,
      source: 'control-sync',
    }));
  } catch {
    /* diagnostics never fail the action they describe */
  }
}
if (typeof host.onWindowControlEvent === 'function') host.onWindowControlEvent((event) => {
  if (!event?.layoutId) return;
  // The widget cannot write the document, so the last control event it hears is
  // also stated in its title: that is the only diagnostic a non-writer surface has.
  try {
    if (WIDGET_SURFACE) windowControlLastEvent = String(event.result).slice(0, 120);
  } catch { /* diagnostics never fail the action they describe */ }
  // THE BROKER'S EVENT IS THE TRUTH ABOUT WHAT HAPPENED. It reports the operation it
  // ACTUALLY performed - a toggle is resolved there from the window's live state,
  // not guessed here from persisted state that can lag - so the member's state and
  // marker follow that.
  if ((event.operation === 'minimize' || event.operation === 'restore')
    && (event.result === 'success' || event.result === 'pending')) {
    const memberState = event.operation === 'minimize' ? 'minimized' : 'normal';
    patchWindowLayoutMember(event.layoutId, event.memberId, memberState);
    if (!WIDGET_SURFACE && surfaceCoordinator?.role === SURFACE_ROLE.WRITER) {
      const next = updateWindowLayoutMember(state, event.layoutId, event.memberId, { state: memberState });
      store.replace(next);
      noteWindowLayoutCommit(event.layoutId);
      queueWindowLayoutSave();
    }
    return;
  }
  // Registration is BACKGROUND work, so readiness ARRIVES here: a member is ready
  // only when Papers reports a positive slot for it in the current broker session.
  if (event.result === 'ready') {
    windowControlReady.add(windowControlKey(event.layoutId, event.memberId));
    setWindowLayoutStatus(event.layoutId, '');
    // WARM THE CAPABILITY CACHE OFF THE GESTURE.
    //
    // Right-click uses the accepted activation path, which needs a capability. When
    // one is not cached, the first right-click after a restart resolves it through
    // the window helper - the seconds-long step - so that gesture carried the cost.
    // Registration has just proved the member is real, so the capability is fetched
    // now, in the background, one at a time; the gesture then costs only the native
    // bridge. This is the part that makes right-click FASTER than it was, not equal.
    queueCapabilityWarmup(event.layoutId, event.memberId);
    return;
  }
  if (event.result === 'refused' || event.result === 'no-surface' || String(event.result).startsWith('no-window')) {
    windowControlReady.delete(windowControlKey(event.layoutId, event.memberId));
    setWindowLayoutStatus(event.layoutId, 'Window control could not take this icon: ' + event.result);
    return;
  }
  if (event.result === 'stale') {
    const key = windowControlKey(event.layoutId, event.memberId);
    windowControlReady.delete(key);
    windowLayoutRuntime.capabilities.delete(key);
    windowControlSignature = '';
  }
  if (event.result === 'foreground-refused') {
    setWindowLayoutStatus(event.layoutId, 'Windows refused the foreground switch.');
  } else if (event.result !== 'success' && event.result !== 'pending') {
    setWindowLayoutStatus(event.layoutId, 'Window control failed: ' + event.result);
  }
});
if (typeof host.onWindowControlUnavailable === 'function') host.onWindowControlUnavailable((reason) => {
  windowControlReady.clear();
  windowControlSignature = '';
  windowControlUnavailable = String(reason || 'Native window control is unavailable');
  for (const button of document.querySelectorAll('[data-wl-member]')) {
    if (button.dataset.wlLayout) setWindowLayoutStatus(button.dataset.wlLayout, windowControlUnavailable);
  }
});
setInterval(() => { void syncWindowControls(); }, 200);

/** 040: ONE shared/batched layout-scoped icon refresh. Members whose icon is
 * not yet cached are queued by their composite layout\u0000member key; a single
 * bounded `windowCandidates()` request resolves every queued member's icon in
 * one pass (never one enumeration per member). Committed pick icons are cached
 * immediately at add time; everything else is filled here. A member with no
 * icon yet renders a stable explicit placeholder cell (no blank geometry, no
 * layout shift). The refresh is shared by the workspace and widget surfaces and
 * re-broadcasts resolved icons to open widgets. */
const windowLayoutIconHydration = createWindowLayoutIconHydration({
  getMember: windowLayoutMemberFromState,
  getCachedEntry: (layoutId, memberId) => windowLayoutRuntime.icons.get(windowLayoutMemberKey(layoutId, memberId)),
  requestCandidates: () => host.windowCandidates({ includeNativeIcons: true }),
  isReadOnly: () => windowLayoutDetachment.isReadOnly(),
  cacheIcon: (layoutId, memberId, windowInstanceId, icon, currentMember) => {
    if (windowLayoutDetachment.isReadOnly()
      || currentMember?.descriptor?.windowInstanceId !== windowInstanceId) return;
    windowLayoutRuntime.icons.set(windowLayoutMemberKey(layoutId, memberId), windowLayoutIconCacheEntry(currentMember, icon));
  },
  onResolved: (resolved) => {
    for (const { layoutId, memberId, windowInstanceId } of resolved) {
      const member = windowLayoutMemberFromState(layoutId, memberId);
      if (member?.descriptor?.windowInstanceId !== windowInstanceId || windowLayoutDetachment.isReadOnly()) continue;
      const icon = windowLayoutIconFromCache(member, windowLayoutRuntime.icons.get(windowLayoutMemberKey(layoutId, memberId)));
      if (!icon) continue;
      const button = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"] [data-wl-member="${CSS.escape(memberId)}"]`);
      const cell = button?.querySelector('[data-wl-member-icon]');
      if (cell?.classList.contains('placeholder')) {
        const img = document.createElement('img');
        img.className = 'window-layout-member-icon';
        img.setAttribute('data-wl-member-icon', memberId);
        img.alt = '';
        img.src = icon;
        cell.replaceWith(img);
      } else if (cell?.tagName === 'IMG' && cell.getAttribute('src') !== icon) {
        cell.setAttribute('src', icon);
      }
      windowLayoutWidgetChannelWorkspace.broadcast(layoutId);
    }
  },
});

function queueWindowLayoutIconRefresh(layoutId, memberId) {
  windowLayoutIconHydration.queue(layoutId, memberId);
}

function runWindowLayoutIconRefresh() {
  return windowLayoutIconHydration.refresh();
}

/**
 * Members this surface has checked and cannot currently confirm, by composite member key.
 *
 * In memory, never persisted, and cleared the moment a member records again - the same life as the runtime's
 * own streak, which is deliberate: this is a statement about RIGHT NOW, and durable state that says a window
 * is fine (or not) outlives the truth in both directions. It exists so the card can say the true thing,
 * because until now a member the widget could not confirm looked exactly like a healthy one.
 */
const windowLayoutUnconfirmedMembers = new Map();

/** Called from the runtime's per-member results: a member is either confirmed or it is not. */
function noteWindowLayoutMemberResult(result) {
  const layoutId = result?.layoutId;
  const memberId = result?.memberId;
  if (typeof layoutId !== 'string' || typeof memberId !== 'string') return;
  const key = windowLayoutMemberKey(layoutId, memberId);
  if (result.outcome === 'unverified') {
    const count = Number.isFinite(result.consecutiveMissing) ? result.consecutiveMissing : 1;
    const changed = !windowLayoutUnconfirmedMembers.has(key);
    windowLayoutUnconfirmedMembers.set(key, count);
    return changed;
  }
  // Any other answer is either a confirmation or a transient this surface has never annotated: in both cases
  // the member is not in the unconfirmed state, so it leaves it.
  return windowLayoutUnconfirmedMembers.delete(key);
}

/**
 * The sentence for a member card, or null. The snapshot's note wins when it is there (the compact widget and
 * the detached surface render from a snapshot and have no runtime of their own to ask), and otherwise this
 * surface's own live state answers. One function, so all three surfaces say the same words.
 *
 * The cycle count is deliberately NOT on the card. It is our diagnostic - it is carried in the result and it
 * is what proves the member is still being checked - but "unconfirmed for 4 cycles" reads to a person as
 * something getting worse, and the true thing is the opposite: the member is being held, not dropped. The
 * count stays in the data and out of the sentence.
 */
function windowLayoutMemberNote(layoutId, member) {
  const fromSnapshot = snapshotMemberNote(member?.note);
  if (fromSnapshot !== null) return fromSnapshot;
  return windowLayoutUnconfirmedMembers.has(windowLayoutMemberKey(layoutId, member?.id))
    ? WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED
    : null;
}

function windowLayoutMemberIcon(layoutId, member) {
  const memberId = typeof member === 'string' ? member : member?.id;
  const currentMember = typeof member === 'string' ? windowLayoutMemberFromState(layoutId, memberId) : member;
  const key = windowLayoutMemberKey(layoutId, memberId);
  const cached = windowLayoutIconFromCache(currentMember, windowLayoutRuntime.icons.get(key));
  if (cached !== null) return cached;
  if (windowLayoutRuntime.icons.has(key)) windowLayoutRuntime.icons.delete(key);
  queueWindowLayoutIconRefresh(layoutId, memberId);
  return null;
}

function setWindowLayoutTransientStatus(layoutId, text, durationMs = 2400) {
  if (WIDGET_SURFACE) {
    setWindowLayoutStatus(layoutId, text);
    return;
  }
  const previous = windowLayoutTransientStatusTimers.get(layoutId);
  if (previous) clearTimeout(previous);
  setWindowLayoutStatus(layoutId, text);
  const timer = setTimeout(() => {
    windowLayoutTransientStatusTimers.delete(layoutId);
    setWindowLayoutStatus(layoutId, '');
  }, durationMs);
  windowLayoutTransientStatusTimers.set(layoutId, timer);
}

/** One capability warm-up at a time, in the background.
 *
 * The accepted right-click path needs a capability, and fetching a cold one goes
 * through the window helper - the step measured in seconds. Registration proves a
 * member is real, so its capability is fetched then, serialised so the helper's
 * single lane is never flooded, and the gesture later finds it cached. */
let capabilityWarmupChain = Promise.resolve();
const capabilityWarmupSeen = new Set();
function queueCapabilityWarmup(layoutId, memberId) {
  const key = windowLayoutMemberKey(layoutId, memberId);
  if (capabilityWarmupSeen.has(key)) return;
  if (windowLayoutRuntime.capabilities.get(key)) return;
  capabilityWarmupSeen.add(key);
  capabilityWarmupChain = capabilityWarmupChain
    .then(() => (typeof capabilityForMember === 'function' ? capabilityForMember(layoutId, memberId) : null))
    .catch(() => undefined);
}
async function capabilityForMember(layoutId, memberId) {
  // 018X5: reject immediately when read-only, BEFORE the cached-capability fast
  // path, so a later group member cannot issue observe/mutation calls without
  // awaiting a fresh resolve.
  if (windowLayoutDetachment.isReadOnly()) return null;
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return null;
  const key = windowLayoutMemberKey(layoutId, memberId);
  const cached = windowLayoutRuntime.capabilities.get(key);
  if (cached) return cached;
  const resolved = await resolveWindowLayoutMemberDescriptor(member.descriptor, layoutId);
  // 018X4: a handoff begun during the resolve must abort IMMEDIATELY after the
  // await, before either the failure status or the success cache side effect.
  if (windowLayoutDetachment.isReadOnly()) return null;
  if (resolved.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(resolved.outcome));
    return null;
  }
  windowLayoutRuntime.capabilities.set(key, resolved.capability);
  return resolved.capability;
}

/** Resolve a persisted member by its exact native identity first. A descriptor
 * that carries a stable windowInstanceId is exact for this caller too: the
 * helper returns its 'missing' (or any inconclusive outcome) as-is, so a live
 * sibling sharing the title and executable fingerprint can never be bound in
 * its place. The legacy title + fingerprint fallback therefore reaches only
 * pre-identity descriptors, which carry no id at all, and the host still
 * requires one unique match. Duplicate Chrome windows remain ambiguous and are
 * never guessed. */
async function resolveWindowLayoutMemberDescriptor(descriptor, layoutId = null, memberCollection = null) {
  const layout = layoutId === null ? null : windowLayoutFromState(layoutId);
  const members = Array.isArray(memberCollection)
    ? memberCollection
    : layout?.arrangement?.members;
  return resolveWindowLayoutDescriptorWithFallback({
    descriptor,
    members,
    exactIdentity: descriptor?.windowInstanceId,
    resolveExact: (instanceId) => typeof host.resolveWindowInstance === 'function'
      ? host.resolveWindowInstance(instanceId)
      : host.resolveWindowDescriptor(descriptor),
    resolveFallback: (value) => host.resolveWindowDescriptor(value),
  });
}

/** Quick Run's Layout Item activation. Resolution remains descriptor-based and
 * fail-closed: an ambiguous/missing member is reported, never guessed. The
 * Papers host performs the final token identity check and atomically restores
 * an iconic window before raising it. */
/** Records WHY bringing a window forward was refused. The status line is for the
 * creator; this is for whoever reads the document afterwards - an ignored promise
 * is exactly how this feature quietly did nothing. */
function recordActivationRefusal(layoutId, memberId, message) {
  try {
    void store.commit(noteWindowLayoutDiagnostic(state, {
      layoutId,
      memberId,
      reason: message,
      source: 'activate',
    }));
  } catch {
    /* diagnostics never fail the action they describe */
  }
}

async function activateWindowLayoutMember(layoutId, memberId) {
  // Whatever happens inside, the refusal is recorded and returned - never thrown
  // away. A right-click that quietly did nothing is what this whole path cost us.
  try {
    return await bringWindowLayoutMemberToFront(layoutId, memberId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordActivationRefusal(layoutId, memberId, 'threw: ' + message);
    return { outcome: 'failed', message };
  }
}

async function bringWindowLayoutMemberToFront(layoutId, memberId) {
  if (windowLayoutDetachment.isReadOnly()) {
    recordActivationRefusal(layoutId, memberId, 'read-only: another surface is writing');
    return { outcome: 'refused', message: 'Window layout is read-only while another surface is writing.' };
  }
  // RIGHT-CLICK IS BACK ON THE ACCEPTED PATH, and it is not the broker's job.
  //
  // The broker can only raise a window into the ordinary z-order, and the widget is
  // a TOPMOST window, so a raised target still sits beneath it - which reads as
  // "nothing happened". This path resolves the exact capability and hands the
  // activation to Papers, which is the behaviour the creator accepted at checkpoint
  // 4. It is a small native bridge launched per click: the same foreground primitive,
  // but from a process Windows treats far more favourably than a resident background
  // one, and it reports success only when the target really became the foreground.
  //
  // The broker keeps the CLICK (minimize, restore, toggle) - that is the one thing
  // this checkpoint is allowed to change.
  // The steps are spelled out here rather than hidden behind capabilityForMember:
  // "unavailable" named none of them, and a right-click that says nothing useful
  // is how this feature spent an evening doing nothing.
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) {
    recordActivationRefusal(layoutId, memberId, 'no such member: ' + layoutId + '/' + memberId);
    return { outcome: 'failed', message: 'That icon is not part of this layout any more.' };
  }
  const memberKey = windowLayoutMemberKey(layoutId, memberId);
  let capability = windowLayoutRuntime.capabilities.get(memberKey);
  if (!capability) {
    let resolved = null;
    try {
      resolved = await resolveWindowLayoutMemberDescriptor(member.descriptor, layoutId);
    } catch (error) {
      recordActivationRefusal(layoutId, memberId, 'resolve threw: ' + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
    if (windowLayoutDetachment.isReadOnly()) {
      return { outcome: 'refused', message: 'Window layout is read-only while another surface is writing.' };
    }
    if (resolved?.outcome !== 'success') {
      recordActivationRefusal(layoutId, memberId, 'resolve said ' + String(resolved?.outcome ?? 'nothing') + ' ' + String(resolved?.error ?? ''));
      return {
        outcome: resolved?.outcome ?? 'failed',
        message: windowLayoutStatusForOutcome(resolved?.outcome),
      };
    }
    capability = resolved.capability ?? null;
    if (capability) windowLayoutRuntime.capabilities.set(memberKey, capability);
  }
  if (!capability) {
    recordActivationRefusal(layoutId, memberId, 'resolved successfully but carried no capability');
    return { outcome: 'failed', message: 'Window activation is unavailable.' };
  }
  // Papers now owns a real activation: it makes the foreground call in its own
  // process, because Papers owns the click that asked for it, and it reports
  // success only when the foreground actually moved. Restore was the wrong
  // primitive - Windows refuses a foreground switch from a background worker,
  // and a refusal flashes the taskbar button instead of raising the window.
  const bring = typeof host.activateWindowCapability === 'function'
    ? host.activateWindowCapability
    : host.restoreWindowCapability;
  if (typeof bring !== 'function') {
    recordActivationRefusal(layoutId, memberId, 'Window activation is unavailable.');
    return { outcome: 'failed', message: 'Window activation is unavailable.' };
  }
  let result;
  try {
    result = await bring(capability);
  } catch (error) {
    recordActivationRefusal(layoutId, memberId, error instanceof Error ? error.message : String(error));
    return { outcome: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
  if (windowLayoutDetachment.isReadOnly()) {
    return { outcome: 'refused', message: 'Window layout is read-only while another surface is writing.' };
  }
  if (result?.outcome === 'success') return result;
  if (result?.outcome === 'missing') {
    // The cached handle is DEAD - Papers restarted, or the binding was dropped -
    // and it used to be thrown away only after failing, which is why the first
    // right-click on every member did nothing and the second one worked. Drop it,
    // resolve a fresh one, and act ONCE more so the first click is the click.
    windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
    windowLayoutRuntimeController.invalidateCapabilities(layoutId);
    const fresh = await capabilityForMember(layoutId, memberId);
    if (windowLayoutDetachment.isReadOnly()) {
      return { outcome: 'refused', message: 'Window layout is read-only while another surface is writing.' };
    }
    if (fresh) {
      try {
        result = await bring(fresh);
      } catch (error) {
        recordActivationRefusal(layoutId, memberId, error instanceof Error ? error.message : String(error));
        return { outcome: 'failed', message: error instanceof Error ? error.message : String(error) };
      }
      if (windowLayoutDetachment.isReadOnly()) {
        return { outcome: 'refused', message: 'Window layout is read-only while another surface is writing.' };
      }
      if (result?.outcome === 'success') return result;
    }
  }
  return {
    outcome: result?.outcome ?? 'failed',
    message: windowLayoutStatusForOutcome(result?.outcome),
  };
}

function windowLayoutStatusForOutcome(outcome) {
  // The one state with something true and calm to say, in the creator's words: this is also the visible half
  // of the member note, because the strip itself takes no text by the creator's own correction.
  if (outcome === 'unverified') return WINDOW_LAYOUT_MEMBER_NOTE_UNCONFIRMED;
  if (outcome === 'missing') return 'Window not visible';
  if (outcome === 'ambiguous') return 'Ambiguous match';
  if (outcome === 'helper-unavailable') return 'Helper unavailable';
  if (outcome === 'timeout') return 'Timed out';
  if (outcome === 'uncertain') return 'Could not confirm window action';
  return 'Failed';
}

/** Is the recording controller RIGHT NOW driving this layout?
 *
 * Two different questions were being answered by one field. "Which layout
 * should we resume on load?" is durable (state.activeWindowLayoutId, read by
 * bootstrapWindowLayoutRecording). "Which layout is the controller actually
 * observing?" is the controller's own live state, and asking the durable field
 * instead was the bug: activeWindowLayoutId is shared top-level document state,
 * so installPeerDocument() overwrites it from another surface's document -
 * including on the elected writer accepting a forwarded mutation - while the
 * runtime's activeLayoutId, a closure variable a document install cannot reach,
 * keeps its old value.
 *
 * Once they diverge the member click deadlocked: the durable gate said "not
 * current" so it called ensureRecording and returned, ensureRecording asked the
 * runtime which said "already current" so it only reconciled - and reconcile
 * deliberately never writes state. Nothing changed, so the next click did the
 * same thing, permanently and silently, never reaching a capability call. Group
 * actions never consult this at all, which is why they kept working while every
 * individual icon looked dead.
 */
function isActiveRecordingContext(layoutId) {
  return windowLayoutRuntimeController.getSnapshot().activeLayoutId === layoutId;
}

async function toggleWindowLayoutMember(layoutId, memberId, capability, member, { resolveCapability, isMemberCurrent } = {}) {
  const key = windowLayoutMemberKey(layoutId, memberId);
  const previous = windowLayoutMemberToggleTails.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(() =>
    toggleWindowLayoutMemberVisibility({
      host,
      capability,
      member,
      isReadOnly: () => windowLayoutDetachment.isReadOnly(),
      resolveCapability,
      isMemberCurrent,
    }));
  windowLayoutMemberToggleTails.set(key, operation);
  try {
    return await operation;
  } finally {
    if (windowLayoutMemberToggleTails.get(key) === operation) windowLayoutMemberToggleTails.delete(key);
  }
}

async function handleWindowLayoutMemberClick(layoutId, memberId, ctrlKey = false, shiftKey = false) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const member = windowLayoutMemberFromState(layoutId, memberId);
  if (!member) return;
  const isolationTargets = !ctrlKey && !shiftKey
    ? windowLayoutRuntime.isolateMode.click(layoutId, memberId, false)
    : null;
  if (isolationTargets !== null) {
    await windowLayoutGroupAction(layoutId, 'isolate', isolationTargets);
    return;
  }
  if (ctrlKey) {
    // 016 inner multiselection: separate from workspace selection.
    const selected = new Set(windowLayoutRuntime.selectedMembers.get(layoutId) ?? []);
    if (selected.has(memberId)) selected.delete(memberId);
    else selected.add(memberId);
    windowLayoutRuntime.selectedMembers.set(layoutId, selected);
    windowLayoutRuntime.selectionAnchor.set(layoutId, memberId);
    syncWindowLayoutMemberSelection(layoutId);
    return;
  }
  if (shiftKey) {
    // 019B: Shift+click selects the first-to-last range between the anchor and
    // the clicked member in persisted member order. With no anchor (or an
    // anchor that left the layout), the clicked member alone becomes the range
    // AND the new anchor.
    const ordered = (windowLayoutFromState(layoutId)?.arrangement?.members ?? [])
      .map((existing) => existing.id);
    const anchorId = windowLayoutRuntime.selectionAnchor.get(layoutId);
    const anchorIndex = ordered.indexOf(anchorId);
    const clickedIndex = ordered.indexOf(memberId);
    const selected = new Set();
    if (anchorIndex === -1 || clickedIndex === -1) {
      selected.add(memberId);
    } else {
      const [start, end] = anchorIndex <= clickedIndex
        ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
      for (let index = start; index <= end; index += 1) selected.add(ordered[index]);
    }
    windowLayoutRuntime.selectedMembers.set(layoutId, selected);
    windowLayoutRuntime.selectionAnchor.set(layoutId, memberId);
    syncWindowLayoutMemberSelection(layoutId);
    return;
  }
  windowLayoutRuntime.selectedMembers.delete(layoutId);
  windowLayoutRuntime.selectionAnchor.delete(layoutId);
  syncWindowLayoutMemberSelection(layoutId);
  // 016 contextual occurrences: an icon click from a DIFFERENT layout (or
  // with no active context) applies THIS layout's saved arrangement for every
  // member and selects this layout's recording context. A click in the
  // already-current context toggles minimize/restore.
  if (!isActiveRecordingContext(layoutId)) {
    await windowLayoutRecording.ensureRecording(layoutId);
    return;
  }
  const descriptorIdentity = member.descriptor?.windowInstanceId
    ?? JSON.stringify([member.descriptor?.title, member.descriptor?.executableFingerprint]);
  // THE BROKER IS THE CLICK PATH. One message to the already-running native
  // process: no observation, no PowerShell, no process creation, no decision made
  // in this page. A member the broker does not hold is said OUT LOUD and falls
  // back to the legacy path with that fact recorded - a silent fallback is what
  // made a broken broker look intermittently functional for a whole session.
  if (typeof host.windowControlGroup === 'function') {
    // NO LOCAL READINESS GATE, and the broker decides the direction. Readiness is
    // this renderer's view; Papers can find a slot the widget registered
    // cross-surface, and the resident process knows from LIVE state whether this
    // window is minimized - persisted state can lag reality. 'toggle' is that
    // decision, made where the truth is.
    const sent = await host.windowControlGroup(layoutId, [{ memberId, operation: 'toggle' }])
      .catch(() => ({ outcome: 'helper-unavailable' }));
    if (sent?.outcome === 'success') {
      // DELIVERED, not done: the window's real state is persisted from the broker's
      // own event, which reports the operation it actually performed.
      patchWindowLayoutMember(layoutId, memberId, 'unknown');
      setWindowLayoutStatus(layoutId, '');
      return;
    }
    setWindowLayoutStatus(layoutId, 'Window control did not accept that click; using the slower path.');
  } else {
    setWindowLayoutStatus(layoutId, 'Window control is not ready for this icon yet.');
  }
  const isMemberCurrent = () => {
    if (windowLayoutDetachment.isReadOnly() || !isActiveRecordingContext(layoutId)) return false;
    const current = windowLayoutMemberFromState(layoutId, memberId);
    const currentIdentity = current?.descriptor?.windowInstanceId
      ?? (current ? JSON.stringify([current.descriptor?.title, current.descriptor?.executableFingerprint]) : null);
    return currentIdentity === descriptorIdentity;
  };
  const capability = windowLayoutRuntime.capabilities.get(windowLayoutMemberKey(layoutId, memberId)) ?? null;
  const resolveCapability = async () => {
    if (!isMemberCurrent()) return { outcome: 'superseded' };
    const current = windowLayoutMemberFromState(layoutId, memberId);
    const key = windowLayoutMemberKey(layoutId, memberId);
    windowLayoutRuntime.capabilities.delete(key);
    const resolved = await resolveWindowLayoutMemberDescriptor(current.descriptor, layoutId);
    if (windowLayoutDetachment.isReadOnly() || !isMemberCurrent()) return { outcome: 'superseded' };
    if (resolved.outcome === 'success' && resolved.capability) {
      windowLayoutRuntime.capabilities.set(key, resolved.capability);
    }
    return resolved;
  };
  // Restore through the same bounds+restore path as Restore all, which brings
  // the exact minimized member back into view. Serialize rapid clicks per
  // member so two queued clicks cannot both act on the same observation.
  const result = await toggleWindowLayoutMember(layoutId, memberId, capability, member, {
    resolveCapability,
    isMemberCurrent,
  });
  if (result.outcome === 'superseded') return;
  // 018X4: abort immediately after the await, before success OR failure handling.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (result.outcome !== 'success' || !result.observation || !result.action) {
    if (result.outcome === 'missing') {
      // Stale binding after a helper restart: drop it and re-sync the
      // controller's capabilities so the observer re-resolves once.
      windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
      windowLayoutRuntimeController.invalidateCapabilities(layoutId);
      if (isActiveRecordingContext(layoutId)) {
        await windowLayoutRuntimeController.reconcileActive();
        // 018X5: abort immediately after the reconcile await before the status.
        if (windowLayoutDetachment.isReadOnly()) return;
      }
    }
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(result.outcome));
    return;
  }
  // 018X2: a handoff begun during the toggle must abort before any side effect.
  if (windowLayoutDetachment.isReadOnly()) return;
  const nextState = result.action === 'restore' ? 'normal' : 'minimized';
  // A MINIMIZED RECTANGLE IS NOT A RESTORE RECTANGLE.
  //
  // The observation returned here is the PRE-mutation one. That is exactly right
  // when the window was just minimized: its normal rectangle is the placement a
  // later restore should return to. It is exactly wrong when the window was
  // restored, because then the pre-mutation rectangle is Windows' minimized
  // sentinel (-32000,-32000 with a tiny size), and persisting it destroys the
  // layout's real remembered rectangle - the window later gets restored to that
  // sentinel and reads as maximally shrunk somewhere odd.
  //
  // The recording observer in window-layout-runtime.js already keeps this rule.
  // Restoring now preserves the existing bounds; only a minimize refreshes them.
  const observationBounds = result.observation?.bounds ?? null;
  const observationWasMinimized = result.observation?.state === 'minimized';
  const persistBounds = result.action === 'restore' || observationWasMinimized
    ? undefined
    : observationBounds;
  store.replace(updateWindowLayoutMember(state, layoutId, memberId, {
    state: nextState,
    ...(persistBounds === undefined ? {} : { bounds: persistBounds }),
  }));
  // The action's result says what was ASKED for; the observation that follows
  // says what is true. Paint unknown until it arrives.
  patchWindowLayoutMember(layoutId, memberId, 'unknown');
  noteWindowLayoutCommit(layoutId);
  queueWindowLayoutSave();
}

function patchWindowLayoutMember(layoutId, memberId, liveState) {
  // 040: scope the DOM selector by layout+member so a state patch for one
  // layout can never touch the same-window member of another layout. There
  // can be two legitimate matches while a compact widget is detached: update
  // both copies instead of leaving one surface with stale underlines.
  //
  // LIVE state, not persisted state. The underline is presentation truth, and
  // only a live observation is allowed to paint it. An action's own result says
  // what was ASKED for, and the atomic toggle's observation describes the window
  // BEFORE the mutation - neither proves what is on screen now, so both paint
  // `unknown` until an observation confirms.
  const state = liveState === 'minimized' ? 'minimized' : (liveState === 'normal' ? 'normal' : 'unknown');
  windowLayoutRuntime.liveMemberState.set(windowLayoutMemberKey(layoutId, memberId), state);
  const buttons = document.querySelectorAll(
    `[data-wl-layout="${CSS.escape(layoutId)}"] [data-wl-member="${CSS.escape(memberId)}"]`);
  for (const button of buttons) {
    button.classList.remove('normal', 'minimized', 'unknown');
    button.classList.add(state);
    button.setAttribute('aria-pressed', state === 'minimized' ? 'true' : 'false');
    button.removeAttribute('title');
    // ONE stable element, always present: its state is inspectable at any moment
    // and there is no create/remove churn. Removing it for minimized made sense
    // while the model had only two states; "unknown" is a real state now.
    let marker = button.querySelector('.window-layout-member-state');
    if (!marker) {
      marker = document.createElement('span');
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
    }
    marker.className = `window-layout-member-state ${state}`;
    marker.setAttribute('data-wl-live-state', state);
  }
}

async function openWindowLayoutPicker(layoutId) {
  if (windowLayoutRuntime.pickerOpenFor === layoutId) {
    // A native chooser can disappear independently (focus loss, renderer
    // restart, or a failed IPC response). Re-entering the list control is an
    // explicit recovery request; clear the stale session instead of leaving
    // this layout permanently unable to open its picker.
    closeWindowLayoutPicker();
  }
  // 019G: a picker covering the desktop must clear/discard the hover preview.
  windowLayoutMemberPreview.cancel();
  const generation = ++windowLayoutRuntime.pickerGeneration;
  windowLayoutRuntime.pickerOpenFor = layoutId;
  try {
    while (windowLayoutRuntime.pickerOpenFor === layoutId
      && windowLayoutRuntime.pickerGeneration === generation) {
      const pickerId = crypto.randomUUID();
      const isCurrent = () => !windowLayoutDetachment.isReadOnly()
        && windowLayoutRuntime.pickerOpenFor === layoutId
        && windowLayoutRuntime.pickerGeneration === generation;
      let session;
      if (typeof host.windowCandidatePickerUpdate === 'function') {
        session = await openWindowLayoutPickerSession({
          pickerId,
          openPicker: (id) => host.windowCandidatePicker([], id),
          loadCandidates: () => host.windowCandidates({ includeNativeIcons: false }),
          updatePicker: (candidates, id) => {
            const rows = toWindowLayoutPickerRows(
              candidates,
              windowLayoutFromState(layoutId)?.arrangement?.members ?? [],
              windowLayoutCandidateIsMember,
            );
            return host.windowCandidatePickerUpdate(rows, id);
          },
          isCurrent,
        });
      } else {
        const result = await host.windowCandidates({ includeNativeIcons: false });
        if (!isCurrent()) return;
        const members = windowLayoutFromState(layoutId)?.arrangement?.members ?? [];
        session = result.outcome === 'success'
          ? { outcome: 'success', candidates: result.candidates, actionPromise: host.windowCandidatePicker(
            toWindowLayoutPickerRows(result.candidates, members, windowLayoutCandidateIsMember),
          ) }
          : { outcome: 'list-error', error: result.error ?? result.outcome, candidates: [] };
      }
      if (!isCurrent() || session.outcome === 'stale') return;
      if (session.outcome === 'list-error' || session.outcome === 'picker-error' || session.outcome === 'update-error') {
        const error = session.error;
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message
          : (typeof error === 'string' ? error : windowLayoutStatusForOutcome(error?.outcome ?? 'helper-unavailable')));
        break;
      }
      windowLayoutRuntime.pickerCandidates = session.candidates;
      const picked = session.outcome === 'action' ? session.action : await session.actionPromise;
      if (!isCurrent()) return;
      if (picked?.action === 'close' && picked.candidateId) {
        await closeWindowLayoutCandidate(layoutId, picked.candidateId, session.candidates);
        continue;
      }
      if (picked?.action === 'direct-pick') {
        await beginWindowLayoutDirectPick(layoutId);
        break;
      }
      if (picked?.action !== 'select' || !picked.candidateId) break;
      await handleWindowLayoutPickCandidate(layoutId, picked.candidateId);
    }
  } catch (error) {
    // The list request may still be in flight when the creator clicks the
    // picker control again to enter live-pick mode.  Its eventual timeout is
    // stale at that point; never let it overwrite the live-pick status.
    if (windowLayoutRuntime.pickerOpenFor !== layoutId
      || windowLayoutRuntime.pickerGeneration !== generation) return;
    setWindowLayoutTransientStatus(
      layoutId,
      error instanceof Error ? error.message : 'List unavailable',
    );
  } finally {
    if (windowLayoutRuntime.pickerOpenFor === layoutId
      && windowLayoutRuntime.pickerGeneration === generation) closeWindowLayoutPicker();
  }
}

async function closeWindowLayoutCandidate(layoutId, candidateId, candidates) {
  const result = await endExactWindowCandidateProcess({
    candidateId,
    candidates,
    bindWindowCandidate: host.bindWindowCandidate,
    endProcessWindowCapability: host.endProcessWindowCapability,
  });
  if (result.outcome !== 'success') {
    setWindowLayoutTransientStatus(layoutId, result.error || 'Window is no longer available');
    return false;
  }
  await retireClosedWindowEverywhere(result.descriptor, { source: 'explicit-close', reason: 'the creator closed it' });
  setWindowLayoutTransientStatus(layoutId, 'Process ended', 1200);
  return true;
}

async function closeWindowLayoutMember(layoutId, memberId) {
  const widgetMember = WIDGET_SURFACE
    ? (windowLayoutWidgetPreviewSnapshot?.members ?? []).find((member) => member.id === memberId)
    : null;
  const stateMember = WIDGET_SURFACE ? null : windowLayoutMemberFromState(layoutId, memberId);
  const descriptor = widgetMember
    ? { ...widgetMember.descriptor, ...(widgetMember.windowInstanceId ? { windowInstanceId: widgetMember.windowInstanceId } : {}) }
    : stateMember?.descriptor;
  const capability = WIDGET_SURFACE
    ? await resolveWindowLayoutPreviewCapability(layoutId, memberId)
    : await capabilityForMember(layoutId, memberId);
  if (!capability) {
    setWindowLayoutTransientStatus(layoutId, 'Window is no longer available');
    return;
  }
  const result = await host.closeWindowCapability(capability);
  if (result.outcome !== 'success') {
    setWindowLayoutTransientStatus(layoutId, result.error || 'Window could not be closed');
    return;
  }
  windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  windowLayoutWidgetPreviewCapabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  if (descriptor) await retireClosedWindowEverywhere(descriptor, { source: 'explicit-close', reason: 'the creator closed it' });
  setWindowLayoutTransientStatus(layoutId, 'Window closed', 1200);
}

function closeWindowLayoutPicker({ requireClosed = false } = {}) {
  const layoutId = windowLayoutRuntime.pickerOpenFor;
  windowLayoutRuntime.pickerOpenFor = null;
  windowLayoutRuntime.pickerGeneration += 1;
  const closeRequest = layoutId
    ? (requireClosed
      ? host.windowCandidatePickerClose()
      : host.windowCandidatePickerClose().catch(() => undefined))
    : Promise.resolve();
  windowLayoutRuntime.pickerCandidates = null;
  const pickerHost = layoutId
    ? document.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`)
    : null;
  if (pickerHost) pickerHost.innerHTML = '';
  restoreHoveredWindowLayoutPreview(layoutId);
  return closeRequest;
}

function restoreHoveredWindowLayoutPreview(layoutId) {
  if (!layoutId) return;
  queueMicrotask(() => {
    const member = document.querySelector(`[data-wl-layout="${CSS.escape(layoutId)}"][data-wl-member]:hover`);
    if (!member) return;
    scheduleWindowLayoutPreviewDwell(member);
  });
}

async function handleWindowLayoutPickCandidate(layoutId, candidateId) {
  if (windowLayoutDetachment.isReadOnly()) return false;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return false;
  const row = (windowLayoutRuntime.pickerCandidates ?? [])
    .find((candidate) => candidate.id === candidateId);
  const picked = await bindWindowLayoutPickerCandidate(candidateId, row);
  const bound = picked.bound;
  // Candidate ids are ephemeral. Bind first, then decide add/remove from the
  // persisted descriptor pair returned by Papers. Title alone is not identity.
  if (windowLayoutDetachment.isReadOnly()) return false;
  if (bound.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(bound.outcome));
    return false;
  }
  const pick = windowLayoutPickForBoundCandidate(
    layout.arrangement?.members ?? [],
    bound,
    picked.row ?? bound.candidate ?? null,
    'toggle',
  );
  if (!pick) {
    setWindowLayoutStatus(layoutId, windowLayoutHasValidInstanceId(bound.descriptor)
      ? 'Window identity could not be confirmed; no layout change was made.'
      : 'Window identity is unavailable; no layout change was made.');
    return false;
  }
  const removing = pick.removes.length > 0;
  // Use the same one-commit writer as direct pick and the detached widget.
  // Adds keep selecting/recording this layout; an inactive-layout removal
  // remains data-only, matching the established attached-list behavior.
  const applied = await applyWindowLayoutPickSet(
    layoutId,
    pick,
    { activateOnMutation: !removing },
  );
  return applied.outcome === 'committed' && windowLayoutPickApplyOutcome(applied).mutated;
}

async function handleWindowLayoutRemoveCandidate(layoutId, candidateId) {
  if (windowLayoutDetachment.isReadOnly()) return false;
  const row = (windowLayoutRuntime.pickerCandidates ?? []).find((candidate) => candidate.id === candidateId);
  const picked = await bindWindowLayoutPickerCandidate(candidateId, row);
  if (windowLayoutDetachment.isReadOnly()) return false;
  const bound = picked.bound;
  if (bound?.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(bound?.outcome));
    return false;
  }
  // This explicit remove intent is not a toggle. Re-read after the host await;
  // if the exact W was removed on another surface, this becomes a no-op.
  const currentLayout = windowLayoutFromState(layoutId);
  const pick = windowLayoutPickForBoundCandidate(
    currentLayout?.arrangement?.members ?? [],
    bound,
    null,
    'remove',
  );
  if (!pick || pick.removes.length === 0) return false;
  const applied = await applyWindowLayoutPickSet(layoutId, pick, { activateOnMutation: false });
  return applied.outcome === 'committed' && windowLayoutPickApplyOutcome(applied).mutated;
}

/** 019B: bounded concurrent group scheduling. At most
 * WINDOW_LAYOUT_GROUP_CONCURRENCY members observe/mutate in flight, so a group
 * action's latency scales with the slowest helper call instead of a fully
 * serialized tail; results stay typed per member and a superseded result
 * (read-only handoff begun mid-batch) aborts the whole batch. */
const WINDOW_LAYOUT_GROUP_CONCURRENCY = 4;
const WINDOW_LAYOUT_GROUP_ABORT = (result) => result === 'superseded';

/** 016 group actions (selected members when any are selected, otherwise all):
 * minimize, restore/open (applies saved bounds), or isolate (restore the
 * targets, minimize only the unselected members OF THIS LAYOUT). One bounded
 * per-member loop with typed results; partial failures are visible. */
async function runGroupMemberAction(layoutId, member, action, results, patches) {
  const capability = await capabilityForMember(layoutId, member.id);
  // 018X7: capabilityForMember yields even on the cached fast path; a handoff
  // entered during that microtask must abort before any host call.
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  if (!capability) return 'missing';
  // 018X5: the runner owns the systematic barriers (observe/apply/restore/
  // minimize each abort on read-only at the next executable boundary).
  const outcome = await windowLayoutGroupActionRunner.runMember(capability, member, action);
  if (outcome === 'superseded') return outcome;
  if (outcome !== 'success') return outcome;
  const nextState = action === 'minimize' ? 'minimized' : 'normal';
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  results.push({ memberId: member.id, outcome });
  patches.push({ memberId: member.id, state: nextState });
  // Persisted intent, not presentation truth: the underline waits for the
  // observation that follows the mutation.
  patchWindowLayoutMember(layoutId, member.id, 'unknown');
  return outcome;
}

/** 019B: the stale-binding retry moves INSIDE the concurrent worker so a
 * helper restart fails one member's first observe with missing, drops and
 * re-resolves that member ONCE, and retries without deserializing the batch. */
async function runGroupMemberActionWithRetry(layoutId, member, action, results, patches) {
  let outcome = await runGroupMemberAction(layoutId, member, action, results, patches);
  if (outcome === 'missing') {
    windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, member.id));
    const freshCapability = await capabilityForMember(layoutId, member.id);
    // 018X5: abort immediately after the retry resolution await.
    if (windowLayoutDetachment.isReadOnly()) return 'superseded';
    if (freshCapability) {
      outcome = await runGroupMemberAction(layoutId, member, action, results, patches);
      if (outcome !== 'missing') return outcome;
    }
    results.push({ memberId: member.id, outcome: 'missing' });
  }
  return outcome;
}

/** 019B: isolate minimizes ONE unselected member (a bounded concurrent
 * worker); the handoff barriers are identical to the per-member runner. */
async function isolateMinimizeMember(layoutId, member, results, patches) {
  const capability = await capabilityForMember(layoutId, member.id);
  // 018X5: abort immediately after the isolate resolution await.
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  if (!capability) {
    results.push({ memberId: member.id, outcome: 'missing' });
    return 'missing';
  }
  const result = await host.minimizeWindowCapability(capability);
  // 018X5: abort immediately after the minimize await before the UI patch.
  if (windowLayoutDetachment.isReadOnly()) return 'superseded';
  results.push({ memberId: member.id, outcome: result.outcome });
  if (result.outcome === 'success') {
    patches.push({ memberId: member.id, state: 'minimized' });
    patchWindowLayoutMember(layoutId, member.id, 'unknown');
  }
  return result.outcome;
}

/** 019B: prewarms every target's capability concurrently (the host descriptor
 * resolves fan out in one round trip instead of a serialized tail), then runs
 * the per-member actions through a BOUNDED concurrent scheduler with typed
 * results, a superseded abort and a final abort barrier before the single
 * committed state. `explicitTargetIds` lets Shift+right-click toggle ONLY the
 * clicked member when no inner range is selected (019B) without disturbing the
 * selection UI. */
async function windowLayoutGroupAction(layoutId, action, explicitTargetIds = null) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  const members = layout.arrangement?.members ?? [];
  if (members.length === 0) return;
  const selected = explicitTargetIds
    ? new Set(explicitTargetIds)
    : windowLayoutRuntime.selectedMembers.get(layoutId);
  const targets = selected && selected.size > 0
    ? members.filter((member) => selected.has(member.id)) : members;
  const actions = targets.map((member) => ({
    memberId: member.id,
    operation: action === 'isolate' ? 'restore' : action,
  }));
  if (action === 'isolate') {
    for (const member of members) {
      if (!targets.some((target) => target.id === member.id)) {
        actions.push({ memberId: member.id, operation: 'minimize' });
      }
    }
  }
  if (typeof host.windowControlGroup !== 'function') {
    setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
    return;
  }
  const result = await host.windowControlGroup(layoutId, actions).catch(() => ({ outcome: 'helper-unavailable' }));
  if (windowLayoutDetachment.isReadOnly()) return;
  if (result?.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
    return;
  }
  let nextState = state;
  for (const entry of actions) {
    nextState = updateWindowLayoutMember(nextState, layoutId, entry.memberId,
      { state: entry.operation === 'minimize' ? 'minimized' : 'normal' });
  }
  store.replace(nextState);
  noteWindowLayoutCommit(layoutId);
  queueWindowLayoutSave();
  setWindowLayoutStatus(layoutId, '');
  await windowLayoutRecording.ensureRecording(layoutId);
}

/** 019B/019C Shift+right-click: minimizes/restores the SELECTED RANGE (or just
 * the clicked member when no inner range is selected) toward the OPPOSITE of
 * the clicked member's live state — clicking a minimized member restores the
 * range, otherwise it minimizes it. `explicitMemberIds` (the widget-sourced
 * range, 019C) overrides the workspace-local inner selection without touching
 * it. The direction is probed once (one observe) and the batch keeps per-member
 * typed results through the bounded scheduler. Plain right-click on a member
 * still falls through to the workspace menu. */
async function windowLayoutToggleRange(layoutId, clickedMemberId, explicitMemberIds = null) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const member = windowLayoutMemberFromState(layoutId, clickedMemberId);
  if (!member) return;
  const selected = explicitMemberIds !== null
    ? new Set(explicitMemberIds)
    : windowLayoutRuntime.selectedMembers.get(layoutId);
  const hasRange = Boolean(selected && selected.size > 0);
  const capability = await capabilityForMember(layoutId, clickedMemberId);
  // 018X5: abort immediately after the probe resolution await.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (!capability) {
    setWindowLayoutStatus(layoutId, 'Window not visible');
    return;
  }
  const observed = await host.observeWindowCapability(capability);
  // 018X4: abort immediately after the observe await, before success/failure.
  if (windowLayoutDetachment.isReadOnly()) return;
  if (observed.outcome !== 'success' || !observed.observation) {
    if (observed.outcome === 'missing') {
      windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, clickedMemberId));
      windowLayoutRuntimeController.invalidateCapabilities(layoutId);
    }
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(observed.outcome));
    return;
  }
  const liveState = observed.observation.state === 'minimized' ? 'minimized' : 'normal';
  const action = liveState === 'minimized' ? 'restore' : 'minimize';
  const range = explicitMemberIds !== null
    ? explicitMemberIds
    : (hasRange ? null : [clickedMemberId]);
  await windowLayoutGroupAction(layoutId, action, range);
}

/** 016 direct onscreen pick: begin the Papers-owned pick session for THIS
 * layout and wait for its single typed result (Escape/right-click cancels). */
async function beginWindowLayoutDirectPick(layoutId) {
  console.info('[045-direct-pick] begin-enter', layoutId);
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return;
  // 019G: the pick overlay covers the desktop; clear/discard the hover preview.
  windowLayoutMemberPreview.cancel();
  // The chooser is a native always-on-top window. Do not race its asynchronous
  // destruction against the Papers-owned direct picker: until it is gone it
  // can retain foreground/ownership and make the picker appear to do nothing.
  try {
    await closeWindowLayoutPicker({ requireClosed: true });
  } catch (error) {
    setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Window list could not close');
    return;
  }
  const members = windowLayoutPickMemberDescriptors(
    (layout.arrangement?.members ?? []).map((member) => member.descriptor),
  );
  if (!members) {
    setWindowLayoutStatus(layoutId, 'A saved window identity is invalid; Direct Pick could not start.');
    return;
  }
  windowLayoutRuntime.pickLayoutId = layoutId;
  const pickAttempt = Symbol('window-layout-direct-pick');
  windowLayoutRuntime.pickAttempt = pickAttempt;
  let result = null;
  let pickUnsubscribe = null;
  try {
    // A renderer reload or an abandoned picker can leave the Papers-owned
    // session alive after this page has lost its result listener. Always
    // cancel that one-shot session first so clicking Direct Pick is itself
    // the recovery action. Cancelling an idle session is intentionally a
    // no-op.
    await host.pickWindowCancel();
    // 016R: subscribe to the result push BEFORE awaiting begin, so a pick
    // that completes while begin() is still resolving (immediate click on an
    // eligible window) is never missed. A failed begin removes the listener
    // again; the main-side session clears onResult on failure, so nothing
    // can deliver afterwards.
    console.info('[045-direct-pick] begin-request', layoutId, members.length);
    const beginPromise = host.pickWindowBegin(members);
    const pickPromise = new Promise((resolve) => {
      pickUnsubscribe = host.onPickResult(resolve);
      windowLayoutRuntime.pickUnsubscribe = pickUnsubscribe;
    });
    const begin = await beginPromise;
    console.info('[045-direct-pick] begin-result', layoutId, begin?.outcome, begin?.error ?? '');
    // 018X4: abort immediately after the begin await, before the failure status.
    if (windowLayoutDetachment.isReadOnly()) {
      pickUnsubscribe?.();
      if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
        windowLayoutRuntime.pickUnsubscribe = null;
      }
      return;
    }
    if (begin.outcome !== 'started') {
      pickUnsubscribe?.();
      if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
        windowLayoutRuntime.pickUnsubscribe = null;
      }
      setWindowLayoutStatus(layoutId, begin.error || 'Direct pick is unavailable');
      return;
    }
    result = await pickPromise;
    // 018X4: abort immediately after the result, before success OR failure
    // handling (the non-picked status must never fire post-handoff).
    if (windowLayoutDetachment.isReadOnly()) return;
  } catch (error) {
    console.error('[045-direct-pick] begin-error', String(error));
    pickUnsubscribe?.();
    if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
      windowLayoutRuntime.pickUnsubscribe = null;
    }
    if (windowLayoutDetachment.isReadOnly()) return;
    setWindowLayoutStatus(
      layoutId,
      error instanceof Error ? error.message : String(error || 'Direct pick is unavailable'),
    );
    return;
  } finally {
    pickUnsubscribe?.();
    if (windowLayoutRuntime.pickUnsubscribe === pickUnsubscribe) {
      windowLayoutRuntime.pickUnsubscribe = null;
    }
    if (windowLayoutRuntime.pickAttempt === pickAttempt) {
      windowLayoutRuntime.pickAttempt = null;
      windowLayoutRuntime.pickLayoutId = null;
    }
  }
  // 019C: Winter's pick session returns ONE typed committed set (Enter) or a
  // zero-mutation cancel (Escape). Every remove is applied data-only and every
  // successful add is bound, all persisted ONCE by the pick applier; the active
  // layout identity is preserved and the one recording controller continues.
  if (result.outcome === 'cancelled') {
    setWindowLayoutStatus(layoutId, '');
    return;
  }
  if (result.outcome !== 'committed') {
    setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
    return;
  }
  // 018X1R: after awaited pick/host work, re-check the read-only handoff so an
  // in-flight pick result can never mutate post-handoff state.
  if (windowLayoutDetachment.isReadOnly()) return;
  await applyWindowLayoutPickSet(layoutId, result);
}

function syncWindowLayoutMemberSelection(layoutId) {
  const selected = windowLayoutRuntime.selectedMembers.get(layoutId);
  const container = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
  if (!container) return;
  for (const button of container.querySelectorAll('[data-wl-member]')) {
    const isSelected = Boolean(selected?.has(button.dataset.wlMember));
    button.classList.toggle('selected', isSelected);
    button.setAttribute('aria-selected', String(isSelected));
  }
}

function clearWindowLayoutMemberSelection(layoutId) {
  if (!layoutId || !(windowLayoutRuntime.selectedMembers.get(layoutId)?.size > 0)) return;
  windowLayoutRuntime.selectedMembers.delete(layoutId);
  windowLayoutRuntime.selectionAnchor.delete(layoutId);
  syncWindowLayoutMemberSelection(layoutId);
}

function toggleWindowLayoutIsolateMode(layoutId) {
  if (!layoutId || windowLayoutDetachment.isReadOnly()) return;
  const active = windowLayoutRuntime.isolateMode.toggle(layoutId);
  for (const button of document.querySelectorAll(`[data-wl-min-all="${CSS.escape(layoutId)}"]`)) {
    button.classList.toggle('isolate-mode-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/** 019B/019GR bounded tooltip/popover DOM seam for a member. ONE shared fixed
 * popover (per document) is reused across every layout and card: it shows the
 * member's NATIVE ICON (when available) + FULL name and carries the live
 * preview slot (`data-wl-popover-preview`) for the real thumbnail. The
 * icon/name fallback stays when no preview is supplied. Bounded: pointer-events
 * none, positioned on hover and RE-POSITIONED when the preview image changes
 * the popover size, hidden on leave/scroll/resize; it never makes a host call. */
function createWindowLayoutMemberPopover() {
  let element = null;
  let lastAnchor = null;
  let lastName = '';
  let animationFrame = null;
  function ensure() {
    if (element) return element;
    element = document.createElement('div');
    element.className = 'window-layout-member-popover';
    element.setAttribute('data-wl-popover', 'true');
    element.hidden = true;
    element.innerHTML =
      '<div class="window-layout-member-popover-title">'
      + '<img class="window-layout-member-popover-icon" data-wl-popover-icon alt="" hidden>'
      + '<div class="window-layout-member-popover-name" data-wl-popover-name></div>'
      + '</div>'
      + '<div class="window-layout-member-popover-preview" data-wl-popover-preview></div>';
    document.body.appendChild(element);
    return element;
  }
  function position() {
    const popover = element;
    if (!popover || !lastAnchor) return;
    const rect = popover.getBoundingClientRect();
    const margin = 6;
    const left = Math.max(margin, Math.min(
      window.innerWidth - rect.width - margin,
      lastAnchor.left + lastAnchor.width / 2 - rect.width / 2,
    ));
    let top = lastAnchor.top - rect.height - margin;
    if (top < margin) top = lastAnchor.bottom + margin;
    // 034: keep the WHOLE popover (including a real-window preview) inside the
    // viewport - in the content-fit detached widget the window is small, so a
    // top-placed preview must not overflow the bottom edge.
    if (top + rect.height > window.innerHeight - margin) top = window.innerHeight - rect.height - margin;
    if (top < margin) top = margin;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }
  return {
    show(name, anchorRect, iconSrc = null) {
      lastName = name;
      // Widget thumbnails live in their own naturally-sized native window.
      // Retain only the anchor here; a local name popover is cramped by the
      // compact widget viewport and duplicates the preview's title.
      if (WIDGET_SURFACE) {
        lastAnchor = anchorRect;
        if (element) {
          element.classList.remove('is-visible');
          element.hidden = true;
        }
        return;
      }
      const popover = ensure();
      const nameNode = popover.querySelector('[data-wl-popover-name]');
      if (nameNode) nameNode.textContent = name;
      const iconNode = popover.querySelector('[data-wl-popover-icon]');
      if (iconNode) {
        if (iconSrc) {
          iconNode.src = iconSrc;
          iconNode.hidden = false;
        } else {
          iconNode.removeAttribute('src');
          iconNode.hidden = true;
        }
      }
      const preview = popover.querySelector('[data-wl-popover-preview]');
      if (preview) preview.replaceChildren();
      popover.hidden = false;
      popover.classList.remove('is-visible');
      lastAnchor = anchorRect;
      position();
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        if (!popover.hidden) popover.classList.add('is-visible');
      });
    },
    hide() {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      if (element) {
        element.classList.remove('is-visible');
        element.hidden = true;
      }
      if (WIDGET_SURFACE) void host.widgetPreviewHide().catch(() => undefined);
      else void host.windowPreviewHide().catch(() => undefined);
    },
    /** 019GR: the preview image changed the popover size - re-clamp placement
     * against the SAME member anchor so it never jumps off-screen. */
    reposition() {
      if (!element || element.hidden || !lastAnchor) return;
      position();
    },
    /** 019C seam: fill the live-preview slot (thumbnail markup). Passing null
     * clears it back to the icon/name-only fallback. 034: once the preview
     * image finishes decoding it changes the popover size, so placement is
     * re-clamped then (and when already complete) to keep the WHOLE popover
     * inside the host viewport - never clipped by host/card bounds. */
    updatePreview(memberId, previewMarkup) {
      const preview = ensure().querySelector('[data-wl-popover-preview]');
      if (!preview) return;
      // BOTH surfaces now use Papers' own always-on-top preview window. The
      // in-page popover could only ever be as visible as this project window, so
      // any other application's window could hide the preview - the creator saw
      // exactly that. The widget keeps its own authorized message; the workspace
      // uses the project-authorized one; the anchor is the same screen rectangle.
      {
        preview.replaceChildren();
        if (previewMarkup == null) {
          void (WIDGET_SURFACE ? host.widgetPreviewHide() : host.windowPreviewHide()).catch(() => undefined);
          return;
        }
        const holder = document.createElement('div');
        holder.innerHTML = previewMarkup;
        const img = holder.querySelector('.window-layout-member-preview-image');
        if (!img || !lastAnchor) return;
        const width = Number(img.getAttribute('width'));
        const height = Number(img.getAttribute('height'));
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        const anchor = {
          x: Math.round(window.screenX + lastAnchor.left),
          y: Math.round(window.screenY + lastAnchor.top),
          width: Math.round(lastAnchor.width),
          height: Math.round(lastAnchor.height),
        };
        void (WIDGET_SURFACE
          ? host.widgetPreviewShow(img.src, lastName, width, height, anchor)
          : host.windowPreviewShow(img.src, lastName, width, height, anchor)).catch(() => undefined);
        return;
      }
      const popover = ensure();
      if (previewMarkup == null) {
        preview.replaceChildren();
        popover.classList.remove('has-preview');
        popover.style.removeProperty('width');
      } else {
        preview.innerHTML = previewMarkup;
        const declaredWidth = Number(preview.querySelector('.window-layout-member-preview-image')?.getAttribute('width'));
        if (Number.isFinite(declaredWidth) && declaredWidth > 0) {
          popover.classList.add('has-preview');
          popover.style.width = `${declaredWidth}px`;
        }
      }
      const img = preview.querySelector('.window-layout-member-preview-image');
      if (img) {
        img.addEventListener('load', () => windowLayoutMemberPopover.reposition(), { once: true });
        if (img.complete) windowLayoutMemberPopover.reposition();
      }
    },
  };
}
const windowLayoutMemberPopover = createWindowLayoutMemberPopover();
const WINDOW_LAYOUT_PREVIEW_DWELL_MS = 100;
let windowLayoutPreviewDwellTimer = null;

function cancelWindowLayoutPreviewDwell() {
  if (windowLayoutPreviewDwellTimer !== null) {
    clearTimeout(windowLayoutPreviewDwellTimer);
    windowLayoutPreviewDwellTimer = null;
  }
}

function scheduleWindowLayoutPreviewDwell(member) {
  cancelWindowLayoutPreviewDwell();
  const layoutId = member.dataset.wlLayout;
  const memberId = member.dataset.wlMember;
  const name = member.getAttribute('aria-label') ?? member.title ?? '';
  const iconSrc = member.querySelector('.window-layout-member-icon')?.getAttribute('src') ?? null;
  const anchor = member.getBoundingClientRect();
  windowLayoutPreviewDwellTimer = setTimeout(() => {
    windowLayoutPreviewDwellTimer = null;
    if (!member.isConnected || !member.matches(':hover')) return;
    if (name) windowLayoutMemberPopover.show(name, anchor, iconSrc);
    windowLayoutMemberPreview.schedule(layoutId, memberId);
  }, WINDOW_LAYOUT_PREVIEW_DWELL_MS);
}

// 019GR surface-aware preview capability resolution. The WORKSPACE resolves the
// member's capability from durable state via the existing runtime logic. The
// COMPACT-WIDGET surface owns only widgetState.snapshot (durable state lives in
// the workspace window), so it turns the snapshot member descriptor into a
// capability through the host and caches it in a MEMORY-ONLY map — a capability
// is never placed in snapshot/channel/durable state. The cache is cleared on
// missing/removal, snapshot replacement (renderWidgetCard) and pagehide.
const windowLayoutWidgetPreviewCapabilities = new Map();

/** The window a cached preview capability belongs to. State is deliberately
 * absent: minimizing a window does not make it a different window. */
function widgetPreviewIdentity(member) {
  return JSON.stringify([
    member?.descriptor?.version ?? '',
    member?.descriptor?.title ?? '',
    member?.descriptor?.executableFingerprint ?? '',
    member?.windowInstanceId ?? '',
  ]);
}

/** Drop only the cached preview capabilities whose WINDOW IDENTITY changed, so a
 * state-only re-render keeps its warm capabilities. A capability names a window;
 * a member's minimize/restore does not rename it.
 *
 * The blanket clear this replaces had one accidental virtue: it guaranteed
 * eventual recovery after a helper restart replaced the underlying tokens.
 * Retaining capabilities longer means a stale one must be evicted explicitly,
 * which `forgetWidgetPreviewCapability` does when Papers reports it missing. */
function evictStaleWidgetPreviewCapabilities(snapshot) {
  const identities = new Map();
  for (const member of snapshot?.members ?? []) {
    identities.set(
      windowLayoutMemberKey(snapshot?.id ?? '', member.id),
      widgetPreviewIdentity(member),
    );
  }
  for (const key of [...windowLayoutWidgetPreviewCapabilities.keys()]) {
    const identity = identities.get(key);
    if (identity === undefined || identity !== windowLayoutWidgetPreviewIdentities.get(key)) {
      windowLayoutWidgetPreviewCapabilities.delete(key);
      windowLayoutWidgetPreviewIdentities.delete(key);
    }
  }
}

/** Window identity each cached preview capability was resolved for. */
const windowLayoutWidgetPreviewIdentities = new Map();

/** A capability Papers no longer recognises (helper restart, window gone) must
 * not be retried forever now that the card no longer clears the cache. */
function forgetWidgetPreviewCapability(layoutId, memberId) {
  const key = windowLayoutMemberKey(layoutId, memberId);
  windowLayoutWidgetPreviewCapabilities.delete(key);
  windowLayoutWidgetPreviewIdentities.delete(key);
}
let windowLayoutWidgetPreviewSnapshot = null;

function resolveWindowLayoutPreviewCapability(layoutId, memberId) {
  if (!WIDGET_SURFACE) return capabilityForMember(layoutId, memberId);
  // 040: composite layout\u0000member cache identity so the widget preview for
  // one layout never reuses a capability cached under another layout's member.
  const key = windowLayoutMemberKey(layoutId, memberId);
  const member = (windowLayoutWidgetPreviewSnapshot?.members ?? [])
    .find((candidate) => candidate.id === memberId);
  if (!member || !member.descriptor || typeof member.descriptor !== 'object' || Array.isArray(member.descriptor)) {
    if (WIDGET_SURFACE) document.title = 'preview: no member descriptor';
    windowLayoutWidgetPreviewCapabilities.delete(key);
    return Promise.resolve(null);
  }
  const cached = windowLayoutWidgetPreviewCapabilities.get(key);
  if (cached) return Promise.resolve(cached);
  // THE EXACT-IDENTITY PATH MUST RETURN A CAPABILITY.
  //
  // resolveWindowInstance is an EXISTENCE probe: it answers success with a
  // descriptor and NO capability, deliberately, so a two-second sweep cannot mint a
  // binding per member. This resolver requires a capability, and the fallback only
  // fires on a missing outcome - so success-without-capability fell straight
  // through and the preview returned null. Hover and Shift-peek both died there,
  // before any capture was ever requested, which is why neither ever appeared.
  //
  // The descriptor can carry its own windowInstanceId, and THAT path returns a
  // capability: Papers matches the exact instance and issues one binding.
  const exactDescriptor = typeof member.windowInstanceId === 'string'
    ? { ...member.descriptor, windowInstanceId: member.windowInstanceId }
    : member.descriptor;
  const resolve = typeof member.windowInstanceId === 'string' && typeof host.resolveWindowDescriptor === 'function'
    ? resolveWindowLayoutDescriptorWithFallback({
      descriptor: exactDescriptor,
      exactIdentity: member.windowInstanceId,
      members: windowLayoutWidgetPreviewSnapshot?.members,
      resolveExact: () => host.resolveWindowDescriptor(exactDescriptor),
      resolveFallback: (value) => host.resolveWindowDescriptor(value),
    })
    : resolveWindowLayoutMemberDescriptor(member.descriptor, layoutId, windowLayoutWidgetPreviewSnapshot?.members);
  return Promise.resolve(resolve).then((resolved) => {
    if (WIDGET_SURFACE) document.title = 'preview resolve: ' + String(resolved?.outcome ?? 'empty')
      + ' cap=' + (resolved?.capability ? 'yes' : 'no');
    if (!resolved || resolved.outcome !== 'success' || !resolved.capability) {
      windowLayoutWidgetPreviewCapabilities.delete(key);
      return null;
    }
    windowLayoutWidgetPreviewCapabilities.set(key, resolved.capability);
    windowLayoutWidgetPreviewIdentities.set(key, widgetPreviewIdentity(member));
    return resolved.capability;
  }).catch((error) => {
    if (WIDGET_SURFACE) document.title = 'preview resolve error: ' + String(error).slice(0, 90);
    return null;
  });
}

// 019G real window thumbnail preview (Windows-taskbar-like hover card). The
// shared popover shows the member ICON + FULL title immediately; the thumbnail
// capture is debounced 120 ms and requests the member's CURRENT capability at
// 240x135. A strictly valid data-PNG success renders a bounded static <img> and
// re-clamps popover placement; everything else stays an honest icon/name-only
// fallback. The generation/latest-only guard drops stale replies, and cancel()
// (pointer leave, scroll, resize, picker start, card removal, pagehide)
// discards pending work + clears the preview. No state/store writes, no
// animation/flashing.
const windowLayoutMemberPreview = createWindowLayoutMemberPreview({
  resolveCapability: resolveWindowLayoutPreviewCapability,
  requestCachedThumbnail: (capability) => host.windowThumbnailCacheCapability(capability),
  requestThumbnail: async (capability, options) => {
    const result = await host.windowThumbnailCapability(capability, options);
    if (WIDGET_SURFACE) document.title = 'thumbnail: ' + String(result?.outcome ?? 'empty');
    return result;
  },
  // Hold the periodic desktop scan off for the whole hover intent, dwell
  // included: otherwise a scan that starts during the dwell lands in front of
  // the capture and the preview arrives late or not at all.
  holdPreview: () => { void host.windowPreviewHold().catch(() => undefined); },
  releasePreview: () => { void host.windowPreviewRelease().catch(() => undefined); },
  // Capabilities now survive a state-only re-render, so a token Papers has
  // stopped recognising (helper restart, window gone) has to be dropped here
  // instead of relying on the card's old blanket clear to eventually do it.
  onCapabilityMissing: (layoutId, memberId) => {
    forgetWidgetPreviewCapability(layoutId, memberId);
    windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  },
  setPreviewImage: (imageUrl, width, height) => {
    windowLayoutMemberPopover.updatePreview(null,
      `<img class="window-layout-member-preview-image" src="${escapeHtml(imageUrl)}" alt="" width="${width}" height="${height}">`);
    // 019GR: the image changed the popover size - re-clamp placement.
    windowLayoutMemberPopover.reposition();
    // THE IMAGE IS INSTALLED - this is the only point that proves a preview was
    // SHOWN rather than merely resolved. A successful resolve and a successful
    // thumbnail can both happen while nothing is ever painted, which is exactly how
    // hover looked dead while its diagnostics read "success".
    try {
      document.title = 'preview-applied | thumbnail=success | ' + width + 'x' + height;
    } catch { /* diagnostic */ }
  },
  clearPreview: () => windowLayoutMemberPopover.updatePreview(null, null),
});

// Shift-hover mirrors taskbar Peek semantics using a reversible host session:
// every other currently visible eligible window is temporarily minimized, and
// only windows changed by this session are restored on release/leave.
let windowLayoutShiftPeekHeld = false;
let windowLayoutShiftPeekGeneration = 0;
let windowLayoutShiftPeekKey = null;
let windowLayoutShiftPeekEndTimer = null;
let windowLayoutShiftPeekStartTimer = null;
let windowLayoutShiftPeekRetryTimer = null;
let windowLayoutLastHoveredMember = null;
let windowLayoutShiftPeekHostQueue = Promise.resolve();

function enqueueWindowLayoutShiftPeekHostOperation(operation) {
  const pending = windowLayoutShiftPeekHostQueue.then(operation, operation);
  windowLayoutShiftPeekHostQueue = pending.catch(() => undefined);
  return pending;
}

function endWindowLayoutShiftPeek() {
  // Planner keyup/blur and pointer-leave can converge on this function. Once
  // this target's lifecycle has been cleared, later notifications must not
  // issue another host end (or let an old completion end a newer target).
  if (windowLayoutShiftPeekKey === null
    && windowLayoutShiftPeekStartTimer === null
    && windowLayoutShiftPeekEndTimer === null
    && windowLayoutShiftPeekRetryTimer === null) return;
  if (windowLayoutShiftPeekStartTimer !== null) {
    clearTimeout(windowLayoutShiftPeekStartTimer);
    windowLayoutShiftPeekStartTimer = null;
  }
  if (windowLayoutShiftPeekEndTimer !== null) {
    clearTimeout(windowLayoutShiftPeekEndTimer);
    windowLayoutShiftPeekEndTimer = null;
  }
  if (windowLayoutShiftPeekRetryTimer !== null) {
    clearTimeout(windowLayoutShiftPeekRetryTimer);
    windowLayoutShiftPeekRetryTimer = null;
  }
  windowLayoutShiftPeekGeneration += 1;
  windowLayoutShiftPeekKey = null;
  void enqueueWindowLayoutShiftPeekHostOperation(() => host.windowPeekEnd()).catch(() => undefined);
}

function deferWindowLayoutShiftPeekEnd() {
  if (windowLayoutShiftPeekEndTimer !== null) clearTimeout(windowLayoutShiftPeekEndTimer);
  windowLayoutShiftPeekEndTimer = setTimeout(() => {
    windowLayoutShiftPeekEndTimer = null;
    windowLayoutShiftPeekHeld = false;
    endWindowLayoutShiftPeek();
  }, 120);
}

function keepWindowLayoutShiftPeekAlive() {
  if (windowLayoutShiftPeekEndTimer === null) return;
  clearTimeout(windowLayoutShiftPeekEndTimer);
  windowLayoutShiftPeekEndTimer = null;
}

function beginWindowLayoutShiftPeek(member) {
  const layoutId = member?.dataset?.wlLayout;
  const memberId = member?.dataset?.wlMember;
  if (!layoutId || !memberId) return;
  const key = `${layoutId}\u0000${memberId}`;
  if (windowLayoutShiftPeekKey === key) return;
  const generation = ++windowLayoutShiftPeekGeneration;
  windowLayoutShiftPeekKey = key;
  if (windowLayoutShiftPeekStartTimer !== null) clearTimeout(windowLayoutShiftPeekStartTimer);
  if (windowLayoutShiftPeekRetryTimer !== null) clearTimeout(windowLayoutShiftPeekRetryTimer);
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  // Explorer's compositor path is private; our bounded foreign-window
  // fallback must never queue one native transition for every icon crossed.
  // Coalesce traversal within two display frames: an A->B->C sweep performs C
  // only, while an intentional hover remains effectively immediate.
  windowLayoutShiftPeekStartTimer = setTimeout(() => {
    windowLayoutShiftPeekStartTimer = null;
    void performWindowLayoutShiftPeek(layoutId, memberId, generation);
  }, 32);
}

async function performWindowLayoutShiftPeek(layoutId, memberId, generation, attempt = 0) {
  let capability = null;
  try {
    capability = await resolveWindowLayoutPreviewCapability(layoutId, memberId);
  } catch {
    // Capability lookup may briefly fail while the host is catching up. Keep
    // retrying this same hovered target while Shift remains held.
  }
  if (!capability && WIDGET_SURFACE) document.title = 'peek: no capability';
  if (generation !== windowLayoutShiftPeekGeneration || !windowLayoutShiftPeekHeld
    || windowLayoutShiftPeekKey !== `${layoutId}\u0000${memberId}`) return;
  if (!capability) {
    windowLayoutShiftPeekRetryTimer = setTimeout(() => {
      windowLayoutShiftPeekRetryTimer = null;
      void performWindowLayoutShiftPeek(layoutId, memberId, generation, attempt + 1);
    }, Math.min(1000, 180 + attempt * 120));
    return;
  }
  const result = await enqueueWindowLayoutShiftPeekHostOperation(() => {
    // A newer target or release may have arrived while this operation waited
    // behind an in-flight host call. Never let the stale target start late.
    if (generation !== windowLayoutShiftPeekGeneration || !windowLayoutShiftPeekHeld
      || windowLayoutShiftPeekKey !== `${layoutId}\u0000${memberId}`) return { outcome: 'cancelled' };
    return host.windowPeekBeginCapability(capability);
  }).catch((error) => ({ outcome: 'error', error: String(error) }));
  // ONE LINE THAT PROVES THE WHOLE REMAINING CHAIN: the broker noticed physical
  // Shift, Node parsed it, IPC forwarded it, the preload posted it, the host bridge
  // relayed it, the widget received it, resolved a capability and Peek began. The
  // native watcher is already proven separately, so nothing else needs proving.
  if (WIDGET_SURFACE) document.title = 'shift-peek | held=1 | begin=' + String(result?.outcome ?? 'empty')
    + ' ' + String(result?.error ?? '').slice(0, 60);
  if (generation !== windowLayoutShiftPeekGeneration) {
    // The lifecycle owner already ended or superseded this attempt. An extra
    // global end here could cancel a newer member's Peek.
    return;
  }
  if (result?.outcome !== 'success' && windowLayoutShiftPeekHeld) {
    windowLayoutShiftPeekRetryTimer = setTimeout(() => {
      windowLayoutShiftPeekRetryTimer = null;
      void performWindowLayoutShiftPeek(layoutId, memberId, generation, attempt + 1);
    }, Math.min(1000, 180 + attempt * 120));
  }
}

function applyWindowLayoutShiftPeekTransition(transition) {
  if (!transition.handled) return false;
  windowLayoutShiftPeekHeld = transition.held;
  if (transition.begin) void beginWindowLayoutShiftPeek(transition.begin);
  if (transition.end) endWindowLayoutShiftPeek();
  return true;
}

window.addEventListener('keydown', (event) => {
  const transition = planWindowLayoutShiftPeekTransition('keydown', event, {
    held: windowLayoutShiftPeekHeld,
    member: document.querySelector('[data-wl-member]:hover'),
  });
  applyWindowLayoutShiftPeekTransition(transition);
});
window.addEventListener('keyup', (event) => {
  const transition = planWindowLayoutShiftPeekTransition('keyup', event, { held: windowLayoutShiftPeekHeld });
  applyWindowLayoutShiftPeekTransition(transition);
});
window.addEventListener('blur', () => {
  if (WIDGET_SURFACE) return; // Physical Shift release comes from the native broker.
  const transition = planWindowLayoutShiftPeekTransition('blur', {}, { held: windowLayoutShiftPeekHeld });
  applyWindowLayoutShiftPeekTransition(transition);
});
// A detached widget is non-focusable. The resident native broker reports the
// physical Shift key, including when the pointer stays still over an icon.
if (typeof host.onWindowControlShift === 'function') host.onWindowControlShift((held) => {
  const transition = planWindowLayoutShiftPeekTransition(held ? 'keydown' : 'keyup', { key: 'Shift' }, {
    held: windowLayoutShiftPeekHeld,
    member: document.querySelector('[data-wl-member]:hover')
      ?? (elements.grid.matches(':hover') && windowLayoutLastHoveredMember?.isConnected
        ? windowLayoutLastHoveredMember : null),
  });
  applyWindowLayoutShiftPeekTransition(transition);
});

// 019B/019GR hover wiring via the pure exact-member transition predicate: a move
// between descendants of the SAME member (icon/indicator) is ignored (no
// reschedule/clear); entering a member shows icon+title and schedules; leaving
// this EXACT member (to another member or the outside) hides + cancels before
// the next member schedules. Scrolling (a card may have scrolled the strip) or
// resizing hides the popover and cancels the pending preview. Read-only safe.
elements.grid.addEventListener('mouseover', (event) => {
  const listButton = event.target.closest('[data-wl-list]');
  const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
  // The compact widget installs its own membership-aware opener on the card.
  // Do not let this workspace delegate replace that dwell after the event
  // bubbles to the grid; widget-local state is authoritative there.
  if (!WIDGET_SURFACE && listButton && listButton !== relatedListButton) {
    scheduleWindowLayoutListDwell(
      listButton,
      () => openWindowLayoutPicker(listButton.dataset.wlList),
    );
    return;
  }
  const member = event.target.closest('[data-wl-member]');
  const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
  if (member) windowLayoutLastHoveredMember = member;
  const peekTransition = planWindowLayoutShiftPeekTransition('hover', event, {
    held: windowLayoutShiftPeekHeld,
    member,
    relatedMember,
  });
  if (peekTransition.handled) {
    keepWindowLayoutShiftPeekAlive();
    applyWindowLayoutShiftPeekTransition(peekTransition);
    return;
  }
  const state = windowLayoutPreviewHoverState(member, relatedMember);
  if (state === 'outside') {
    if (!event.target.closest('[data-wl-popover]')) {
      cancelWindowLayoutPreviewDwell();
      windowLayoutMemberPopover.hide();
      windowLayoutMemberPreview.cancel();
    }
    return;
  }
  if (state === 'inside') return;
  scheduleWindowLayoutPreviewDwell(member);
});
// The detached widget is deliberately non-focusable, so it cannot reliably
// receive Shift keydown/keyup. Mouse/pointer events still carry the physical
// modifier state. Track that state while the pointer moves so Shift Peek works
// even when Shift was pressed before entering the widget.
elements.grid.addEventListener('pointermove', (event) => {
  // Small pointer drift over gaps/descendants is still inside the compact
  // widget. Cancel the delayed leave end even when the move is not over a
  // member and therefore produces no planner transition.
  if (windowLayoutShiftPeekHeld && elements.grid.matches(':hover')) keepWindowLayoutShiftPeekAlive();
  const member = event.target.closest('[data-wl-member]');
  if (member) windowLayoutLastHoveredMember = member;
  const transition = planWindowLayoutShiftPeekTransition('pointermove', event, {
    held: windowLayoutShiftPeekHeld,
    member,
  });
  if (transition.handled && transition.begin) {
    keepWindowLayoutShiftPeekAlive();
    applyWindowLayoutShiftPeekTransition(transition);
    return;
  }
  if (transition.handled && transition.end) {
    applyWindowLayoutShiftPeekTransition(transition);
  }
});
elements.grid.addEventListener('mouseout', (event) => {
  const listButton = event.target.closest('[data-wl-list]');
  const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
  if (listButton && listButton !== relatedListButton) cancelWindowLayoutListDwell();
  const member = event.target.closest('[data-wl-member]');
  const relatedMember = event.relatedTarget?.closest?.('[data-wl-member]') ?? null;
  if (relatedMember) windowLayoutLastHoveredMember = relatedMember;
  else if (!event.relatedTarget || !elements.grid.contains(event.relatedTarget)) windowLayoutLastHoveredMember = null;
  // Crossing directly from one member to another is a Peek transition, not a
  // release. Keep the session alive so the host can reveal only the new target
  // and hide only the old one. Blank space between icons keeps the last Peek
  // while Shift is held; leaving the widget or releasing Shift ends it.
  if (member && !relatedMember && windowLayoutShiftPeekKey) {
    const leftWidget = !event.relatedTarget || !elements.grid.contains(event.relatedTarget);
    const leave = planWindowLayoutShiftPeekTransition('memberleave', { leftWidget }, { held: windowLayoutShiftPeekHeld });
    if (leave.end) deferWindowLayoutShiftPeekEnd();
  }
  const state = windowLayoutPreviewHoverState(member, relatedMember);
  if (state === 'enter') {
    cancelWindowLayoutPreviewDwell();
    windowLayoutMemberPopover.hide();
    windowLayoutMemberPreview.cancel();
  }
});
elements.grid.addEventListener('auxclick', (event) => {
  if (event.button !== 1) return;
  const folderTile = event.target.closest('.icon-item[data-kind="group"]');
  if (folderTile && !folderTile.classList.contains('ancestor-item')) {
    event.preventDefault();
    event.stopPropagation();
    const folderId = folderTile.dataset.id;
    if (folderId) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('as-you-go-folder', folderId);
      void host.openNewSurface(nextUrl.toString()).catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
    }
    return;
  }
  const restoreAll = event.target.closest('[data-wl-restore-all]');
  if (restoreAll && !detachedWidgets.has(restoreAll.dataset.wlRestoreAll)) {
    event.preventDefault();
    event.stopPropagation();
    void windowLayoutWidgetLifecycle.open(restoreAll.dataset.wlRestoreAll);
    return;
  }
  const minimizeAll = event.target.closest('[data-wl-min-all]');
  if (minimizeAll && detachedWidgets.has(minimizeAll.dataset.wlMinAll)) {
    event.preventDefault();
    event.stopPropagation();
    const layoutId = minimizeAll.dataset.wlMinAll;
    if (detachedWidgets.delete(layoutId)) render();
    void host.widgetClose(layoutId).catch(() => undefined);
    return;
  }
  const member = event.target.closest('[data-wl-member]');
  if (!member || member.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  if (event.ctrlKey) {
    // Ctrl+MMB is the explicit close-process gesture. The close path retires
    // the member only after Papers confirms that the native window closed.
    void closeWindowLayoutMember(member.dataset.wlLayout, member.dataset.wlMember);
  } else {
    // Plain MMB is data-only: remove this icon from this layout, leaving the
    // external application running and available to pick again.
    handleWindowLayoutUnlink(member.dataset.wlLayout, member.dataset.wlMember);
  }
});
// A press on a member is a CONTROL intent, and control must not queue behind
// cosmetic work. The Papers window helper executes exactly one request at a
// time - read a line, run it to completion, write the reply - so a hover that
// is still cold (desktop list, then bind/observe, then a full PrintWindow
// capture) occupies it, and this click's own observe and minimize/restore wait
// behind all of that. The creator sees the real application window react late,
// and only on the first click after moving to another icon: staying on one icon
// starts no new hover pipeline.
//
// Every other member interaction already cancels the preview - Ctrl-drag,
// context menu, picker start, scroll, resize. The ordinary click was the single
// path that did not, so pressing an icon let a capture launch AFTER the creator
// had already asked for the window to move. Capture phase, so it runs ahead of
// any handler that stops propagation, and covers the attached card and the
// detached widget through one seam.
//
// This cannot cancel a capture already executing inside the helper - nothing
// can, PowerShell is synchronous inside PrintWindow - but it stops one being
// started or queued once the creator has committed to a click.
document.addEventListener('pointerdown', (event) => {
  if (!event.target?.closest?.('[data-wl-member]')) return;
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
}, true);
document.addEventListener('scroll', () => {
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
}, true);
window.addEventListener('resize', () => {
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
});
window.addEventListener('pagehide', () => {
  endWindowLayoutShiftPeek();
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPreview.cancel();
});

/** 017I2: exactly ONE controller owns recording (switch, timer, observation,
 * echo suppression). This wiring glues the pure controller to the real model
 * and store: persisted active id, byte-stable inactive arrangements,
 * minimized restore bounds preserved, debounced prompt saves and typed
 * status. The old per-entry recording timer / global observationPending /
 * single suppression path are retired. */
const windowLayoutRecording = createWindowLayoutRecordingWiring({
  getLayout: windowLayoutFromState,
  host: {
    resolveWindowDescriptor: (descriptor, layoutId = null) => resolveWindowLayoutMemberDescriptor(descriptor, layoutId),
    observeWindowCapability: (capability) => host.observeWindowCapability(capability),
    applyWindowCapability: (capability, bounds) => host.applyWindowCapability(capability, bounds),
    minimizeWindowCapability: (capability) => host.minimizeWindowCapability(capability),
    restoreWindowCapability: (capability) => host.restoreWindowCapability(capability),
  },
  model: { setActiveWindowLayoutId, updateWindowLayoutMember },
  getState: () => state,
  replaceState: (next) => { state = store.replace(next); },
  scheduleSave: queueWindowLayoutSave,
  setStatus: setWindowLayoutStatus,
  patchMember: patchWindowLayoutMember,
  // Bounds observations stay local; a normal/minimized transition is the
  // state that the detached widget must receive so its underline cannot go
  // stale while the attached card is already correct.
  // A live observation is the ONLY writer allowed to paint the underline: it is
  // the only thing that knows what the window is doing now. This used to commit
  // a save and nothing else, so the marker was repainted by whatever else
  // happened to run - which is why it lagged the screen.
  onObservationStateChange: (layoutId, memberId, state) => {
    if (memberId) patchWindowLayoutMember(layoutId, memberId, state);
    noteWindowLayoutCommit(layoutId);
  },
  statusText: windowLayoutStatusForOutcome,
  onRetireMember: (intent) => handleWindowLayoutRetireMember(intent),
  // Every member result reaches the card's state, and only a TRANSITION repaints: the cadence runs every few
  // seconds and a repaint per cycle would be work the creator can see.
  onMemberOutcome: (result) => { if (noteWindowLayoutMemberResult(result)) render(); },
});
const windowLayoutRuntimeController = windowLayoutRecording.runtime;

// Native Papers lifecycle stream: the watcher owns existence/eligibility;
// this writer owns the one tracking layout's durable membership.  Events are
// advisory until the host resolves the exact instance into a fresh capability.
let trackingEventInFlight = false;
const trackingEventQueue = [];
let trackingPopulateInFlight = false;
const trackingPendingOpens = new Map();
let trackingSessionId = null;
let trackingLastSequence = 0;
let trackingStartupBaselineReconciled = false;
const CLOSED_WINDOW_RECONCILE_INTERVAL_MS = 2000;
let closedWindowReconcileTimer = null;
let closedWindowReconcileInFlight = false;
const windowLayoutAutoTracking = createWindowLayoutAutoTracking({
  getState: () => state,
  resolveWindowInstance: (instanceId) => host.resolveWindowInstance(instanceId),
  resolveWindowDescriptor: (descriptor) => host.resolveWindowDescriptor(descriptor),
  observeWindowCapability: (capability) => host.observeWindowCapability(capability),
  commit: (next) => store.commit(next),
  onCommitted: async ({ layoutId, member, capability }) => {
    windowLayoutRuntime.capabilities.set(windowLayoutMemberKey(layoutId, member.id), capability);
    saveWorkspaceView();
    noteWindowLayoutCommit(layoutId);
    // Auto observes a new member; it must not select/reapply the entire saved
    // arrangement when the recording context is inactive (for example while
    // Quick Run has focus). Only refresh an already active recording session.
    if (isActiveRecordingContext(layoutId)) {
      await windowLayoutRuntimeController.reconcileActive();
    }
  },
  onDiagnostic: ({ stage, outcome }) => host.windowLayoutDiagnostic?.({ stage, outcome }),
});

function isWindowLifecycleDestroyEvent(event) {
  return event?.kind === 'destroy'
    || event?.kind === 'close'
    || event?.kind === 'closed'
    || event?.kind === 'gone';
}

async function processTrackingLifecycleEvent(event) {
  if (windowLayoutDetachment.isReadOnly() || !hasDocumentWriteAuthority()
    || surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
  if (!event || typeof event.windowInstanceId !== 'string') return;
  if (isWindowLifecycleDestroyEvent(event)) {
    trackingPendingOpens.delete(event.windowInstanceId);
    const tracked = (state.windowLayouts ?? []).some((layout) =>
      (layout.arrangement?.members ?? []).some((member) =>
        member.descriptor?.windowInstanceId === event.windowInstanceId));
    if (!tracked) return;
    // EVIDENCE, NOT PROOF. A lifecycle 'gone' is produced by diffing successive
    // task-worthy enumerations, so one transient disappearance would delete a
    // member outright. Seed one positive, then corroborate it immediately with
    // the exact resolver. That resolver performs a fresh serialized enumeration
    // when the WID is no longer in the lifecycle cache, so this is the second
    // independent observation. Do not make a real close wait for a renderer
    // timer: background/throttled writer surfaces can still receive the host
    // lifecycle push while their 2s safety sweep is delayed indefinitely.
    const existing = windowLayoutGoneConfirmations.get(event.windowInstanceId);
    windowLayoutGoneConfirmations.set(event.windowInstanceId, {
      count: Math.max(1, existing?.count ?? 0),
      at: Date.now(),
    });
    let confirmed = null;
    try {
      confirmed = await host.resolveWindowInstance(event.windowInstanceId);
    } catch {
      confirmed = null;
    }
    if (surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
    if (confirmed?.outcome === 'success') {
      // The lifecycle diff was transient. A fresh exact observation wins.
      windowLayoutGoneConfirmations.delete(event.windowInstanceId);
      return;
    }
    if (confirmed?.outcome === 'missing') {
      const retired = await retireClosedWindowEverywhere(
        { version: 1, windowInstanceId: event.windowInstanceId },
        { source: 'lifecycle-gone-confirmed', reason: 'the lifecycle close was independently confirmed missing' },
      );
      if (retired) windowLayoutGoneConfirmations.delete(event.windowInstanceId);
    }
    // An outage/timeout is not proof. Keep the seeded positive so the periodic
    // reconciliation remains the bounded recovery path.
    return;
  }
  const result = await windowLayoutAutoTracking.addFromEvent(event);
  if (result?.outcome === 'added' || result?.outcome === 'duplicate'
    || result?.outcome === 'disabled' || result?.outcome === 'suppressed') {
    trackingPendingOpens.delete(event.windowInstanceId);
  } else if (trackingPendingOpens.has(event.windowInstanceId) || trackingPendingOpens.size < 64) {
    const pending = trackingPendingOpens.get(event.windowInstanceId);
    trackingPendingOpens.set(event.windowInstanceId, {
      firstSeenAt: pending?.firstSeenAt ?? Date.now(),
      lastAttemptAt: Date.now(),
      descriptor: event.descriptor ?? pending?.descriptor ?? null,
    });
  }
}
async function drainTrackingLifecycleEvents() {
  if (trackingEventInFlight) return;
  trackingEventInFlight = true;
  try {
    while (trackingEventQueue.length > 0) {
      try {
        await processTrackingLifecycleEvent(trackingEventQueue.shift());
      } catch {
        // One transient IPC/store failure must not strand later eligible opens
        // behind an abandoned queue drain.
      }
    }
  } finally {
    trackingEventInFlight = false;
  }
}

/** Lifecycle pushes are the fast path, but a host may miss a close while its
 * watcher is restarting or while automatic tracking is off. Recheck exact
 * persisted identities as a safety net. Only an explicit `missing` result is
 * destructive; helper outages, timeouts, and ambiguity leave the member in
 * place for a later retry. */
async function reconcileClosedWindowMembers() {
  if (closedWindowReconcileInFlight
    || windowLayoutDetachment.isReadOnly()
    || !hasDocumentWriteAuthority()
    || surfaceCoordinator?.role !== SURFACE_ROLE.WRITER
    || typeof host.resolveWindowInstance !== 'function'
    || typeof host.windowLifecycleSnapshot !== 'function') return;
  const candidates = [];
  const seen = new Set();
  for (const layout of state.windowLayouts ?? []) {
    for (const member of layout.arrangement?.members ?? []) {
      const instanceId = member.descriptor?.windowInstanceId;
      if (typeof instanceId !== 'string' || seen.has(instanceId)) continue;
      seen.add(instanceId);
      candidates.push(instanceId);
    }
  }
  closedWindowReconcileInFlight = true;
  try {
    // One complete native enumeration answers which saved identities still
    // appear live. Probing every member separately kept the serial helper busy
    // nearly continuously and starved Auto's new-window binding requests.
    const response = await host.windowLifecycleSnapshot().catch(() => null);
    const snapshot = response?.snapshot;
    if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.windows)
      || surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
    const live = new Set(snapshot.windows.map((entry) => entry?.windowInstanceId)
      .filter((id) => typeof id === 'string'));
    for (const instanceId of candidates) {
      if (surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
      if (live.has(instanceId)) {
        windowLayoutGoneConfirmations.delete(instanceId);
        continue;
      }
      let result = null;
      try {
        result = await host.resolveWindowInstance(instanceId);
      } catch {
        result = null;
      }
      if (result?.outcome !== 'missing') {
        // Any other answer - including "I could not tell" - clears the count.
        windowLayoutGoneConfirmations.delete(instanceId);
        continue;
      }
      // ONE POSITIVE ANSWER IS NOT ENOUGH. A resolve can report 'missing' for a
      // window that is merely not visible, cloaked, or not yet enumerated, and a
      // single such answer once deleted live members one by one until the layout
      // was empty. Two independent positives, separated by at least one sweep,
      // are required before anything is retired.
      const confirmed = (windowLayoutGoneConfirmations.get(instanceId)?.count ?? 0) + 1;
      if (confirmed < 2) {
        windowLayoutGoneConfirmations.set(instanceId, { count: confirmed, at: Date.now() });
        continue;
      }
      if (surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
      windowLayoutGoneConfirmations.delete(instanceId);
      await retireClosedWindowEverywhere({ version: 1, windowInstanceId: instanceId }, { source: 'periodic-resolve-missing', reason: 'two independent resolutions could not find it' });
    }
    // Retry only opens the watcher actually delivered. A failed one-shot bind
    // no longer loses that window, while startup does not bulk-add old windows.
    let retried = 0;
    for (const [instanceId, pending] of trackingPendingOpens) {
      if (Date.now() - pending.firstSeenAt > 60000) {
        trackingPendingOpens.delete(instanceId);
        continue;
      }
      // A single lifecycle snapshot can omit a still-opening window. Keep the
      // bounded retry alive; the exact resolver itself confirms identity.
      if (Date.now() - pending.lastAttemptAt >= 2000) {
        if (surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
        await processTrackingLifecycleEvent({
          kind: 'open',
          windowInstanceId: instanceId,
          ...(pending.descriptor ? { descriptor: pending.descriptor } : {}),
        });
        if (++retried >= 4) break;
      }
    }
  } finally {
    closedWindowReconcileInFlight = false;
  }
}

function scheduleClosedWindowReconcile() {
  if (closedWindowReconcileTimer !== null) return;
  const tick = () => {
    closedWindowReconcileTimer = null;
    void reconcileClosedWindowMembers().catch(() => undefined).finally(() => {
      if (!windowLayoutDetachment.isStopped()) {
        closedWindowReconcileTimer = window.setTimeout(tick, CLOSED_WINDOW_RECONCILE_INTERVAL_MS);
      }
    });
  };
  closedWindowReconcileTimer = window.setTimeout(tick, CLOSED_WINDOW_RECONCILE_INTERVAL_MS);
}

function stopClosedWindowReconcile() {
  if (closedWindowReconcileTimer !== null) {
    window.clearTimeout(closedWindowReconcileTimer);
    closedWindowReconcileTimer = null;
  }
}

host.onWindowLifecycleEvent?.((event) => {
  const sequence = Number(event?.sequence);
  const sessionChanged = trackingSessionId !== event?.trackerSessionId;
  const gap = !Number.isSafeInteger(sequence) || (trackingLastSequence > 0 && sequence > trackingLastSequence + 1);
  trackingSessionId = typeof event?.trackerSessionId === 'string' ? event.trackerSessionId : trackingSessionId;
  if (Number.isSafeInteger(sequence)) trackingLastSequence = Math.max(trackingLastSequence, sequence);
  if (sessionChanged || gap) void reconcileTrackingBaseline();
  if (trackingEventQueue.length < 64) trackingEventQueue.push(event);
  void drainTrackingLifecycleEvents();
});
host.onWindowLifecycleBaseline?.((baseline) => {
  if (!baseline || baseline.complete !== true || typeof baseline.trackerSessionId !== 'string') return;
  trackingSessionId = baseline.trackerSessionId;
  if (Number.isSafeInteger(baseline.sequence)) trackingLastSequence = baseline.sequence;
  void reconcileTrackingBaseline(baseline);
});

// ---- 018A1 exclusive-controller handoff (As You Go half) ------------------
// One controller/observer/save owner at any time. While detached the workspace
// is read-only (persist gate + stopped controller + cancelled pick); the
// detached surface loads durable state and starts the controller ONLY after
// ACTIVATE. Detached READY is reported before any load/bootstrap.
function cancelWindowLayoutPick() {
  windowLayoutRuntime.pickUnsubscribe?.();
  windowLayoutRuntime.pickUnsubscribe = null;
  // 018X1R: return the host cancel promise so the handoff AWAITS the pick
  // cancel before controller stop/flush/ACK (a late pick result must not
  // overtake the handoff).
  return host.pickWindowCancel().catch(() => undefined);
}

// 018A1/018X1 read-only capture guard: while a layout controller is detached
// the workspace is an inert summary. A full-viewport transparent overlay
// swallows every pointer gesture (navigation/selection included); a small fixed
// toolbar ABOVE the overlay keeps only Focus/Reattach usable. Durable writes
// are additionally blocked by the detach save gate (persist/commit/replace).
// Z-indexes stay within the CSS 32-bit clamp: overlay 2147483646, toolbar
// 2147483647 (toolbar one above the overlay, neither exceeding the max).
let detachReadOnlyOverlay = null;
let detachReadOnlyToolbar = null;
// 018X1R/018X2: while read-only, capture-phase keyboard/beforeinput events are
// swallowed so keyboard mutations (typing, Ctrl+Z, workspace hotkeys) cannot
// reach the workspace. No arbitrary toolbar key is exempted; only Enter/Space
// 018X3: read-only input guards (workspace hotkeys blocked; only the
// Focus/Reattach toolbar is usable — pointer events targeted at it pass
// through, Enter/Space on a focused button activate it exactly once).
const detachReadOnlyInputGuards = createDetachReadOnlyInputGuards({
  windowRef: window,
  getToolbar: () => detachReadOnlyToolbar,
});
function buildDetachReadOnlyToolbar() {
  const toolbar = document.createElement('div');
  toolbar.setAttribute('data-detach-readonly', 'true');
  Object.assign(toolbar.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '2147483647',
    display: 'flex',
    gap: '6px',
  });
  const focus = document.createElement('button');
  focus.type = 'button';
  focus.textContent = 'Focus';
  focus.className = 'window-layout-control wl-focus';
  focus.addEventListener('click', () => void windowLayoutDetachment.focusDetached().catch(() => undefined));
  const reattach = document.createElement('button');
  reattach.type = 'button';
  reattach.textContent = 'Reattach';
  reattach.className = 'window-layout-control wl-reattach';
  reattach.addEventListener('click', () => void windowLayoutDetachment.reattach().catch(() => undefined));
  toolbar.append(focus, reattach);
  return toolbar;
}
function setDetachReadOnly(flag) {
  detachSaveGate.setReadOnly(flag);
  if (flag) {
    // 018X2 item 9: cancel any in-progress graph drag (rolls back node
    // positions) and any active marquee (releases capture / hides the overlay
    // WITHOUT the finish command), before the capture guards prevent a
    // still-captured pointerup from finalizing after the handoff.
    pointer?.cancelDrag?.();
    marquee?.cancel?.();
    // 018X4: cancel the separate 016 member drag (clears state/capture/visuals
    // without finalizing a move) so it cannot revive after disarm/pointer reuse.
    cancelWindowLayoutDrag();
    if (!detachReadOnlyOverlay) {
      detachReadOnlyOverlay = document.createElement('div');
      detachReadOnlyOverlay.setAttribute('data-detach-readonly', 'true');
      Object.assign(detachReadOnlyOverlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        cursor: 'default',
        background: 'transparent',
      });
      document.body.appendChild(detachReadOnlyOverlay);
    }
    if (!detachReadOnlyToolbar) {
      detachReadOnlyToolbar = buildDetachReadOnlyToolbar();
      document.body.appendChild(detachReadOnlyToolbar);
    }
    detachReadOnlyInputGuards.arm();
  } else {
    if (detachReadOnlyOverlay) {
      detachReadOnlyOverlay.remove();
      detachReadOnlyOverlay = null;
    }
    if (detachReadOnlyToolbar) {
      detachReadOnlyToolbar.remove();
      detachReadOnlyToolbar = null;
    }
    detachReadOnlyInputGuards.disarm();
  }
}

// 019G/021: the legacy 018 full-surface detach (windowLayoutDetachment) is
// RETIRED from reachability. Detach now opens the compact layout-only widget
// (widgetOpen) which never freezes the workspace, so these guards are inert:
// the workspace is never read-only and the old `?detach=1` branch below can
// never activate (mode is always 'workspace'). The compact-widget guards (the
// widget never writes the store) are untouched.
const windowLayoutDetachment = {
  isReadOnly: () => false,
  getState: () => ({ mode: 'workspace', readOnly: false, detachedActive: false, stopped: false, transferId: null, busy: false }),
  isStopped: () => false,
  stop: () => undefined,
  reattach: () => Promise.resolve(),
  focusDetached: () => Promise.resolve(),
  reportReady: () => Promise.resolve(),
  waitForActivate: () => Promise.resolve(null),
};

// 018X5: systematic await/read-only barrier for the group member actions.
const windowLayoutGroupActionRunner = createWindowLayoutGroupActionRunner({
  isReadOnly: () => windowLayoutDetachment.isReadOnly(),
  host,
});

// ---- 019C compact widget surface (As You Go half) -------------------------
// One native widget per layout, opened/focused by the workspace and closed by
// the widget itself. The workspace is the SOLE durable writer and revision
// source: the widget only sends bounded command intents over a same-origin
// BroadcastChannel and never touches the store/save/recording persistence.
// The workspace writer applies commands through the EXISTING functions/store.
// 035: layouts whose compact widget is currently open. Their attached card is
// a greyed placeholder (the widget is the sole live card); the set is driven by
// the widget's widget-ready/dispose channel announcements.
const detachedWidgets = new Set();
// 040: module-level handle to the WIDGET surface's channel client so the shared
// context-menu action (`Remove from this layout`) can route the removal intent
// through the widget channel instead of writing the store from the widget. Set
// when the widget bootstraps, cleared on pagehide.
let windowLayoutWidgetClient = null;

async function retireClosedWindowEverywhere(descriptor, diagnostics = {}) {
  if (WIDGET_SURFACE) {
    return Boolean(windowLayoutWidgetClient?.sendCommand({
      kind: 'retire-closed-window',
      descriptor,
      diagnostics,
    }));
  }
  if (windowLayoutDetachment.isReadOnly()) return false;
  const removedByLayout = new Map();
  for (const layout of state.windowLayouts ?? []) {
    const removed = (layout.arrangement?.members ?? []).filter((member) => {
      if (typeof descriptor?.windowInstanceId === 'string') {
        return member.descriptor?.windowInstanceId === descriptor.windowInstanceId;
      }
      return member.descriptor?.title === descriptor?.title
        && member.descriptor?.executableFingerprint?.toLowerCase()
          === descriptor?.executableFingerprint?.toLowerCase();
    });
    if (removed.length > 0) removedByLayout.set(layout.id, removed);
  }
  if (removedByLayout.size === 0) return false;
  const next = removeClosedWindowFromAllLayouts(state, descriptor, diagnostics);
  const persisted = await store.commit(next);
  if (!persisted) return false;
  for (const [changedLayoutId, removed] of removedByLayout) {
    const removedIds = new Set(removed.map((member) => member.id));
    for (const memberId of removedIds) {
      const key = windowLayoutMemberKey(changedLayoutId, memberId);
      windowLayoutRuntime.capabilities.delete(key);
      windowLayoutRuntime.icons.delete(key);
      windowLayoutWidgetPreviewCapabilities.delete(key);
    }
    const selected = windowLayoutRuntime.selectedMembers.get(changedLayoutId);
    if (selected) {
      for (const memberId of removedIds) selected.delete(memberId);
      if (selected.size === 0) windowLayoutRuntime.selectedMembers.delete(changedLayoutId);
      syncWindowLayoutMemberSelection(changedLayoutId);
    }
    if (removedIds.has(windowLayoutRuntime.selectionAnchor.get(changedLayoutId))) {
      windowLayoutRuntime.selectionAnchor.delete(changedLayoutId);
    }
    setWindowLayoutStatus(changedLayoutId, '');
    noteWindowLayoutCommit(changedLayoutId, { reason: 'closed-window-retired' });
  }
  windowLayoutMemberPreview.cancel();
  if ([...removedByLayout.keys()].some((candidate) => isActiveRecordingContext(candidate))) {
    await windowLayoutRuntimeController.reconcileActive();
  }
  return persisted;
}

// The compact widget loads this same bundle, so this workspace-side responder
// is constructed on the widget surface too - but the widget deliberately skips
// bootstrapWorkspace(), so its `state` never holds a layout. On a live channel
// it would therefore answer the widget's OWN snapshot-request with
// `unknown-layout`, which re-arms the widget's bounded retry, which requests
// again: an endless request loop whose replies rebuild the card. Only a real
// workspace surface is an authoritative responder, so the widget gets an inert
// channel and answers nothing.
const windowLayoutWidgetChannelWorkspace = createWindowLayoutWidgetChannelWorkspace({
  channel: WIDGET_SURFACE
    ? createInertBroadcastChannel(WINDOW_LAYOUT_WIDGET_CHANNEL)
    : createSafeBroadcastChannel(WINDOW_LAYOUT_WIDGET_CHANNEL),
  // Exactly one surface answers a widget. Reuse the document-writer election
  // rather than inventing a second one: the Web Lock already names a single
  // WRITER per project and hands it on when that surface dies.
  isAuthoritative: () => !WIDGET_SURFACE
    && coordinationState === 'ready'
    && surfaceCoordinator?.role === SURFACE_ROLE.WRITER,
  getLayout: windowLayoutFromState,
  getHoverPolicy: () => {
    const preferences = state.view?.preferences?.hotkeys ?? {};
    const blockedBindings = [];
    for (const action of HOTKEY_CATALOG) {
      if (action.scope !== HOTKEY_SCOPE_WORKSPACE) continue;
      for (const binding of effectiveBindings(action.id, preferences, HOTKEY_CATALOG)) {
        if (/^(?:Shift\+)?[^+\t\r\n]+$/.test(binding)) blockedBindings.push(binding);
      }
    }
    return { enabled: true, blockedBindings: [...new Set(blockedBindings)].slice(0, 256) };
  },
  snapshot: (layout, memberIcon, memberNote) => ({
    ...windowLayoutWidgetSnapshot(layout, memberIcon, memberNote),
    // The compact surface does not load the whole workspace state. Carry only
    // the bounded visual preferences needed to render the same native window
    // transparency/theme as its host Backpack.
    appearance: {
      theme: getTheme(state.view?.preferences),
      transparentBackground: getTransparentBackground(state.view?.preferences),
      backdropOpacity: getBackdropOpacity(state.view?.preferences),
    },
  }),
  // 019G/021: the workspace's icon cache feeds the bounded snapshot icon so the
  // widget renders REAL member icons (bounded to the channel byte cap).
  // 040: composite layout\u0000member cache identity.
  memberIcon: (layoutId, memberId) => windowLayoutMemberIcon(layoutId, memberId),
  // The same note, carried the same way, so the compact widget and the detached surface say it too - they
  // render from this snapshot and have no runtime to ask.
  memberNote: (layoutId, memberId) => windowLayoutMemberNote(layoutId, { id: memberId }),
  // 035: a widget announcing itself marks its attached card as a placeholder;
  // a dispose restores it. Both re-render the graph node.
  onWidgetOpen: (layoutId) => {
    if (detachedWidgets.has(layoutId)) return;
    detachedWidgets.add(layoutId);
    render();
  },
  onWidgetDispose: (layoutId) => {
    if (!detachedWidgets.delete(layoutId)) return;
    render();
  },
  // Member icons are resolved into each surface's own in-memory cache and the
  // snapshot reads the responder's copy, so the authority must hydrate the ones
  // it lacks. Another surface resolving them can no longer publish, and the
  // writer may not even be displaying this layout - without this the widget
  // sits on placeholder icons forever.
  onAuthoritativeWidgetOpen: (layoutId) => {
    for (const member of windowLayoutFromState(layoutId)?.arrangement?.members ?? []) {
      queueWindowLayoutIconRefresh(layoutId, member.id);
    }
  },
  // 035: the live widget reports its window content size; the workspace persists
  // it to the shared card geometry (replace + save, no history/selection churn)
  // so reattach mirrors it.
  onCardSize: (layoutId, width, height) => {
    let next;
    try {
      next = setWindowLayoutCardSize(state, layoutId, width, height);
    } catch {
      return;
    }
    if (next === state) return;
    store.replace(next);
    void store.save(next, { rebaseAutomaticSave: true }).catch(() => undefined);
  },
  applyCommand: async (layoutId, command) => {
    if (windowLayoutDetachment.isReadOnly()) return { ok: false, error: 'read-only' };
    if (command.kind === 'dock-widget-to-pill') {
      const next = setWindowLayoutPill(state, layoutId, true);
      if (next !== state && !(await store.commit(next))) return { ok: false, error: 'dock persistence failed' };
      const minimized = await host.widgetMinimize(layoutId).catch(() => null);
      if (!minimized || minimized.ok !== true) {
        const restored = setWindowLayoutPill(state, layoutId, false);
        if (restored !== state) await store.commit(restored);
        return { ok: false, error: 'widget minimize failed' };
      }
      if (detachedWidgets.delete(layoutId)) render();
      return { ok: true };
    }
    if (command.kind === 'activate-member') {
      // The widget's right-click intent: it owns no state, so the workspace
      // resolves the member here and brings that window forward.
      const activated = await activateWindowLayoutMember(layoutId, command.memberId);
      if (activated?.outcome !== 'success') {
        return { ok: false, error: activated?.message || 'that window could not be brought forward' };
      }
      return { ok: true, activated: true };
    }    if (command.kind === 'delete-layout') {
      const wasActive = isActiveRecordingContext(layoutId);
      const next = deleteWindowLayout(state, layoutId);
      if (next === state || !(await store.commit(next))) return { ok: false, error: 'delete persistence failed' };
      const prefix = `${layoutId}\u0000`;
      for (const key of [...windowLayoutRuntime.capabilities.keys()]) {
        if (key.startsWith(prefix)) windowLayoutRuntime.capabilities.delete(key);
      }
      for (const cache of [windowLayoutRuntime.icons, windowLayoutWidgetPreviewCapabilities]) {
        for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
      }
      windowLayoutRuntime.selectedMembers.delete(layoutId);
      windowLayoutRuntime.selectionAnchor.delete(layoutId);
      detachedWidgets.delete(layoutId);
      if (wasActive) await windowLayoutRuntimeController.reconcileActive();
      await host.widgetClose(layoutId).catch(() => undefined);
      return { ok: true, deleted: true };
    }
    if (command.kind === 'clear-layout') {
      const layout = windowLayoutFromState(layoutId);
      if (!layout) return { ok: false, error: 'unknown layout' };
      const members = layout.arrangement?.members ?? [];
      if (members.length === 0) return { ok: true };
      let next = state;
      for (const member of members) {
        next = removeWindowLayoutMember(next, layoutId, member.id);
        const instanceId = member.descriptor?.windowInstanceId;
        if (layout.tracking?.enabled === true && typeof instanceId === 'string') {
          next = setWindowLayoutInstanceSuppressed(next, layoutId, instanceId, true);
        }
      }
      if (!(await store.commit(next))) return { ok: false, error: 'clear persistence failed' };
      for (const member of members) {
        const key = windowLayoutMemberKey(layoutId, member.id);
        windowLayoutRuntime.capabilities.delete(key);
        windowLayoutRuntime.icons.delete(key);
        windowLayoutWidgetPreviewCapabilities.delete(key);
      }
      windowLayoutRuntime.selectedMembers.delete(layoutId);
      windowLayoutRuntime.selectionAnchor.delete(layoutId);
      await windowLayoutRuntimeController.reconcileActive();
      noteWindowLayoutCommit(layoutId);
      return { ok: true };
    }
    if (command.kind === 'bring-to-front') {
      // The widget cannot activate a window itself; the writer owns that path.
      await bringWindowLayoutMemberToFront(layoutId, command.memberId);
      return { ok: true };
    }
    if (command.kind === 'member-toggle') {
      // Recorded, because "the widget sent it" and "the writer received it" are
      // different facts, and only one of them was ever visible.
      try {
        void store.commit(noteWindowLayoutDiagnostic(state, {
          reason: 'writer received member-toggle for ' + command.memberId,
          source: 'member-toggle',
        }));
      } catch { /* diagnostics never fail the action they describe */ }
      await handleWindowLayoutMemberClick(layoutId, command.memberId);
      return { ok: true };
    }
    if (command.kind === 'toggle-tracking') {
      const toggled = await handleWindowLayoutTrackingToggle(layoutId);
      return toggled ? { ok: true } : { ok: false, error: 'tracking persistence failed' };
    }
    if (command.kind === 'remove-member') {
      // 040: the widget's `Remove from this layout` routes to the existing
      // scoped data-only unlink writer (composite cache cleanup, one
      // persistence, active-only reconcile). Never a cross-layout mutation.
      handleWindowLayoutUnlink(layoutId, command.memberId);
      return { ok: true };
    }
    if (command.kind === 'retire-closed-window') {
      await retireClosedWindowEverywhere(command.descriptor, { source: command.diagnostics?.source ?? 'writer-retire', reason: command.diagnostics?.reason, operationId: command.diagnostics?.operationId });
      return { ok: true };
    }
    if (command.kind === 'group-action') {
      await windowLayoutGroupAction(layoutId, command.action,
        command.memberIds.length > 0 ? command.memberIds : null);
      return { ok: true };
    }
    if (command.kind === 'range-toggle') {
      await windowLayoutToggleRange(layoutId, command.memberId,
        command.memberIds.length > 0 ? command.memberIds : [command.memberId]);
      return { ok: true };
    }
    if (command.kind === 'reorder') {
      // 024: the widget drag-reorder intent - applied through the EXISTING
      // model reorder, persisted once and broadcast back to open widgets.
      const next = reorderWindowLayoutMember(state, layoutId, command.memberId, command.toIndex);
      if (next !== state) {
        // commit() already owns the one queued persistence write. The former
        // saveWorkspaceView() issued a second identical host request per drop;
        // repeated drags could backlog the bridge and surface a false timeout.
        const persisted = await store.commit(next);
        if (!persisted) return { ok: false, error: 'reorder persistence failed' };
        noteWindowLayoutCommit(layoutId, { reason: 'reorder' });
      }
      return { ok: true };
    }
    if (command.kind === 'picker-commit') {
      const applied = await applyWindowLayoutPickSet(layoutId, command.pick);
      // 019DR: a read-only handoff that began during observation surfaces as a
      // typed superseded failure (zero commit/save/recording mutation), so the
      // widget never sees a false committed result.
      if (applied.outcome === 'superseded') return { ok: false, error: 'superseded' };
      if (applied.outcome === 'failed') {
        return { ok: false, error: applied.error || 'picker commit failed' };
      }
      if (applied.outcome === 'cancelled') return { ok: true };
      if (applied.outcome !== 'committed') return { ok: false, error: 'picker commit failed' };
      // The sentence this workspace already put on its own status line rides back with the committed
      // result. A pick whose removals were all refused changes nothing, so the widget's snapshot comes
      // back byte-identical to the one it is already showing and no repaint can tell the creator anything;
      // on the DETACHED card the refusal was silent - the creator saw a menu close and nothing else. It
      // travels as a status ON the committed result, never as an error: a refusal is not a failure, and a
      // mixed result is a real commit whose two halves both need saying.
      const status = windowLayoutWidgetCommittedStatus(windowLayoutPickApplyOutcome(applied).statusText);
      return status === null ? { ok: true } : { ok: true, status };
    }
    return { ok: false, error: 'unknown command' };
  },
});
const windowLayoutPickApplier = createWindowLayoutPickApplier({
  getState: () => state,
  // 019I: store.commit() installs state synchronously via setState and RETURNS
  // a Promise<boolean> for persistence. NEVER assign that Promise to `state`
  // (JSON.stringify(Promise) == "{}" would corrupt the durable snapshot).
  commitState: (next) => store.commit(next),
  observeCapability: (capability) => host.observeWindowCapability(capability),
  model: { addWindowLayoutMember, removeWindowLayoutMember },
  capabilities: windowLayoutRuntime.capabilities,
  icons: windowLayoutRuntime.icons,
  iconCacheEntry: windowLayoutIconCacheEntry,
  isReadOnly: () => windowLayoutDetachment.isReadOnly(),
});
const windowLayoutRetirementWriter = createWindowLayoutRetirementWriter({
  getState: () => state,
  // 019I: same rule as the pick applier - invoke the real commit, never assign
  // its persistence Promise to the global state.
  commitState: (next) => store.commit(next),
  model: { removeWindowLayoutMember },
  capabilities: windowLayoutRuntime.capabilities,
  icons: windowLayoutRuntime.icons,
});

/** 019C/019DR: applies Winter's ONE typed committed pick set (every remove
 * data-only, every successful add) with a single durable commit; cancel is
 * byte-zero and a read-only handoff begun mid-apply surfaces as typed
 * `superseded` with zero commit/save/recording mutation. */
async function applyWindowLayoutPickSet(layoutId, result, { activateOnMutation = true } = {}) {
  if (windowLayoutDetachment.isReadOnly()) return { outcome: 'failed', error: 'read-only' };
  const applied = await windowLayoutPickApplier.apply(layoutId, result);
  if (applied.outcome === 'failed') {
    setWindowLayoutStatus(layoutId, applied.error || 'Pick failed');
    return applied;
  }
  if (applied.outcome === 'committed') {
    const outcome = windowLayoutPickApplyOutcome(applied);
    // A pick that changed nothing is not a commit and must not activate anything.
    if (outcome.mutated) windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId);
    setWindowLayoutStatus(layoutId, outcome.statusText);
    if (outcome.mutated) {
      if (activateOnMutation) {
        await windowLayoutRecording.ensureRecording(layoutId);
      } else if (isActiveRecordingContext(layoutId)) {
        await windowLayoutRuntimeController.reconcileActive();
      }
    }
  }
  return applied;
}

/** 019C: Ning's onRetireMember intent -> ONE data-only removal/save and a
 * status/selection refresh. An intent for a member/layout that no longer
 * exists is ignored; counters are never persisted. */
function handleWindowLayoutRetireMember(intent) {
  const { layoutId, memberId } = intent ?? {};
  if (!layoutId || !memberId) return;
  if (windowLayoutDetachment.isReadOnly()) return;
  const result = windowLayoutRetirementWriter.retire(layoutId, memberId);
  if (result.outcome !== 'removed') return;
  if (intent.reason === 'watcher-destroy' && typeof intent.descriptor?.windowInstanceId === 'string') {
    const cleared = setWindowLayoutInstanceSuppressed(state, layoutId, intent.descriptor.windowInstanceId, false);
    void store.commit(cleared);
  }
  // 019G: a removed card must clear/discard any pending hover preview.
  windowLayoutMemberPreview.cancel();
  windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId);
  setWindowLayoutStatus(layoutId, '');
  const selected = windowLayoutRuntime.selectedMembers.get(layoutId);
  if (selected?.delete(memberId)) syncWindowLayoutMemberSelection(layoutId);
}

/** 019C: after any OTHER durable window-layout commit the workspace broadcasts
 * the fresh snapshot/revision so open widgets re-sync (the channel workspace
 * also answers command intents itself). */
/** Per-layout signature of the DURABLE fields a widget snapshot is built from,
 * used to detect that an installed document changed a layout. Deliberately not
 * the widget render identity: that one carries locally-resolved member icons,
 * which are per-surface cache state and would report spurious changes. */
function windowLayoutDurableSignatures(source) {
  const signatures = new Map();
  for (const layout of source?.windowLayouts ?? []) {
    signatures.set(layout.id, JSON.stringify([
      layout.name ?? '',
      (layout.arrangement?.members ?? []).map((member) => [
        member.id,
        member.state,
        member.descriptor?.title ?? '',
        member.descriptor?.executableFingerprint ?? '',
      ]),
    ]));
  }
  return signatures;
}

function noteWindowLayoutCommit(layoutId, options) {
  windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId, options);
}

function queueWindowLayoutSave() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = setTimeout(() => {
    saveWorkspaceView();
  }, WINDOW_LAYOUT_SAVE_DEBOUNCE_MS);
}

/** Bootstrap: reconcile the persisted active id WITHOUT inventing one. Returns
 * the real controller switch promise so the detached/workspace RESUMED ACK
 * follows actual owner start (018X1). A null id means no recording context
 * until the creator touches a layout. */
function bootstrapWindowLayoutRecording() {
  // Deliberately the DURABLE id, not isActiveRecordingContext(): this is the
  // resume seam, and at boot the runtime has no active layout yet. This is the
  // one question the persisted field is the right answer to.
  if (state.activeWindowLayoutId) {
    // RESUME, do not activate. Launching Papers attaches observation to the
    // layout that was already active; ensureRecording() here replayed the whole
    // layout - applying every saved rectangle and restoring each window in turn
    // for about eight seconds after launch, raising the creator's windows over
    // whatever they were doing. A deliberate switch still applies the layout.
    return windowLayoutRecording.resumeRecording(state.activeWindowLayoutId);
  }
  return Promise.resolve();
}

/** Teardown: stop the recording timer and drop ephemeral capabilities without
 * a late save (the persisted active id stays for the next open to reconcile).
 * A pending debounced save is cancelled so no write races the unload. This is
 * the CONTROLLER stop used by the detach handoff too, so it must NOT stop the
 * detach lifecycle: the workspace still has to receive CLOSED/crash and
 * resume. 018X2 item 8: the runtime stop Promise is RETURNED so the factory's
 * `await stopController()` is a real await. The pagehide handler performs the
 * full lifecycle stop. */
function teardownWindowLayoutRecording() {
  clearTimeout(windowLayoutRuntime.saveTimer);
  windowLayoutRuntime.saveTimer = null;
  const hadActivePick = Boolean(windowLayoutRuntime.pickAttempt || windowLayoutRuntime.pickUnsubscribe);
  windowLayoutRuntime.pickAttempt = null;
  windowLayoutRuntime.pickLayoutId = null;
  windowLayoutRuntime.pickUnsubscribe?.();
  windowLayoutRuntime.pickUnsubscribe = null;
  // pagehide can occur without immediately destroying the sender WebContents.
  // Do not abandon the result listener while leaving that sender owning the
  // native one-shot session; explicitly release it before teardown completes.
  const cancelPick = hadActivePick
    ? host.pickWindowCancel().catch(() => undefined)
    : Promise.resolve();
  return Promise.all([
    cancelPick,
    windowLayoutRuntimeController.stop({ clearActive: false }),
  ]).then(() => undefined);
}

// 018X1: pagehide performs only the detach LIFECYCLE stop (the controller stop
// is owned by the handoff and by the controller's own seams; a second stop here
// would be a duplicate that could race an in-flight transfer).
window.addEventListener('pagehide', () => windowLayoutDetachment.stop());

window.addEventListener('pagehide', () => {
  stopClosedWindowReconcile();
  void teardownWindowLayoutRecording();
});

function handleWindowLayoutUnlink(layoutId, memberId) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const layout = windowLayoutFromState(layoutId);
  if (!layout || !memberId) return;
  // 019G: a removed card must clear/discard any pending hover preview.
  windowLayoutMemberPreview.cancel();
  let next = removeWindowLayoutMember(state, layoutId, memberId, { source: 'user-unlink', reason: 'the creator removed this icon' });
  if (layout.tracking?.enabled === true && typeof layout.arrangement?.members?.find((member) => member.id === memberId)?.descriptor?.windowInstanceId === 'string') {
    const instanceId = layout.arrangement.members.find((member) => member.id === memberId).descriptor.windowInstanceId;
    next = setWindowLayoutInstanceSuppressed(next, layoutId, instanceId, true);
  }
  windowLayoutRuntime.capabilities.delete(windowLayoutMemberKey(layoutId, memberId));
  windowLayoutRuntime.icons.delete(windowLayoutMemberKey(layoutId, memberId));
  store.commit(next);
  closeWindowLayoutPicker();
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  // Unlinking a member of the active layout re-syncs the observer; unlinking
  // from an inactive layout never starts recording there. Unlinking the last
  // member leaves the id retained with no timer (retry on the next add).
  if (isActiveRecordingContext(layoutId)) {
    void windowLayoutRuntimeController.reconcileActive();
  }
}

async function reconcileTrackingBaseline(providedSnapshot = null) {
  if (windowLayoutDetachment.isReadOnly() || !hasDocumentWriteAuthority()
    || surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
  const response = providedSnapshot ? null : await host.windowLifecycleSnapshot?.().catch(() => null);
  const snapshot = providedSnapshot ?? response?.snapshot;
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.windows)) return;
  // A delayed snapshot from an old watcher session must not overwrite a newer
  // baseline or reintroduce opens from that retired session.
  if (trackingSessionId && snapshot.trackerSessionId !== trackingSessionId) return;
  const accepted = await windowLayoutAutoTracking.acceptBaseline(snapshot, async () => {
    // Authority can change while a host snapshot is in flight. Do not consume
    // its lifecycle delta unless this surface can reconcile and commit it.
    if (windowLayoutDetachment.isReadOnly() || !hasDocumentWriteAuthority()
      || surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return false;
    // A later watcher restart or sequence-gap baseline is a recovery sample,
    // not another startup. Runtime removal requires the two confirmed misses
    // in reconcileClosedWindowMembers instead of one task-list omission.
    if (trackingStartupBaselineReconciled) return true;
    const live = new Set(snapshot.windows.map((entry) => entry?.windowInstanceId).filter((id) => typeof id === 'string'));
    const before = state;
    let next = reconcileWindowLayoutsAfterStartup(state, [...live]);
    const trackingLayout = (next.windowLayouts ?? []).find((entry) => entry.tracking?.enabled === true);
    if (trackingLayout) {
      const suppressed = (trackingLayout.tracking?.suppressedInstanceIds ?? []).filter((id) => live.has(id));
      if (suppressed.length !== (trackingLayout.tracking?.suppressedInstanceIds ?? []).length) {
        next = {
          ...next,
          windowLayouts: next.windowLayouts.map((entry) => entry.id === trackingLayout.id
            ? { ...entry, tracking: { ...entry.tracking, suppressedInstanceIds: suppressed } }
            : entry),
        };
      }
    }
    if (next !== before && !(await store.commit(next))) return false;
    if (next !== before) {
      const after = state;
      for (const layout of before.windowLayouts ?? []) {
        const nextLayout = (after.windowLayouts ?? []).find((entry) => entry.id === layout.id);
        const removedIds = new Set((layout.arrangement?.members ?? [])
          .filter((member) => !nextLayout?.arrangement?.members?.some((candidate) => candidate.id === member.id))
          .map((member) => member.id));
        for (const memberId of removedIds) {
          const key = windowLayoutMemberKey(layout.id, memberId);
          windowLayoutRuntime.capabilities.delete(key);
          windowLayoutRuntime.icons.delete(key);
          windowLayoutWidgetPreviewCapabilities.delete(key);
        }
        if (removedIds.size > 0 || !nextLayout) {
          const selected = windowLayoutRuntime.selectedMembers.get(layout.id);
          if (selected) {
            for (const memberId of removedIds) selected.delete(memberId);
            if (selected.size === 0) windowLayoutRuntime.selectedMembers.delete(layout.id);
            syncWindowLayoutMemberSelection(layout.id);
          }
          setWindowLayoutStatus(layout.id, '');
          noteWindowLayoutCommit(layout.id, { reason: 'startup-window-baseline' });
        }
      }
      windowLayoutMemberPreview.cancel();
      saveWorkspaceView();
      if (before.activeWindowLayoutId !== after.activeWindowLayoutId) {
        await windowLayoutRuntimeController.reconcileActive();
      }
    }
    trackingStartupBaselineReconciled = true;
    return true;
  });
  // Baseline deltas are accepted only after the durable startup reconciliation
  // succeeds. Both lifecycle pushes and recovered opens then share one queue.
  for (const event of accepted.events) trackingEventQueue.push(event);
  if (accepted.events.length) void drainTrackingLifecycleEvents();
}

const windowLayoutWidgetLifecycle = createWindowLayoutWidgetLifecycle({
  widgetOpen: (layoutId, options) => host.widgetOpen(layoutId, options),
  getLayouts: () => state.windowLayouts ?? [],
  getDockedLayoutIds: () => state.windowLayoutPillIds ?? [],
  isLayoutVisible: (layout) =>
    itemsIn(state, layout.parentId).some((candidate) => candidate.id === layout.id),
  presentationSuppressed: () =>
    windowLayoutDetachment.getState().mode === 'detached'
      || windowLayoutDetachment.isReadOnly(),
});

async function populateTrackingLayout(layoutId) {
  if (trackingPopulateInFlight) return;
  trackingPopulateInFlight = true;
  try {
    await populateTrackingLayoutCore(layoutId);
  } catch {
    // The periodic lifecycle sweep will retry live windows. A transient
    // helper or writer failure must not strand the one Auto owner.
    setWindowLayoutStatus(layoutId, 'Auto Add is preparing; it will retry.');
  } finally {
    trackingPopulateInFlight = false;
  }
}

async function populateTrackingLayoutCore(layoutId) {
  const layout = windowLayoutFromState(layoutId);
  if (!layout || layout.tracking?.enabled !== true) return;
  const listed = await host.windowCandidates({ includeNativeIcons: false });
  if (listed.outcome !== 'success') {
    setWindowLayoutStatus(layoutId, windowLayoutStatusForOutcome(listed.outcome));
    return;
  }
  let added = 0;
  for (const candidate of listed.candidates ?? []) {
    if (surfaceCoordinator?.role !== SURFACE_ROLE.WRITER) return;
    const currentLayout = windowLayoutFromState(layoutId);
    if (!currentLayout || currentLayout.tracking?.enabled !== true) return;
    const currentIds = new Set((currentLayout.arrangement?.members ?? [])
      .map((member) => member.descriptor?.windowInstanceId)
      .filter((value) => typeof value === 'string'));
    const currentSuppressed = new Set(currentLayout.tracking?.suppressedInstanceIds ?? []);
    if (typeof candidate.windowInstanceId === 'string'
      && (currentIds.has(candidate.windowInstanceId) || currentSuppressed.has(candidate.windowInstanceId))) continue;
    const bound = await host.bindWindowCandidate(candidate.id);
    if (bound.outcome !== 'success') continue;
    const instanceId = bound.descriptor?.windowInstanceId;
    if (typeof instanceId !== 'string' || currentIds.has(instanceId) || currentSuppressed.has(instanceId)) continue;
    const observed = await host.observeWindowCapability(bound.capability);
    if (observed.outcome !== 'success') continue;
    const latestLayout = windowLayoutFromState(layoutId);
    if (!latestLayout || latestLayout.tracking?.enabled !== true) return;
    const latestIds = new Set((latestLayout.arrangement?.members ?? [])
      .map((member) => member.descriptor?.windowInstanceId)
      .filter((value) => typeof value === 'string'));
    if (latestIds.has(instanceId) || latestLayout.tracking?.suppressedInstanceIds?.includes(instanceId)) continue;
    const member = {
      id: crypto.randomUUID(),
      descriptor: bound.descriptor,
      bounds: observed.observation?.bounds ?? null,
      state: observed.observation?.state === 'minimized' ? 'minimized' : 'normal',
    };
    const next = addWindowLayoutMember(state, layoutId, member);
    if (next === state) continue;
    if (!(await store.commit(next))) continue;
    windowLayoutRuntime.capabilities.set(windowLayoutMemberKey(layoutId, member.id), bound.capability);
    added += 1;
  }
  if (added === 0) return;
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  await windowLayoutRecording.ensureRecording(layoutId);
}

async function handleWindowLayoutTrackingToggle(layoutId) {
  if (windowLayoutDetachment.isReadOnly()) return false;
  const layout = windowLayoutFromState(layoutId);
  if (!layout) return false;
  const nextEnabled = layout.tracking?.enabled !== true;
  const next = setWindowLayoutTracking(state, layoutId, nextEnabled);
  const persisted = await store.commit(next);
  if (!persisted) return false;
  saveWorkspaceView();
  noteWindowLayoutCommit(layoutId);
  // A newly-enabled owner gets a fresh baseline; disabling only stops future
  // additions and deliberately keeps its current members.
  if (nextEnabled) {
    void windowLayoutRecording.ensureRecording(layoutId);
    void populateTrackingLayout(layoutId);
  }
  return true;
}

const graph = createGraphController();

function createGraphController() {
  const nodes = new Map();
  const edges = new Map();
  const originEdges = new Map();
  let onDragCancel = null;
  let onRestPositions = null;
  let simulation = null;
  let zoomBehavior = null;
  let viewportSelection = null;
  let viewport = null;
  let camera = null;
  let edgeLayer = null;
  let setLayer = null;
  let regionLayer = null;
  let effectsLayer = null;
  // One path per set, and the ring nodes whose positions it is drawn through.
  // The nodes live in the simulation alongside the icons, so the outline is
  // wherever the physics put them rather than a shape computed from the
  // members' positions.
  const setShapes = new Map();
  const regionShapes = new Map();
  // Overlap-component discovery, per-component caching and the dense-cluster
  // fallback all live in the layout engine; this file only composes.
  const regionLayout = createRegionLayout();
  const setRings = new Map();
  const setEffects = createSetEffectsController({ document, animate });
  const dragTrail = createDragTrailController({ document, animate });
  // A ring node's collision radius.
  //
  // This was 18, reasoned as "only has to exceed half the spacing, since an
  // icon is stopped by the pair of nodes it meets". That holds for an icon the
  // simulation is free to move, and fails for a dragged one: a drag pins the
  // node's position outright, so the ring must physically occupy the space
  // rather than push back. Measured with a foreign tile pinned and walked to
  // the set centre, 18 was breached at x=20 and 26 at x=0.
  //
  // 36 is half a tile, so a ring node is as substantial as the thing it is
  // resisting, and the boundary holds at every position. Tighter spacing
  // (linkDistance 40, radius 26) also works but costs 50% more ring nodes for
  // the same result.
  const RING_NODE_RADIUS = 30;
  const RING_LINK_DISTANCE = 60;
  let nodeLayer = null;
  let svg = null;
  let resizeObserver = null;
  let rafId = 0;
  let pendingFrame = false;
  let initialized = false;
  let fitPending = false;
  let attached = false;
  let updatePending = false;
  let pendingInitialFit = false;
  // Position commits and role/status updates also render. They must not reset
  // cooling: only entry or changed physical layout inputs start another pass.
  let lastGraphLayoutKey = null;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  // Folder hues retain their position solver state; set hues retain a seeded,
  // distance-drift state. Both maps are session-only and never persisted.
  // One namespace is shared by folders and visible set outlines. Prefixing
  // ids prevents a folder id and set id with the same text from colliding.
  const spatialColors = new Map();
  const spatialHueState = new Map();

  function folderColor(id) {
    const hue = spatialColors.get(`folder:${id}`);
    // OKLCH spacing tracks perceived difference better than HSL; 68% lightness
    // and 0.18 chroma read clearly on the warm paper background.
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function setColor(id) {
    const hue = spatialColors.get(`set:${id}`);
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function regionColor(id) {
    const hue = spatialColors.get(`region:${id}`);
    return typeof hue === 'number' ? `oklch(68% 0.18 ${hue}deg)` : null;
  }

  function createGraphView() {
    if (attached) return;
    viewport = document.createElement('div');
    viewport.className = 'graph-viewport';
    viewport.id = 'graph-viewport';
    viewport.dataset.blankParent = session.binMode ? 'bin' : session.currentId;

    camera = document.createElement('div');
    camera.className = 'graph-camera';

    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'graph-edges-svg');
    svg.setAttribute('aria-hidden', 'true');
    // Set outlines sit behind the edges so tiles and links stay readable on
    // top of them.
    setLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    setLayer.setAttribute('class', 'graph-set-layer');
    regionLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    regionLayer.setAttribute('class', 'graph-set-region-layer');
    effectsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    effectsLayer.setAttribute('class', 'graph-set-effects-layer');
    dragTrail.setLayer(effectsLayer);
    edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(regionLayer, effectsLayer, setLayer, edgeLayer);
    syncEdgeOpacity();

    nodeLayer = document.createElement('div');
    nodeLayer.className = 'graph-node-layer';

    camera.append(svg, nodeLayer);
    viewport.append(camera);
    elements.grid.append(viewport);

    try {
      zoomBehavior = zoom()
        .scaleExtent([0.35, 3])
        .filter((event) => {
          if (event.type === 'mousedown' && event.button === 0) return false;
          if (event.type === 'dblclick') return false;
          if (event.type === 'wheel' && event.ctrlKey) return false;
          return true;
        })
        .on('zoom', ({ transform }) => {
          if (camera) {
            camera.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`;
          }
        });
      viewportSelection = select(viewport);
      viewportSelection.call(zoomBehavior);
    } catch (error) {
      viewport.remove();
      viewport = null;
      camera = null;
      edgeLayer = null;
      setLayer = null;
      regionLayer = null;
      effectsLayer = null;
      setShapes.clear();
      setRings.clear();
      nodeLayer = null;
      svg = null;
      throw error;
    }

    resizeObserver = new ResizeObserver(() => {
      const w = viewport?.clientWidth ?? 0;
      const h = viewport?.clientHeight ?? 0;
      if (w >= 2 && h >= 2) {
        if (simulation) {
          simulation.force('cx').x(w / 2);
          simulation.force('cy').y(h / 2);
        }
        if (updatePending || fitPending) {
          updatePending = false;
          updateGraphView(pendingInitialFit);
        }
      }
    });
    resizeObserver.observe(viewport);
    attached = true;
  }

  function destroyGraphView() {
    onDragCancel?.();
    // The throttled timer is deliberately not allowed to outrun a real
    // navigation/window close. Capture the latest coordinates synchronously
    // while the nodes still exist, then cancel the old-context timer.
    saveRestPositions();
    if (restSaveTimer) { clearTimeout(restSaveTimer); restSaveTimer = null; }
    if (simulation) { simulation.stop(); simulation = null; }
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; pendingFrame = false; }
    nodes.forEach((node) => {
      if (node.exitTimer) { clearTimeout(node.exitTimer); node.exitTimer = null; }
      removeWindowLayoutCardPresentation(node.shell);
    });
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    nodes.clear();
    edges.clear();
    originEdges.clear();
    // The paths go with the viewport below, but the maps that track them would
    // otherwise survive into the next attach and describe rings that no longer
    // exist.
    setShapes.clear();
    regionShapes.clear();
    regionLayout.update([]);
    setRings.clear();
    setEffects.clear();
    dragTrail.clear();
    lastGraphLayoutKey = null;
    if (viewport) { viewport.remove(); viewport = null; }
    camera = null;
    edgeLayer = null;
    setLayer = null;
    regionLayer = null;
    effectsLayer = null;
    nodeLayer = null;
    svg = null;
    viewportSelection = null;
    zoomBehavior = null;
    attached = false;
    initialized = false;
    fitPending = false;
    updatePending = false;
    pendingInitialFit = false;
  }

  function scheduleRender() {
    if (pendingFrame) return;
    pendingFrame = true;
    rafId = requestAnimationFrame(() => {
      pendingFrame = false;
      rafId = 0;
      drawFrame();
    });
  }

  function drawFrame() {
    nodes.forEach((node) => {
      if (node.exiting || !node.shell) return;
      node.shell.style.transform =
        `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%) scale(${node.visualScale ?? 1})`;
    });
    drawSetRings();
    syncEdgeOpacity();
    syncFolderColors();
    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target || !edge.path) return;
      const d = edgePath(source.x, source.y, target.x, target.y);
      if (edge.lastPathD === d) return;
      edge.lastPathD = d;
      edge.path.setAttribute('d', d);
    });
    originEdges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (!source || !target || !edge.path) return;
      const d = edgePath(source.x, source.y, target.x, target.y);
      if (edge.lastPathD === d) return;
      edge.lastPathD = d;
      edge.path.setAttribute('d', d);
    });
  }

  function syncEdgeOpacity() {
    const preferences = state.view?.preferences;
    // Trail opacity styles ancestor TILES, which live in the node layer rather
    // than inside the edges <svg> — so it is written to the root element, and
    // written BEFORE the svg guard below, or it would silently never apply
    // whenever the graph view happens not to be attached yet.
    const trailOpacity = String(getTrailOpacity(preferences));
    if (document.documentElement.style.getPropertyValue('--graph-trail-opacity') !== trailOpacity) {
      document.documentElement.style.setProperty('--graph-trail-opacity', trailOpacity);
    }
    if (!svg) return;
    const values = {
      '--graph-edge-opacity': getEdgeOpacity(preferences),
      '--graph-outline-opacity': getOutlineOpacity(preferences),
      '--graph-region-opacity': getRegionOpacity(preferences),
    };
    for (const [property, value] of Object.entries(values)) {
      const opacity = String(value);
      if (svg.style.getPropertyValue(property) !== opacity) svg.style.setProperty(property, opacity);
    }
  }

  function edgePath(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  /** Every folder an item sits inside, walked up to the root, nearest first.
   *
   * belongsToSet uses this to decide inherited membership: putting a folder in
   * a set covers its contents, so a child is a member when any ancestor is.
   * Passing nothing would make inheritance silently stop working, and passing
   * an undefined identifier — which is what this replaces — threw on every
   * group attempt with "ancestorsOfNode is not defined".
   *
   * The chain comes from the graph's own parentIds rather than the stored
   * folder tree, because that is what the visible layout is built from. */
  function ancestorsOfNode(nodeId) {
    const chain = [];
    const seen = new Set();
    const node = nodes.get(nodeId);
    const queue = (node?.parentIds?.length ? [...node.parentIds] : [node?.parentId]).filter(Boolean);
    while (queue.length > 0) {
      const parentId = queue.shift();
      if (!parentId || parentId === ROOT_ID || parentId === 'bin' || seen.has(parentId)) continue;
      seen.add(parentId);
      chain.push(parentId);
      const parent = nodes.get(parentId);
      if (parent?.parentIds?.length) queue.push(...parent.parentIds);
      else if (parent?.parentId) queue.push(parent.parentId);
    }
    return chain;
  }

  /** Which sets this node belongs to, by the same rule the ring is drawn from.
   *
   * Membership is inherited, so a folder's contents count — resolving it any
   * other way here would let the forces disagree with the outline about who is
   * inside what. */
  /** Whether an id is trail-derived in this view (an ancestor body or
   * anything revealed beneath an expanded ancestor). Trail items are
   * outside the set system here: they never join a ring, never receive a
   * set force, and are never ejected. This is the single predicate every
   * set consumer reads, so none of them can disagree. */
  function isTrailNode(id) {
    return nodes.get(id)?.candidate?.trail === true;
  }

  /** Every non-trail node — the bodies that participate in the set system
   * for this view. Shared by membership resolution, ring members and the
   * ejection sweep, so they all see the same eligible set. */
  function setEligibleNodes() {
    return [...nodes.values()].filter((node) => !node.exiting && !node.candidate?.trail);
  }

  function setIdsContaining(nodeId) {
    // Trail bodies are not members of anything drawn here. Sets express how
    // the creator organised their real items, and a trail body wandering
    // into a ring — or being pulled by its gravity — misrepresents that.
    // Excluding them at this one function keeps the outline and the forces
    // agreeing, which is the invariant the rest of this block depends on.
    if (isTrailNode(nodeId)) return [];
    const ids = [];
    for (const itemSet of state.view?.itemSets ?? []) {
      if (belongsToSet(itemSet, nodeId, ancestorsOfNode)) ids.push(itemSet.id);
    }
    return ids;
  }

  /** A direct member visible at this level makes the set eligible to draw here. */
  function setDrawsAtCurrentLevel(itemSet, visibleIds) {
    return directSetMemberIdsVisible(itemSet, visibleIds).length > 0;
  }

  /** The visible members of a set, as rectangles the ring can enclose. The
   * eligibility gate above is intentionally separate: once a set draws, its
   * outline encloses every visible inherited member, not only direct members.
   * Trail bodies are excluded from the visible ids entirely, so they can
   * neither make a set eligible to draw nor be enclosed by its outline. */
  function membersOnScreen(setId) {
    const itemSet = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId);
    if (!itemSet) return [];
    const eligible = setEligibleNodes();
    const visibleIds = eligible.map((node) => node.id);
    if (!setDrawsAtCurrentLevel(itemSet, visibleIds)) return [];
    const inheritedIds = new Set(inheritedSetMemberIdsVisible(itemSet, visibleIds, ancestorsOfNode));
    const members = [];
    for (const node of eligible) {
      if (!inheritedIds.has(node.id)) continue;
      members.push({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height });
    }
    return members;
  }

  /** Creates and removes the ring for each set that has members on screen.
   *
   * The ring nodes are added to the simulation by syncSimulation, so this only
   * decides how many there should be and where new ones start. It runs on
   * structural changes rather than every frame: the node count follows the
   * ring's perimeter, which only changes when members move appreciably. */
  function syncSetRings() {
    if (!setLayer) {
      console.warn('[as-you-go] syncSetRings called with no set layer');
      return;
    }
    const wanted = new Set();
    for (const itemSet of (state.view?.itemSets ?? [])) {
      const members = membersOnScreen(itemSet.id);
      // A set with nothing on screen has no ring to draw; it still exists in
      // the data and comes back when its members do.
      if (members.length === 0) continue;
      wanted.add(itemSet.id);

      const previous = setRings.get(itemSet.id)?.nodes ?? [];
      const ring = reconcileRing({ setId: itemSet.id, members, existing: previous });
      setRings.set(itemSet.id, ring);

      const existingShape = setShapes.get(itemSet.id);
      if (existingShape) {
        // Back before the fade finished. Clearing the flag both restores the
        // outline and tells the pending timer to leave it alone.
        if (existingShape.retiring) {
          existingShape.retiring = false;
          existingShape.path?.classList.remove('set-retiring');
          existingShape.glyphs?.classList.remove('set-retiring');
        }
      } else {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const glyphs = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-set-outline');
        glyphs.setAttribute('class', 'graph-set-glyphs');
        path.dataset.setId = itemSet.id;
        glyphs.dataset.setId = itemSet.id;
        setLayer.append(path);
        setLayer.append(glyphs);
        setShapes.set(itemSet.id, { setId: itemSet.id, path, glyphs, glyphLayoutKey: null });
      }
    }

    for (const [setId, shape] of setShapes) {
      if (wanted.has(setId)) continue;
      // Faded rather than cut. A set loses its ring whenever its members leave
      // the screen, and removing the path outright made the outline disappear
      // between two frames — indistinguishable, to the eye, from the set
      // popping. The CSS transition carries it out; the node is removed when
      // that finishes, so a set whose members come straight back reuses it.
      if (!shape.retiring) {
        shape.retiring = true;
        shape.path?.classList.add('set-retiring');
        shape.glyphs?.classList.add('set-retiring');
        setRings.delete(setId);
        window.setTimeout(() => {
          // Re-checked on landing. The members may have returned during the
          // fade and cleared the flag, or the layer may have been rebuilt
          // wholesale and this entry replaced — the identity check catches the
          // second, which a flag alone would not.
          if (setShapes.get(setId) !== shape || !shape.retiring) return;
          shape.path?.remove();
          shape.glyphs?.remove();
          setShapes.delete(setId);
      }, 200);
      }
    }

    const picking = setMembershipMode?.isActive() === true;
    const chosen = picking ? new Set(setMembershipMode.chosenSetIds()) : null;
    const partial = picking ? new Set(setMembershipMode.mixedSetIds()) : null;
    syncSetRegions({ picking, chosen, partial });
    setEffects.sync({
      selectedSetIds: session.selectedSets,
      regions: regionShapes,
      colorFor: regionColor,
      effectsLayer,
    });

    // One line per reconcile, so a set that exists in the data but never
    // reaches the screen can be told apart from one that was never created.
    // The three numbers are the three places it can go wrong: no sets stored,
    // sets stored but no members matched on screen, or members matched but no
    // ring built.
    const stored = (state.view?.itemSets ?? []).length;
    let ringNodes = 0;
    for (const ring of setRings.values()) ringNodes += ring.nodes.length;
    console.info(`[as-you-go] rings: ${stored} set(s) stored, ${setShapes.size} drawn, ${ringNodes} ring nodes`);
  }

  /** Which sets' rings enclose a point, smallest first.
   *
   * Tested against the ring nodes rather than the drawn path: the nodes are
   * where the physics put them and the path is drawn through them, so the two
   * agree by construction — there is no second geometry to fall out of step
   * with what is on screen.
   *
   * Smallest first so clicking inside a small set nested in a larger one picks
   * the small one, which is the set the click is most specifically about. */
  function setIdsAtPoint(point) {
    const hits = [];
    for (const [setId, ring] of setRings) {
      if (ring.nodes.length < 3) continue;
      if (!pointInRing(point, ring.nodes)) continue;
      hits.push({ setId, area: ringArea(ring.nodes) });
    }
    return hits.sort((a, b) => a.area - b.area).map((hit) => hit.setId);
  }

  /** Moves any of these items that ended up inside a set they do not belong to
   * back outside it, along the shortest path.
   *
   * Called when a drag is released, not while it runs. The ring cannot stop a
   * drag: a dragged node's position is set outright rather than nudged, so
   * collision has nothing to push back against, and stiffening the boundary
   * enough to try made the whole set convulse while foreign items still got in.
   * Letting the gesture do whatever it likes and correcting afterwards means
   * the screen the user is left looking at states the true relationship.
   *
   * Members are exempt: an item inside its own set is where it should be. A
   * folder's contents inherit its sets, so belongsToSet decides this rather
   * than the stored member list. */
  function ejectTrespassers(itemIds) {
    // Every visible node by default, not only the ones just dragged. An item
    // can end up inside a set it does not belong to without being touched —
    // the ring moves when its members do, and expanding a folder drops new
    // tiles wherever the layout puts them. Checking only the drag left those
    // sitting inside with nothing to correct them.
    const candidates = itemIds ?? [...nodes.keys()];
    for (const itemId of candidates) {
      const node = nodes.get(itemId);
      if (!node || node.exiting) continue;
      // Trail bodies are outside the set system entirely. They are not
      // members, but they are not trespassers either — ejecting them would
      // still be a set acting on the trail, and it would shove a navigation
      // or trail-revealed body across the canvas for being near a ring it
      // has nothing to do with.
      if (node.candidate?.trail) continue;

      for (const [setId, ring] of setRings) {
        if (ring.nodes.length < 3) continue;
        const itemSet = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId);
        if (!itemSet) continue;
        if (belongsToSet(itemSet, itemId, ancestorsOfNode)) continue;

        const target = ejectionTarget({ x: node.x, y: node.y }, ring.nodes);
        if (!target) continue;
        node.x = target.x;
        node.y = target.y;
        // The pinned coordinates too, or the next tick puts it straight back
        // where it was — a drag leaves fx/fy set, and they win over x/y.
        if (node.fx != null) node.fx = target.x;
        if (node.fy != null) node.fy = target.y;
      }
    }
  }

  /** Ray casting against the ring's hull — the shape actually on screen.
   *
   * This walked the chain in ringIndex order, which assumed the loop stays
   * ordered. It does not: RING-TANGLE.md measured neighbours 317 degrees apart
   * after a drag, and a ray cast over a crossed loop reports points plainly
   * inside the outline as outside, silently.
   *
   * A click has to select what the user pointed at, so this must read the same
   * hull that drawSetRings draws. */
  function pointInRing(point, nodes) {
    const ring = ringHull(nodes);
    if (ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i];
      const b = ring[j];
      if ((a.y > point.y) === (b.y > point.y)) continue;
      const crossX = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < crossX) inside = !inside;
    }
    return inside;
  }

  /** Shoelace area of the hull, used only to order overlapping hits.
   *
   * Same reason as pointInRing: the formula sums signed trapezoids around a
   * loop, so a reordered node list gives a number that is not the area of
   * anything and nested sets get ranked wrongly. The hull is also the area the
   * user perceives, which is what "smallest first where they nest" means. */
  function ringArea(nodes) {
    const ring = ringHull(nodes);
    let total = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      total += (ring[j].x * ring[i].y) - (ring[i].x * ring[j].y);
    }
    return Math.abs(total) / 2;
  }

  /** Redraws each outline through its ring nodes' current positions.
   *
   * Cheap enough for every frame — it reads positions and builds a path string,
   * with no sampling, routing or contour extraction. That is the whole point of
   * the ring: the expensive part is the simulation, which was already running.
   */
  function drawSetRings() {
    // Read once per frame rather than per set: while the picker is open these
    // are the same for every outline, and they are what makes the canvas the
    // picker rather than a list.
    const picking = setMembershipMode?.isActive() === true;
    const chosen = picking ? new Set(setMembershipMode.chosenSetIds()) : null;
    const partial = picking ? new Set(setMembershipMode.mixedSetIds()) : null;
    for (const [setId, shape] of setShapes) {
      const ring = setRings.get(setId);

      // The outline is eased towards the physics rather than snapped to it, and
      // held open to a floor area. Recomputing the hull per frame is what made a
      // set able to shrivel or blink out between frames when its ring collapsed
      // or briefly degenerated; the drawn shape is its own state, so it settles
      // instead of popping. A null target leaves the last good shape standing.
      // The floor is the members' own tiles, so the outline can never shrink
      // inside the items it is drawn around. Read live rather than cached: the
      // members are what the floor is made of, and they move every frame.
      // 40 matches reconcileRing's and forceRingShape's padding default, which
      // is the gap the ring settles at: the floor has to agree with where the
      // physics is already trying to hold the boundary, or the two fight.
      const floor = ring ? memberFloorHull(membersOnScreen(setId), 40) : null;
      const target = ring ? floorOutline(resampleHull(ringHull(ring.nodes)), floor) : null;
      shape.outline = easeOutline(shape.outline, target);
      const outlinePath = shape.outline ? ringPath(shape.outline, { hulled: true }) : '';
      if (shape.lastPathD !== outlinePath) {
        shape.lastPathD = outlinePath;
        shape.path.setAttribute('d', outlinePath);
      }
      const title = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId)?.title?.trim() ?? '';
      const named = title.length > 0 && Array.isArray(shape.outline);
      shape.path.classList.toggle('set-named', named);
      shape.glyphs?.classList.toggle('set-named', named);
      // The outline is live while a ring moves, so every coordinate belongs in
      // the key: caching a partial geometry key would visibly detach lettering
      // from its body. Once the eased outline and title are unchanged, settled
      // frames reuse the exact decorative path instead of rebuilding it.
      const glyphLayoutKey = named
        ? `${title}|${shape.outline.map(({ x, y }) => `${x},${y}`).join('|')}`
        : '';
      if (shape.glyphLayoutKey !== glyphLayoutKey) {
        shape.glyphs?.setAttribute('d', named ? glyphPath(layoutTitleGlyphs(shape.outline, title)) : '');
        shape.glyphLayoutKey = glyphLayoutKey;
      }
      shape.path.classList.toggle('set-selected', session.selectedSets?.has(setId) === true);
      shape.path.classList.toggle('set-picking', picking);
      shape.path.classList.toggle('set-chosen', picking && chosen.has(setId));
      // Neither in nor out: Enter leaves a partial set exactly as it is, so it
      // must not read as either.
      shape.path.classList.toggle('set-partial', picking && partial.has(setId));
      shape.glyphs?.classList.toggle('set-selected', session.selectedSets?.has(setId) === true);
      shape.glyphs?.classList.toggle('set-picking', picking);
      shape.glyphs?.classList.toggle('set-chosen', picking && chosen.has(setId));
      shape.glyphs?.classList.toggle('set-partial', picking && partial.has(setId));
    }
    syncSetRegions({ picking, chosen, partial });
    setEffects.sync({
      selectedSetIds: session.selectedSets,
      regions: regionShapes,
      colorFor: regionColor,
      effectsLayer,
    });
  }

  function syncSetRegions({ picking, chosen, partial }) {
    if (!regionLayer) return;
    const source = [...setShapes.values()]
      .filter((shape) => !shape.retiring && Array.isArray(shape.outline) && shape.outline.length >= 3)
      .map((shape) => ({ id: shape.setId, outline: shape.outline }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const regions = regionLayout.update(source);
    // Regions come back identity-stable while their component is unchanged, so
    // the centroid is computed once per rebuild rather than once per frame.
    for (const region of regions) {
      if (region.center === undefined) region.center = regionCentroid(region);
    }
    const wanted = new Set(regions.map(({ id }) => id));
    for (const region of regions) {
      let shape = regionShapes.get(region.id);
      if (!shape) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-set-region');
        path.setAttribute('fill-rule', 'nonzero');
        path.dataset.regionId = `region:${region.id}`;
        path.dataset.setIds = region.setIds.join('|');
        regionLayer.append(path);
        shape = { id: region.id, path, setIds: region.setIds, center: null };
        regionShapes.set(region.id, shape);
      }
      const d = regionPath(region);
      if (shape.path.getAttribute('d') !== d) shape.path.setAttribute('d', d);
      shape.setIds = region.setIds;
      shape.center = region.center;
      shape.path.dataset.setIds = region.setIds.join('|');
      const selected = region.setIds.some((setId) => session.selectedSets?.has(setId) === true);
      shape.path.classList.toggle('region-selected', selected);
      shape.path.classList.toggle('region-picking', picking);
      shape.path.classList.toggle('region-chosen', picking && region.setIds.some((setId) => chosen?.has(setId)));
      shape.path.classList.toggle('region-partial', picking && region.setIds.some((setId) => partial?.has(setId)));
    }
    for (const [id, shape] of regionShapes) {
      if (wanted.has(id)) continue;
      shape.path.remove();
      regionShapes.delete(id);
    }
  }

  function recordDragTrail(itemIds) {
    const points = (itemIds ?? [])
      .map((id) => nodes.get(id))
      .filter((node) => node && !node.exiting)
      .map((node) => ({ x: node.x, y: node.y }));
    dragTrail.record(points);
  }

  function buildCandidate(vi) {
    if (vi.kind === 'bin-origin') {
      // A ghost node standing in for a folder that isn't itself visible in
      // the current Bin walk — just a "this is where it came from" label,
      // not a real interactive item. The folder may since have been
      // deleted or renamed to nothing findable; fall back to a generic
      // label rather than dropping the edge entirely.
      const origin = group(vi.groupId);
      return {
        id: vi.id,
        kind: 'bin-origin',
        name: origin?.name ?? 'Elsewhere',
        parentId: null,
        parentIds: [],
        linked: false,
      };
    }
    const stored = vi.kind === 'shortcut'
      ? shortcutByRecordOrPlacementId(vi.id)
      : vi.kind === 'window-layout'
        ? windowLayout(vi.id)
        : (vi.id === ROOT_ID || vi.id === 'bin'
          // The two pseudo heads of the ancestor chain ("As you Go" and the
          // Bin) have no stored record — pathTo synthesises their names, and
          // this fallback lets them render and navigate like the folders
          // they stand for.
          ? { kind: 'group', name: vi.name ?? (vi.id === 'bin' ? 'Bin' : 'As you Go') }
          : group(vi.id));
    if (!stored) return null;
    return {
      ...stored,
      // The graph node's identity is always vi.id (a placement id for a
      // bin-mode shortcut tile, the shared record id everywhere else) —
      // never stored.id, which for a resolved-by-placement bin tile would
      // be the shared shortcut record id and corrupt every DOM/selection
      // lookup keyed off candidate.id (dataset.id, dataset.graphNodeId).
      id: vi.id,
      kind: vi.kind,
      parentId: vi.parentId,
      // Every folder this shortcut is currently placed in, per the visible
      // graph (used to decide whether Ctrl+X collapses everything into one
      // place or moves just the one placement this view represents).
      parentIds: vi.parentIds ?? [vi.parentId],
      // Whether the underlying shortcut has more than one active placement
      // anywhere at all (not just in this view) — drives the link marker
      // and the apply-everywhere-or-fork prompt on edit.
      linked: vi.kind === 'shortcut' ? placementCount(stored) > 1 : false,
      // Assignment 003: an ancestor of the current folder, prepended to
      // this view by collectVisible. Ordinary body in every way except:
      // --text outline, never selected, never deletable, never persisted.
      ancestor: vi.ancestor === true,
      // Assignment 005: the broader derived-branch provenance. Every
      // ancestor AND everything revealed beneath an expanded ancestor is a
      // trail item — outside the set system for this view, styled by the
      // Trail opacity slider. Expanded trail descendants are trail items,
      // not ancestors.
      trail: vi.trail === true,
      // Pure render metadata: breadcrumb ancestors and anything expanded from
      // one inherit that path node's depth scale. Ordinary workspace bodies
      // remain exactly 1.
      trailScale: Number.isFinite(vi.trailScale) ? vi.trailScale : 1,
      // A Proxima-bound project root keeps its green underlined label in
      // every view, scoped or full: the host names these groups
      // `group-proxima-<hash>`, so the boundary is recognizable without a
      // host round-trip. Scoped surfaces additionally land inside it.
      scopeRoot: Boolean(
        (SCOPE_ROOT_ID && vi.id === SCOPE_ROOT_ID)
        || (typeof vi.id === 'string' && vi.id.startsWith('group-proxima-')),
      ),
    };
  }

  function syncNodes(visibleItems) {
    const incoming = new Set(visibleItems.map((vi) => vi.id));
    for (const id of [...nodes.keys()]) {
      if (!incoming.has(id)) removeNode(id);
    }
    // Seed-position buckets. The head of the ancestor chain has no parent, so
    // keying it by `parentId ?? ROOT_ID` used to drop it in with every real
    // top-level item — and seedPosition's parentless ring grows with the
    // bucket's size (RADIUS * 2.4 * total/4), so in a crowded folder the trail
    // head seeded past the viewport edge and appeared to land off screen.
    // Giving the chain its own bucket makes its seed independent of how many
    // items happen to share the view.
    const TRAIL_SEED_BUCKET = 'ancestor-chain:seed-bucket';
    const seedBucketKey = (vi) => (vi.ancestor ? TRAIL_SEED_BUCKET : (vi.parentId ?? ROOT_ID));
    const byParent = new Map();
    for (const vi of visibleItems) {
      const key = seedBucketKey(vi);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(vi);
    }
    const ctxId = (typeof SCOPE_ROOT_ID !== 'undefined' && SCOPE_ROOT_ID
      && !session.binMode && session.currentId === ROOT_ID)
      ? SCOPE_ROOT_ID
      : graphContextId(session.currentId, session.binMode);
    for (const vi of visibleItems) {
      const parentIds = vi.parentIds ?? [vi.parentId];
      let node = nodes.get(vi.id);
      if (node) {
        if (node.exitTimer) {
          clearTimeout(node.exitTimer);
          node.exitTimer = null;
          node.exiting = false;
          if (node.shell) {
            node.shell.classList.remove('exiting');
            node.shell.style.opacity = '';
            node.shell.style.scale = '';
          }
        }
        node.candidate = buildCandidate(vi);
        node.parentIds = parentIds;
        node.depth = vi.depth;
        node.visualScale = node.candidate?.trailScale ?? 1;
        refreshNodeContent(node);
        continue;
      }
      const candidate = buildCandidate(vi);
      if (!candidate) continue;
      const firstParentId = parentIds[0];
      const parent = firstParentId && firstParentId !== ROOT_ID && firstParentId !== 'bin'
        ? nodes.get(firstParentId)
        : null;
      const siblings = byParent.get(seedBucketKey(vi)) ?? [];
      const index = Math.max(0, siblings.findIndex((s) => s.id === vi.id));
      const originX = viewport ? viewport.clientWidth / 2 : 400;
      const originY = viewport ? viewport.clientHeight / 2 : 300;
      // Ancestors never read a stored position. Their ids collide with real
      // records — 'root' and 'bin' have saved coordinates from before the
      // trail existed, several of them negative (off the left edge) — and a
      // saved position is applied as fx/fy, which PINS the node so the solver
      // can never pull it back into view. That is why the trail sometimes
      // appeared stuck off screen. Ancestors are derived from the path, not
      // creator-placed, so they always seed fresh and float.
      const saved = vi.ancestor ? null : getGraphPosition(state, ctxId, vi.id);
      // Where this node last came to rest, if it is not pinned. Applied to x/y
      // only — never to fx/fy — so the node still floats and every force still
      // moves it. Without this an unpinned node seeds onto a generic ring and
      // the solver settles it somewhere new on every open, which rearranges a
      // workspace the creator had learned the shape of.
      const remembered = (saved || vi.ancestor) ? null : getGraphRestPosition(state, ctxId, vi.id);
      const seed = remembered ?? seedPosition(vi.id, parent, index, siblings.length, originX, originY);
      node = {
        id: vi.id,
        candidate,
        depth: vi.depth,
        visualScale: candidate.trailScale ?? 1,
        x: saved ? saved.x : seed.x,
        y: saved ? saved.y : seed.y,
        fx: saved ? saved.x : null,
        fy: saved ? saved.y : null,
        vx: 0,
        vy: 0,
        width: 0,
        height: 0,
        parentIds,
        parentNode: parent ?? null,
        shell: null,
        exiting: false,
        exitTimer: null,
        positioned: Boolean(saved),
      };
      nodes.set(vi.id, node);
      createNodeShell(node);
    }
  }

  /** Frames a folder's icon square with its assigned color; non-folders are
   * left plain. The color is exposed as --folder-color and styled in CSS so
   * it wraps only the icon graphic, not the tile's text. An ancestor of the
   * current folder wears the --text outline instead of a hue — the existing
   * folder-colored rule draws both the ring and its color-mix fill; nothing
   * else about the tile changes. */
  function applyFolderColor(iconItem, candidate) {
    if (candidate.ancestor) {
      iconItem.classList.add('folder-colored');
      iconItem.style.setProperty('--folder-color', 'var(--text)');
      return;
    }
    const color = candidate.kind === 'group' ? folderColor(candidate.id) : null;
    iconItem.classList.toggle('folder-colored', Boolean(color));
    if (color) iconItem.style.setProperty('--folder-color', color);
    else iconItem.style.removeProperty('--folder-color');
  }

  /** Recomputes folder hues from their current canvas positions (so colors
   * follow dragging and relative distance), then re-applies only the shells
   * and edges whose color actually changed. Ancestor bodies are excluded:
   * they wear the --text outline instead of a hue, and joining the near-pair
   * projection would perturb the real folders' hue assignment. */
  function syncFolderColors() {
    const folderNodes = [...nodes.values()].filter(
      (node) => !node.exiting && node.shell && node.candidate?.kind === 'group'
        && !node.candidate.ancestor,
    );
    const center = {
      cx: (viewport?.clientWidth ?? 800) / 2,
      cy: (viewport?.clientHeight ?? 600) / 2,
    };
    const spatialNodes = [
      ...folderNodes.map((node) => ({ id: `folder:${node.id}`, x: node.x, y: node.y })),
      ...[...setShapes.values()]
        .filter((shape) => !shape.retiring)
        .map((shape) => {
          const point = outlineCentroid(shape.outline);
          return point ? { id: `set:${shape.setId}`, ...point } : null;
        })
        .filter(Boolean),
      ...[...regionShapes.values()]
        .filter((shape) => shape.center)
        .map((shape) => ({ id: `region:${shape.id}`, ...shape.center })),
    ];
    assignSpatialFolderHues(
      spatialNodes,
      spatialColors,
      center,
      spatialHueState,
    );
    for (const node of folderNodes) {
      const hue = spatialColors.get(`folder:${node.id}`);
      if (node.appliedFolderHue === hue) continue;
      node.appliedFolderHue = hue;
      const iconItem = node.shell.querySelector('.icon-item');
      if (iconItem) applyFolderColor(iconItem, node.candidate);
    }
    edges.forEach((edge) => {
      const source = nodes.get(edge.sourceId);
      if (!source || source.candidate?.kind !== 'group' || source.candidate?.ancestor || !edge.path) return;
      const stroke = folderColor(source.candidate.id) ?? '';
      if (edge.appliedStroke === stroke) return;
      edge.appliedStroke = stroke;
      edge.path.style.stroke = stroke;
    });
    for (const shape of setShapes.values()) {
      const color = setColor(shape.setId);
      if (color) {
        shape.path.style.setProperty('--set-color', color);
        shape.glyphs?.style.setProperty('--set-color', color);
      }
    }
    for (const shape of regionShapes.values()) {
      const color = regionColor(shape.id);
      if (color) shape.path.style.setProperty('--region-color', color);
    }
  }

  /** 035: the attached window-layout shell takes the layout's persisted shared
   * card width (the detached widget's latest window content width) so attached
   * and detached cards are 1:1. No persisted width -> the CSS default. */
  function applyWindowLayoutShellWidth(shell, candidate) {
    if (candidate.kind !== 'window-layout') return;
    const raw = candidate.cardSize?.width;
    // 037: the attached host footprint is the CARD's client width, capped at
    // the shared compact presentation maximum - never a larger empty host
    // footprint (a legacy over-max persisted value cannot stretch the node).
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
      const width = Math.min(raw, WINDOW_LAYOUT_CARD_MAX_WIDTH);
      shell.style.setProperty('--wl-card-width', `${Math.round(width)}px`);
    } else {
      shell.style.removeProperty('--wl-card-width');
    }
  }

  function refreshNodeContent(node) {
    if (!node.shell) return;
    const candidate = node.candidate;
    if (!candidate) return;
    const iconItem = node.shell.querySelector('.icon-item');
    if (!iconItem) return;
    applyFolderColor(iconItem, candidate);
    const isGhost = candidate.kind === 'bin-origin';
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && (candidate.trail
      ? session.trailExpanded.has(candidate.id)
      : session.graphExpanded.has(candidate.id));
    const isSelected = !isGhost && session.selected.has(candidate.id);
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (session.binMode ? 'bin' : session.currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.classList.toggle('selected', isSelected);
    iconItem.classList.toggle('bin-origin-ghost', isGhost);
    iconItem.classList.toggle('ancestor-item', candidate.ancestor === true);
    iconItem.classList.toggle('trail-item', candidate.trail === true);
    iconItem.classList.toggle('scope-root-item', candidate.scopeRoot === true);
    node.shell.classList.toggle('bin-origin-ghost', isGhost);
    // 035: the shared card width updates whenever it changes, even when the
    // inner HTML is otherwise unchanged.
    applyWindowLayoutShellWidth(node.shell, candidate);
    // 018V7R3: the window-layout signature includes the bounded presentation
    // mode so the cached inert read-only HTML is not reused for the writable
    // view (the Detach control must appear after the unlock render). 035: the
    // detached-widget placeholder state + persisted width also change the
    // signature so the node re-renders when a widget opens/closes or resizes.
    const windowLayoutMode = windowLayoutPresentationMode({
      isReadOnly: windowLayoutDetachment.isReadOnly(),
      mode: windowLayoutDetachment.getState().mode,
    });
    const signature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      candidate.linked ?? false,
      candidate.scopeRoot ?? false,
      isExpanded,
      session.binMode,
      state.view.iconSize,
      candidate.kind === 'window-layout'
        ? `${windowLayoutContentSignature(candidate, windowLayoutMode)}|d:${detachedWidgets.has(candidate.id)}|w:${candidate.cardSize?.width ?? 0}`
        : 0,
    ]);
    if (node.contentSignature !== signature) {
      removeWindowLayoutCardPresentation(iconItem);
      node.contentSignature = signature;
      iconItem.innerHTML =
        `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}${candidate.scopeRoot === true ? ' scope-expander' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">${candidate.scopeRoot === true ? '★' : '›'}</button>` : ''}`
        + `${linkMarkup(candidate)}`
        + (candidate.kind === 'window-layout'
          ? windowLayoutCardMarkup(candidate, { detached: detachedWidgets.has(candidate.id) })
          : `${iconItemMarkup(candidate)}<strong>${escapeHtml(candidate.name)}</strong>${descriptionMarkup(candidate)}`);
      hydrateNodeIcons(node.shell);
      installWindowLayoutCardPresentation(iconItem);
    }
    const visualScale = node.visualScale ?? 1;
    node.width = (node.shell.offsetWidth || (state.view.iconSize + 42)) * visualScale;
    node.height = (node.shell.offsetHeight || (state.view.iconSize + 64)) * visualScale;
  }

  function createNodeShell(node) {
    const candidate = node.candidate;
    if (!candidate) return;
    const isGhost = candidate.kind === 'bin-origin';
    const isSelected = !isGhost && session.selected.has(candidate.id);
    const canExpand = candidate.kind === 'group';
    const isExpanded = canExpand && (candidate.trail
      ? session.trailExpanded.has(candidate.id)
      : session.graphExpanded.has(candidate.id));

    const shell = document.createElement('div');
    shell.className = `graph-node-shell${isGhost ? ' bin-origin-ghost' : ''}${candidate.kind === 'window-layout' ? ' window-layout-shell' : ''}`;
    shell.dataset.graphNodeId = candidate.id;
    shell.style.transform = `translate3d(${node.x}px, ${node.y}px, 0) translate(-50%, -50%) scale(${node.visualScale ?? 1})`;

    const iconItem = document.createElement('div');
    iconItem.className = `icon-item${isSelected ? ' selected' : ''}${isGhost ? ' bin-origin-ghost' : ''}${candidate.ancestor ? ' ancestor-item' : ''}${candidate.trail ? ' trail-item' : ''}${candidate.scopeRoot ? ' scope-root-item' : ''}`;
    applyFolderColor(iconItem, candidate);
    iconItem.dataset.id = candidate.id;
    const semanticKey = isGhost ? null : semanticKeyForItem(candidate);
    if (semanticKey) iconItem.setAttribute('data-papers-visual-key', semanticKey);
    else iconItem.removeAttribute('data-papers-visual-key');
    iconItem.dataset.kind = candidate.kind;
    iconItem.dataset.parent = candidate.parentId ?? (session.binMode ? 'bin' : session.currentId);
    iconItem.setAttribute('draggable', 'false');
    iconItem.setAttribute('role', isGhost ? 'presentation' : 'option');
    iconItem.setAttribute('aria-selected', String(isSelected));
    iconItem.setAttribute('tabindex', '-1');
    iconItem.setAttribute('aria-label', `${candidate.ancestor ? 'Go to ' : ''}${escapeHtml(candidate.name)}`);
    iconItem.innerHTML =
      `${canExpand ? `<button class="folder-expander ${isExpanded ? 'expanded' : ''}${candidate.scopeRoot === true ? ' scope-expander' : ''}" data-expand="${candidate.id}" type="button" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${escapeHtml(candidate.name)}">${candidate.scopeRoot === true ? '★' : '›'}</button>` : ''}`
      + `${linkMarkup(candidate)}`
      + (candidate.kind === 'window-layout'
        ? windowLayoutCardMarkup(candidate, { detached: detachedWidgets.has(candidate.id) })
        : `${iconItemMarkup(candidate)}<strong>${escapeHtml(candidate.name)}</strong>${descriptionMarkup(candidate)}`);

    shell.append(iconItem);
    nodeLayer.append(shell);
    node.shell = shell;
    installWindowLayoutCardPresentation(iconItem);
    // 035: the shell takes the layout's persisted shared card width so the
    // initial node width/height measure the real footprint.
    applyWindowLayoutShellWidth(shell, candidate);

    // 018V7R3: the initial signature includes the bounded presentation mode so
    // the create and refresh signatures agree with the body markup. 035: the
    // detached-widget placeholder state + persisted width are included too.
    const windowLayoutMode = windowLayoutPresentationMode({
      isReadOnly: windowLayoutDetachment.isReadOnly(),
      mode: windowLayoutDetachment.getState().mode,
    });
    node.contentSignature = JSON.stringify([
      candidate.kind,
      candidate.name,
      candidate.description ?? '',
      candidate.target ?? '',
      candidate.icon ?? null,
      candidate.linked ?? false,
      candidate.scopeRoot ?? false,
      isExpanded,
      session.binMode,
      state.view.iconSize,
      candidate.kind === 'window-layout'
        ? `${windowLayoutContentSignature(candidate, windowLayoutMode)}|d:${detachedWidgets.has(candidate.id)}|w:${candidate.cardSize?.width ?? 0}`
        : 0,
    ]);

    const visualScale = node.visualScale ?? 1;
    node.width = (shell.offsetWidth || (state.view.iconSize + 42)) * visualScale;
    node.height = (shell.offsetHeight || (state.view.iconSize + 64)) * visualScale;

    if (reducedMotion?.matches) {
      shell.style.opacity = '1';
    } else {
      shell.style.opacity = '0';
      shell.style.scale = '0.7';
      requestAnimationFrame(() => {
        if (node.shell) {
          shell.style.opacity = '1';
          shell.style.scale = '1';
        }
      });
    }
  }

  function removeNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    if (reducedMotion?.matches || node.exiting) {
      node.shell?.remove();
      nodes.delete(id);
      return;
    }
    node.exiting = true;
    const parent = node.parentNode;
    const targetX = parent ? parent.x : node.x;
    const targetY = parent ? parent.y : node.y;
    if (node.shell) {
      node.shell.classList.add('exiting');
      node.shell.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%) scale(${node.visualScale ?? 1})`;
      node.shell.style.opacity = '0';
      node.shell.style.scale = '0.5';
    }
    node.exitTimer = setTimeout(() => {
      node.shell?.remove();
      nodes.delete(id);
      node.exitTimer = null;
    }, 200);
  }

  function syncEdges(visibleItems) {
    if (!edgeLayer) return;
    const wanted = new Map();
    for (const edge of graphEdges(visibleItems)) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target || source.exiting || target.exiting) continue;
      wanted.set(edge.id, { sourceId: edge.source, targetId: edge.target });
    }
    for (const [key, edge] of edges) {
      if (!wanted.has(key)) {
        edge.path?.remove();
        edges.delete(key);
      }
    }
    for (const [key, info] of wanted) {
      let edge = edges.get(key);
      const source = nodes.get(info.sourceId);
      const target = nodes.get(info.targetId);
      if (!source || !target) continue;
      // Edge stroke colors are owned by syncFolderColors, which recomputes them
      // from folder positions each frame.
      if (!edge) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-edge');
        const d = edgePath(source.x, source.y, target.x, target.y);
        path.setAttribute('d', d);
        edgeLayer.append(path);
        edge = { key, sourceId: info.sourceId, targetId: info.targetId, path, lastPathD: d };
        edges.set(key, edge);
      }
    }
  }

  /** Draws the "where did this come from" edges for binned tiles (see
   * binOriginEdges) — kept in a separate map/CSS class from the normal
   * graph-edge set above, since these connect to a possibly-ghost node
   * and are always styled distinctly (red) rather than the default gray. */
  function syncOriginEdges(edgeList) {
    if (!edgeLayer) return;
    const wanted = new Map();
    for (const edge of edgeList) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (!source || !target || source.exiting || target.exiting) continue;
      wanted.set(edge.id, { sourceId: edge.source, targetId: edge.target });
    }
    for (const [key, edge] of originEdges) {
      if (!wanted.has(key)) {
        edge.path?.remove();
        originEdges.delete(key);
      }
    }
    for (const [key, info] of wanted) {
      let edge = originEdges.get(key);
      const source = nodes.get(info.sourceId);
      const target = nodes.get(info.targetId);
      if (!source || !target) continue;
      if (!edge) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'graph-edge bin-origin-edge');
        const d = edgePath(source.x, source.y, target.x, target.y);
        path.setAttribute('d', d);
        edgeLayer.append(path);
        edge = { key, sourceId: info.sourceId, targetId: info.targetId, path, lastPathD: d };
        originEdges.set(key, edge);
      }
    }
  }

  function ensureSimulation() {
    if (simulation) return;
    const w = viewport?.clientWidth || 800;
    const h = viewport?.clientHeight || 600;
    simulation = forceSimulation()
      .force('cx', forceX(w / 2).strength((node) => (
        node.ring ? 0.05 : branchCenterGravityStrength(node)
      )))
      .force('cy', forceY(h / 2).strength((node) => (
        node.ring ? 0.05 : branchCenterGravityStrength(node)
      )))
      // Ring nodes do not repel. Hundreds of them each pushing on everything
      // would both swamp the layout the icons make between themselves and pay
      // the charge cost for nodes whose position is already decided by their
      // links and the shape force.
      .force('charge', forceManyBody().strength((n) => (n.ring ? 0 : -280)))
      .force('collide', forceCollide()
        .radius((n) => (n.ring ? RING_NODE_RADIUS : Math.max(n.width, n.height) / 2 + 20))
        .strength(0.9))
      // Ring links are short and stiff: the boundary has to hold its spacing
      // against the icons pushing on it, where the graph's own links are long
      // and slack so the layout can breathe.
      .force('link', forceLink()
        .id((n) => n.id)
        .distance((link) => (link.source.ring ? RING_LINK_DISTANCE : branchLinkDistance(link)))
        .strength((link) => (link.source.ring ? 0.9 : branchLinkStrength(link))))
      // A maximal non-branching path may not fold through itself. Its closest
      // monotone projection is approached with a capped velocity; sibling
      // paths and ordinary item bodies remain completely uninvolved.
      .force('branchUncross', forceBranchUncross())
      // Holds each ring around its own members rather than letting it drift.
      //
      // The alpha floor inside it is gated on a drag being in progress. It
      // refuses to cool, which is what keeps a ring with its member during a
      // drag, but d3 cools everything else — so on a settled scene it was the
      // only force still injecting velocity, driving icons through the ring
      // nodes' collision and chasing them as they moved. Measured: two disjoint
      // sets stretched without bound and their outlines crossed.
      .force('ring', forceRingShape({
        membersOf: membersOnScreen,
        // Same test the other two set forces use for a held node, asked across
        // the whole graph rather than about one id.
        isDragging: () => {
          for (const node of nodes.values()) if (node.fx != null) return true;
          return false;
        },
      }))
      // Gathers a set's members towards each other. Without it they sprawl
      // wherever the graph's own layout puts them, and a boundary drawn round
      // a sprawl is mostly empty space with bystanders sitting in it — the ring
      // then has no way to exclude anything, because a point between two
      // members is interior however the outline is drawn. Measured on a
      // six-member set: without gravity only 4 of 6 members were inside their
      // own ring and 2 foreign items were; with it, 6 of 6 and none.
      .force('setGravity', forceSetGravity({
        setsOf: (nodeId) => setIdsContaining(nodeId),
        isHeld: (nodeId) => nodes.get(nodeId)?.fx != null,
      }))
      // Keeps unrelated sets from drawing through each other. Nothing else
      // acts between two sets: ring nodes carry zero charge, and collision only
      // separates node from node at 60px, which two rings can satisfy while the
      // curves drawn through them still cross. Sets sharing a member are exempt,
      // so the Venn that gravity builds is left alone.
      .force('setSeparation', forceSetSeparation({
        setsOf: (nodeId) => setIdsContaining(nodeId),
        // The shape actually on screen, so the force parts what the creator
        // sees rather than a proxy for it — the same rule drawing and
        // hit-testing already follow. shape.outline is the eased, resampled,
        // member-floored outline drawSetRings last put on screen; recomputing
        // the hull from physics nodes would read a different shape. A null
        // outline (not yet drawn, or retired) is a safe no-op: the node pass
        // above covers the ring until a visible outline exists.
        hullOf: (setId) => setShapes.get(setId)?.outline ?? null,
        // A set whose member is under the pointer is anchored: it takes no
        // separation impulse, and the other set absorbs the whole response.
        isHeld: (nodeId) => nodes.get(nodeId)?.fx != null,
      }))
      // And pushes non-members back out of a set they have wandered into. The
      // outline cannot do this alone: it can only exclude what lies outside the
      // region its members occupy, so the layout has to express membership too.
      .force('setExclusion', forceSetExclusion({
        setsOf: (nodeId) => setIdsContaining(nodeId),
        membersOf: membersOnScreen,
        // The visible outline, so the force and the drawn shape agree on who is
        // inside — the same source separation uses. Proximity to a member is a
        // proxy for that and disagrees with it in open space within the
        // boundary, which is where foreign items leaked. A null outline (not
        // yet drawn, or retired) is a safe no-op: the set contributes nothing
        // until its visible outline exists.
        hullOf: (setId) => setShapes.get(setId)?.outline ?? null,
        isHeld: (nodeId) => nodes.get(nodeId)?.fx != null,
      }))
      .alphaDecay(0.028)
      .velocityDecay(0.32);
    simulation.on('tick', () => {
      scheduleRender();
      scheduleRestPositionSave();
    });
  }

  // Remembering where unpinned nodes rest. Throttled, NOT debounced: the
  // simulation never truly stops ticking — sets keep nudging each other — so a
  // debounce that waits for quiet waits forever and nothing is ever written.
  // This fires at most once an interval while the layout is live, which keeps
  // the durable snapshot from being rewritten every frame while still recording
  // where things ended up.
  let restSaveTimer = null;
  const lastSavedRest = new Map();
  const REST_SAVE_INTERVAL_MS = 1500;
  // Below this a node has not meaningfully moved, and rewriting it would churn
  // the snapshot over sub-pixel drift.
  const REST_SAVE_MIN_SHIFT = 4;

  function scheduleRestPositionSave() {
    if (!onRestPositions || restSaveTimer) return;
    restSaveTimer = setTimeout(() => {
      restSaveTimer = null;
      saveRestPositions();
    }, REST_SAVE_INTERVAL_MS);
  }

  function saveRestPositions() {
    if (!onRestPositions) return;
    const updates = {};
    let changed = false;
    for (const node of nodes.values()) {
      // Pinned nodes already persist through graphPositions; ring nodes and
      // ancestors are derived rather than placed, and a node on its way out
      // should not leave a resting place behind.
      if (node.exiting || node.ring || node.fx != null) continue;
      if (isTrailNode(node.id)) continue;
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const previous = lastSavedRest.get(node.id);
      if (previous && Math.hypot(node.x - previous.x, node.y - previous.y) < REST_SAVE_MIN_SHIFT) continue;
      updates[node.id] = { x: node.x, y: node.y };
      changed = true;
    }
    if (!changed) return;
    for (const [id, pos] of Object.entries(updates)) lastSavedRest.set(id, pos);
    onRestPositions(updates);
  }
  function syncSimulation() {
    ensureSimulation();
    syncSetRings();
    const nodeArray = [...nodes.values()].filter((n) => !n.exiting);
    // Ring nodes are ordinary simulation nodes. That is the whole design: they
    // collide with icons, so a member cannot leave its set and an outsider
    // cannot get in, and the outline dents and stretches because the same
    // forces act on it as on everything else. Nothing about containment is
    // enforced separately.
    const edgeArray = [];
    const hierarchyEdgeArray = [];
    edges.forEach((edge) => {
      const link = { source: edge.sourceId, target: edge.targetId };
      edgeArray.push(link);
      hierarchyEdgeArray.push(link);
    });
    originEdges.forEach((edge) => {
      edgeArray.push({ source: edge.sourceId, target: edge.targetId });
    });
    // The links closing each ring into a loop, which is what stops the boundary
    // opening up under load.
    for (const ring of setRings.values()) edgeArray.push(...ring.links);

    // ForceX/ForceY cache their per-node strengths when simulation.nodes() is
    // called. Compute branch rigidity first so the cached gravity coefficient
    // already reflects the current expansion depth on this very tick.
    assignBranchRigidity(nodeArray, hierarchyEdgeArray);
    for (const ring of setRings.values()) nodeArray.push(...ring.nodes);
    simulation.nodes(nodeArray);

    simulation.force('link').links(edgeArray);
    simulation.force('branchUncross').links(hierarchyEdgeArray);
    // Ring nodes are small, so they pack tightly along the boundary instead of
    // being held a whole icon apart by the padding icons need.
    simulation.force('collide').radius((n) => (n.ring
      ? RING_NODE_RADIUS
      : Math.max(n.width, n.height) / 2 + 20));
    const w = viewport?.clientWidth || 800;
    const h = viewport?.clientHeight || 600;
    simulation.force('cx').x(w / 2);
    simulation.force('cy').y(h / 2);
  }

  function reheat(level = 0.35) {
    if (!simulation) return;
    simulation.alpha(Math.max(simulation.alpha(), level)).restart();
  }

  function fitGraph(padding = 90) {
    if (!camera || !viewport || !viewportSelection || nodes.size === 0) return false;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w < 2 || h < 2) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let activeCount = 0;
    nodes.forEach((n) => {
      if (n.exiting) return;
      activeCount += 1;
      const halfW = (n.width || 100) / 2;
      const halfH = (n.height || 120) / 2;
      minX = Math.min(minX, n.x - halfW);
      minY = Math.min(minY, n.y - halfH);
      maxX = Math.max(maxX, n.x + halfW);
      maxY = Math.max(maxY, n.y + halfH);
    });
    if (!Number.isFinite(minX) || activeCount === 0) return false;
    const scale = Math.min(
      (w - padding * 2) / Math.max(1, maxX - minX),
      (h - padding * 2) / Math.max(1, maxY - minY),
      2,
    );
    const k = Math.max(0.35, Math.min(3, scale));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = w / 2 - cx * k;
    const ty = h / 2 - cy * k;
    const transform = zoomIdentity.translate(tx, ty).scale(k);
    // 043: the vendored d3-selection.js selection (what `select(viewport)`
    // returns) has NO transition() method — the transition machinery is only
    // bundled inside d3-zoom.js against its private selection copy, so the
    // previous animated branch always threw `viewportSelection.transition is
    // not a function` on normal first render. Apply the transform directly
    // (the same zoomBehavior.transform the old non-animated branch used) so
    // the initial fit works for every renderer.
    zoomBehavior.transform(viewportSelection, transform);
    return true;
  }

  function updateGraphView(initialFit = false) {
    const w = viewport?.clientWidth ?? 0;
    const h = viewport?.clientHeight ?? 0;
    if (w < 2 || h < 2) {
      updatePending = true;
      pendingInitialFit = initialFit;
      return;
    }
    updatePending = false;
    // Assignment 007: trail expansion is remembered per view context and is
    // fully independent of ordinary expansion. The active set for THIS view
    // is synced into the session here — one place, every render — so the
    // chevrons and the walk below read one source.
    const trailExpanded = new Set(
      state.view?.trailExpandedByContext?.[currentTrailContextKey()] ?? [],
    );
    store.setTrailExpanded([...trailExpanded]);
    const visible = visibleGraphItems(
      state,
      // Navigating to the root via an ancestor tile sets currentId to null
      // (the store's own "no folder" value), but items at the top level are
      // stored under ROOT_ID — collectVisible finds nothing for null and the
      // whole workspace renders empty. Normalise here so both spellings of
      // "the root" resolve to the same folder.
      session.currentId ?? ROOT_ID,
      session.graphExpanded,
      session.binMode,
      session.binCurrentId,
      // Assignment 003: the ancestors of the current folder join its item
      // list as ordinary bodies. The chain is the path TO here, so the
      // current folder's own entry is sliced off — at root it is empty.
      state.view?.preferences?.parentGraphVisible !== false
        ? (session.binMode
          ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).slice(0, -1)
          : pathTo(session.currentId).slice(0, -1))
        : [],
      trailExpanded,
      {
        rootScale: getBreadcrumbRootScale(state.view?.preferences),
        middleScale: getBreadcrumbMiddleScale(state.view?.preferences),
      },
    );
    if (visible.length === 0) {
      lastGraphLayoutKey = null;
      nodes.forEach((_, id) => removeNode(id));
      syncEdges([]);
      syncOriginEdges([]);
      // Nothing on screen means no members, so every ring goes too. Without
      // this the previous view's outlines would stay drawn over an empty graph.
      syncSetRings();
      return;
    }
    const originEdges = session.binMode ? binOriginEdges(visible) : [];
    const ghostIds = new Set(originEdges.filter((e) => e.ghost).map((e) => e.ghostGroupId));
    const ghostItems = [...ghostIds].map((groupId, index) => ({
      id: `bin-origin:${groupId}`,
      parentId: null,
      kind: 'bin-origin',
      groupId,
      depth: 0,
      siblingIndex: index,
      siblingCount: ghostIds.size,
    }));
    syncNodes([...visible, ...ghostItems]);
    syncEdges(visible);
    syncOriginEdges(originEdges);
    syncSimulation();
    const contextId = (typeof SCOPE_ROOT_ID !== 'undefined' && SCOPE_ROOT_ID
      && !session.binMode && session.currentId === ROOT_ID)
      ? SCOPE_ROOT_ID
      : graphContextId(session.currentId, session.binMode);
    const layoutKey = JSON.stringify([
      contextId, session.binMode ? session.binCurrentId : null, w, h,
      visible.map((item) => {
        const node = nodes.get(item.id);
        return [item.id, item.kind, item.parentId, item.parentIds, item.depth,
          item.trailScale, node?.width, node?.height,
          getGraphPosition(state, contextId, item.id)];
      }),
      state.view?.itemSets ?? [],
    ]);
    if (layoutKey !== lastGraphLayoutKey) {
      reheat(initialFit ? 0.7 : 0.35);
      lastGraphLayoutKey = layoutKey;
    }
    if (initialFit && !initialized) {
      fitPending = true;
      setTimeout(() => {
        if (fitPending && fitGraph()) {
          fitPending = false;
          initialized = true;
        }
      }, 500);
    }
  }

  function refreshSelection() {
    nodes.forEach((node) => {
      if (!node.shell) return;
      const iconItem = node.shell.querySelector('.icon-item');
      if (!iconItem) return;
      const isSelected = session.selected.has(node.id);
      iconItem.classList.toggle('selected', isSelected);
      iconItem.setAttribute('aria-selected', String(isSelected));
    });
  }

  return {
    createGraphView,
    updateGraphView,
    destroyGraphView,
    refreshSelection,
    refreshEdgeOpacity: syncEdgeOpacity,
    reheat,
    fitGraph,
    ancestorsOfNode,
    setIdsAtPoint,
    setPathFor: (id) => setShapes.get(id)?.path ?? null,
    ejectTrespassers,
    recordDragTrail,
    clearDragTrail: () => dragTrail.clear(),
    get dragTrailCount() { return dragTrail.count; },
    _getNode: (id) => nodes.get(id) ?? null,
    _isTrailNode: (id) => isTrailNode(id),
    // Which sets a node belongs to, by the same inherited-membership rule the
    // ring is drawn from. Exposed so gestures can be scoped by set membership
    // rather than by whatever happens to be on screen.
    setIdsContaining: (id) => setIdsContaining(id),
    _setOnDragCancel(callback) { onDragCancel = callback; },
    _setOnRestPositions(callback) { onRestPositions = callback; },
    _saveRestPositionsNow() { saveRestPositions(); },
    _setSimulationDecay() {
      if (simulation) {
        simulation.alphaTarget(0);
        if (simulation.alpha() < simulation.alphaMin()) {
          simulation.alpha(0.05).restart();
        }
      }
    },
    get hasNodes() { return nodes.size > 0; },
    get isAttached() { return attached; },
    get nodeCount() { return [...nodes.values()].filter((n) => !n.exiting).length; },
    get edgeCount() { return edges.size; },
    get _needsFullRebuild() { return false; },
  };
}

function renderGraph(initialFit = false) {
  if (!graph.isAttached) {
    graph.createGraphView();
  }
  graph.updateGraphView(initialFit);
}

function applyTheme(preferences) {
  document.documentElement.dataset.theme = getTheme(preferences);
  document.documentElement.dataset.transparentBackground = String(getTransparentBackground(preferences));
  applyBackdropOpacity(preferences);
}

/** Drives the .workspace-backdrop panel and keeps the pill's slider/readout in
 * step. Split out so the drag handler can repaint on every input event without
 * paying for a full render(). */
function applyBackdropOpacity(preferences) {
  const opacity = getBackdropOpacity(preferences);
  document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
  document.documentElement.style.setProperty(
    '--workspace-backdrop-opacity-percent',
    `${Math.round(opacity * 10000) / 100}%`,
  );
  const slider = elements.backdropOpacitySlider;
  if (slider && document.activeElement !== slider) slider.value = String(opacity);
  if (elements.backdropOpacityValue) {
    elements.backdropOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
  }
}

function render() {
  applyTheme(state.view?.preferences);
  if (WIDGET_SURFACE) return; // 019C: the widget renders only its own card
  syncWorkspaceTabIdentity();
  workspaceNavigator?.render();
  renderWindowLayoutPills();
  if (session.binMode && session.binCurrentId !== 'bin' && !group(session.binCurrentId)?.bin) {
    // The folder we'd drilled into was restored or deleted out from under
    // us (e.g. via the top-level Bin list or "Delete all") — fall back to
    // the top of the Bin rather than rendering a dangling, nonexistent
    // breadcrumb segment.
    store.setNavigation({ binCurrentId: 'bin' });
  }
  const iconSize = state.view.iconSize;
  document.documentElement.style.setProperty('--icon-size', `${iconSize}px`);
  elements.breadcrumbs.innerHTML = session.binMode
    ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).map((candidate, index, path) =>
        `<button type="button" data-bin-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('')
    : pathTo(session.currentId).map((candidate, index, path) =>
        `<button type="button" data-breadcrumb="${candidate.id}">${escapeHtml(candidate.name)}</button>${index < path.length - 1 ? '<span aria-hidden="true">›</span>' : ''}`,
      ).join('');

  const visible = session.binMode
    ? (session.binCurrentId === 'bin' ? binnedItems(state) : itemsInBinnedGroup(state, session.binCurrentId))
    // Same null-vs-ROOT_ID normalisation as the graph view above: an
    // ancestor tile navigating to the root leaves currentId null, and
    // itemsIn(null) is empty, which would show the "folder is empty" line
    // over a workspace that is not empty.
    : itemsIn(state, session.currentId ?? ROOT_ID).filter((candidate) => candidate.kind !== 'window-layout');
  elements.grid.dataset.blankParent = session.binMode ? session.binCurrentId : (session.currentId ?? ROOT_ID);
  elements.grid.dataset.view = 'graph';
  elements.grid.classList.toggle('bin-canvas', session.binMode);

  if (!graph.isAttached) {
    elements.grid.innerHTML = '';
    renderGraph(true);
  } else {
    graph.updateGraphView(false);
  }
  elements.empty.hidden = visible.length !== 0
    || (session.binMode
      ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).slice(0, -1).length
      : pathTo(session.currentId).slice(0, -1).length) > 0;
  elements.empty.textContent = session.binMode
    ? (session.binCurrentId === 'bin' ? 'The Bin is empty.' : 'Nothing left here.')
    : 'This folder is empty. Right-click here to add something.';

  syncSelection();

  const binCount = binnedItems(state).length;
  elements.binButton.hidden = false;
  elements.binCount.hidden = binCount === 0;
  elements.binCount.textContent = String(binCount);
  elements.binButton.setAttribute('aria-pressed', String(session.binMode));
  elements.binLabel.textContent = session.binMode ? 'Close Bin' : 'Bin';
  elements.binButton.title = session.binMode ? 'Close Bin' : 'Bin';
  const hasSelection = session.binMode && session.selected.size > 0;
  elements.deleteAllBin.hidden = !session.binMode || binCount === 0;
  elements.restoreAllBin.hidden = !session.binMode || binCount === 0;
  elements.deleteAllBin.classList.toggle('selective', hasSelection);
  elements.restoreAllBin.classList.toggle('selective', hasSelection);
  elements.deleteAllBin.title = hasSelection ? 'Delete selection permanently' : 'Delete all';
  elements.restoreAllBin.title = hasSelection ? 'Restore selection' : 'Restore all';

  hydrateIcons();
}

function renderWindowLayoutPills() {
  if (!windowLayoutPillTray) return;
  const layouts = (state.windowLayoutPillIds ?? [])
    .map((layoutId) => windowLayoutFromState(layoutId))
    .filter((layout) => layout && !layout.bin);
  windowLayoutPillTray.innerHTML = layouts.map((layout) =>
    `<button class="window-layout-pill" type="button" data-layout-widget-pill="${escapeHtml(layout.id)}" title="Open ${escapeHtml(layout.name)}">${escapeHtml(layout.name)}</button>`,
  ).join('');
  windowLayoutPillTray.hidden = layouts.length === 0;
}

async function reopenWindowLayoutWidget(layoutId) {
  if (windowLayoutDetachment.isReadOnly()) return;
  const next = setWindowLayoutPill(state, layoutId, false);
  if (next !== state && !(await store.commit(next))) {
    setStatus('Could not reopen this layout widget.');
    return;
  }
  const result = await windowLayoutWidgetLifecycle.open(layoutId);
  if (!result || result.ok === false || result.widget?.ok === false
    || result.outcome === 'failed' || result.outcome === 'error') {
    setStatus('Could not open this layout widget.');
    const docked = setWindowLayoutPill(state, layoutId, true);
    if (docked !== state) await store.commit(docked);
    return;
  }
  detachedWidgets.add(layoutId);
  render();
}

windowLayoutPillTray?.addEventListener('click', (event) => {
  const pill = event.target.closest('[data-layout-widget-pill]');
  if (pill) void reopenWindowLayoutWidget(pill.dataset.layoutWidgetPill);
});

function nativeDragPathsForItemIds(itemIds) {
  return [...new Set(itemIds.flatMap((itemId) => {
    const record = shortcutByRecordOrPlacementId(itemId);
    if (!record || isWebLink(record) || !isAbsoluteWindowsPath(record.target)) return [];
    return [record.target];
  }))];
}

function selectedFileCapabilityContext() {
  const selectedIds = [...session.selected];
  if (selectedIds.length === 0) return { mode: 'empty', selectionCount: 0, items: [] };
  if (selectedIds.length === 1) {
    const selectedRecord = shortcutByRecordOrPlacementId(selectedIds[0]);
    if (selectedRecord && isWebLink(selectedRecord)) {
      return {
        mode: 'web',
        selectionCount: 1,
        item: { shortcutId: selectedRecord.id, url: selectedRecord.target, name: selectedRecord.name },
        items: [],
      };
    }
  }
  const fileItems = selectedIds.flatMap((selectedId) => {
    const record = shortcutByRecordOrPlacementId(selectedId);
    if (!record || isWebLink(record) || !isAbsoluteWindowsPath(record.target)) return [];
    return [{ shortcutId: record.id, path: record.target, name: record.name }];
  });
  if (selectedIds.length === 1 && fileItems.length === 1) {
    return { mode: 'single', selectionCount: 1, item: fileItems[0], items: fileItems };
  }
  if (selectedIds.length > 1) {
    return { mode: 'multiple', selectionCount: selectedIds.length, items: fileItems };
  }
  return { mode: 'empty', selectionCount: selectedIds.length, items: fileItems };
}

function syncFileCapabilitySelection() {
  const selection = selectedFileCapabilityContext();
  if (
    workspaceNavigator?.isMachineMode?.()
    && selection.mode === 'empty'
    && selection.selectionCount === 0
  ) {
    return;
  }
  if (EMBEDDED_SURFACE === 'proxima') {
    window.parent.postMessage({ type: 'papers:proxima-preview-selection', selection }, embeddedParentOrigin());
    return;
  }
  fileCapabilityPanel?.syncSelection(selection);
}

function syncSelection() {
  if (graph.isAttached) {
    graph.refreshSelection();
  } else {
    document.querySelectorAll('.icon-item').forEach((tile) => {
      const isSelected = session.selected.has(tile.dataset.id);
      tile.classList.toggle('selected', isSelected);
      tile.setAttribute('aria-selected', String(isSelected));
    });
  }
  elements.selectionStatus.hidden = session.selected.size === 0;
  elements.selectionStatus.textContent = session.selected.size === 1
    ? '1 item selected'
    : `${session.selected.size} items selected`;
  syncFileCapabilitySelection();
  void workspaceNavigator?.syncCanvasSelection(selectedFileCapabilityContext());
}

async function hydrateIcons() {
  await hydrateIconsScoped(
    document,
    iconCache,
    (detail) => host.shortcutIcon(detail),
    (url) => host.resolveWebIcon(url),
  );
}

function hydrateNodeIcons(shell) {
  if (!shell) return;
  hydrateIconsScoped(
    shell,
    iconCache,
    (detail) => host.shortcutIcon(detail),
    (url) => host.resolveWebIcon(url),
  );
}

async function persist(nextState = state, metadata) {
  return store.save(nextState, metadata);
}

async function commit(nextState, options = {}) {
  return store.commit(nextState, options);
}

function visibleItemIds() {
  // Ancestors never enter the selection: select-all and shift-ranges read
  // this list, and the marquee filters separately — the bin-origin pattern
  // for keeping derived bodies out of selection and deletion.
  return [...elements.grid.querySelectorAll('.icon-item')]
    .filter((node) => !node.classList.contains('ancestor-item'))
    .map((node) => node.dataset.id);
}

function currentSelectionParent() {
  const first = item([...session.selected][0]);
  return first?.parentId ?? session.currentId;
}




/** Resolves a set of graph item ids (groups or shared shortcut identities)
 * to the exact Bin-context ids binSelection() needs — a linked shortcut
 * with more than one visible edge bins every one of its placements (the
 * whole shared thing), while one with a single visible edge only bins the
 * placement this view represents. Shared by the Bin button/keyboard path
 * and drag-onto-the-bin-pill. */
function resolveBinTargets(itemIds) {
  return itemIds.flatMap((itemId) => {
    if (group(itemId) || windowLayout(itemId)) return [itemId];
    return visibleParentCountFor(itemId) > 1
      ? allActivePlacementIds(itemId)
      : [visiblePlacementIdFor(itemId)].filter(Boolean);
  });
}


async function runMenuAction(action) {
  const onlyId = session.selected.size === 1 ? [...session.selected][0] : null;
  const scopedMutationParent = (parentId) => SCOPE_ROOT_ID && (!parentId || parentId === ROOT_ID)
    ? SCOPE_ROOT_ID
    : (parentId ?? session.currentId ?? ROOT_ID);
  if (action === 'new-folder') return editorDialog.showEditor('group', null, scopedMutationParent(elements.menu.dataset.parent));
  if (action === 'new-shortcut') return editorDialog.showEditor('shortcut', null, scopedMutationParent(elements.menu.dataset.parent));
  if (action === 'new-web-link') return editorDialog.showEditor('web', null, scopedMutationParent(elements.menu.dataset.parent));
  if (action === 'new-window-layout') {
    try {
      const parentId = scopedMutationParent(elements.menu.dataset.parent);
      let createdLayout = null;
      const attemptCreateLayout = async () => {
        const next = createWindowLayout(state, { parentId });
        createdLayout = next.windowLayouts.at(-1) ?? null;
        const committed = await commit(next, { requireDurable: true });
        if (committed !== true && createdLayout?.id && windowLayoutFromState(createdLayout.id)) {
          store.replace(deleteWindowLayout(state, createdLayout.id));
          render();
          createdLayout = null;
        }
        return committed;
      };
      let committed = await attemptCreateLayout();
      // A freshly restored tab can receive input before its shared-document
      // baseline is ready. The first commit is deliberately refused in that
      // short interval; retry once after coordination settles instead of
      // turning the creator's click into a silent no-op.
      const needsCoordination = () => coordinationState !== 'ready'
        || !surfaceCoordinator?.baselineReady;
      if (committed === false && needsCoordination()) {
        const deadline = Date.now() + 5000;
        while (needsCoordination() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (hasDocumentWriteAuthority()) {
          committed = await attemptCreateLayout();
        }
      }
      if (committed === false) {
        setStatus(windowLayoutDetachment.isReadOnly()
          ? 'Reattach the window layout before creating another layout.'
          : 'Workspace is still synchronizing; try again in a moment.');
      } else if (createdLayout?.id) {
        const opened = await windowLayoutWidgetLifecycle.open(createdLayout.id);
        if (!windowLayoutWidgetOpenSucceeded(opened)) setStatus('Could not open this layout widget.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (action === 'paste') return commands.pasteInto(scopedMutationParent(elements.menu.dataset.parent));
  if (action === 'open' && onlyId) return commands.activateItem(onlyId);
  if (action === 'open-new-tab' && onlyId && group(onlyId)) {
    closeMenu();
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('as-you-go-folder', onlyId);
    try {
      await host.openNewSurface(nextUrl.toString());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    return;
  }
  if (action === 'edit' && onlyId) {
    const chosen = shortcut(onlyId);
    return editorDialog.showEditor(isWebLink(chosen) ? 'web' : 'shortcut', chosen);
  }
  if (action === 'rename' && onlyId) {
    if (windowLayout(onlyId)) {
      setStatus('Window layout names and icons are fixed.');
      return;
    }
    return editorDialog.showEditor('group', group(onlyId) ?? windowLayout(onlyId));
  }
  if (action === 'copy') return commands.copySelection();
  if (action === 'cut') return commands.cutSelection();
  if (action === 'bin') return commands.moveSelectionToBin();
  if (action === 'restore') return confirmDialog.askRestoreConfirm([...session.selected]);
  if (action === 'delete-forever') return confirmDialog.askPermanentDelete();
  if (action === 'reset-graph-position') return commands.resetGraphPositions();
  if (action === 'rename-set') return beginSetRename();
  if (action === 'delete-sets') return commands.deleteSelectedSets();
  if (action === 'remove-from-layout') {
    // 040: member context action -> the existing scoped data-only unlink
    // writer with the clicked composite layout/member key. Scoped cache
    // cleanup, one persistence, active-only reconcile; never a cross-layout
    // mutation. Read the target from the menu dataset (set at open time).
    // On the WIDGET surface the intent routes through the widget channel to
    // the workspace writer (the widget never writes the store itself).
    const layoutId = elements.menu.dataset.wlLayout;
    const memberId = elements.menu.dataset.wlMember;
    delete elements.menu.dataset.wlLayout;
    delete elements.menu.dataset.wlMember;
    if (!layoutId || !memberId) return;
    if (WIDGET_SURFACE && windowLayoutWidgetClient) {
      windowLayoutWidgetClient.sendCommand({ kind: 'remove-member', memberId });
      return;
    }
    handleWindowLayoutUnlink(layoutId, memberId);
    return;
  }
}

// 016 inner member drag: reorder within the layout, or unlink (data-only)
// beyond a clear outside threshold. Never starts outer graph drag and never
// moves/resizes/minimizes/closes the external window. 018X4: the drag state
// machine lives in the shared createWindowLayoutMemberDrag guard so the
// read-only handoff can cancel it and a later pointerup / reused pointer ID
// cannot finalize an unlink/reorder after reattach.
const windowLayoutMemberDrag = createWindowLayoutMemberDrag();
let windowLayoutDragJustMoved = false;
const WINDOW_LAYOUT_DROP_OUT_PX = 40;

/** 018X6: restores the member row's live DOM order back to the canonical
 * persisted arrangement order (a pointermove may already have reordered the
 * buttons before a read-only cancellation). Same DOM nodes/listeners are
 * preserved; nothing is committed/saved/finalized. */
function restoreWindowLayoutMemberDomOrder(layoutId) {
  const members = document.querySelector(`[data-wl-members="${CSS.escape(layoutId)}"]`);
  const layout = windowLayoutFromState(layoutId);
  if (!members || !layout) return;
  const memberIds = (layout.arrangement?.members ?? []).map((member) => member.id);
  const ordered = orderWindowLayoutMemberButtons(
    [...members.querySelectorAll('[data-wl-member]')],
    memberIds,
  );
  for (const button of ordered) {
    if (button.parentNode === members) members.appendChild(button);
  }
}

/** 018X4/018X6: cancels an in-progress 016 member drag WITHOUT finalizing a
 * move: rolls back any visual DOM reorder to the canonical order, clears the
 * drag state and the drag-out visual, so a later pointerup (e.g. after the
 * read-only handoff disarms) or a reused pointer ID cannot trigger an unlink
 * or reorder. Used by read-only entry and Escape (force-cancel). */
function cancelWindowLayoutDrag() {
  const layoutId = windowLayoutMemberDrag.get()?.layoutId;
  windowLayoutMemberDrag.cancel();
  if (layoutId) restoreWindowLayoutMemberDomOrder(layoutId);
  const members = document.querySelector('[data-wl-members].wl-drag-out');
  if (members) members.classList.remove('wl-drag-out');
}

elements.grid.addEventListener('pointerdown', (event) => {
  if (WIDGET_SURFACE) return;
  const body = event.target.closest('.window-layout-body');
  if (body && event.button === 0 && !event.ctrlKey && !event.shiftKey
    && !event.target.closest('button, input, [data-wl-member]')) {
    // Attached cards need their own inner-selection clear. The outer graph
    // blank handler never sees this press because card events intentionally
    // stop before workspace selection/navigation. Clear on pointerdown so a
    // graph drag or pointer capture cannot swallow the later click.
    clearWindowLayoutMemberSelection(body.dataset.wlLayout);
  }
  const member = event.target.closest('[data-wl-member]');
  if (!member || !event.ctrlKey || event.button !== 0) return;
  cancelWindowLayoutPreviewDwell();
  windowLayoutMemberPopover.hide();
  windowLayoutMemberPreview.cancel();
  windowLayoutMemberDrag.start({
    layoutId: member.dataset.wlLayout,
    memberId: member.dataset.wlMember,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
  });
});

elements.grid.addEventListener('pointermove', (event) => {
  if (WIDGET_SURFACE) return;
  const drag = windowLayoutMemberDrag.move(event.pointerId, event.clientX, event.clientY);
  if (!drag) return;
    const members = document.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    const button = document.querySelector(`[data-wl-layout="${CSS.escape(drag.layoutId)}"] [data-wl-member="${CSS.escape(drag.memberId)}"]`);
  if (!members || !button) return;
  const row = members.getBoundingClientRect();
  const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
    || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
  members.classList.toggle('wl-drag-out', outside);
  if (outside) return;
  moveWindowLayoutMemberButton(members, button, event.clientX, event.clientY);
});

elements.grid.addEventListener('pointerup', (event) => {
  if (WIDGET_SURFACE) return;
  windowLayoutMemberDrag.finalize(event.pointerId, (drag) => {
    const members = document.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    if (!members) return;
    const row = members.getBoundingClientRect();
    const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
    members.classList.remove('wl-drag-out');
    const layout = windowLayoutFromState(drag.layoutId);
    if (!layout) return;
    if (!drag.moved) return; // plain click: handled by the click delegation
    windowLayoutDragJustMoved = true;
    if (outside) {
      // Escape-like cancel path: data-only unlink, never closes or moves it.
      handleWindowLayoutUnlink(drag.layoutId, drag.memberId);
      return;
    }
    const buttons = [...members.querySelectorAll('[data-wl-member]')];
    const toIndex = buttons.findIndex((button) => button.dataset.wlMember === drag.memberId);
    if (toIndex === -1) return;
    const next = reorderWindowLayoutMember(state, drag.layoutId, drag.memberId, toIndex);
    // One commit = one persistence request; only broadcast after it settles.
    void store.commit(next).then((persisted) => {
      if (persisted) noteWindowLayoutCommit(drag.layoutId);
    });
  });
});

elements.grid.addEventListener('pointercancel', (event) => {
  if (WIDGET_SURFACE) return;
  // 018X6: ordinary pointercancel cancels ONLY when its pointerId matches the
  // active drag (preserving prior multi-pointer behavior); read-only/Escape
  // force-cancel via cancelWindowLayoutDrag().
  const active = windowLayoutMemberDrag.get();
  if (!active || !windowLayoutMemberDrag.cancelMatching(event.pointerId)) return;
  restoreWindowLayoutMemberDomOrder(active.layoutId);
  const members = document.querySelector('[data-wl-members].wl-drag-out');
  if (members) members.classList.remove('wl-drag-out');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && windowLayoutMemberDrag.isActive()) {
    cancelWindowLayoutDrag();
  }
});

elements.grid.addEventListener('click', (event) => {
  if (WIDGET_SURFACE) return;
  event.stopPropagation();
  const expandButton = event.target.closest('[data-expand]');
  if (expandButton) {
    const folderId = expandButton.dataset.expand;
    // Assignment 007: a trail tile's chevron expands the trail branch for
    // THIS view context; an ordinary tile's chevron expands ordinary
    // content. The two sets never touch.
    if (graph._isTrailNode(folderId)) {
      const next = new Set(store.getSession().trailExpanded);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      setCurrentTrailExpanded([...next]);
    } else {
      store.toggleGraphExpanded(folderId);
    }
    closeMenu();
    render();
    saveWorkspaceView();
    return;
  }
  // Assignment 015/016: window-layout member/control clicks are handled here
  // and never fall through to selection, navigation or graph drag.
  const windowLayoutBody = event.target.closest('.window-layout-body');
  if (windowLayoutBody) {
    // 035: while a layout's widget is open its attached card is a greyed
    // placeholder — every ordinary interaction is inert except its explicit
    // plain-click reattach lock.
    const bodyLayoutId = windowLayoutBody.dataset?.wlLayout;
    const detachedLayout = typeof bodyLayoutId === 'string' && bodyLayoutId && detachedWidgets.has(bodyLayoutId);
    if (detachedLayout && !event.target.closest('[data-wl-reattach]')) return;
    const memberButton = event.target.closest('[data-wl-member]');
    if (memberButton) {
      if (windowLayoutDragJustMoved) {
        windowLayoutDragJustMoved = false;
        return;
      }
      if (!event.ctrlKey && !event.shiftKey
        && !windowLayoutRuntime.isolateMode.isActive(memberButton.dataset.wlLayout)) {
        // A PLAIN CLICK TOGGLES. This branch used to check readiness and RETURN -
        // nothing was ever sent, which is why an icon click did nothing at all while
        // minimize-all and restore-all worked. The widget is not the writer, so it
        // sends the intent over the seam that already exists; the writer applies it
        // and routes it to the resident broker.
        const plainLayoutId = memberButton.dataset.wlLayout;
        const plainMemberId = memberButton.dataset.wlMember;
        if (WIDGET_SURFACE && windowLayoutWidgetClient) {
          const sentOk = windowLayoutWidgetClient.sendCommand({ kind: 'member-toggle', memberId: plainMemberId });
          try { document.title = 'click->toggle sent=' + String(sentOk); } catch { /* diagnostic */ }
          return;
        }
        void handleWindowLayoutMemberClick(plainLayoutId, plainMemberId);
        return;
      }
      void handleWindowLayoutMemberClick(memberButton.dataset.wlLayout, memberButton.dataset.wlMember, event.ctrlKey, event.shiftKey);
      return;
    }
    const pickCandidate = event.target.closest('[data-wl-pick-candidate]');
    if (pickCandidate) {
      void handleWindowLayoutPickCandidate(pickCandidate.dataset.wlPick, pickCandidate.dataset.wlPickCandidate);
      return;
    }
    const unlink = event.target.closest('[data-wl-unlink]');
    if (unlink) {
      void handleWindowLayoutUnlink(unlink.dataset.wlPick, unlink.dataset.wlUnlink);
      return;
    }
    const pickerClose = event.target.closest('[data-wl-picker-close]');
    if (pickerClose) {
      closeWindowLayoutPicker();
      return;
    }
    const listButton = event.target.closest('[data-wl-list]');
    if (listButton) {
      cancelWindowLayoutListDwell();
      void beginWindowLayoutDirectPick(listButton.dataset.wlList);
      return;
    }
    const trackingButton = event.target.closest('[data-wl-track]');
    if (trackingButton) {
      void handleWindowLayoutTrackingToggle(trackingButton.dataset.wlTrack);
      return;
    }
    const minAll = event.target.closest('[data-wl-min-all]');
    if (minAll) {
      void windowLayoutGroupAction(minAll.dataset.wlMinAll, 'minimize');
      return;
    }
    const restoreAll = event.target.closest('[data-wl-restore-all]');
    if (restoreAll) {
      void windowLayoutGroupAction(restoreAll.dataset.wlRestoreAll, 'restore');
      return;
    }
    const reattach = event.target.closest('[data-wl-reattach]');
    if (reattach) {
      const layoutId = reattach.dataset.wlReattach;
      if (detachedWidgets.delete(layoutId)) render();
      void host.widgetClose(layoutId).catch(() => undefined);
      return;
    }
    return;
  }
  const tile = event.target.closest('.icon-item');
  if (tile) {
    if (suppressGraphClick) {
      suppressGraphClick = false;
      return;
    }
    if (tile.classList.contains('bin-origin-ghost')) return;
    // Assignment 003: an ancestor tile is the breadcrumb as folder
    // contents — clicking it navigates into that folder, never selects.
    if (tile.classList.contains('ancestor-item')) {
      // Assignment 003: an ancestor tile is the breadcrumb as folder
      // contents — clicking it navigates exactly as the pill's crumb
      // buttons do, never selecting.
      if (session.binMode) {
        store.setNavigation({ binCurrentId: tile.dataset.id });
      } else {
        // Navigate with ROOT_ID itself, not null: top-level items are stored
        // under ROOT_ID, so a null current folder makes itemsIn and
        // collectVisible find nothing and the workspace renders empty.
        store.setNavigation({ currentId: tile.dataset.id });
      }
      store.clearSelection();
      graph.destroyGraphView();
      closeMenu();
      render();
      saveWorkspaceView({ persistSurfaceLocation: !session.binMode });
      return;
    }
    // While Ctrl+G is open a click picks the set the item belongs to, rather
    // than changing the selection being edited — the subjects were captured
    // when the mode opened, so changing selection underneath it would edit
    // membership for items the user is no longer looking at. Trail items are
    // outside the set system in this view: pointing at one must not drive
    // the subjects' membership.
    if (setMembershipMode.isActive()) {
      if (tile.classList.contains('trail-item')) return;
      setMembershipMode.toggleFromItem(tile.dataset.id);
      return;
    }
    // Shift+left-click stands in for double-click: it opens the item. The
    // range-selection it used to do assumed items sit in a linear order,
    // which is meaningless in a force-directed graph where "between" has no
    // definition. Shift+DRAG still pins (pointer-controller owns that) — this
    // only fires on a click that never became a drag.
    if (event.shiftKey && !event.ctrlKey) {
      commands.activateItem(tile.dataset.id, { revealDirectoryTarget: true });
      return;
    }
    commands.selectItem(tile.dataset.id, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      visibleItemIds: visibleItemIds(),
    });
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (blank) {
    if (suppressBlankClick) {
      suppressBlankClick = false;
      return;
    }
    if (suppressGraphClick) {
      suppressGraphClick = false;
      return;
    }
    // Blank space inside a set's ring selects that set. The click landed on the
    // canvas rather than an icon, so the outline is the only thing it could
    // have been about — and this has to come before clearing, or selecting a
    // set would immediately deselect it.
    // No optional chaining: while clientToWorld was missing from the pointer
    // controller's exports, `?.` turned its absence into undefined, then into
    // an empty hit list, and clicking inside a ring did nothing at all with no
    // way to tell a missing function from a missed ring. A throw here would at
    // least reach the status bar.
    const world = pointer.clientToWorld(event.clientX, event.clientY);
    const hitSets = graph.setIdsAtPoint(world);
    if (hitSets.length > 0) {
      commands.selectSets([hitSets[0]], { additive: event.ctrlKey === true });
      closeMenu();
      return;
    }
    store.clearSelection();
    commands.clearSetSelection();
    store.setSelectionAnchor(null);
    syncSelection();
    closeMenu();
    saveWorkspaceView();
  }
});


elements.grid.addEventListener('contextmenu', (event) => {
  if (WIDGET_SURFACE) return;
  event.preventDefault();
  event.stopPropagation();
  // Opening the context menu can implicitly cancel an in-progress pointer
  // sequence without ever dispatching pointerup/pointercancel to the grid
  // (observed with Shift+right-click on a folder) — leaving graph-dragging/
  // will-pin/graph-drop-target visuals stuck on whatever tile the pointer
  // last touched. Cancel the drag defensively any time the menu opens.
  pointer.cancelDrag();
  const isolateToggle = event.target.closest('[data-wl-min-all]');
  if (isolateToggle) {
    toggleWindowLayoutIsolateMode(isolateToggle.dataset.wlMinAll);
    return;
  }
  // 019B: Shift+right-click on a member minimizes/restores the selected range
  // (direction from the clicked member's live state). 040: a PLAIN right-click
  // on a member opens the member context menu (`Remove from this layout`); it
  // must never trigger preview, reorder, selection, or removal from another
  // layout, and the inert grey placeholder card refuses removal.
  const wlMember = event.target.closest('[data-wl-member]');
  if (wlMember) {
    if (event.ctrlKey && !event.shiftKey && windowLayoutRuntime.isolateMode.isActive(wlMember.dataset.wlLayout)) {
      const targets = windowLayoutRuntime.isolateMode.click(wlMember.dataset.wlLayout, wlMember.dataset.wlMember, true);
      if (targets !== null) void windowLayoutGroupAction(wlMember.dataset.wlLayout, 'isolate', targets);
      return;
    }
    if (event.shiftKey) {
      void windowLayoutToggleRange(wlMember.dataset.wlLayout, wlMember.dataset.wlMember);
      return;
    }
    const layoutId = wlMember.dataset.wlLayout;
    const memberId = wlMember.dataset.wlMember;
    if (!layoutId || !memberId) return;
    // 040: grey placeholder refusal — the placeholder card's members are
    // disabled and never offer removal.
    if (wlMember.disabled) return;
    if (!windowControlReady.has(windowControlKey(layoutId, memberId))) {
      setWindowLayoutStatus(layoutId, windowControlUnavailable || 'Native window control is preparing.');
    }
    return;
    // A plain right-click brings that member's window to the front. It used to
    // open a menu whose only entry was "remove from this layout" - a dead end
    // for the far more common "show me that window". Removing an icon is Direct
    // Pick's job now, and it names the windows on screen instead of a menu item.
    // The refusal is SHOWN: an ignored promise is how this quietly did nothing.
    // The resident hook already attempted the native action at mouse-down.
  }
  const tile = event.target.closest('.icon-item');
  if (tile && tile.classList.contains('bin-origin-ghost')) return;
  // An ancestor tile has no context menu (nothing on it can be renamed,
  // moved or deleted), but Shift+right-click is this workspace's expand
  // gesture and must keep working on it — returning early here is what
  // made expanding a trail folder impossible.
  const isAncestorTile = tile?.classList.contains('ancestor-item') === true;
  if (isAncestorTile && !event.shiftKey && !event.altKey) return;
  if (tile) {
    if ((event.shiftKey || event.altKey) && tile.dataset.kind === 'group') {
      const id = tile.dataset.id;
      if (event.altKey) {
        // Alt+right-click is the inverse of Shift: Shift toggles the folder
        // you clicked, Alt toggles every OTHER folder IN THAT FOLDER'S SETS.
        // Sets are what express "these belong together", so the gesture is
        // scoped by membership rather than by whatever happens to be on
        // screen. It is a toggle, not a collapse — if the others are open it
        // closes them ("isolate this one within its set"), and pressing it
        // again reopens them. Direction is decided once, from whether ANY
        // other member is currently open, so one gesture never both opens
        // and closes. A folder in no set has no others to act on.
        const ownSetIds = new Set(graph.setIdsContaining(id));
        const others = [...elements.grid.querySelectorAll('.icon-item')]
          .filter((node) => node.dataset.kind === 'group' && node.dataset.id !== id)
          .map((node) => node.dataset.id)
          .filter((folderId) => graph.setIdsContaining(folderId)
            .some((setId) => ownSetIds.has(setId)));
        const anyOtherExpanded = others.some((folderId) => session.graphExpanded.has(folderId));
        for (const folderId of others) {
          if (anyOtherExpanded) store.removeFromGraphExpanded(folderId);
          else store.addToGraphExpanded(folderId);
        }
      } else {
        const folderIds = session.selected.has(id)
          ? [...session.selected].filter((selectedId) => group(selectedId))
          : [id];
        const shouldExpand = !session.graphExpanded.has(id);
        for (const folderId of folderIds) {
          // Assignment 007: trail tiles expand only the current view
          // context's trail set; ordinary folders expand ordinary content.
          if (graph._isTrailNode(folderId)) {
            const next = new Set(store.getSession().trailExpanded);
            if (next.has(folderId)) next.delete(folderId);
            else next.add(folderId);
            setCurrentTrailExpanded([...next]);
          } else if (shouldExpand) {
            store.addToGraphExpanded(folderId);
          } else {
            store.removeFromGraphExpanded(folderId);
          }
        }
      }
      closeMenu();
      // Right-clicking a tile moves DOM focus onto it (standard mousedown
      // behavior) even though it's only tabindex="-1" — the plain
      // right-click path clears this because opening the context menu
      // moves focus onto one of its buttons, but this Shift+right-click
      // expand shortcut never opens a menu, so the tile's :focus-visible
      // outline would otherwise stay stuck on screen until something else
      // happens to move focus away.
      tile.blur();
      render();
      saveWorkspaceView();
      return;
    }
    if (!session.selected.has(tile.dataset.id)) {
      store.setSelection([tile.dataset.id]);
      store.setSelectionAnchor(tile.dataset.id);
      syncSelection();
      saveWorkspaceView();
    }
    openMenu(event.clientX, event.clientY);
    return;
  }
  const blank = event.target.closest('[data-blank-parent], [data-icon-grid]');
  if (!blank) return;
  const world = pointer.clientToWorld(event.clientX, event.clientY);
  const contextTarget = resolveContextTarget({
    hitSetIds: graph.setIdsAtPoint(world),
    selectedSetIds: session.selectedSets,
  });
  if (contextTarget.kind === 'set') {
    openMenu(event.clientX, event.clientY);
    return;
  }
  if (session.binMode) {
    if (session.selected.size > 0) openMenu(event.clientX, event.clientY);
    return;
  }
  if (session.selected.size > 0) {
    openMenu(event.clientX, event.clientY);
    return;
  }
  openMenu(
    event.clientX,
    event.clientY,
    'blank',
    blank.dataset.blankParent ?? session.currentId,
  );
});

document.addEventListener('click', (event) => {
  if (!elements.menu.hidden && !event.target.closest('#context-menu') && !event.target.closest('.icon-item')) {
    closeMenu();
  }
});

// Escape (or a click anywhere else) closes an open window-layout picker
// without changing anything (Assignment 015).
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && windowLayoutRuntime.pickUnsubscribe) {
    event.preventDefault();
    event.stopPropagation();
    void cancelWindowLayoutPick();
    return;
  }
  if (windowLayoutRuntime.pickUnsubscribe) {
    event.preventDefault();
    event.stopPropagation();
    const activePickLayout = windowLayoutRuntime.pickLayoutId;
    const request = host.pickWindowCommit();
    void request.catch((error) => setWindowLayoutStatus(
      activePickLayout ?? 'active',
      error instanceof Error ? error.message : String(error),
    ));
    return;
  }
  if (event.key === 'Escape' && windowLayoutRuntime.pickerOpenFor) {
    closeWindowLayoutPicker();
  }
});
document.addEventListener('click', (event) => {
  if (windowLayoutRuntime.pickerOpenFor && !event.target.closest('[data-wl-picker]')) {
    closeWindowLayoutPicker();
  }
});

elements.explorer.addEventListener('wheel', (event) => {
  if (WIDGET_SURFACE) return;
  if (!event.ctrlKey) return;
  event.preventDefault();
  state = store.replace(setIconSize(state, state.view.iconSize + (event.deltaY < 0 ? 12 : -12)));
  render();
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => persist(state, { rebaseAutomaticSave: true }).catch((error) => {
    // 018X6: a delayed persistence error must not paint status over the
    // handoff if read-only began before this catch ran.
    if (detachSaveGate.isReadOnly()) return;
    setStatus(String(error));
  }), 250);
}, { passive: false });

elements.breadcrumbs.addEventListener('click', (event) => {
  const binCrumb = event.target.closest('[data-bin-breadcrumb]');
  if (binCrumb) {
    store.setNavigation({ binCurrentId: binCrumb.dataset.binBreadcrumb });
    store.clearSelection();
    graph.destroyGraphView();
    render();
    saveWorkspaceView();
    return;
  }
  const crumb = event.target.closest('[data-breadcrumb]');
  if (!crumb) return;
  store.setNavigation({ currentId: crumb.dataset.breadcrumb });
  store.clearSelection();
  graph.destroyGraphView();
  render();
  saveWorkspaceView({ persistSurfaceLocation: !session.binMode });
});

const PICKUP_COPY_LABEL = 'Copy agent pickup prompt';
const PICKUP_COPY_FLASH_MS = 1800;
let pickupCopyTimer = null;

/** Confirms a pickup copy. The button is icon-only and its label is sr-only,
 * so the visible acknowledgement has to be on the button itself; the label
 * still changes for screen readers. One timer, so a rapid second copy restarts
 * the confirmation instead of the first firing partway through and clearing
 * it early. */
function confirmPickupCopy(message) {
  const button = document.querySelector('#copy-prompt');
  const label = document.querySelector('.copy-label');
  if (pickupCopyTimer != null) {
    clearTimeout(pickupCopyTimer);
    button?.classList.remove('pickup-copied');
  }
  if (label) label.textContent = 'Copied';
  button?.classList.add('pickup-copied');
  setStatus(message, { level: 'success' });
  elements.status.classList.add('status-copied');
  pickupCopyTimer = setTimeout(() => {
    pickupCopyTimer = null;
    button?.classList.remove('pickup-copied');
    if (label) label.textContent = PICKUP_COPY_LABEL;
    // Clear the text as well as the emphasis. Dropping only the class would
    // leave the confirmation behind in the red error styling.
    if (elements.status.textContent === message) setStatus('');
  }, PICKUP_COPY_FLASH_MS);
}

// Background-opacity pill. `input` repaints live while dragging so the panel
// tracks the thumb; `change` is what persists, so a drag writes state once on
// release instead of on every frame.
elements.backdropOpacitySlider.addEventListener('input', () => {
  const opacity = Number(elements.backdropOpacitySlider.value);
  document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
  document.documentElement.style.setProperty(
    '--workspace-backdrop-opacity-percent',
    `${Math.round(opacity * 10000) / 100}%`,
  );
  elements.backdropOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
});

elements.backdropOpacitySlider.addEventListener('change', async () => {
  const preferences = setBackdropOpacity(
    state.view?.preferences,
    Number(elements.backdropOpacitySlider.value),
  );
  const nextState = { ...state, view: { ...state.view, preferences } };
  try {
    await commit(nextState);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

document.querySelector('#copy-prompt').addEventListener('click', async () => {
  try {
    const selectedCandidates = [...session.selected]
      .map((selectedId) => shortcutByRecordOrPlacementId(selectedId))
      .filter(Boolean);
    const promptNodes = promptLibrary.getSnapshotLibrary();
    const selectedTargets = selectedCandidates.map((candidate) => candidate.target);
    const outcome = resolveCopierAction(selectedTargets, promptNodes);
    if (outcome.kind === 'open') {
      promptLibrary.open({ message: 'Select at least one prompt for batch copying.' });
      return;
    }
    await host.copyText(outcome.text);
    const copiedNames = outcome.copied === 'paths'
      ? selectedCandidates.map((candidate) => candidate.name ?? candidate.target)
      : collectIncludedPrompts(promptNodes)
        .filter((node) => typeof node.text === 'string' && node.text.trim() !== '')
        .map((node) => node.title);
    confirmPickupCopy(formatCopyConfirmation(outcome, copiedNames));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

// The launcher overlay, and the three entrances to one surface.
//
// The creator's correction: Alt+A is a LAUNCHER, not a window switcher. The host opens a 640x220
// always-on-top window on this page with `?papers-surface=command-surface` on the URL and relays one event;
// Papers itself does not come forward, and the application they came from keeps its place. So the marker is
// what says "you are the command surface", and the event only means "put them on an empty, focused line".
//
// Nothing here is a second surface. The same modules, the same session, the same ranking and the same Enter
// serve the canvas, the in-app chord and this overlay; the two divergences the overlay forces are named where
// they happen (Escape belongs to the host, and nothing takes focus back on the way out).
//
// The event arrives through the host bridge, not a window listener: host-to-project pushes arrive as `message`
// events from `window.parent` (the preload re-posts them), and the bridge is the one place that checks the
// source. A named-event listener here would never fire in the app while passing any test that dispatches it.
const commandSurfaceMode = commandSurfaceModeFromUrl(window.location.href);
if (commandSurfaceMode === 'overlay') {
  // The stylesheet keys off this: no canvas, no toolbars, no chrome - the command surface and nothing else.
  document.documentElement.dataset.papersSurface = COMMAND_SURFACE_MODE;
}
// Whether this surface's one load of the project's items landed, and if not, why. The launcher overlay has no
// canvas behind it, so an empty universe there is ambiguous between "your project is empty" and "I could not
// read your project" - and the creator's failure was the second one, hidden by the first reading. Recorded
// here, shown in the surface's own sentence, and it is what decides whether an invocation asks again.
let workspaceLoad = { settled: false, ok: false, error: null };
async function loadWorkspaceRecording() {
  try {
    const loaded = await host.loadWorkspace();
    workspaceLoad = { settled: true, ok: true, error: null };
    return loaded;
  } catch (error) {
    workspaceLoad = { settled: true, ok: false, error: error instanceof Error ? error.message : String(error) };
    throw error;
  }
}
/** Ask for the items again. The same single source, through the same channel: no cache, no second store. */
async function reloadWorkspace() {
  try {
    const loaded = await loadWorkspaceRecording();
    state = store.install(typeof loaded === 'string' ? JSON.parse(loaded) : loaded);
    render();
    quickRun.refresh();
    setStatus('');
    return true;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    return false;
  }
}
host.onCommandSurfaceInvoke((payload) => {
  if (SCOPE_ROOT_ID) return;
  const plan = planCommandSurfaceInvoke(payload, { loadFailed: workspaceLoad.ok !== true });
  try {
    if (plan.kind === 'open-seeded') {
      openQuickRun(plan.seed);
    } else if (plan.kind === 'append-text') {
      if (!quickRun.appendText(plan.text)) throw new Error('Quick Run did not accept the captured character.');
    } else if (plan.kind === 'focus-and-clear') {
      quickRun.focusEmptyLine();
      // The creator is here, looking at an empty launcher: if the boot load did not land, ask again now rather
      // than making them close and reopen it. Bounded to one attempt per invocation.
      if (plan.reload) void reloadWorkspace();
    } else {
      return;
    }
    if (typeof payload?.captureId === 'string') {
      void host.acknowledgeCommandSurfaceInput(payload.captureId).catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Quick Run input acknowledgement failed.');
      });
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Quick Run could not accept captured input.');
  }
});

const toolbar = createToolbarController({
  window,
  document,
  getState: () => state,
  setState: (next) => { state = store.replace(next); },
  setToolbarPosition,
  getToolbarPosition,
  persist,
  setStatus,
});

const confirmDialog = createConfirmationDialog({
  elements,
  getState: () => state,
  getSelectedIds: () => [...session.selected],
  binItemName,
  permanentlyDelete,
  restoreSelection,
  commit,
});

const menu = createContextMenu({
  elements,
  window,
  getCurrentId: () => session.currentId,
  getBinMode: () => session.binMode,
  getClipboard: () => session.clipboard,
  getSelectedItems: () => [...session.selected].map(item).filter(Boolean),
  getSelectedSets: () => [...session.selectedSets]
    .map((id) => (state.view?.itemSets ?? []).find((candidate) => candidate.id === id))
    .filter(Boolean),
  isWebLink,
  onAction: runMenuAction,
});
// Thin compatibility shims so the entry file's existing call sites stay put
// while the context menu's real implementation lives in the module above.
const closeMenu = () => menu.closeMenu();
const openMenu = (...args) => menu.openMenu(...args);

// Constructed after graph and closeMenu are initialized (both are consts
// declared later in the file); evaluating graph/closeMenu as argument
// values any earlier would hit the temporal dead zone.
const commands = createWorkspaceCommands({
  store,
  group,
  windowLayout,
  shortcut,
  item,
  isWebLink,
  host,
  graph,
  resolveBinTargets,
  visiblePlacementIdFor,
  visibleParentCountFor,
  allActivePlacementIds,
  anyActivePlacementId,
  moveSelection,
  copySelection,
  collapsePlacements,
  binSelection,
  graphContextId: scopedGraphContextId,
  scopeRootId: SCOPE_ROOT_ID,
  isItemInScope: (id) => itemInScope(state, id, SCOPE_ROOT_ID),
  isDestinationInScope: (id) => destinationInScope(state, id, SCOPE_ROOT_ID),
  removeGraphPositions,
  setGraphPositions,
  createWebLink,
  createDroppedShortcuts,
  setItemSets,
  // The graph's own ancestor chain, so inherited membership is resolved the
  // same way the ring is drawn. A separate walk here would let the two disagree
  // about which items a folder set covers.
  ancestorsOfNode: (id) => graph.ancestorsOfNode(id),
  // Assignment 003: the ancestors currently shown in this view (the path
  // to here, excluding the current folder itself) cannot be binned or
  // moved.
  isAncestorItem: (id) => (session.binMode
    ? pathToBin(session.binCurrentId === 'bin' ? null : session.binCurrentId).slice(0, -1)
    : pathTo(session.currentId).slice(0, -1)
  ).some((entry) => entry.id === id),
  syncSelection,
  saveWorkspaceView,
  closeMenu,
  render,
  setStatus,
});

if (!WIDGET_SURFACE && commandSurfaceMode !== 'overlay' && EMBEDDED_SURFACE !== 'proxima') {
  fileCapabilityPanel = createFileCapabilityPanel({
    document,
    host,
    setStatus,
    retargetShortcut: async ({ shortcutId, oldPath, newPath, nextName }) => {
      const record = shortcut(shortcutId);
      if (!record || record.target !== oldPath) return false;
      const next = updateShortcut(state, shortcutId, {
        name: nextName ?? record.name,
        description: record.description ?? '',
        target: newPath,
        icon: record.icon ?? null,
      });
      const persisted = await store.commit(next);
      if (!persisted) return false;
      render();
      return true;
    },
  });
}
if (!WIDGET_SURFACE && commandSurfaceMode !== 'overlay') {
  const workspaceElement = document.querySelector('.workspace');
  workspaceNavigator = createWorkspaceNavigator({
    document,
    host,
    workspace: workspaceElement,
    rootId: SCOPE_ROOT_ID || ROOT_ID,
    getState: () => state,
    getSession: () => session,
    itemsIn,
    isWebLink,
    isAbsoluteWindowsPath,
    nativeDragPaths: nativeDragPathsForItemIds,
    selectAyG: (id, visibleIds, modifiers = {}) => commands.selectItem(id, {
      shiftKey: false,
      ctrlKey: modifiers.ctrlKey === true,
      visibleItemIds: visibleIds,
    }),
    activateAyG: (id) => commands.activateItem(id),
    navigateAyG: (id) => commands.goToWorkspaceFolder(id),
    renameAyG: () => {
      const onlyId = session.selected.size === 1 ? [...session.selected][0] : null;
      if (!onlyId) return;
      const chosen = shortcutByRecordOrPlacementId(onlyId);
      if (chosen) return editorDialog.showEditor(isWebLink(chosen) ? 'web' : 'shortcut', chosen);
      const folder = group(onlyId);
      if (folder) return editorDialog.showEditor('group', folder);
    },
    copyAyG: () => commands.copySelection(),
    cutAyG: () => commands.cutSelection(),
    pasteAyG: (destination) => commands.pasteClipboard({}, destination),
    deleteAyG: () => commands.moveSelectionToBin(),
    clearCanvasForMachine: () => {
      store.clearSelection();
      commands.clearSetSelection();
      store.setSelectionAnchor(null);
      syncSelection();
      saveWorkspaceView();
    },
    previewMachinePath: (path, name) => {
      const selection = {
        mode: 'single',
        selectionCount: 1,
        item: { shortcutId: null, path, name },
        items: [{ shortcutId: null, path, name }],
      };
      if (EMBEDDED_SURFACE === 'proxima') {
        window.parent.postMessage({ type: 'papers:proxima-preview-selection', selection }, embeddedParentOrigin());
      } else {
        void fileCapabilityPanel?.previewPath(path, name);
      }
    },
    setStatus,
  });
  const parentGraphToggle = document.querySelector('#parent-graph-toggle');
  const parentGraphVisible = () => state.view?.preferences?.parentGraphVisible !== false;
  parentGraphToggle?.setAttribute('aria-pressed', String(parentGraphVisible()));
  if (parentGraphToggle) parentGraphToggle.title = parentGraphVisible() ? 'Hide parent folders' : 'Show parent folders';
  parentGraphToggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    const nextVisible = !parentGraphVisible();
    state = store.replace({
      ...state,
      view: {
        ...(state.view ?? {}),
        preferences: {
          ...(state.view?.preferences ?? {}),
          parentGraphVisible: nextVisible,
        },
      },
    });
    parentGraphToggle.setAttribute('aria-pressed', String(nextVisible));
    parentGraphToggle.title = nextVisible ? 'Hide parent folders' : 'Show parent folders';
    void saveWorkspaceView();
    render();
  });
  workspaceNavigator.render();
  syncFileCapabilitySelection();
} else {
  document.querySelector('#workspace-navigator')?.setAttribute('hidden', '');
  document.querySelector('#parent-graph-toggle')?.setAttribute('hidden', '');
}

let activeSetRename = null;
function beginSetRename() {
  const ids = [...store.getSession().selectedSets];
  if (ids.length !== 1) {
    setStatus('Select exactly one set to rename.', { level: 'validation' });
    return false;
  }
  const setId = ids[0];
  const itemSet = (state.view?.itemSets ?? []).find((candidate) => candidate.id === setId);
  const path = graph.setPathFor(setId);
  if (!itemSet || !path) {
    setStatus('That set is not visible here.');
    return false;
  }
  activeSetRename?.cancel();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'set-name-editor';
  input.value = itemSet.title ?? '';
  input.setAttribute('aria-label', 'Set name');
  const rect = path.getBoundingClientRect();
  input.style.left = `${rect.left + rect.width / 2 - 90}px`;
  input.style.top = `${rect.top + rect.height / 2 - 18}px`;
  document.body.append(input);
  const finish = async (save) => {
    if (!activeSetRename) return;
    activeSetRename = null;
    input.remove();
    if (save) await commands.renameSet(setId, input.value);
  };
  activeSetRename = { cancel: () => { activeSetRename = null; input.remove(); } };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
    else if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
  });
  input.addEventListener('blur', () => { void finish(true); }, { once: true });
  input.focus();
  input.select();
  return true;
}

// Constructed after commands: the controller delegates session mutation and
// persistence to the marquee commands.
const marquee = createMarqueeController({
  elements,
  commands,
  itemsIntersectingMarquee,
});

const drop = createDropController({
  document,
  elements,
  store,
  commands,
});

const pointer = createPointerController({
  window,
  document,
  elements,
  store,
  commands,
  graph,
  marquee,
  zoomTransform,
  group,
  visiblePlacementIdFor,
  closeMenu,
  nativeDragPaths: nativeDragPathsForItemIds,
  startNativeDrag: (paths) => host.fileCapability('native-drag', { paths }).catch((error) => {
    setStatus(error instanceof Error ? error.message : 'Native file drag failed.');
  }),
  onDragTrail: (itemIds) => graph.recordDragTrail(itemIds),
  clearDragTrail: () => graph.clearDragTrail(),
  setSuppressGraphClick: (value) => { suppressGraphClick = value; },
  setSuppressBlankClick: (value) => { suppressBlankClick = value; },
  consumeSuppressGraphClick: () => {
    if (!suppressGraphClick) return false;
    suppressGraphClick = false;
    return true;
  },
});
graph._setOnDragCancel(() => pointer.cancelDrag());
// Where unpinned nodes came to rest. Written through `state` rather than
// through the store alone: saveWorkspaceView rebuilds the view from this
// variable, so an update that only reached the store would be overwritten by
// the next save before it ever hit disk.
graph._setOnRestPositions((positions) => {
  state = store.replace(
    setGraphRestPositions(state, scopedGraphContextId(session.currentId, session.binMode), positions),
  );
  saveWorkspaceView();
  // Resting coordinates are shared board geometry, not a surface-local view
  // preference. Persist them without adding an Undo history entry so reopening
  // seeds from the latest coordinates, and let the coordinator broadcast the same
  // last-writer-wins positions to every open surface.
  pendingRestSave = store.save(state, { rebaseAutomaticSave: true }).catch((error) => {
    setStatus(error instanceof Error ? error.message : String(error));
  });
});
// Native surface close/pagehide can bypass a folder-navigation destroy path.
// Flush the current graph before the renderer disappears so the latest settled
// coordinates are recoverable on the next real renderer.
window.addEventListener('pagehide', () => graph._saveRestPositionsNow());
window.__papersFlushBeforeClose = async () => {
  graph._saveRestPositionsNow();
  if (PROJECT_SURFACE_KEY && !detachSaveGate.isReadOnly()) {
    state = store.replace(captureWorkspaceView());
    pendingSurfaceLocationSave = store.save(state, { rebaseAutomaticSave: true }).catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }
  await pendingRestSave;
  await pendingSurfaceLocationSave;
  await store.flush();
  return { ok: true };
};

/** A newly restored embedded surface can accept the editor click before its
 * shared-document baseline has settled. Keep the mutation in the editor
 * layer's normal commit path, but give that transient startup refusal the
 * same bounded retry as window-layout creation. Other failures stay visible. */
async function commitWhenWorkspaceReady(next, message) {
  const build = typeof next === 'function' ? next : () => next;
  let committed = await commit(build(), message);
  const needsCoordination = () => coordinationState !== 'ready'
    || !surfaceCoordinator?.baselineReady;
  if (committed === false && needsCoordination()) {
    const deadline = Date.now() + 5000;
    while (needsCoordination() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (hasDocumentWriteAuthority()) committed = await commit(build(), message);
  }
  if (committed === false && needsCoordination()) {
    setStatus('Workspace is still synchronizing; try again in a moment.');
  }
  return committed;
}

const editorDialog = createEditorDialog({
  elements,
  document,
  getState: () => state,
  getCurrentId: () => session.currentId,
  closeMenu,
  host,
  iconCache,
  compressIconFile,
  hydrateWebPreview,
  commit,
  commitWhenWorkspaceReady,
  render,
  shortcut,
  isWebLink,
  placementCount,
  forkPlacement,
  anyActivePlacementId,
  visiblePlacementIdFor,
  updateGroup,
  createGroup,
  updateWebLink,
  createWebLink,
  updateShortcut,
  createShortcut,
});
const showEditor = (...args) => editorDialog.showEditor(...args);

const binControls = createBinControls({
  elements,
  getState: () => state,
  getBinMode: () => session.binMode,
  setBinMode: (next) => store.setNavigation({ binMode: next }),
  getSelectedIds: () => [...session.selected],
  clearSelection: () => { store.clearSelection(); },
  resetDrillDown: () => store.setNavigation({ binCurrentId: 'bin' }),
  binnedItems,
  moveToBin: () => commands.moveSelectionToBin(),
  confirmDialog,
  closeMenu,
  render,
  saveWorkspaceView,
});

/** Ctrl+G membership picking.
 *
 * Constructed before the keyboard controller, which needs it to route Enter
 * and Escape while the mode is open. Sets are chosen by clicking their
 * contents rather than from a list, so the mode also intercepts canvas clicks
 * — see the graph click handler. */
const setMembershipMode = createSetMembershipMode({
  getSets: () => state.view?.itemSets ?? [],
  // Trail items are outside the set system in this view: they never open
  // the picker as subjects, and confirming must not write their (view-
  // suppressed) membership into the persisted sets.
  getSelectedIds: () => [...store.getSession().selected]
    .filter((id) => !graph._isTrailNode(id)),
  shareSelectionWithSets: (desired, itemIds, before) =>
    commands.shareSelectionWithSets(desired, itemIds, before),
  // The graph's chain, matching how the ring decides membership. Resolving
  // inheritance two different ways here would let the picker disagree with the
  // outline about which items a folder set covers.
  ancestorsOf: (itemId) => graph.ancestorsOfNode(itemId),
  render: () => render(),
  setStatus,
});

// The global launcher hands folder results to a normal project surface. Kept
// outside the Quick Run composition region so the search/activation seam stays
// free of host-specific work; the entry owns this one surface-opening adapter.
function openQuickRunFolderSurface(groupId) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete('papers-surface');
  nextUrl.searchParams.set('as-you-go-folder', groupId);
  return host.openNewSurface(nextUrl.toString());
}

// Keep the host-specific clipboard adapter outside the Quick Run composition region, just like the folder
// surface adapter above. Quick Run receives a narrow function and remains unaware of Papers messaging.
const quickRunCopyText = (text) => host.copyText(text);
const quickRunDismissCommandSurface = (options) => host.dismissCommandSurface(options);
const quickRunHydrateIcons = (shell) => hydrateNodeIcons(shell);
const quickRunCardSizeChanged = (size) => {
  state = store.replace({ ...state, view: { ...state.view, quickRunCardSize: size } });
  return persist(state, { rebaseAutomaticSave: true }).catch((error) => {
    if (!detachSaveGate.isReadOnly()) setStatus(error instanceof Error ? error.message : String(error));
    throw error;
  });
};

// Quick Run (STAGE 5). The composition seam lives in its own module so the wiring can be exercised
// without booting the app: quick-run-workspace.test.mjs drives these same keys on the production markup
// with a real store and the real command object. What is left here is the element adapter - the registry
// in dom.js namespaces its keys (quickRunLayer, quickRunInput, ...) while the surface takes the handles it
// paints - and the collaborators this file owns, so a mismatch in the adapter is still the
// one thing quick-run-entry.test.mjs checks against both files.
//
// The binding is handed commands, the state reader, the visible ids and the status line, and nothing else:
// it is not given this file's workspace store or this file's render or the window-layout helpers, because
// nothing Quick Run does writes workspace state. Shift+Enter used to, through an in-memory replace, and was
// cut rather than repaired (see public/app/quick-run/quick-run-activation.js and papers/quick-run.md).
const quickRun = bindQuickRunWorkspace({
  document,
  elements: {
    layer: elements.quickRunLayer,
    input: elements.quickRunInput,
    chips: elements.quickRunChips,
    cap: elements.quickRunCap,
    results: elements.quickRunResults,
    notice: elements.quickRunNotice,
  },
  commands,
  getState: () => state,
  getVisibleItemIds: visibleItemIds,
  setStatus,
  // What sits underneath Quick Run is frozen while it is up, and told only that: "something transient is on
  // top", never what it is. Measured reason, not a precaution: with a folder rename half typed in the prompt
  // library, pressing the chord persisted the half-typed title through the dialog's own auto-save - the
  // launcher inventing a state change, which the ruling forbids. The dialog keeps the edit in memory and the
  // next deliberate action writes it.
  onOpen: () => promptLibrary.setSuspended(true),
  onClose: () => promptLibrary.setSuspended(false),
  // The mode is a presentation fact, not a second surface: the same binding, session and rules in both.
  // What to tell the reader when there is nothing to search: the surface asks the loader, which is the only
  // thing here that knows whether the project is empty or unreadable.
  universeNote: () => (workspaceLoad.ok === false ? workspaceLoad.error : null),
  commandSurface: commandSurfaceMode === 'overlay',
  openFolderSurface: openQuickRunFolderSurface,
  dismissCommandSurface: quickRunDismissCommandSurface,
  activateLayoutMember: activateWindowLayoutMember,
  copyText: quickRunCopyText,
  hydrateIcons: quickRunHydrateIcons,
  getCardSize: () => state.view?.quickRunCardSize ?? null,
  onCardSizeChanged: quickRunCardSizeChanged,
});
if (SCOPE_ROOT_ID) elements.quickRunLayer.hidden = true;

const keyboard = createKeyboardController({
  document,
  elements,
  store,
  commands,
  closeMenu,
  getVisibleItemIds: visibleItemIds,
  confirmDialog,
  beginSetMembershipEdit: () => setMembershipMode.begin(),
  setMembershipMode,
  setStatus,
  beginSetRename,
  commandSurface: commandSurfaceMode === 'overlay',
  openQuickRun,
  toggleSidePanes: () => {
    if (!workspaceNavigator || !fileCapabilityPanel || fileCapabilityPanel.isFullPage?.()) return false;
    const bothCollapsed = workspaceNavigator.isCollapsed?.() === true
      && fileCapabilityPanel.isExpanded?.() === false;
    workspaceNavigator.setCollapsed?.(!bothCollapsed);
    fileCapabilityPanel.setExpanded?.(bothCollapsed);
    return true;
  },
});

// The three entrances to one surface, in one place.
//
// The chord the catalog declares (which the controller reports, whether it was pressed on the canvas or
// through a dialog) and the host's relayed Alt+A are the same gesture and toggle: the same key dismisses a
// palette it opened, which is what the creator expected of it. A seed is the other way in (type-to-run):
// the controller has already decided that this keystroke is a letter and not a binding, and hands the
// letter over so the palette opens with it in the line. A seeded call always OPENS — toggle semantics
// belong to the chord, and a reader who typed a letter while the palette was up is typing into the line,
// which the controller's own guard arranges.
//
// Named rather than inline because the overlay's invocation listener above the controller also needs it.
// One chord, one toggle. The same Alt+A can reach two receivers - the in-page
// shortcut and the widget's own Quick Run path - and a toggle that runs twice
// opens the palette and closes it again in the same instant, which the creator
// sees as "it got cancelled immediately". A second toggle inside this window is
// the same gesture arriving twice, not a new one, so it is ignored.
const QUICK_RUN_TOGGLE_COALESCE_MS = 300;
let quickRunToggleHandledAt = 0;

function openQuickRun(seed) {
  if (SCOPE_ROOT_ID) {
    setStatus('Quick Run is unavailable inside a project folder.');
    return;
  }
  if (typeof seed === 'string' && seed !== '') return quickRun.open(seed);
  const now = Date.now();
  if (now - quickRunToggleHandledAt < QUICK_RUN_TOGGLE_COALESCE_MS) {
    return quickRun.session().open;
  }
  quickRunToggleHandledAt = now;
  return quickRun.toggle();
}

const promptLibrary = createPromptLibraryDialog({
  document,
  store,
  fallbackPrompt: PICKUP_PROMPT,
  copyText: (text) => host.copyText(text),
  setStatus,
  onViewPreferencesChanged: (next) => {
    applyTheme(next.view?.preferences);
    graph.refreshEdgeOpacity();
    render();
  },
});

// ---- 019C compact-widget surface bootstrap --------------------------------
// `?papers-surface=compact-widget&papers-layout-key=<id>` renders ONLY the named
// layout's card and routes every card interaction through the same-origin
// widget channel to the WORKSPACE writer. No old 018 wait-for-ACTIVATE/read-only
// lifecycle; widget-ready is reported after the channel message listener exists.
// The widget never writes the store/save/recording persistence.
function bootstrapWindowLayoutWidget() {
  const { layoutId } = WIDGET_SURFACE;
  const widgetOpacityStorageKey = `papers-window-layout-widget-opacity:${layoutId}`;
  const storedWidgetOpacity = localStorage.getItem(widgetOpacityStorageKey);
  const parsedWidgetOpacity = storedWidgetOpacity === null ? Number.NaN : Number(storedWidgetOpacity);
  let widgetOpacity = Number.isFinite(parsedWidgetOpacity)
    ? Math.max(0, Math.min(1, parsedWidgetOpacity))
    : 1;

  function applyWidgetOpacity() {
    const opacity = widgetOpacity;
    document.documentElement.style.setProperty('--workspace-backdrop-opacity', String(opacity));
    document.documentElement.style.setProperty(
      '--workspace-backdrop-opacity-percent',
      `${Math.round(opacity * 10000) / 100}%`,
    );
  }
  const channel = createSafeBroadcastChannel(WINDOW_LAYOUT_WIDGET_CHANNEL);
  const widgetState = {
    selection: new Set(),
    clearArmed: false,
    clearArmTimer: null,
    anchor: new Map(),
    snapshot: { id: layoutId, name: layoutId, tracking: { enabled: false }, members: [] },
    candidates: null,
    pickUnsubscribe: null,
    pickAttempt: null,
    lastRevision: -1,
    // What the currently mounted card DOM was built from. Protocol revision is
    // NOT that identity: see windowLayoutWidgetRenderIdentity.
    lastRenderIdentity: null,
    // 035: true once a real workspace snapshot has been received (the restore
    // below must never run against the empty initial default snapshot).
    snapshotReceived: false,
    blockedHotkeyBindings: [],
    hoverPolicyReceived: false,
  };
  const widgetClearGuard = createClickTwiceGuard();
  const widgetDeleteGuard = createClickTwiceGuard();
  const widgetHoverPolicyDiagnostics = createWidgetHoverPolicyDiagnostics();
  const widgetHoverPolicy = createWidgetHoverPolicy({
    publish: (enabled, blockedBindings) => host.setWidgetHoverPolicy(enabled, blockedBindings),
    onPublishFailure: widgetHoverPolicyDiagnostics.onPublishFailure,
    onPublishSuccess: widgetHoverPolicyDiagnostics.onPublishSuccess,
  });
  const widgetRoot = document.documentElement;
  const onWidgetPointerEnter = (event) => {
    if (event.pointerType === 'mouse') widgetHoverPolicy.setHovered(true);
  };
  const onWidgetPointerLeave = (event) => {
    if (event.pointerType === 'mouse') widgetHoverPolicy.setHovered(false);
  };
  widgetRoot.addEventListener('pointerenter', onWidgetPointerEnter);
  widgetRoot.addEventListener('pointermove', onWidgetPointerEnter);
  widgetRoot.addEventListener('pointerleave', onWidgetPointerLeave);
  // 035: the widget restores its window size EXACTLY ONCE after the first real
  // snapshot; every later resize is user-owned and only reported for persistence.
  let windowRestoredOnce = false;
  // 019G/021: bounded snapshot re-request for a transient unknown-layout.
  let snapshotRetry = null;
  let snapshotRetryCooldownTimer = null;
  const MAX_SNAPSHOT_RETRY_ARMINGS = 3;
  let snapshotRetryArmings = 0;
  function renderWidgetBootstrapCard(message) {
    const card = document.createElement('div');
    card.className = 'window-layout-card window-layout-card--bootstrap';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    card.textContent = message;
    elements.grid.replaceChildren(card);
  }
  /** A resolved open ends the cold-open episode: stop any running retry and let
   * a LATER unresolved open arm a fresh budget rather than inheriting a spent
   * one from this widget's whole lifetime. */
  function cancelSnapshotRetry() {
    snapshotRetry?.cancel?.();
    snapshotRetry = null;
    if (snapshotRetryCooldownTimer !== null) clearTimeout(snapshotRetryCooldownTimer);
    snapshotRetryCooldownTimer = null;
    snapshotRetryArmings = 0;
  }

  /** A cold widget can miss the first BroadcastChannel request before its
   * workspace writer is ready. Unlike an explicit unknown-layout response,
   * that race is silent, so retry a small bounded number of times and leave a
   * compact, understandable surface instead of exposing the whole Backpack
   * shell or remaining blank forever. */
  function armSnapshotRetry() {
    if (widgetState.snapshotReceived || snapshotRetry || snapshotRetryCooldownTimer !== null
      || snapshotRetryArmings >= MAX_SNAPSHOT_RETRY_ARMINGS) return;
    snapshotRetryArmings += 1;
    snapshotRetry = createBoundedRetry({
      attempts: 3,
      delayMs: 250,
      request: () => { client.requestSnapshot(); return null; },
      shouldRetry: () => !widgetState.snapshotReceived,
      onResult: () => {
        snapshotRetry = null;
        if (widgetState.snapshotReceived) return;
        const exhausted = snapshotRetryArmings >= MAX_SNAPSHOT_RETRY_ARMINGS;
        renderWidgetBootstrapCard(exhausted
          ? 'This window layout no longer exists.'
          : 'Waiting for the window layout…');
        if (exhausted) {
          void host.widgetCloseSelf().catch(() => undefined);
          return;
        }
        if (snapshotRetryArmings < MAX_SNAPSHOT_RETRY_ARMINGS) {
          snapshotRetryCooldownTimer = setTimeout(() => {
            snapshotRetryCooldownTimer = null;
            armSnapshotRetry();
          }, 500);
        }
      },
    });
    snapshotRetry.start();
  }

  function handleWidgetMessage(message) {
    // Deletion is document-global but native widget ownership is Papers-window
    // scoped. The elected writer may live in a different Papers window, so its
    // best-effort widgetClose(layoutId) can target the wrong owner even after
    // the durable delete succeeded. A committed deletion therefore closes from
    // the widget's own authenticated surface, which always names the exact
    // native window that must disappear.
    if (message.type === 'committed' && message.deleted === true) {
      cancelSnapshotRetry();
      void host.widgetCloseSelf().catch(() => undefined);
      return;
    }
    if (message.type === 'hover-policy') {
      if (typeof message.enabled !== 'boolean'
        || !Array.isArray(message.blockedBindings) || message.blockedBindings.length > 256
        || message.blockedBindings.some((binding) => typeof binding !== 'string' || binding.length > 64)) return;
      const modalOpen = [...document.querySelectorAll('[role="dialog"], dialog')]
        .some((dialog) => !dialog.hidden && dialog.getClientRects().length > 0);
      widgetState.blockedHotkeyBindings = message.blockedBindings;
      widgetState.hoverPolicyReceived = true;
      widgetHoverPolicy.updateWorkspacePolicy(message.enabled && !modalOpen, message.blockedBindings);
      return;
    }
    if (message.type === 'snapshot' || message.type === 'committed' || message.type === 'stale') {
      if (typeof message.revision !== 'number') return;
      // A committed response may carry one short sentence about what actually happened (a pick whose
      // removals were all refused, or one that removed some and could not match others). It is shown HERE,
      // before the render-identity guard below and not inside it: a refusal-only pick changes nothing, so
      // its snapshot is identical to the card already on screen and that guard would return early - leaving
      // this surface exactly as silent about the refusal as it was before the sentence existed.
      const committedStatus = windowLayoutWidgetCommittedStatus(message.status);
      if (committedStatus !== null) setWindowLayoutStatus(layoutId, committedStatus);
      widgetState.lastRevision = message.revision;
      if (message.snapshot && typeof message.snapshot === 'object' && message.snapshot.id === layoutId) {
        widgetState.snapshot = message.snapshot;
        windowControlWidgetSnapshot = message.snapshot;
        windowControlSignature = '';
        if (message.snapshot.appearance && typeof message.snapshot.appearance === 'object') {
          applyTheme(message.snapshot.appearance);
          // Widget opacity is independent of workspace opacity. A fresh widget
          // is solid; only this widget's own saved/wheel-adjusted value applies.
          applyWidgetOpacity();
        }
        widgetState.snapshotReceived = true;
        const memberIds = new Set((message.snapshot.members ?? []).map((member) => member.id));
        for (const memberId of [...widgetState.selection]) {
          if (!memberIds.has(memberId)) widgetState.selection.delete(memberId);
        }
        // renderWidgetCard replaces elements.grid.innerHTML wholesale, which
        // destroys every member button and the pointer's hover target with it.
        // A duplicate message must therefore leave the live DOM alone: the
        // creator saw every icon flicker at once, and clicks fall through,
        // when repeated snapshots rebuild a card whose content never changed.
        // A real snapshot arrived, so any in-flight cold-open retry has served
        // its purpose; leaving it running would emit redundant requests.
        cancelSnapshotRetry();
        const renderIdentity = windowLayoutWidgetRenderIdentity(message.snapshot);
        if (renderIdentity === widgetState.lastRenderIdentity) return;
        // Recorded only AFTER a successful render: were the render to throw,
        // latching the identity first would suppress every identical retry and
        // strand the card on stale DOM.
        renderWidgetCard({ skipHostResize: message.reason === 'reorder' || message.commandKind === 'reorder' });
        widgetState.lastRenderIdentity = renderIdentity;
      }
      return;
    }
    if (message.type === 'error') {
      if (message.code === 'unknown-layout') {
        if (widgetState.snapshotReceived) {
          // A widget that previously held an authoritative snapshot cannot
          // legitimately outlive that layout. This is the orphan case left by
          // cross-window deletion or an external durable removal: close the
          // exact widget instead of leaving an interactive-looking dead shell.
          cancelSnapshotRetry();
          void host.widgetCloseSelf().catch(() => undefined);
          return;
        }
        armSnapshotRetry();
        return;
      }
      if (!widgetState.snapshotReceived) {
        renderWidgetBootstrapCard(message.message || 'The window layout is not available yet.');
        armSnapshotRetry();
        return;
      }
      setWindowLayoutStatus(layoutId, message.message || message.code || 'Command failed');
    }
  }

  function renderWidgetCard({ skipHostResize = false } = {}) {
    // 019GR: replacing the card must cancel the hover preview and hide the
    // popover so a late reply cannot paint a removed/replaced card. The
    // snapshot ref feeds the surface-aware preview resolver.
    windowLayoutMemberPreview.cancel();
    windowLayoutMemberPopover.hide();
    // The previous button node is about to be replaced; discard any armed
    // confirmation so its invisible state cannot survive without a red cue.
    resetWidgetClearArm();
    resetWidgetDeleteArm();
    // A capability identifies a WINDOW. A member going normal -> minimized does
    // not change which window it is, yet member state is part of the widget's
    // render identity, so the old blanket clear threw away every warm
    // capability on every successful toggle. That is what made ping-ponging
    // between two icons uniquely slow: each click re-cooled BOTH members, so
    // the next hover paid a fresh desktop list plus a bind/observe on the same
    // serial helper the click needs. Evict by descriptor identity instead.
    evictStaleWidgetPreviewCapabilities(widgetState.snapshot);
    windowLayoutWidgetPreviewSnapshot = widgetState.snapshot;
    // 019G/021: seed the shared icon cache from the snapshot's bounded icons so
    // the SAME member markup renders REAL member icons (prune stale ones).
    // 040: composite layout\u0000member cache identity — prune only THIS
    // layout's keys that are no longer in the snapshot.
    const snapshot = widgetState.snapshot;
    reconcileWindowLayoutIconSnapshotCache(
      windowLayoutRuntime.icons,
      layoutId,
      snapshot.members,
      windowLayoutMemberKey,
    );
    // 033 C5: the detached widget renders the EXACT SAME card component as the
    // attached grid node - one shared card, two homes.
    removeWindowLayoutCardPresentation(elements.grid);
    elements.grid.innerHTML = windowLayoutCardMarkup(
      {
        id: snapshot.id,
        name: snapshot.name,
        tracking: snapshot.tracking,
        arrangement: { members: snapshot.members },
      },
      { widgetSurface: true },
    );
    installWindowLayoutCardPresentation(elements.grid);
    const card = elements.grid.querySelector('.window-layout-body');
    if (card) {
      card.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        if (event.button === 0 && !event.ctrlKey && !event.shiftKey
          && !event.target.closest('button, input, [data-wl-member]')) {
          clearWidgetSelection();
          beginBlankWidgetDrag(event, card);
        }
      });
      card.addEventListener('click', handleWidgetCardClick);
      card.addEventListener('auxclick', handleWidgetCardAuxClick);
      card.addEventListener('mouseover', (event) => {
        const listButton = event.target.closest('[data-wl-list]');
        const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
        if (listButton && listButton !== relatedListButton) {
          scheduleWindowLayoutListDwell(listButton, openWidgetPicker);
        }
      });
      card.addEventListener('mouseout', (event) => {
        const listButton = event.target.closest('[data-wl-list]');
        const relatedListButton = event.relatedTarget?.closest?.('[data-wl-list]') ?? null;
        if (listButton && listButton !== relatedListButton) cancelWindowLayoutListDwell();
      });
      card.addEventListener('contextmenu', handleWidgetCardContextMenu);
    }
    syncWidgetSelection();
    // 035: restore the window ONCE after the first real snapshot (persisted
    // shared card geometry, or a content-fit when none exists yet). 039: after
    // that, EVERY re-render (e.g. a member-count change) auto-corrects the
    // native client height to the rendered card content height. The FIRST
    // restore reports BOTH axes itself; its own native resize event drives the
    // follow-up height correction, so the correction never measures the
    // transient default width (which would clobber the restored width).
    const wasRestored = windowRestoredOnce;
    restoreWidgetWindowSize();
    if (wasRestored && !skipHostResize) reportWidgetSize();
  }

  /** 035: the full card content size — the card root plus any member/control
   * strip content that must not be clipped by the hidden scrollbars. The card
   * fills its host width, so the measured width equals the window content
   * width and only the height is a real content-fit input. */
  function measureWidgetCardContent() {
    const cardEl = elements.grid.querySelector('.window-layout-card');
    if (!cardEl) return null;
    const rect = cardEl.getBoundingClientRect();
    let width = rect.width;
    // `getBoundingClientRect()` is clipped to the current native viewport when
    // a width resize creates extra wrapped rows. scrollHeight retains the full
    // laid-out card, including content below the clipped bottom edge.
    let height = Math.max(rect.height, cardEl.scrollHeight);
    for (const strip of cardEl.querySelectorAll('[data-wl-members], .window-layout-controls')) {
      if (strip.scrollWidth > width) width = strip.scrollWidth;
    }
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  /** 035: restore the frameless widget window exactly once, after the first
   * real workspace snapshot. With a persisted shared geometry the window opens
   * at that size (the layout's last resize); without one it content-fits to
   * the card's natural size. The host applies the report verbatim (no
   * +tolerance), so the card's fill-width never creeps. */
  function restoreWidgetWindowSize() {
    if (windowRestoredOnce || !widgetState.snapshotReceived) return;
    windowRestoredOnce = true;
    const cardSize = widgetState.snapshot?.cardSize;
    if (cardSize && typeof cardSize.width === 'number' && typeof cardSize.height === 'number'
      && Number.isFinite(cardSize.width) && Number.isFinite(cardSize.height)
      && cardSize.width >= 1 && cardSize.height >= 1) {
      // 037: a persisted width is the actual card/client width; an over-max
      // legacy value is capped so the window opens content-fitted immediately.
      void host.widgetReportSize(
        Math.round(Math.min(cardSize.width, WINDOW_LAYOUT_CARD_MAX_WIDTH)),
        Math.round(cardSize.height),
      ).catch(() => undefined);
      return;
    }
    const memberCount = widgetState.snapshot?.members?.length ?? 0;
    const preferredColumns = memberCount <= 8 ? Math.max(1, memberCount) : Math.ceil(memberCount / Math.ceil(memberCount / 8));
    const naturalWidth = Math.min(WINDOW_LAYOUT_CARD_MAX_WIDTH, Math.max(158, (preferredColumns * 28) + ((preferredColumns - 1) * 4) + 16));
    const content = measureWidgetCardContent();
    if (content && content.height > 0) {
      void host.widgetReportSize(naturalWidth, content.height).catch(() => undefined);
    }
  }

  /** 039/041: report the ACTUAL shared card/client presentation geometry —
   * WIDTH = the rendered card border-box width (content-fit, capped at the
   * compact maximum; a few-member card never retains a wide empty minimum) and
   * HEIGHT = the rendered card content height. When the card reflows (a user
   * width resize or a member-count change) the native client is auto-corrected
   * to the card border box, so the detached host equals the card in BOTH axes
   * with no empty vertical canvas and no clipping. The width stays user-
   * resizable (narrowing drives wrapping) and continuously measurement-driven;
   * the report also persists the shared geometry so reattach matches. */
  function reportWidgetSize() {
    const width = window.innerWidth;
    const content = measureWidgetCardContent();
    const cardWidth = Math.min(width, WINDOW_LAYOUT_CARD_MAX_WIDTH);
    const height = content && content.height > 0 ? content.height : window.innerHeight;
    // 037: snap an over-max client width; 039: auto-correct the client height;
    // 041: snap the client width to the content-fit card border box. One report.
    if (width > WINDOW_LAYOUT_CARD_MAX_WIDTH
      || Math.abs(height - window.innerHeight) > 1) {
      void host.widgetReportSize(cardWidth, height).catch(() => undefined);
    }
    client.sendCardSize(cardWidth, height);
  }

  function syncWidgetSelection() {
    for (const button of elements.grid.querySelectorAll('[data-wl-member]')) {
      const selected = widgetState.selection.has(button.dataset.wlMember);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-selected', String(selected));
    }
  }

  function toggleWidgetMemberSelection(memberId) {
    if (widgetState.selection.has(memberId)) widgetState.selection.delete(memberId);
    else widgetState.selection.add(memberId);
    widgetState.anchor.set(layoutId, memberId);
    syncWidgetSelection();
  }

  function clearWidgetSelection() {
    if (widgetState.selection.size === 0) return;
    widgetState.selection.clear();
    widgetState.anchor.delete(layoutId);
    syncWidgetSelection();
  }

  let blankWidgetDrag = null;
  function signalBlankWidgetDrag(phase, event) {
    window.postMessage({
      type: 'papers:project:widget-drag',
      phase,
      x: event.screenX,
      y: event.screenY,
    }, window.location.origin);
  }

  function beginBlankWidgetDrag(event, card) {
    blankWidgetDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    card.setPointerCapture?.(event.pointerId);
    signalBlankWidgetDrag('begin', event);
  }

  window.addEventListener('pointermove', (event) => {
    if (!blankWidgetDrag || blankWidgetDrag.pointerId !== event.pointerId) return;
    if (!blankWidgetDrag.dragging) {
      const distance = Math.hypot(event.clientX - blankWidgetDrag.startX, event.clientY - blankWidgetDrag.startY);
      if (distance < 4) return;
      blankWidgetDrag.dragging = true;
    }
    event.preventDefault();
    signalBlankWidgetDrag('move', event);
  }, { capture: true });

  const endBlankWidgetDrag = (event) => {
    if (!blankWidgetDrag || blankWidgetDrag.pointerId !== event.pointerId) return;
    signalBlankWidgetDrag('end', event);
    blankWidgetDrag = null;
  };
  window.addEventListener('pointerup', endBlankWidgetDrag, { capture: true });
  window.addEventListener('pointercancel', endBlankWidgetDrag, { capture: true });

  // Leaving the detached widget for Papers/Backpack cancels only its ephemeral
  // Ctrl/Shift member selection. The widget and persisted layout stay open and
  // unchanged.
  // Capture the plain press at the window boundary as well as the card click:
  // native frameless dragging/pointer capture may suppress the later click,
  // but a blank press must always clear the ephemeral Ctrl/range selection.
  window.addEventListener('pointerdown', (event) => {
    if (event.button === 0 && !event.ctrlKey && !event.shiftKey
      && !event.target.closest('button, input, [data-wl-member]')) clearWidgetSelection();
  }, { capture: true });
  window.addEventListener('blur', clearWidgetSelection);
  windowLayoutWidgetSelectionChannel?.addEventListener('message', (event) => {
    if (event.data?.type === 'clear-selection') clearWidgetSelection();
  });

  async function sendWidgetNativeActions(actions) {
    if (typeof host.windowControlGroup !== 'function') {
      setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
      return;
    }
    const result = await host.windowControlGroup(layoutId, actions).catch(() => ({ outcome: 'helper-unavailable' }));
    if (result?.outcome !== 'success') {
      setWindowLayoutStatus(layoutId, 'Native window control is unavailable.');
    }
  }

  async function activateWidgetMember(memberId) {
    windowLayoutMemberPreview.cancel();
    const activated = await host.windowControlActivate(layoutId, memberId)
      .catch(() => ({ outcome: 'helper-unavailable' }));
    if (activated?.outcome !== 'activated') {
      setWindowLayoutStatus(layoutId, 'Windows did not give that window the foreground ('
        + String(activated?.outcome ?? 'no answer') + ').');
    }
  }

  function widgetGroupTargets() {
    const members = widgetState.snapshot.members ?? [];
    return widgetState.selection.size > 0
      ? members.filter((member) => widgetState.selection.has(member.id))
      : members;
  }

  function handleWidgetCardClick(event) {
    event.stopPropagation();
    const deleteButton = event.target.closest('[data-wl-delete]');
    if (deleteButton) {
      const outcome = handleWidgetDeleteActivation(event, deleteButton, widgetDeleteGuard, () => {
        resetWidgetDeleteArm();
        client.sendCommand({ kind: 'delete-layout' });
      });
      if (outcome === 'armed' || outcome === 'deleted') event.stopPropagation();
      return;
    }
    const clearButton = event.target.closest('[data-wl-clear]');
    if (clearButton) {
      const outcome = handleWidgetClearActivation(event, clearButton, widgetClearGuard, () => {
        resetWidgetClearArm();
        client.sendCommand({ kind: 'clear-layout' });
      });
      if (outcome === 'armed' || outcome === 'cleared') event.stopPropagation();
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    if (member) {
      if (widgetDragJustMoved) {
        widgetDragJustMoved = false;
        return;
      }
      const memberId = member.dataset.wlMember;
      const isolationTargets = !event.ctrlKey && !event.shiftKey
        ? windowLayoutRuntime.isolateMode.click(layoutId, memberId, false)
        : null;
      if (isolationTargets !== null) {
        client.sendCommand({ kind: 'group-action', action: 'isolate', memberIds: isolationTargets });
        return;
      }
      if (event.ctrlKey) {
        // 019C: widget-local ephemeral selection (Ctrl toggle / Shift range);
        // only committed actions are routed to the workspace writer.
        toggleWidgetMemberSelection(memberId);
        return;
      }
      if (event.shiftKey) {
        const ordered = (widgetState.snapshot.members ?? []).map((candidate) => candidate.id);
        const anchorId = widgetState.anchor.get(layoutId);
        const anchorIndex = ordered.indexOf(anchorId);
        const clickedIndex = ordered.indexOf(memberId);
        widgetState.selection = new Set();
        if (anchorIndex === -1 || clickedIndex === -1) {
          widgetState.selection.add(memberId);
        } else {
          const [start, end] = anchorIndex <= clickedIndex
            ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex];
          for (let index = start; index <= end; index += 1) widgetState.selection.add(ordered[index]);
        }
        widgetState.anchor.set(layoutId, memberId);
        syncWidgetSelection();
        return;
      }
      // A plain left click raises this exact member. Right click owns the
      // minimize/restore toggle in handleWidgetCardContextMenu.
      if (!member.disabled) void activateWidgetMember(memberId);
      return;
    }
    const pickCandidate = event.target.closest('[data-wl-pick-candidate]');
    if (pickCandidate) {
      void handleWidgetListCandidate(pickCandidate.dataset.wlPickCandidate);
      return;
    }
    const pickerClose = event.target.closest('[data-wl-picker-close]');
    if (pickerClose) {
      closeWidgetPicker();
      return;
    }
    const listButton = event.target.closest('[data-wl-list]');
    if (listButton) {
      cancelWindowLayoutListDwell();
      void beginWidgetDirectPick();
      return;
    }
    const trackingButton = event.target.closest('[data-wl-track]');
    if (trackingButton) {
      client.sendCommand({ kind: 'toggle-tracking' });
      return;
    }
    const minAll = event.target.closest('[data-wl-min-all]');
    if (minAll) {
      void sendWidgetNativeActions(widgetGroupTargets().map(({ id: memberId }) => ({ memberId, operation: 'minimize' })));
      return;
    }
    const restoreAll = event.target.closest('[data-wl-restore-all]');
    if (restoreAll) {
      void sendWidgetNativeActions(widgetGroupTargets().map(({ id: memberId }) => ({ memberId, operation: 'restore' })));
      return;
    }
    // Plain blank-card click exits the widget-local Ctrl/range selection. This
    // is ephemeral presentation state only: no member is toggled, no command
    // is sent to the workspace writer, and no layout data is changed.
    if (widgetState.selection.size > 0) {
      clearWidgetSelection();
    }
  }

  function resetWidgetClearArm() {
    widgetClearGuard.reset();
    elements.grid.querySelector('.window-layout-card [data-wl-clear]')?.classList.remove('is-clear-armed');
  }

  function resetWidgetDeleteArm() {
    widgetDeleteGuard.reset();
    elements.grid.querySelector('.window-layout-card [data-wl-delete]')?.classList.remove('is-delete-armed');
  }

  elements.grid.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-wl-clear]')
      && !event.relatedTarget?.closest?.('[data-wl-clear]')) resetWidgetClearArm();
    if (event.target.closest('[data-wl-delete]')
      && !event.relatedTarget?.closest?.('[data-wl-delete]')) resetWidgetDeleteArm();
  });
  window.addEventListener('blur', resetWidgetClearArm);
  window.addEventListener('blur', resetWidgetDeleteArm);

  function handleWidgetCardAuxClick(event) {
    if (event.button !== 1) return;
    const member = event.target.closest('[data-wl-member]');
    if (member && !member.disabled) {
      event.preventDefault();
      event.stopPropagation();
      windowLayoutMemberPreview.cancel();
      if (event.ctrlKey) {
        // Ctrl+MMB closes the native window/process, then the confirmed close
        // retires its exact member identity from every layout.
        void closeWindowLayoutMember(layoutId, member.dataset.wlMember);
      } else {
        // Plain MMB only unlinks the clicked icon from this layout.
        client.sendCommand({ kind: 'remove-member', memberId: member.dataset.wlMember });
      }
      return;
    }
    const minimizeAll = event.target.closest('[data-wl-min-all]');
    if (!minimizeAll) return;
    event.preventDefault();
    event.stopPropagation();
    client.sendCommand({ kind: 'dock-widget-to-pill' });
  }

  async function handleWidgetCardContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const isolateToggle = event.target.closest('[data-wl-min-all]');
    if (isolateToggle) {
      toggleWindowLayoutIsolateMode(isolateToggle.dataset.wlMinAll);
      return;
    }
    const member = event.target.closest('[data-wl-member]');
    if (member && event.ctrlKey && !event.shiftKey && windowLayoutRuntime.isolateMode.isActive(layoutId)) {
      const targets = windowLayoutRuntime.isolateMode.click(layoutId, member.dataset.wlMember, true);
      if (targets !== null) client.sendCommand({ kind: 'group-action', action: 'isolate', memberIds: targets });
      return;
    }
    if (member && event.shiftKey) {
      client.sendCommand({
        kind: 'range-toggle',
        memberId: member.dataset.wlMember,
        memberIds: [...widgetState.selection],
      });
      return;
    }
    // A detached widget is frequently narrower than an ordinary menu. Ask its
    // trusted native host for a real popup so the action can extend beyond the
    // widget bounds and dismiss normally with Escape, blur or an outside click.
    if (member) {
      const memberId = member.dataset.wlMember;
      if (!memberId || member.disabled) return;
      windowLayoutMemberPreview.cancel();
      // The browser context menu is suppressed above; the right button is the
      // member's minimize/restore gesture instead.
      await sendWidgetNativeActions([{ memberId, operation: 'toggle' }]);
      return;
    }
  }

  let widgetPickerOpen = false;
  let widgetPickerGeneration = 0;
  async function openWidgetPicker() {
    if (widgetPickerOpen) {
      // A native chooser can disappear independently. Re-entering the list
      // control is an explicit recovery request: invalidate the old attempt
      // before starting a fresh one so its late reply cannot mutate this
      // widget or leave the control permanently inert.
      closeWidgetPicker();
    }
    const generation = ++widgetPickerGeneration;
    widgetPickerOpen = true;
    const ownsPicker = () => widgetPickerOpen && widgetPickerGeneration === generation;
    // 019G: a picker covering the desktop must clear/discard the hover preview.
    windowLayoutMemberPreview.cancel();
    try {
      while (true) {
        const pickerId = crypto.randomUUID();
        let session;
        if (typeof host.windowCandidatePickerUpdate === 'function') {
          session = await openWindowLayoutPickerSession({
            pickerId,
            openPicker: (id) => host.windowCandidatePicker([], id),
            loadCandidates: () => host.windowCandidates({ includeNativeIcons: false }),
            updatePicker: (candidates, id) => host.windowCandidatePickerUpdate(toWindowLayoutPickerRows(
              candidates, widgetState.snapshot.members ?? [], windowLayoutCandidateIsMember,
            ), id),
            isCurrent: ownsPicker,
          });
        } else {
          const result = await host.windowCandidates({ includeNativeIcons: false });
          if (!ownsPicker()) return;
          session = result.outcome === 'success'
            ? { outcome: 'success', candidates: result.candidates, actionPromise: host.windowCandidatePicker(
              toWindowLayoutPickerRows(result.candidates, widgetState.snapshot.members ?? [], windowLayoutCandidateIsMember),
            ) }
            : { outcome: 'list-error', error: result.error || 'List unavailable', candidates: [] };
        }
        if (!ownsPicker() || session.outcome === 'stale') return;
        if (session.outcome === 'list-error' || session.outcome === 'picker-error' || session.outcome === 'update-error') {
          const error = session.error;
          setWindowLayoutStatus(layoutId, error instanceof Error ? error.message
            : (typeof error === 'string' ? error : 'List unavailable'));
          break;
        }
        widgetState.candidates = session.candidates;
        // The chooser stays open while searching/selecting. Recompute its
        // presentation state after every authoritative command acknowledgement.
        const picked = session.outcome === 'action' ? session.action : await session.actionPromise;
        if (!ownsPicker()) return;
        if (picked?.action === 'close' && picked.candidateId) {
          await closeWindowLayoutCandidate(layoutId, picked.candidateId, session.candidates);
          if (!ownsPicker()) return;
          continue;
        }
        if (picked?.action === 'direct-pick') {
          await beginWidgetDirectPick();
          break;
        }
        if (picked?.action !== 'select' || !picked.candidateId) break;
        await handleWidgetListCandidate(picked.candidateId);
        if (!ownsPicker()) return;
      }
    } catch (error) {
      if (!ownsPicker()) return;
      setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : String(error));
    } finally {
      if (ownsPicker()) closeWidgetPicker();
    }
  }

  function windowLayoutWidgetPickerMarkup(candidates) {
    const rows = candidates.map((candidate) => {
      const isCurrent = windowLayoutCandidateIsMember(widgetState.snapshot.members ?? [], candidate);
      return `<button class="window-layout-pick-candidate${isCurrent ? ' current-member' : ''}" data-wl-pick-candidate="${escapeHtml(candidate.id)}" type="button" title="${escapeHtml(candidate.title)}">
        ${candidate.icon
          ? `<img class="window-layout-pick-icon" src="${escapeHtml(candidate.icon)}" alt="">`
          : '<span class="window-layout-pick-icon placeholder" aria-hidden="true"></span>'}
        <span class="window-layout-pick-label">${escapeHtml(candidate.title)}</span>
        <span class="window-layout-pick-state">${isCurrent ? 'remove' : escapeHtml(candidate.state ?? 'add')}</span>
      </button>`;
    }).join('');
    return `<div class="window-layout-picker-panel">
      <div class="window-layout-picker-head">Choose an onscreen window (click a member row to remove it)
        <button class="window-layout-picker-close" data-wl-picker-close="true" type="button" title="Close picker">×</button>
      </div>
      <div class="window-layout-picker-list">${rows || '<div class="window-layout-empty">No eligible windows</div>'}</div>
    </div>`;
  }

  function closeWidgetPicker({ requireClosed = false } = {}) {
    widgetState.candidates = null;
    const pickerHost = elements.grid.querySelector(`[data-wl-picker="${CSS.escape(layoutId)}"]`);
    // A direct-pick click comes from the normal widget card, where the list
    // picker is not open. Do not issue a host dismiss request for a picker
    // that does not exist: an unanswered dismiss used to block live-pick for
    // the full bridge timeout and make every widget button appear inert.
    const wasOpen = widgetPickerOpen || Boolean(pickerHost?.innerHTML);
    // Invalidate synchronously, before awaiting the native dismiss request;
    // a late chooser response or a later finally block must not touch the
    // retired attempt or issue a duplicate close.
    widgetPickerOpen = false;
    widgetPickerGeneration += 1;
    if (pickerHost) pickerHost.innerHTML = '';
    restoreHoveredWindowLayoutPreview(layoutId);
    if (!wasOpen) return Promise.resolve();
    return requireClosed
      ? host.windowCandidatePickerClose()
      : host.windowCandidatePickerClose().catch(() => undefined);
  }

  async function handleWidgetListCandidate(candidateId, intent = 'toggle') {
    // Oct 2 regression guard: the a123d8f merge accidentally resolved this
    // conflict to the old Sep 24 path and discarded the exact row that the
    // working Oct 1 implementation carried across the native chooser await.
    // Candidate ids are deliberately short-lived; retaining the row is what
    // lets bindWindowLayoutPickerCandidate perform its bounded relist/rebind
    // recovery if that id expired while the creator was clicking it.
    const row = (widgetState.candidates ?? []).find((candidate) => candidate.id === candidateId);
    if (!row) return false;
    const picked = await bindWindowLayoutPickerCandidate(candidateId, row);
    const bound = picked.bound;
    if (bound.outcome !== 'success') {
      setWindowLayoutStatus(layoutId, bound.error || 'Pick failed');
      return false;
    }
    // Candidate current-state is presentation-only: it has no persisted
    // executable fingerprint. After bind, exact descriptor identity decides
    // whether this candidate is an add or a removal.
    const pick = windowLayoutPickForBoundCandidate(
      widgetState.snapshot.members ?? [],
      bound,
      picked.row,
      intent,
    );
  if (!pick) {
    setWindowLayoutStatus(layoutId, windowLayoutHasValidInstanceId(bound.descriptor)
      ? 'Window identity could not be confirmed; no layout change was made.'
      : 'Window identity is unavailable; no layout change was made.');
      return false;
    }
    if (intent === 'remove' && pick.removes.length === 0) return false;
    const command = { kind: 'picker-commit', pick };
    let acknowledgement = await client.sendCommandAndWait(command, { timeoutMs: 30000 });
    if (acknowledgement?.type === 'stale') {
      acknowledgement = await client.sendCommandAndWait(command, { timeoutMs: 30000 });
    }
    if (acknowledgement?.type === 'error') {
      setWindowLayoutStatus(layoutId, acknowledgement.message || acknowledgement.code || 'Pick failed');
      return false;
    }
    return true;
  }

  async function beginWidgetDirectPick() {
    // 019G: the pick overlay covers the desktop; clear/discard the hover preview.
    windowLayoutMemberPreview.cancel();
    // Mirror the attached surface's per-attempt token. A second click
    // supersedes the first BEFORE any awaited chooser/cancel/begin work can
    // resume and mutate status or shared picker ownership.
    const pickAttempt = Symbol('window-layout-widget-direct-pick');
    widgetState.pickAttempt = pickAttempt;
    // As on the attached surface, the native chooser must be fully destroyed
    // before starting the direct picker or it can steal picker ownership.
    try {
      await closeWidgetPicker({ requireClosed: true });
    } catch (error) {
      if (widgetState.pickAttempt === pickAttempt) {
        widgetState.pickAttempt = null;
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Window list could not close');
      }
      return;
    }
    if (widgetState.pickAttempt !== pickAttempt) return;
    const members = windowLayoutPickMemberDescriptors(
      (widgetState.snapshot.members ?? []).map((member) => member.descriptor),
    );
    if (!members) {
      if (widgetState.pickAttempt === pickAttempt) widgetState.pickAttempt = null;
      setWindowLayoutStatus(layoutId, 'A saved window identity is invalid; Direct Pick could not start.');
      return;
    }
    windowLayoutRuntime.pickLayoutId = layoutId;
    let pickUnsubscribe = null;
    try {
      // Recover an orphaned main-process picker before starting this widget's
      // fresh one-shot session. This also makes a second click a clean restart.
      await host.pickWindowCancel();
      if (widgetState.pickAttempt !== pickAttempt) return;
      // Subscribe to the result push BEFORE awaiting begin, so an immediate
      // pick never misses its result (016R pattern).
      const beginPromise = host.pickWindowBegin(members);
      const pickPromise = new Promise((resolve) => {
        pickUnsubscribe = host.onPickResult(resolve);
        widgetState.pickUnsubscribe = pickUnsubscribe;
      });
      const begin = await beginPromise;
      if (widgetState.pickAttempt !== pickAttempt) return;
      if (begin.outcome !== 'started') {
        pickUnsubscribe?.();
        if (widgetState.pickUnsubscribe === pickUnsubscribe) {
          widgetState.pickUnsubscribe = null;
        }
        setWindowLayoutStatus(layoutId, begin.error || 'Direct pick is unavailable');
        return;
      }
      const result = await pickPromise;
      if (widgetState.pickAttempt !== pickAttempt) return;
      if (result.outcome === 'failed') {
        setWindowLayoutStatus(layoutId, result.error || 'Pick failed');
        return;
      }
      if (result.outcome !== 'committed') return;
      // Winter's one typed committed set goes to the WORKSPACE writer; the
      // widget never applies it locally. Wait for the authoritative result so
      // a missing writer or a revision race cannot silently drop the pick.
      let acknowledgement = await client.sendCommandAndWait(
        { kind: 'picker-commit', pick: result },
        { timeoutMs: 30000 },
      );
      if (widgetState.pickAttempt !== pickAttempt) return;
      if (acknowledgement?.type === 'stale') {
        acknowledgement = await client.sendCommandAndWait(
          { kind: 'picker-commit', pick: result },
          { timeoutMs: 30000 },
        );
        if (widgetState.pickAttempt !== pickAttempt) return;
      }
      if (acknowledgement?.type === 'error') {
        setWindowLayoutStatus(
          layoutId,
          acknowledgement.message || acknowledgement.code || 'Pick failed',
        );
      }
    } catch (error) {
      pickUnsubscribe?.();
      if (widgetState.pickUnsubscribe === pickUnsubscribe) {
        widgetState.pickUnsubscribe = null;
      }
      if (widgetState.pickAttempt !== pickAttempt) return;
      setWindowLayoutStatus(
        layoutId,
        error instanceof Error ? error.message : String(error || 'Direct pick is unavailable'),
      );
    } finally {
      pickUnsubscribe?.();
      if (widgetState.pickUnsubscribe === pickUnsubscribe) {
        widgetState.pickUnsubscribe = null;
      }
      if (widgetState.pickAttempt === pickAttempt) {
        widgetState.pickAttempt = null;
        if (windowLayoutRuntime.pickLayoutId === layoutId) {
          windowLayoutRuntime.pickLayoutId = null;
        }
      }
    }
  }

  window.addEventListener('keydown', (event) => {
    if (!widgetState.pickUnsubscribe) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void host.pickWindowCancel();
    } else {
      event.preventDefault();
      event.stopPropagation();
      void host.pickWindowCommit();
    }
  });

  window.addEventListener('pagehide', () => {
    widgetHoverPolicy.dispose();
    widgetRoot.removeEventListener('pointerenter', onWidgetPointerEnter);
    widgetRoot.removeEventListener('pointermove', onWidgetPointerEnter);
    widgetRoot.removeEventListener('pointerleave', onWidgetPointerLeave);
    if (hoverPolicyTimer !== null) clearInterval(hoverPolicyTimer);
    const hadActivePick = Boolean(widgetState.pickAttempt || widgetState.pickUnsubscribe);
    widgetState.pickAttempt = null;
    widgetState.pickUnsubscribe?.();
    widgetState.pickUnsubscribe = null;
    if (hadActivePick) void host.pickWindowCancel().catch(() => undefined);
    cancelSnapshotRetry();
    if (cardSizeTimer !== null) {
      clearTimeout(cardSizeTimer);
      cardSizeTimer = null;
    }
    // 019GR: pagehide discards pending preview work and clears the ephemeral
    // widget capability cache.
    windowLayoutMemberPreview.cancel();
    windowLayoutWidgetPreviewCapabilities.clear();
    // 035: report the widget is closing so the workspace restores its attached
    // card (no longer a greyed placeholder).
    client.dispose();
    client.close();
    windowLayoutWidgetClient = null;
  });

  // 035/037/039: the live widget reports its shared card geometry whenever the
  // creator resizes it (debounced) so the workspace persists it. The width is
  // capped at the compact presentation maximum (over-max snaps), and the
  // HEIGHT is the rendered card content height, so the native client
  // auto-corrects to fit the card in both axes after every reflow.
  let cardSizeTimer = null;
  window.addEventListener('resize', () => {
    // Trailing-edge correction: while the creator is dragging an edge Windows
    // owns the native size and can overwrite an early correction. Re-arm on
    // every event, then fit the wrapped height once that resize burst settles.
    if (cardSizeTimer !== null) clearTimeout(cardSizeTimer);
    cardSizeTimer = setTimeout(() => {
      cardSizeTimer = null;
      reportWidgetSize();
    }, 80);
  });

  // 019C: the widget channel client installs its message listener in the
  // factory, so widget-ready is reported ONLY after the listener exists. The
  // preload latches the hidden token and forwards READY to the session; no
  // ACTIVATE/load gate.
  const client = createWindowLayoutWidgetChannelClient({
    channel,
    layoutId,
    onMessage: handleWidgetMessage,
  });
  windowLayoutWidgetClient = client;
  renderWidgetBootstrapCard('Loading window layout…');
  let hoverPolicyTimer = setInterval(() => client.requestHoverPolicy(), 400);
  client.requestHoverPolicy();
  let widgetQuickRunOpening = false;
  const widgetQuickRunAppends = new Set();
  host.onWidgetQuickRunSealRequest(async ({ generation } = {}) => {
    if (!Number.isSafeInteger(generation) || generation < 1) return;
    try {
      await Promise.all([...widgetQuickRunAppends]);
      await host.acknowledgeWidgetQuickRunSeal(generation);
    } catch (error) {
      setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Quick Run input handoff failed.');
    }
  });
  window.addEventListener('keydown', (event) => {
    if (!widgetState.hoverPolicyReceived || !widgetHoverPolicy.isHovered()
      || widgetState.pickUnsubscribe || event.defaultPrevented) return;
    const target = event.target;
    const editingTarget = target instanceof Element
      && target.matches('input, textarea, select, [contenteditable="true"], .set-name-editor');
    const modalOpen = [...document.querySelectorAll('[role="dialog"], dialog')]
      .some((dialog) => !dialog.hidden && dialog.getClientRects().length > 0);
    const plan = widgetHoverPolicy.planInput(event, {
      modalOpen,
      paletteOpen: quickRun.session().open,
      editingTarget,
      blockedBindings: widgetState.blockedHotkeyBindings,
      opening: widgetQuickRunOpening,
    });
    if (plan.kind !== 'open' && plan.kind !== 'append') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (plan.kind === 'open') {
      widgetQuickRunOpening = true;
      void host.widgetQuickRunInput('open', plan.seed).then((result) => {
        if (result?.ok !== true) setWindowLayoutStatus(
          layoutId,
          typeof result?.detail === 'string' && result.detail.trim() !== ''
            ? `Quick Run could not open: ${result.detail}`
            : 'Quick Run could not open from this widget.',
        );
      }).catch((error) => {
        setWindowLayoutStatus(layoutId, error instanceof Error ? error.message : 'Quick Run could not open from this widget.');
      }).finally(() => { widgetQuickRunOpening = false; });
      return;
    }
    const request = host.widgetQuickRunInput('append', plan.text);
    widgetQuickRunAppends.add(request);
    void request.then((result) => {
      if (result?.ok !== true) setWindowLayoutStatus(layoutId, 'A character could not be added to Quick Run.');
    }).catch(() => setWindowLayoutStatus(layoutId, 'A character could not be added to Quick Run.'))
      .finally(() => widgetQuickRunAppends.delete(request));
  }, { capture: true });
  // 040: the widget card's member context menu (`Remove from this layout`) is
  // the SHARED context menu component; it must be mounted in the widget surface
  // too (the workspace bootstrap does this, but the widget never runs it).
  menu.mount();
  // 024: member-icon reordering in the DETACHED/compact-widget card. The widget
  // never writes the store: a drag reorders the live DOM and sends a bounded
  // `reorder` intent through the channel; the workspace applies + broadcasts
  // the fresh snapshot. Capture-phase listeners run before the card's own
  // stopPropagation handlers.
  const widgetMemberDrag = createWindowLayoutMemberDrag();
  let widgetDragJustMoved = false;
  window.addEventListener('wheel', (event) => {
    // A detached widget has no scrollable document. Chromium does not always
    // preserve Ctrl in wheel events for a non-focusable native window, so the
    // wheel itself is the stable input contract here (Ctrl+wheel still works).
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = widgetOpacity;
    widgetOpacity = Math.max(0, Math.min(1, Math.round((current + (event.deltaY < 0 ? 0.05 : -0.05)) * 100) / 100));
    localStorage.setItem(widgetOpacityStorageKey, String(widgetOpacity));
    applyWidgetOpacity();
  }, { capture: true, passive: false });
  function suppressNextWidgetMemberClick() {
    widgetDragJustMoved = true;
    setTimeout(() => { widgetDragJustMoved = false; }, 0);
  }
  elements.grid.addEventListener('pointerdown', (event) => {
    const member = event.target.closest('[data-wl-member]');
    if (!member || !event.ctrlKey || event.button !== 0) return;
    event.preventDefault();
    cancelWindowLayoutPreviewDwell();
    windowLayoutMemberPopover.hide();
    windowLayoutMemberPreview.cancel();
    // A lost pointerup from a previous OS/native transition must not poison the
    // next Ctrl-drag. Each press owns a fresh captured pointer session.
    widgetMemberDrag.cancel();
    widgetMemberDrag.start({
      layoutId: member.dataset.wlLayout,
      memberId: member.dataset.wlMember,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    });
    member.classList.add('wl-member-dragging');
    // Capture on the stable grid, not the button whose DOM position changes
    // during live reorder. Moving a captured button can release capture after
    // the first insertion and incorrectly limit a drag to one slot.
    try { elements.grid.setPointerCapture(event.pointerId); } catch { /* unsupported */ }
  }, true);
  elements.grid.addEventListener('pointermove', (event) => {
    const drag = widgetMemberDrag.move(event.pointerId, event.clientX, event.clientY);
    if (!drag) return;
    event.preventDefault();
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
    const button = elements.grid.querySelector(`[data-wl-layout="${CSS.escape(drag.layoutId)}"] [data-wl-member="${CSS.escape(drag.memberId)}"]`);
    if (!members || !button) return;
    const row = members.getBoundingClientRect();
    const outside = event.clientY < row.top - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientY > row.bottom + WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX < row.left - WINDOW_LAYOUT_DROP_OUT_PX
      || event.clientX > row.right + WINDOW_LAYOUT_DROP_OUT_PX;
    members.classList.toggle('wl-drag-out', outside);
    if (outside) return;
    moveWindowLayoutMemberButton(members, button, event.clientX, event.clientY);
  }, true);
  elements.grid.addEventListener('pointerup', (event) => {
    widgetMemberDrag.finalize(event.pointerId, (drag) => {
      const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(drag.layoutId)}"]`);
      if (!members) return;
      const dragged = members.querySelector(`[data-wl-member="${CSS.escape(drag.memberId)}"]`);
      dragged?.classList.remove('wl-member-dragging');
      members.classList.remove('wl-drag-out');
      if (!drag.moved) {
        // Pointer capture retargets the eventual click to the grid. Complete
        // Ctrl-click selection here when the gesture never became a drag.
        toggleWidgetMemberSelection(drag.memberId);
        suppressNextWidgetMemberClick();
        return;
      }
      suppressNextWidgetMemberClick();
      const buttons = [...members.querySelectorAll('[data-wl-member]')];
      const toIndex = buttons.findIndex((button) => button.dataset.wlMember === drag.memberId);
      if (toIndex === -1) return;
      client.sendCommand({ kind: 'reorder', memberId: drag.memberId, toIndex });
    });
    const captured = elements.grid.querySelector(`[data-wl-member].wl-member-dragging`);
    captured?.classList.remove('wl-member-dragging');
    try { elements.grid.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }, true);
  elements.grid.addEventListener('pointercancel', (event) => {
    const active = widgetMemberDrag.get();
    if (!active || !widgetMemberDrag.cancelMatching(event.pointerId)) return;
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(active.layoutId)}"]`);
    if (members) members.classList.remove('wl-drag-out');
    const captured = elements.grid.querySelector(`[data-wl-member="${CSS.escape(active.memberId)}"]`);
    captured?.classList.remove('wl-member-dragging');
    try { elements.grid.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }, true);
  elements.grid.addEventListener('lostpointercapture', (event) => {
    const active = widgetMemberDrag.get();
    if (!active || active.pointerId !== event.pointerId) return;
    widgetMemberDrag.cancelMatching(event.pointerId);
    const members = elements.grid.querySelector(`[data-wl-members="${CSS.escape(active.layoutId)}"]`);
    if (members) members.classList.remove('wl-drag-out');
    members?.querySelector(`[data-wl-member="${CSS.escape(active.memberId)}"]`)?.classList.remove('wl-member-dragging');
  }, true);
  return host.widgetReady().then(() => {
    client.ready();
    client.requestSnapshot();
    armSnapshotRetry();
  });
}

// 018A1/018X1/018X2/018V2: the detached surface (?detach=1) registers lifecycle
// listeners at factory creation, then (018V2 two-sided latch) reports page
// READY EXACTLY ONCE — only after its detach-message listener is installed and
// BEFORE it waits for ACTIVATE/load/bootstrap. The durable-state load is gated
// on ACTIVATE (after the workspace stop+flush ACK). On pagehide the activate
// waiter resolves the explicit CANCELLED sentinel: the loadState rejects
// (bootstrap must not load) and the controller bootstrap is skipped while
// stopped, so neither durable state nor the controller starts.
// 019C: the compact-widget surface never runs the workspace graph/workspace
// bootstrap, the old 018 wait-for-ACTIVATE lifecycle or the recording
// controller (the workspace window owns all of those).
if (WIDGET_SURFACE) {
  void bootstrapWindowLayoutWidget();
} else {
  const DETACHED_SURFACE = windowLayoutDetachment.getState().mode === 'detached';
  if (DETACHED_SURFACE) {
    void windowLayoutDetachment.reportReady();
  }
  /**
   * 0B composition. The coordinator owns write authority, the revision and the
   * conflict; the store keeps the document, history, serialization and save
   * ordering; the panel only follows the role.
   */
  /** Coordination failed, so no surface will ever be authoritative for a widget.
   * Fail closed on every mutation, but say so rather than leaving an open
   * widget blank and waiting forever. */
  function reportCoordinationUnavailableToWidgets(reason) {
    for (const layout of state.windowLayouts ?? []) {
      windowLayoutWidgetChannelWorkspace.announceUnavailable(layout.id, reason);
    }
  }

  function startSurfaceCoordination() {
    // Prefer the renderer's native Web Locks when this WebContents provides
    // them.  They are reclaimed automatically when the page dies, which is
    // essential during a remount: a queued main-process lease from an older
    // frame must never strand the only visible workspace behind "syncing".
    // Papers' lease remains the fallback for custom surfaces where Web Locks
    // are genuinely unavailable.
    const rendererLock = webLockAdapter(navigator);
    const hostLock = typeof host.acquireWorkspaceWriterLease === 'function'
      ? hostWriterLeaseAdapter(host)
      : null;
    // A single surface must remain usable even on a custom protocol runtime
    // that exposes neither Web Locks nor the new Papers lease bridge. The
    // local writer still saves through revision-checked CAS, so a later second
    // surface cannot silently overwrite it; it will surface a conflict until
    // the host-backed multi-view coordinator is available.
    const localCasWriterLock = {
      available: true,
      async request() { return { release() {} }; },
    };
    // Arbitration order is load-bearing: native Web Locks first (reclaimed
    // automatically when a page dies), then the now-fixed Papers writer lease
    // (lifecycle-bound acquisition with no RPC timeout), and only then the
    // local CAS writer. The fixed host lease must not be bypassed: without it,
    // every lockless surface would become an unchecked writer. Persistence
    // stays on the versioned CAS path whenever a real lock arbitrates.
    const lock = rendererLock.available
      ? rendererLock
      : (hostLock?.available ? hostLock : localCasWriterLock);
    let channel;
    const coordinationNamespace = SCOPE_ROOT_ID ? `:scope:${SCOPE_ROOT_ID}` : '';
    if (typeof BroadcastChannel === 'function') {
      try {
        channel = new BroadcastChannel(`${SURFACE_DOCUMENT_CHANNEL}${coordinationNamespace}`);
      } catch { /* use the CAS-protected single-surface channel below */ }
    }
    channel ??= {
      postMessage() {},
      addEventListener() {},
      close() {},
    };
    const conflictPanel = createDocumentConflictPanel({
      document,
      onUseLatest: () => surfaceCoordinator.useLatest().then(render),
      onKeepMine: () => surfaceCoordinator.keepMine().then(render),
      confirm: (message) => confirmDialog.askConfirm({
        title: 'Keep your version?',
        copy: message,
        confirmLabel: 'Keep my version',
      }),
    });
    const installPeerDocument = (document_, authoritativeSerialized) => {
      // Peer generations carry shared document data, not this surface's live
      // navigation/session. Overlay the local session and trail map before
      // installing so an unrelated edit cannot move or collapse this window.
      const localView = state.view ?? {};
      const preserved = {
        currentGroupId: session.currentId,
        graphExpandedGroupIds: [...session.graphExpanded],
        selectedItemIds: [...session.selected],
        binMode: session.binMode,
        trailExpandedByContext: localView.trailExpandedByContext,
      };
      const next = {
        ...document_,
        view: { ...(document_.view ?? {}), ...preserved },
      };
      state = store.installExternal(next, { authoritativeSerialized });
      render();
    };
    surfaceCoordinator = createSurfaceCoordinator({
      lock,
      lockName: `${SURFACE_DOCUMENT_LOCK}${coordinationNamespace}`,
      channel,
      host: {
        loadVersioned: () => host.loadWorkspaceVersioned(),
        saveChecked: (serialized, revision) => host.saveWorkspaceChecked(serialized, revision),
      },
      // Installs the document only. This surface's navigation is deliberately
      // preserved, so two windows keep showing different places. Trail
      // expansion is also a local session concern: an in-flight document save
      // must not reset a newer trail interaction when its authoritative bytes
      // are reinstalled.
      installDocument: (document_, authoritativeSerialized) => {
        const trailExpandedByContext = state.view?.trailExpandedByContext;
        const next = trailExpandedByContext === undefined
          ? document_
          : { ...document_, view: { ...(document_.view ?? {}), trailExpandedByContext } };
        // Any ordinary surface may originate a layout edit; it forwards the
        // document to the writer, and only the writer may tell widgets. So the
        // notification has to happen where the writer INSTALLS the accepted
        // document, not where the edit was made - otherwise a change made in a
        // non-writer tab leaves the detached widget on a stale layout. Diffing
        // here also means the widget is told after the writer really holds the
        // state, never speculatively ahead of it.
        const before = windowLayoutDurableSignatures(state);
        state = store.install(next, { authoritativeSerialized });
        const after = windowLayoutDurableSignatures(state);
        for (const [layoutId, signature] of after) {
          if (before.get(layoutId) !== signature) windowLayoutWidgetChannelWorkspace.noteCommitted(layoutId);
        }
        render();
      },
      // A peer commit is a new document generation. Drop this surface's local
      // snapshot undo chain rather than allowing Undo to resurrect stale work
      // from before the external install.
      installExternalDocument: installPeerDocument,
      onHydrated: (source, revision) => {
        if (hydrationSummaryDisagrees(source, state)) {
          visualObservability.hydrationFailed('normalize', 'nonempty-source-empty-model', revision);
          return;
        }
        visualObservability.hydrated(state, revision);
      },
      onHydrationFailed: (stage, code, revision) => visualObservability.hydrationFailed(stage, code, revision),
      invalidatePendingSaves: () => store.invalidatePendingSaves(),
      onRoleChange: (role) => {
        conflictPanel.syncToRole(role, elements.explorer);
        // On takeover, hand every open widget an authoritative snapshot at once
        // instead of leaving it on the dead writer's last revision until it
        // happens to ask again.
        if (role === SURFACE_ROLE.WRITER) {
          for (const layout of state.windowLayouts ?? []) {
            windowLayoutWidgetChannelWorkspace.broadcast(layout.id);
          }
          void reconcileTrackingBaseline();
          void windowLayoutWidgetLifecycle.ensureStartup();
          scheduleClosedWindowReconcile();
        }
        render();
      },
    });
    coordinationState = 'ready';
    channel.addEventListener('message', (event) => {
      if (surfaceCoordinator.receive(event.data)) render();
    });
    // Scoped views receive different host projections and therefore cannot
    // exchange document snapshots directly. A versioned authority read also
    // detects hand-edits to state.json. Keep it active in unfocused windows.
    let refreshFailed = false;
    const refreshExternalDocument = async () => {
      try {
        await surfaceCoordinator.refreshFromHost();
        refreshFailed = false;
      } catch (error) {
        if (!refreshFailed) console.warn('[AsYouGo] external document refresh failed', error);
        refreshFailed = true;
      } finally {
        setTimeout(refreshExternalDocument, 2000);
      }
    };
    setTimeout(refreshExternalDocument, 2000);
    let coordinationRetryTimer = null;
    let coordinationFailureShown = false;
    const startCoordinator = (attempt = 0) => {
      if (!surfaceCoordinator || windowLayoutDetachment.isStopped()) return;
      coordinationState = 'ready';
      void surfaceCoordinator.start().then(async () => {
        coordinationFailureShown = false;
        // Writer election is the durable-editing gate. Tracking/widget refresh
        // is an optional window capability and must not be allowed to turn a
        // successfully elected writer into a read-only workspace when its
        // helper is unavailable or still restarting.
        try {
          await reconcileTrackingBaseline();
          await windowLayoutWidgetLifecycle.ensureStartup();
          scheduleClosedWindowReconcile();
        } catch (error) {
          console.warn('[AsYouGo] window tracking startup failed; editing remains enabled', error);
        }
      }).catch((error) => {
        coordinationState = 'unavailable';
        if (!coordinationFailureShown) {
          coordinationFailureShown = true;
          statusToast.show(error instanceof Error && error.message
            ? `Shared document coordination failed; retrying. ${error.message}`
            : 'Shared document coordination failed; retrying.', { tone: 'error' });
          reportCoordinationUnavailableToWidgets('Workspace coordination temporarily unavailable');
        }
        if (coordinationRetryTimer !== null || windowLayoutDetachment.isStopped()) return;
        const delay = Math.min(5000, 250 * (2 ** Math.min(attempt, 5)));
        coordinationRetryTimer = window.setTimeout(() => {
          coordinationRetryTimer = null;
          startCoordinator(attempt + 1);
        }, delay);
      });
    };
    startCoordinator();
  }

  void bootstrapWorkspace({
    // The load outcome, kept because the launcher overlay has no canvas behind it: an empty universe there
    // can mean "this project is empty" or "I could not read this project", and the creator's report - the
    // launcher opened and had nothing to search - is exactly the case where flattening those two hides the
    // failure. This is the instrument and the sentence at once.
    loadState: DETACHED_SURFACE
      ? () => windowLayoutDetachment.waitForActivate().then((transferId) => {
        if (transferId === DETACH_ACTIVATE_CANCELLED) {
          throw new Error('detach activate cancelled');
        }
        return loadWorkspaceRecording();
      })
      : () => loadWorkspaceRecording(),
    setState: (next) => { state = store.install(next); },
    restoreWorkspaceView,
    setStatus,
    render,
    toolbar,
    confirmDialog,
    menu,
    editorDialog,
    binControls,
    keyboard,
    drop,
    pointer,
    promptLibrary,
  }).then(() => {
    if (!windowLayoutDetachment.isStopped()) bootstrapWindowLayoutRecording();
    // The launcher overlay: the marker already put this page in command-surface mode, and now that the state
    // is loaded and every collaborator exists, the surface opens itself - there is no canvas here to open it
    // from and no second way in. It cannot be opened at mount time, and the first attempt proved why: mount
    // runs during module evaluation, so `onOpen` reached the prompt library before it was constructed, the
    // boot died there, and the overlay came up with no rows to search.
    if (commandSurfaceMode === 'overlay' && !SCOPE_ROOT_ID) quickRun.open();
    if (commandSurfaceMode === 'overlay' && workspaceLoad.ok !== true) {
      // A launcher window is created and shown in the same breath as its page loads, so the first read of the
      // project's items can lose that race. One bounded retry, in this mode only and only while nothing has
      // ever loaded: the same single source of items, asked again a moment later. No cache, no second store.
      setTimeout(() => { if (workspaceLoad.ok !== true) void reloadWorkspace(); }, 1500);
    }
    // 0B: elect a document writer among the surfaces of this project.
    //
    // Only ordinary workspace surfaces take part. A detached surface receives
    // ownership through the existing 018 STOP -> FLUSH -> ACTIVATE handshake,
    // and until the coordinator's reservation is wired into that handshake,
    // giving a detached surface a lock to wait on could deadlock against a
    // workspace that never releases. That integration is deliberately separate.
    if (!DETACHED_SURFACE) startSurfaceCoordination();
    if (!DETACHED_SURFACE && !SCOPE_ROOT_ID) void windowLayoutWidgetLifecycle.ensureStartup();
    // 019G/021: after durable state loads, broadcast a real snapshot for every
    // layout so an already-open widget is never stuck on `unknown-layout` /
    // the empty default card (cold-open readiness race).
    for (const layout of state.windowLayouts ?? []) {
      windowLayoutWidgetChannelWorkspace.broadcast(layout.id);
    }
  });
}
