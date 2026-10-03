/** Produced artifacts and external application handoff. */
import { el, clear, fmtDate } from '../dom.js';
import * as api from '../api.js';
import { state } from '../state.js';
import { toast } from '../ui.js';

async function perform(label, operation) {
  try {
    await operation();
    toast(label);
  } catch (err) {
    toast(api.parseCapabilityError(err).message, 'error');
  }
}

export function render(container) {
  clear(container);
  container.append(el('div', { class: 'view-head' },
    el('h3', { text: 'Produced artifacts' }),
    el('span', { class: 'muted', text: 'Generated files are editable, version-preserving, and stored in this program’s artifact directory.' }),
  ));
  if (state.artifacts.length === 0) {
    container.append(el('div', { class: 'card muted', text: 'No artifacts yet. Generate an editable report from Draft Production.' }));
    return;
  }
  container.append(el('div', { class: 'stack' }, state.artifacts.map((artifact) =>
    el('div', { class: 'card stack' },
      el('div', { class: 'row' },
        el('h4', { text: artifact.title || 'Untitled artifact' }),
        el('span', { class: 'badge plain', text: fmtDate(artifact.createdAt) }),
      ),
      el('div', { class: 'prov', text: artifact.path }),
      el('div', { class: 'row' },
        el('button', {
          class: 'primary',
          onclick: () => void perform('Opened in LibreOffice Writer.', () => api.external.launchWriter(artifact.resourceId)),
        }, 'Open in LibreOffice Writer'),
        el('button', {
          onclick: () => void perform('Opened with the default application.', () => api.external.openResource(artifact.resourceId)),
        }, 'Open'),
        el('button', {
          onclick: () => void perform('Revealed in the system file browser.', () => api.external.showInFolder(artifact.resourceId)),
        }, 'Show in folder'),
      ),
    ))));
}
