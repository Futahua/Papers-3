import { contextBridge, ipcRenderer } from 'electron';

const ACTIONS = new Set(['select', 'close', 'cancel', 'peek', 'peek-end']);

contextBridge.exposeInMainWorld('candidatePicker', {
  signal: (action: string, candidateId = ''): void => {
    if (!ACTIONS.has(action)) return;
    if (typeof candidateId !== 'string' || Buffer.byteLength(candidateId, 'utf8') > 512) return;
    ipcRenderer.send('papers:candidate-picker:signal', { action, candidateId });
  },
});
