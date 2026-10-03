/** Notes: create/edit/delete notes, topics manager, topic filter. */
import { el, clear, fmtDate, clampText } from '../dom.js';
import { state, mutated, mutatedQuiet, findEvidence, findTopic, nowIso, makeNote } from '../state.js';
import { toast, confirmModal } from '../ui.js';
import { toggleItem, isSelected } from '../tray.js';

const PALETTE = ['#2f6f4f', '#8a5a2b', '#4a5f8a', '#7a3f6e', '#946a15', '#3f7a78', '#9c3a2e', '#5a5f2b'];

let selectedNoteId = null;
let topicFilter = null; // topic id or null
let rootEl = null;

function rerender() { if (rootEl && rootEl.isConnected) render(rootEl); }

function selectedNote() { return state.notes.find((n) => n.id === selectedNoteId) || null; }

// ---- topics manager -----------------------------------------------------

function topicsManager() {
  const box = el('section', { class: 'block' }, el('h3', { text: 'Topics' }));
  const list = el('div', { class: 'row' });
  for (const topic of state.topics) {
    const colorInput = el('input', {
      type: 'color', value: topic.color || '#2f6f4f', title: 'Topic color', style: 'width:26px;height:22px;padding:0;border:none;background:none;cursor:pointer',
      oninput: (ev) => { topic.color = ev.target.value; mutatedQuiet(); },
      onchange: () => mutated(),
    });
    list.append(el('span', { class: 'chip', style: `border-color:${topic.color}` },
      colorInput, ' ', topic.name, ' ',
      el('button', {
        class: 'linkish small', title: 'Delete topic (unassigns it everywhere)',
        onclick: async () => {
          if (!(await confirmModal('Delete topic', `Delete topic “${topic.name}”? It will be unassigned from all notes and evidence.`, 'Delete'))) return;
          state.topics = state.topics.filter((t) => t.id !== topic.id);
          for (const n of state.notes) n.topicIds = (n.topicIds || []).filter((id) => id !== topic.id);
          for (const e of state.evidence) e.topicIds = (e.topicIds || []).filter((id) => id !== topic.id);
          if (topicFilter === topic.id) topicFilter = null;
          mutated();
        },
      }, '×'),
    ));
  }
  const nameInput = el('input', { type: 'text', placeholder: 'New topic…', style: 'width:150px' });
  const addTopic = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    state.topics.push({ id: crypto.randomUUID(), name, color: PALETTE[state.topics.length % PALETTE.length] });
    nameInput.value = '';
    mutated();
  };
  nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addTopic(); });
  list.append(nameInput, el('button', { onclick: addTopic }, 'Add topic'));
  box.append(list);
  return box;
}

export function topicChips(assignedIds, onToggle) {
  const row = el('div', { class: 'row', style: 'gap:4px' });
  if (state.topics.length === 0) {
    row.append(el('span', { class: 'muted small', text: 'No topics yet — create one in Notes.' }));
  }
  for (const topic of state.topics) {
    const on = assignedIds.includes(topic.id);
    row.append(el('button', {
      class: `chip${on ? ' on' : ''}`,
      style: on ? `background:${topic.color};border-color:${topic.color}` : `border-color:${topic.color}`,
      onclick: () => onToggle(topic.id, !on),
    }, topic.name));
  }
  return row;
}

// ---- note editor --------------------------------------------------------

function noteEditor(note) {
  const box = el('div', { class: 'card stack' });
  if (!note) {
    box.append(el('p', { class: 'muted', text: 'Select a note on the left, or create a new one.' }));
    return box;
  }
  const runInfo = note.sourceRunId ? state.pendingRuns[note.sourceRunId] : null;
  const head = el('div', { class: 'row' });
  if (note.sourceRunId) {
    head.append(el('span', {
      class: 'badge',
      title: `Created from agent run ${note.sourceRunId}${runInfo && runInfo.sessionId ? ` — session ${runInfo.sessionId}` : ''}`,
    }, 'from run'));
  }
  head.append(el('span', { class: 'muted small', text: `updated ${fmtDate(note.updatedAt)}` }));
  head.append(el('button', {
    class: 'danger', style: 'margin-left:auto',
    onclick: async () => {
      if (!(await confirmModal('Delete note', `Delete note “${note.title}”?`, 'Delete'))) return;
      state.notes = state.notes.filter((n) => n.id !== note.id);
      if (selectedNoteId === note.id) selectedNoteId = null;
      mutated();
    },
  }, 'Delete'));
  box.append(head);

  box.append(el('div', { class: 'field' },
    el('label', { text: 'Title' }),
    el('input', {
      type: 'text', value: note.title,
      oninput: (ev) => { note.title = ev.target.value; note.updatedAt = nowIso(); mutatedQuiet(); },
      onchange: () => mutated(),
    })));
  box.append(el('div', { class: 'field' },
    el('label', { text: 'Body (markdown)' }),
    el('textarea', {
      rows: 12, value: note.body,
      oninput: (ev) => { note.body = ev.target.value; note.updatedAt = nowIso(); mutatedQuiet(); },
    })));
  box.append(el('div', { class: 'field' },
    el('label', { text: 'Topics' }),
    topicChips(note.topicIds || [], (topicId, on) => {
      note.topicIds = on
        ? [...(note.topicIds || []), topicId]
        : (note.topicIds || []).filter((id) => id !== topicId);
      note.updatedAt = nowIso();
      mutated();
    })));

  const evBox = el('div', { class: 'field' }, el('label', { text: 'Linked evidence' }));
  const linked = (note.evidenceIds || []).map((id) => ({ id, ev: findEvidence(id) }));
  if (linked.length === 0) evBox.append(el('span', { class: 'muted small', text: 'No evidence linked.' }));
  for (const { id, ev } of linked) {
    evBox.append(el('div', { class: 'row small' },
      el('span', {}, ev ? clampText(ev.title, 80) : '(deleted evidence)'),
      ev ? el('span', { class: 'prov', text: `${ev.provenance.repoName} ${ev.provenance.filePath}@${String(ev.provenance.commit).slice(0, 8)}:${ev.provenance.startLine}-${ev.provenance.endLine}` }) : null,
      el('button', {
        class: 'linkish small',
        onclick: () => { note.evidenceIds = note.evidenceIds.filter((e) => e !== id); mutated(); },
      }, 'unlink'),
    ));
  }
  box.append(evBox);
  return box;
}

// ---- view ---------------------------------------------------------------

export function render(container) {
  rootEl = container;
  clear(container);
  container.append(topicsManager());

  const filterRow = el('div', { class: 'row', style: 'margin-bottom:8px' },
    el('span', { class: 'small muted' }, 'Filter:'),
    el('button', { class: `chip${topicFilter == null ? ' on' : ''}`, style: topicFilter == null ? 'background:var(--ink-soft);border-color:var(--ink-soft)' : '', onclick: () => { topicFilter = null; rerender(); } }, 'All'),
    state.topics.map((t) => el('button', {
      class: `chip${topicFilter === t.id ? ' on' : ''}`,
      style: topicFilter === t.id ? `background:${t.color};border-color:${t.color}` : `border-color:${t.color}`,
      onclick: () => { topicFilter = topicFilter === t.id ? null : t.id; rerender(); },
    }, t.name)),
    el('button', {
      class: 'primary', style: 'margin-left:auto',
      onclick: () => {
        const note = makeNote({ title: 'Untitled note', body: '' });
        state.notes.unshift(note);
        selectedNoteId = note.id;
        mutated();
      },
    }, 'New note'),
  );
  container.append(filterRow);

  const notes = state.notes.filter((n) => topicFilter == null || (n.topicIds || []).includes(topicFilter));
  const listBox = el('ul', { class: 'plain' });
  if (notes.length === 0) listBox.append(el('li', { class: 'muted small' }, 'No notes yet.'));
  for (const note of notes) {
    listBox.append(el('li', { class: `note-row${note.id === selectedNoteId ? ' current' : ''}` },
      el('input', {
        type: 'checkbox', checked: isSelected('notes', note.id),
        title: 'Add this note to the selection tray',
        onchange: () => toggleItem('notes', { id: note.id }),
      }),
      el('button', { class: 'title-btn', title: note.title, onclick: () => { selectedNoteId = note.id; rerender(); } },
        clampText(note.title || 'Untitled note', 60)),
      note.sourceRunId ? el('span', { class: 'badge', title: `agent run ${note.sourceRunId}` }, 'run') : null,
      el('span', { class: 'muted small', text: fmtDate(note.updatedAt) }),
    ));
  }
  container.append(el('div', { class: 'two-col' }, el('div', {}, listBox), noteEditor(selectedNote())));
}
