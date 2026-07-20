/** Toasts and modals. */
import { el, clear } from './dom.js';

export function toast(message, kind = 'info') {
  const root = document.getElementById('toasts');
  if (!root) return;
  const node = el('div', { class: `toast${kind === 'error' ? ' error' : ''}`, text: message });
  root.append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 4200);
}

/**
 * Show a modal. body may be a Node or a string. actions: [{label, kind, onClick}]
 * where onClick receives {close}. Returns {close}.
 */
export function showModal({ title, body, actions = [], wide = false }) {
  const root = document.getElementById('modal-root');
  clear(root);
  const handle = {
    close() {
      clear(root);
      document.removeEventListener('keydown', onKey);
    },
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') handle.close();
  };
  document.addEventListener('keydown', onKey);

  const footer = el('footer', {},
    actions.map((a) =>
      el('button', {
        class: a.kind === 'primary' ? 'primary' : a.kind === 'danger' ? 'danger' : '',
        onclick: () => {
          try {
            const result = a.onClick ? a.onClick(handle) : undefined;
            if (a.onClick == null || result !== false) {
              if (a.autoClose !== false && !a.keepOpen) handle.close();
            }
          } catch (err) {
            toast(String(err && err.message ? err.message : err), 'error');
          }
        },
      }, a.label),
    ),
  );

  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: wide ? 'width:min(880px,94vw)' : null },
    el('header', {}, el('h3', { text: title })),
    el('div', { class: 'modal-body' }, body instanceof Node ? body : el('p', { text: String(body ?? '') })),
    footer,
  );
  root.append(modal);
  return handle;
}

export function confirmModal(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    showModal({
      title,
      body: message,
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: confirmLabel, kind: 'primary', onClick: () => resolve(true) },
      ],
    });
  });
}
