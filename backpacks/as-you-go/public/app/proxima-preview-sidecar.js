import { createHostBridge } from './host/host-bridge.js?build=coordination-v18';
import { createFileCapabilityPanel } from './file-capability-panel.js';

function parentOrigin() {
  try {
    const parsed = new URL(document.referrer);
    const origin = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
    return origin && origin !== 'null' ? origin : '*';
  } catch {
    return '*';
  }
}

const expectedParentOrigin = parentOrigin();
const host = createHostBridge(window);
const panel = createFileCapabilityPanel({
  document,
  host,
  setStatus: () => {},
});
panel.openSearch();

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (expectedParentOrigin !== '*' && event.origin !== expectedParentOrigin) return;
  if (event.data?.type === 'papers:proxima-preview-selection') {
    panel.syncSelection(event.data.selection);
    return;
  }
  if (event.data?.type === 'papers:proxima-preview-reposition') {
    panel.refreshPreviewGeometry();
  }
});

window.parent.postMessage({ type: 'papers:proxima-preview-ready' }, expectedParentOrigin);
