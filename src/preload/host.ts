/**
 * Host preload — bridge for the trusted first-party host frame renderer.
 * Wider than the program API but still explicit methods only.
 */
import { contextBridge, ipcRenderer } from 'electron';

type Listener = (payload: unknown) => void;

function subscribe(channel: string): (listener: Listener) => () => void {
  return (listener) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  };
}

const api = {
  backpacks: {
    list: () => ipcRenderer.invoke('host:backpacks:list'),
    create: (name: string, type: string) => ipcRenderer.invoke('host:backpacks:create', name, type),
    rename: (id: string, name: string) => ipcRenderer.invoke('host:backpacks:rename', id, name),
    setArchived: (id: string, archived: boolean) =>
      ipcRenderer.invoke('host:backpacks:set-archived', id, archived),
    enter: (id: string) => ipcRenderer.invoke('host:backpacks:enter', id),
    leave: () => ipcRenderer.invoke('host:backpacks:leave'),
    lastActive: () => ipcRenderer.invoke('host:backpacks:last-active'),
    chooseWorkspace: () => ipcRenderer.invoke('host:backpacks:choose-workspace'),
    clearWorkspace: () => ipcRenderer.invoke('host:backpacks:clear-workspace'),
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
    show: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:hermes:show', bounds),
    hide: () => ipcRenderer.invoke('host:hermes:hide'),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('host:hermes:set-bounds', bounds),
    openDesktop: () => ipcRenderer.invoke('host:hermes:open-desktop'),
  },

  events: {
    onBackpacksChanged: subscribe('host:event:backpacks-changed'),
    onProgramStatus: subscribe('host:event:program-status'),
    onShelfChanged: subscribe('host:event:shelf-changed'),
    onSaveStatus: subscribe('host:event:save-status'),
    onPermissionPrompt: subscribe('host:event:permission-prompt'),
    onInvocationPreview: subscribe('host:event:invocation-preview'),
    onRunsChanged: subscribe('host:event:runs-changed'),
    onHermesHealth: subscribe('host:event:hermes-health'),
    onHostError: subscribe('host:event:host-error'),
  },
};

contextBridge.exposeInMainWorld('papersHost', api);

export type PapersHostBridge = typeof api;
