/**
 * Program preload — the ONLY bridge between a sandboxed program renderer and
 * Papers. Exposes the narrow PapersProgramAPI (plan section 9); never raw
 * ipcRenderer, Node, or Electron APIs. Program identity is resolved by the
 * main process from the sender, never trusted from renderer arguments.
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
  identity: () => ipcRenderer.invoke('program:identity'),

  state: {
    load: () => ipcRenderer.invoke('program:state:load'),
    save: (value: unknown) => ipcRenderer.invoke('program:state:save', value),
  },

  shelf: {
    contribute: (items: unknown) => ipcRenderer.invoke('program:shelf:contribute', items),
    clear: () => ipcRenderer.invoke('program:shelf:clear'),
  },

  commands: {
    register: (commands: unknown) => ipcRenderer.invoke('program:commands:register', commands),
  },

  capabilities: {
    request: (request: unknown) => ipcRenderer.invoke('program:capability:request', request),
  },

  agent: {
    invoke: (invocation: unknown) => ipcRenderer.invoke('program:agent:invoke', invocation),
    cancel: (runId: string) => ipcRenderer.invoke('program:agent:cancel', runId),
  },

  summary: {
    /** Publish this program's explicit shared summary (readable by programs
     *  holding program.read-shared-summary). */
    publish: (value: unknown) => ipcRenderer.invoke('program:summary:publish', value),
  },

  events: {
    /** Host or shelf asked the program to run one of its registered commands. */
    onCommand: subscribe('program:command'),
    /** State changes for agent runs this program originated. */
    onRunUpdate: subscribe('program:run-update'),
    /** A result proposal is ready for program-owned validation and preview. */
    onResultProposal: subscribe('program:result-proposal'),
  },
};

contextBridge.exposeInMainWorld('papers', api);

export type PapersProgramBridge = typeof api;
