import { ipcRenderer, webUtils } from 'electron';

interface ProjectMessage { type?: unknown; requestId?: unknown; actionId?: unknown; text?: unknown; state?: unknown; url?: unknown; files?: unknown; kind?: unknown; }

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data as ProjectMessage;
  if (!request || typeof request.type !== 'string') return;
  if (request.type === 'papers:project:close') { ipcRenderer.send('host:backpack-project:request-close'); return; }

  let task: Promise<unknown> | null = null;
  if (request.type === 'papers:project:run-action' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:run-action', request.actionId);
  if (request.type === 'papers:project:copy-text' && typeof request.text === 'string') task = ipcRenderer.invoke('host:backpack-project:copy-text', request.text);
  if (request.type === 'papers:project:as-you-go-load') task = ipcRenderer.invoke('host:backpack-project:state-load').then((state) => ({ state: JSON.stringify(state) }));
  if (request.type === 'papers:project:as-you-go-save' && typeof request.state === 'string') task = ipcRenderer.invoke('host:backpack-project:state-save', request.state);
  if (request.type === 'papers:project:as-you-go-pick-target' && (request.kind === 'file' || request.kind === 'folder')) task = ipcRenderer.invoke('host:backpack-project:pick-target', request.kind).then((selection) => ({ target: selection?.target ?? null, icon: selection?.icon ?? null }));
  if (request.type === 'papers:project:as-you-go-shortcut-icon' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:shortcut-icon', request.actionId).then((icon) => ({ icon }));
  if (request.type === 'papers:project:as-you-go-launch' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:launch-shortcut', request.actionId);
  if (request.type === 'papers:project:as-you-go-reveal' && typeof request.actionId === 'string') task = ipcRenderer.invoke('host:backpack-project:reveal-shortcut', request.actionId);
  if (request.type === 'papers:project:open-web-link' && typeof request.url === 'string') task = ipcRenderer.invoke('host:backpack-project:open-web-link', request.url);
  if (request.type === 'papers:project:resolve-dropped-targets' && Array.isArray(request.files)) {
    const paths = request.files.filter((file): file is File => file instanceof File).map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    if (paths.length) task = ipcRenderer.invoke('host:backpack-project:resolve-dropped-targets', paths).then((targets) => ({ targets }));
  }
  if (request.type === 'papers:project:resolve-web-link-icon' && typeof request.url === 'string') task = ipcRenderer.invoke('host:backpack-project:resolve-web-link-icon', request.url);
  if (!task) return;
  void task.then((payload) => window.postMessage({ type: 'papers:host:result', requestId: request.requestId, ok: true, ...(payload && typeof payload === 'object' ? payload : {}) }, event.origin))
    .catch((caught) => window.postMessage({ type: 'papers:host:result', requestId: request.requestId, ok: false, error: String(caught instanceof Error ? caught.message : caught) }, event.origin));
});
