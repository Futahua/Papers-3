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
    lastActive: () => ipcRenderer.invoke('host:backpacks:last-active'),
  },

  // Narrow host seam for independently maintained Backpack projects. Project
  // roots and action targets never cross into a renderer.
  backpackProject: {
    open: (id: string) => ipcRenderer.invoke('host:backpack-project:open', id),
    close: () => ipcRenderer.invoke('host:backpack-project:close'),
    showSurface: (url: string) => ipcRenderer.invoke('host:backpack-project:show-surface', url),
    hideSurface: () => ipcRenderer.invoke('host:backpack-project:hide-surface'),
    runAction: (actionId: string) =>
      ipcRenderer.invoke('host:backpack-project:run-action', actionId),
    copyText: (text: string) => ipcRenderer.invoke('host:backpack-project:copy-text', text),
    projectStateLoad: () => ipcRenderer.invoke('host:backpack-project:state-load'),
    projectStateSave: (state: string) => ipcRenderer.invoke('host:backpack-project:state-save', state),
    projectPickTarget: (kind: string) => ipcRenderer.invoke('host:backpack-project:pick-target', kind),
    projectShortcutIcon: (shortcutId: string) =>
      ipcRenderer.invoke('host:backpack-project:shortcut-icon', shortcutId),
    projectLaunchShortcut: (shortcutId: string) => ipcRenderer.invoke('host:backpack-project:launch-shortcut', shortcutId),
    projectRevealShortcut: (shortcutId: string) => ipcRenderer.invoke('host:backpack-project:reveal-shortcut', shortcutId),
    projectOpenWebLink: (url: string) =>
      ipcRenderer.invoke('host:backpack-project:open-web-link', url),
    projectResolveDroppedTargets: (files: File[]) => {
      const paths = files
        .map((file) => webUtils.getPathForFile(file))
        .filter((filePath) => filePath.length > 0);
      return ipcRenderer.invoke('host:backpack-project:resolve-dropped-targets', paths);
    },
    projectResolveWebLinkIcon: (url: string) =>
      ipcRenderer.invoke('host:backpack-project:resolve-web-link-icon', url),
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
    setProgramBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:layout:set-program-bounds', bounds),
    setOverlayActive: (active: boolean) => ipcRenderer.invoke('host:layout:set-overlay', active),
    setTitleBarOverlay: (color: string, symbolColor: string) =>
      ipcRenderer.invoke('host:layout:set-titlebar', color, symbolColor),
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
