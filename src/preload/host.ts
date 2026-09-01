/**
 * Host preload — bridge for the trusted first-party host frame renderer.
 * Wider than the program API but still explicit methods only.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

type Listener = (payload: unknown) => void;

function subscribe(channel: string): (listener: Listener) => () => void {
  return (listener) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };
}

const api = {
  // Historical program/ACP demonstrations are exposed only when Papers is
  // launched with PAPERS_ENABLE_FIXTURES=1. Production renders never see them.
  fixtureMode: process.env['PAPERS_ENABLE_FIXTURES'] === '1',

  app: {
    // Which build this is and where it runs from, so two machines running
    // Papers can be told apart and compared.
    buildIdentity: () => ipcRenderer.invoke('host:app:build-identity'),
    // Papers updating itself from its GitHub releases.
    updateStatus: () => ipcRenderer.invoke('host:app:update-status'),
    checkForUpdate: () => ipcRenderer.invoke('host:app:check-for-update'),
    installUpdate: () => ipcRenderer.invoke('host:app:install-update'),
    // Create one fresh Papers window; all policy stays in the main process.
    newWindow: () => ipcRenderer.invoke('host:window:new'),
  },

  backpacks: {
    list: () => ipcRenderer.invoke('host:backpacks:list'),
    // Name-only creation. Every production Backpack is a machine-wide
    // environment; the legacy 'canvas' type is only ever passed by fixtures.
    create: (name: string, type: string = 'environment') =>
      ipcRenderer.invoke('host:backpacks:create', name, type),
    rename: (id: string, name: string) => ipcRenderer.invoke('host:backpacks:rename', id, name),
    setArchived: (id: string, archived: boolean) =>
      ipcRenderer.invoke('host:backpacks:set-archived', id, archived),
    remove: (id: string) => ipcRenderer.invoke('host:backpacks:remove', id),
    enter: (id: string) => ipcRenderer.invoke('host:backpacks:enter', id),
    leave: () => ipcRenderer.invoke('host:backpacks:leave'),
    startupRestore: () => ipcRenderer.invoke('host:backpacks:startup-restore'),
  },

  // Narrow host seam for independently maintained Backpack projects. Project
  // roots and action targets never cross into a renderer.
  backpackProject: {
    open: (id: string) => ipcRenderer.invoke('host:backpack-project:open', id),
    close: (surfaceId: string) => ipcRenderer.invoke('host:backpack-project:close', surfaceId),
    activateSurface: (surfaceId: string) => ipcRenderer.invoke('host:backpack-project:activate-surface', surfaceId),
    showSurface: (surfaceId: string, url: string) => ipcRenderer.invoke('host:backpack-project:show-surface', surfaceId, url),
    setSurfaceBounds: (surfaceId: string, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:backpack-project:set-surface-bounds', surfaceId, bounds),
    hideSurface: (surfaceId: string) => ipcRenderer.invoke('host:backpack-project:hide-surface', surfaceId),
    // A0.2.1: project-scoped operations are NOT exposed to the host
    // renderer. They resolved through the host's own project binding, so once
    // a window can hold two tabs a host call would act on whichever project
    // the host was last bound to -- the wrong-project class again, in a new
    // place. These channels belong to the project frame, whose sender proves
    // its own {surfaceId, projectId, windowId}. If host UI ever needs one, it
    // gets an explicitly targeted variant, not this.
  },

  programs: {
    catalog: () => ipcRenderer.invoke('host:programs:catalog'),
    start: (programId: string) => ipcRenderer.invoke('host:programs:start', programId),
    stop: () => ipcRenderer.invoke('host:programs:stop'),
    restart: (programId: string) => ipcRenderer.invoke('host:programs:restart', programId),
    clearQuarantine: (programId: string) =>
      ipcRenderer.invoke('host:programs:clear-quarantine', programId),
    invokeCommand: (commandId: string) => ipcRenderer.invoke('host:programs:invoke-command', commandId),
  },

  layout: {
    hydrateStartupWorkspace: () => ipcRenderer.invoke('host:workspace:hydrate-startup'),
    list: () => ipcRenderer.invoke('host:layout:list'),
    save: (name: string) => ipcRenderer.invoke('host:layout:save', name),
    load: (layoutId: string) => ipcRenderer.invoke('host:layout:load', layoutId),
    setProgramBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:layout:set-program-bounds', bounds),
    setOverlayActive: (active: boolean) => ipcRenderer.invoke('host:layout:set-overlay', active),
    setTitleBarOverlay: (color: string, symbolColor: string) =>
      ipcRenderer.invoke('host:layout:set-titlebar', color, symbolColor),
    commitWorkspaceTopology: (topology: unknown) =>
      ipcRenderer.invoke('host:workspace:commit-topology', topology),
  },

  settings: {
    get: () => ipcRenderer.invoke('host:settings:get'),
    setTransparentWindow: (enabled: boolean) =>
      ipcRenderer.invoke('host:settings:set-transparent-window', enabled),
    saveWindowBounds: () => ipcRenderer.invoke('host:settings:save-window-bounds'),
    clearWindowBounds: () => ipcRenderer.invoke('host:settings:clear-window-bounds'),
  },

  permissions: {
    list: () => ipcRenderer.invoke('host:permissions:list'),
    revoke: (backpackId: string, programId: string, capability: string) =>
      ipcRenderer.invoke('host:permissions:revoke', backpackId, programId, capability),
    respond: (promptId: string, decision: string) =>
      ipcRenderer.invoke('host:permissions:respond', promptId, decision),
  },

  runs: {
    list: () => ipcRenderer.invoke('host:runs:list'),
    get: (runId: string) => ipcRenderer.invoke('host:runs:get', runId),
    cancel: (runId: string) => ipcRenderer.invoke('host:runs:cancel', runId),
    respondInteraction: (runId: string, requestId: string, optionId: string) =>
      ipcRenderer.invoke('host:runs:respond-interaction', runId, requestId, optionId),
    retry: (runId: string) => ipcRenderer.invoke('host:runs:retry', runId),
    inspectInHermes: (runId: string) => ipcRenderer.invoke('host:runs:inspect-in-hermes', runId),
    returnToOrigin: (runId: string) => ipcRenderer.invoke('host:runs:return-to-origin', runId),
    respondInvocation: (previewId: string, approved: boolean) =>
      ipcRenderer.invoke('host:runs:respond-invocation', previewId, approved),
    reply: (runId: string, text: string) => ipcRenderer.invoke('host:runs:reply', runId, text),
    composedPrompt: (runId: string) => ipcRenderer.invoke('host:runs:composed-prompt', runId),
  },

  hermes: {
    health: () => ipcRenderer.invoke('host:hermes:health'),
    surfaceStatus: () => ipcRenderer.invoke('host:hermes:surface-status'),
    // Dock/detach the one real Hermes Desktop window. Docked and detached are
    // placements of the same experience; hiding never terminates the session.
    dock: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:hermes:dock', bounds),
    setDockBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:hermes:set-dock-bounds', bounds),
    hideDock: () => ipcRenderer.invoke('host:hermes:hide-dock'),
    showWindow: () => ipcRenderer.invoke('host:hermes:show-window'),
    hideWindow: () => ipcRenderer.invoke('host:hermes:hide-window'),
  },

  events: {
    onBackpacksChanged: subscribe('host:event:backpacks-changed'),
    onBackpackProjectCloseRequest: subscribe('host:event:backpack-project-close-request'),
    onWorkspaceTopology: subscribe('host:event:workspace-topology'),
    onWorkspaceProjectOpened: subscribe('host:event:workspace-project-opened'),
    onWorkspaceHydrated: subscribe('host:event:workspace-hydrated'),
    onWorkspaceLayoutLoaded: subscribe('host:event:workspace-layout-loaded'),
    onProgramStatus: subscribe('host:event:program-status'),
    onShelfChanged: subscribe('host:event:shelf-changed'),
    onSaveStatus: subscribe('host:event:save-status'),
    onPermissionPrompt: subscribe('host:event:permission-prompt'),
    onInvocationPreview: subscribe('host:event:invocation-preview'),
    onRunsChanged: subscribe('host:event:runs-changed'),
    onHermesHealth: subscribe('host:event:hermes-health'),
    onHermesSurface: subscribe('host:event:hermes-surface'),
    onHostError: subscribe('host:event:host-error'),
    onUpdateStatus: subscribe('host:event:update-status'),
  },
};

contextBridge.exposeInMainWorld('papersHost', api);

export type PapersHostBridge = typeof api;
