/**
 * The program-owned selection and the persistent bottom tray showing it
 * together with the agent actions that apply to it.
 */
import { el, clear } from './dom.js';
import { state, findEvidence, findNote, findTask, findDraft } from './state.js';
import { applicableActions, runAction } from './actions.js';

let selection = { type: null, items: [] };

const TYPE_LABELS = {
  files: 'files',
  'code-regions': 'code regions',
  evidence: 'evidence',
  notes: 'notes',
  'draft-sections': 'draft sections',
  task: 'task',
};

export function getSelection() { return selection; }

export function itemKey(type, item) {
  switch (type) {
    case 'files': return `${item.resourceId}|${item.filePath}`;
    case 'code-regions': return `${item.resourceId}|${item.filePath}|${item.startLine}-${item.endLine}`;
    case 'draft-sections': return `${item.draftId}|${item.sectionId}`;
    default: return item.id;
  }
}

export function isSelected(type, key) {
  if (selection.type !== type) return false;
  return selection.items.some((i) => itemKey(type, i) === key);
}

/** Toggle an item. Selecting a different type replaces the whole selection. */
export function toggleItem(type, item) {
  const key = itemKey(type, item);
  if (selection.type !== type) {
    selection = { type, items: [item] };
  } else if (type === 'task') {
    selection = selection.items.some((i) => itemKey(type, i) === key)
      ? { type: null, items: [] }
      : { type, items: [item] };
  } else {
    const rest = selection.items.filter((i) => itemKey(type, i) !== key);
    selection = rest.length === selection.items.length
      ? { type, items: [...selection.items, item] }
      : { type, items: rest };
    if (selection.items.length === 0) selection = { type: null, items: [] };
  }
  renderTray();
}

export function setSelection(type, items) {
  selection = items.length ? { type, items } : { type: null, items: [] };
  renderTray();
}

export function clearSelection() {
  selection = { type: null, items: [] };
  renderTray();
}

/** Drop selected items whose backing objects were deleted meanwhile. */
function pruneSelection() {
  if (!selection.type) return;
  const alive = selection.items.filter((item) => {
    switch (selection.type) {
      case 'evidence': return Boolean(findEvidence(item.id));
      case 'notes': return Boolean(findNote(item.id));
      case 'task': return Boolean(findTask(item.id));
      case 'draft-sections': {
        const draft = findDraft(item.draftId);
        return Boolean(draft && draft.sections.some((s) => s.id === item.sectionId));
      }
      default: return true;
    }
  });
  if (alive.length !== selection.items.length) {
    selection = alive.length ? { ...selection, items: alive } : { type: null, items: [] };
  }
}

function describeItem(type, item) {
  switch (type) {
    case 'files': return item.filePath;
    case 'code-regions': return `${item.filePath}:${item.startLine}-${item.endLine}`;
    case 'evidence': return (findEvidence(item.id) || {}).title || '(deleted evidence)';
    case 'notes': return (findNote(item.id) || {}).title || '(deleted note)';
    case 'task': return (findTask(item.id) || {}).title || '(deleted task)';
    case 'draft-sections': {
      const draft = findDraft(item.draftId);
      const section = draft && draft.sections.find((s) => s.id === item.sectionId);
      return section ? (section.heading || 'Untitled section') : '(deleted section)';
    }
    default: return '?';
  }
}

function liveRunChips() {
  const chips = [];
  for (const run of Object.values(state.pendingRuns || {})) {
    if (run.status !== 'pending') continue;
    chips.push(el('span', { class: 'badge plain run-chip', title: `Run ${run.runId}` },
      `${run.actionLabel} — ${run.runState || 'queued'}`));
  }
  return chips;
}

export function renderTray() {
  const tray = document.getElementById('tray');
  if (!tray) return;
  pruneSelection();
  clear(tray);

  const head = el('div', { class: 'tray-head' });
  if (!selection.type) {
    head.append(
      el('span', { class: 'tray-title', text: 'Selection tray' }),
      el('span', { class: 'muted small', text: 'Nothing selected. Pick files, regions, evidence, notes, sections, or a task to see the agent actions that apply.' }),
    );
    tray.append(head);
  } else {
    head.append(
      el('span', { class: 'tray-title', text: 'Selection tray' }),
      el('span', { class: 'badge', text: `${selection.items.length} ${TYPE_LABELS[selection.type] || selection.type}` }),
      el('button', { class: 'linkish small', onclick: () => clearSelection() }, 'Clear'),
    );
    tray.append(head);
    tray.append(el('div', { class: 'tray-items' },
      selection.items.slice(0, 12).map((item) =>
        el('span', { class: 'tray-item', title: describeItem(selection.type, item) },
          describeItem(selection.type, item))),
      selection.items.length > 12
        ? el('span', { class: 'muted small' }, `+${selection.items.length - 12} more`)
        : null,
    ));
    const actions = applicableActions(selection);
    tray.append(el('div', { class: 'tray-actions' },
      actions.length === 0
        ? el('span', { class: 'muted small', text: 'No agent actions apply to this selection.' })
        : actions.map((a) =>
          el('button', { class: 'primary', onclick: () => { void runAction(a.id, getSelection()); } }, a.label)),
    ));
  }

  const chips = liveRunChips();
  if (chips.length) tray.append(el('div', { class: 'tray-actions' }, chips));
}

export function focusTray() {
  const tray = document.getElementById('tray');
  if (!tray) return;
  tray.classList.remove('flash');
  // force reflow so the animation can replay
  void tray.offsetWidth;
  tray.classList.add('flash');
  tray.scrollIntoView({ block: 'end' });
}
