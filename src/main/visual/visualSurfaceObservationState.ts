import { randomUUID } from 'node:crypto';

export interface VisualSurfaceObservationState {
  windowId: number;
  surfaceId: string;
  senderId: number | null;
  senderGeneration: number;
  renderCycleId: string | null;
  documentStateRevision: string | null;
  domReady: boolean;
  hydrated: boolean;
  firstPaint: boolean;
  layoutEpoch: number | null;
  layoutStable: boolean;
  renderFailed: boolean;
  semanticKeys: string[];
}

export interface VisualSurfaceObservationStore {
  bindSender(windowId: number, surfaceId: string, senderId: number): void;
  startNavigation(windowId: number, surfaceId: string, senderId: number): void;
  markDomReady(windowId: number, surfaceId: string, senderId: number): void;
  markHydrated(windowId: number, surfaceId: string, senderId: number, revision: string): void;
  markFirstPaint(windowId: number, surfaceId: string, senderId: number): void;
  markLayoutEpoch(windowId: number, surfaceId: string, senderId: number, epoch?: number): void;
  markLayoutStable(windowId: number, surfaceId: string, senderId: number, epoch?: number): void;
  markRenderFailed(windowId: number, surfaceId: string, senderId: number): void;
  replaceSemanticKeys(windowId: number, surfaceId: string, senderId: number, keys: string[]): void;
  invalidateSender(windowId: number, surfaceId: string, senderId: number): void;
  resetForNavigation(windowId: number, surfaceId: string, senderId: number): void;
  retireSurface(surfaceId: string): void;
  retireSurfaceAt(windowId: number, surfaceId: string): void;
  retireWindow(windowId: number): void;
  snapshot(windowId: number, surfaceId: string): VisualSurfaceObservationState | null;
}

function mapKey(windowId: number, surfaceId: string): string {
  return `${windowId}\0${surfaceId}`;
}

function freshState(windowId: number, surfaceId: string, senderId: number): VisualSurfaceObservationState {
  return {
    windowId,
    surfaceId,
    senderId,
    senderGeneration: 1,
    renderCycleId: randomUUID(),
    documentStateRevision: null,
    domReady: false,
    hydrated: false,
    firstPaint: false,
    layoutEpoch: null,
    layoutStable: false,
    renderFailed: false,
    semanticKeys: [],
  };
}

function clearDocumentState(state: VisualSurfaceObservationState): void {
  state.renderCycleId = randomUUID();
  state.documentStateRevision = null;
  state.domReady = false;
  state.hydrated = false;
  state.firstPaint = false;
  state.layoutEpoch = null;
  state.layoutStable = false;
  state.renderFailed = false;
  state.semanticKeys = [];
}

function cloneState(state: VisualSurfaceObservationState): VisualSurfaceObservationState {
  return { ...state };
}

export function createVisualSurfaceObservationStore(): VisualSurfaceObservationStore {
  const states = new Map<string, VisualSurfaceObservationState>();

  function stateFor(windowId: number, surfaceId: string, senderId?: number): VisualSurfaceObservationState | null {
    const key = mapKey(windowId, surfaceId);
    let state = states.get(key);
    if (!state && senderId !== undefined) {
      state = freshState(windowId, surfaceId, senderId);
      states.set(key, state);
    }
    return state ?? null;
  }

  function current(state: VisualSurfaceObservationState | null, senderId: number): state is VisualSurfaceObservationState {
    return state !== null && state.senderId === senderId;
  }

  return {
    bindSender(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId, senderId)!;
      if (state.senderId === senderId) return;
      state.senderId = senderId;
      state.senderGeneration += 1;
      clearDocumentState(state);
    },
    startNavigation(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId);
      if (current(state, senderId)) clearDocumentState(state);
    },
    markDomReady(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId);
      if (current(state, senderId)) state.domReady = true;
    },
    markHydrated(windowId, surfaceId, senderId, revision) {
      const state = stateFor(windowId, surfaceId);
      if (!current(state, senderId)) return;
      state.documentStateRevision = revision;
      state.hydrated = true;
      state.renderFailed = false;
    },
    markFirstPaint(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId);
      if (current(state, senderId)) state.firstPaint = true;
    },
    markLayoutEpoch(windowId, surfaceId, senderId, epoch) {
      const state = stateFor(windowId, surfaceId);
      if (!current(state, senderId)) return;
      const nextEpoch = epoch ?? ((state.layoutEpoch ?? 0) + 1);
      if (state.layoutEpoch !== nextEpoch) state.layoutStable = false;
      state.layoutEpoch = nextEpoch;
    },
    markLayoutStable(windowId, surfaceId, senderId, epoch) {
      const state = stateFor(windowId, surfaceId);
      if (!current(state, senderId)) return;
      const nextEpoch = epoch ?? ((state.layoutEpoch ?? 0) + 1);
      state.layoutEpoch = nextEpoch;
      state.layoutStable = true;
    },
    markRenderFailed(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId);
      if (current(state, senderId)) state.renderFailed = true;
    },
    replaceSemanticKeys(windowId, surfaceId, senderId, keys) {
      const state = stateFor(windowId, surfaceId);
      if (!current(state, senderId)) return;
      state.semanticKeys = [...keys];
    },
    invalidateSender(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId);
      if (!current(state, senderId)) return;
      state.senderId = null;
      state.senderGeneration += 1;
      clearDocumentState(state);
    },
    resetForNavigation(windowId, surfaceId, senderId) {
      const state = stateFor(windowId, surfaceId);
      if (current(state, senderId)) clearDocumentState(state);
    },
    retireSurface(surfaceId) {
      for (const key of states.keys()) {
        if (key.endsWith(`\0${surfaceId}`)) states.delete(key);
      }
    },
    retireSurfaceAt(windowId, surfaceId) {
      states.delete(mapKey(windowId, surfaceId));
    },
    retireWindow(windowId) {
      for (const key of states.keys()) {
        if (key.startsWith(`${windowId}\0`)) states.delete(key);
      }
    },
    snapshot(windowId, surfaceId) {
      const state = states.get(mapKey(windowId, surfaceId));
      return state ? cloneState(state) : null;
    },
  };
}
