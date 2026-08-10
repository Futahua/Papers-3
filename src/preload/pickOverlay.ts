/**
 * Preload for the Papers-owned direct-pick OVERLAY window (Assignment 016).
 *
 * The overlay renderer never touches Windows or the helper directly: it
 * receives draw state pushed from the main pick session and reports user
 * actions (click point / cancel) through this narrow bridge. The overlay is
 * Papers-owned; Backpack content never sees it. There is deliberately no
 * `ready` seam: the session owns the overlay lifetime and pushes state
 * immediately on begin, so no handshake is needed (016R).
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pickOverlay', {
  onState: (callback: (state: unknown) => void): void => {
    ipcRenderer.on('pick:state', (_event, state) => callback(state));
  },
  click: (x: number, y: number): void => {
    ipcRenderer.send('pick:click', { x, y });
  },
  cancel: (): void => {
    ipcRenderer.send('pick:cancel');
  },
});
