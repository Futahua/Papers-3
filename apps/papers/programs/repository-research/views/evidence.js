/** Evidence board: cards grouped by topic, filters, collections. */
import { el, clear, provenanceLine, shortHash, clampText } from '../dom.js';
import { state, mutated, mutatedQuiet, findCollection } from '../state.js';
import { confirmModal } from '../ui.js';
import { toggleItem, isSelected } from '../tray.js';
import { topicChips } from './notes.js';

let filterTopic = '';
let filterRepo = '';
let filterText = '';
let activeCollectionId = '';
let rootEl = null;

function rerender() { if (rootEl && rootEl.isConnected) render(rootEl); }

function passesFilters(ev) {
  if (filterTopic && !(ev.topicIds || []).includes(filterTopic)) return false;
  if (filterRepo && ev.provenance.resourceId !== filterRepo) return false;
  if (filterText) {
    const needle = filterText.toLowerCase();
    const hay = `${ev.title}\n${ev.excerpt}\n${ev.note || ''}\n${ev.provenance.filePath}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (activeCollectionId) {
    const coll = findCollection(activeCollectionId);
    if (!coll || !coll.evidenceIds.includes(ev.id)) return false;
  }
  return true;
}

function evidenceCard(ev) {
  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'row' },
    el('input', {
      type: 'checkbox', checked: isSelected('evidence', ev.id),
      title: 'Add this evidence to the selection tray',
      onchange: () => toggleItem('evidence', { id: ev.id }),
    }),
    el('h4', { title: ev.title, style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, ev.title),
    el('button', {
      class: 'linkish small danger',
      onclick: async () => {
        if (!(await confirmModal('Delete evidence', `Delete evidence “${clampText(ev.title, 60)}”?`, 'Delete'))) return;
        state.evidence = state.evidence.filter((e) => e.id !== ev.id);
        for (const coll of state.collections) coll.evidenceIds = coll.evidenceIds.filter((id) => id !== ev.id);
        mutated();
      },
    }, 'delete'),
  ));
  card.append(el('div', { class: 'excerpt-clamp', text: ev.excerpt }));
  card.append(el('div', { class: 'prov', text: provenanceLine(ev.provenance) }));
  card.append(el('div', { class: 'row small', style: 'margin-top:4px' },
    el('span', { class: 'mono muted', title: `sha256 ${ev.provenance.contentHash}` }, `sha256 ${shortHash(ev.provenance.contentHash)}…`),
  ));
  card.append(el('div', { style: 'margin-top:6px' },
    topicChips(ev.topicIds || [], (topicId, on) => {
      ev.topicIds = on ? [...(ev.topicIds || []), topicId] : (ev.topicIds || []).filter((id) => id !== topicId);
      mutated();
    })));
  const noteInput = el('input', {
    type: 'text', placeholder: 'annotation…', value: ev.note || '', style: 'width:100%;margin-top:6px',
    oninput: (evn) => { ev.note = evn.target.value; mutatedQuiet(); },
  });
  card.append(noteInput);

  if (state.collections.length > 0) {
    const collSelect = el('select', { style: 'margin-top:6px' },
      el('option', { value: '' }, 'Add to collection…'),
      state.collections
        .filter((c) => !c.evidenceIds.includes(ev.id))
        .map((c) => el('option', { value: c.id }, c.name)));
    collSelect.addEventListener('change', () => {
      const coll = findCollection(collSelect.value);
      if (coll && !coll.evidenceIds.includes(ev.id)) {
        coll.evidenceIds.push(ev.id);
        mutated();
      }
    });
    card.append(collSelect);
  }
  return card;
}

function collectionsBar() {
  const bar = el('div', { class: 'row', style: 'margin-bottom:10px' }, el('span', { class: 'small muted' }, 'Collections:'));
  bar.append(el('button', {
    class: `chip${activeCollectionId === '' ? ' on' : ''}`,
    style: activeCollectionId === '' ? 'background:var(--ink-soft);border-color:var(--ink-soft)' : '',
    onclick: () => { activeCollectionId = ''; rerender(); },
  }, 'All evidence'));
  for (const coll of state.collections) {
    bar.append(el('button', {
      class: `chip${activeCollectionId === coll.id ? ' on' : ''}`,
      style: activeCollectionId === coll.id ? 'background:var(--moss);border-color:var(--moss)' : '',
      onclick: () => { activeCollectionId = activeCollectionId === coll.id ? '' : coll.id; rerender(); },
    }, `${coll.name} (${coll.evidenceIds.length})`));
  }
  const nameInput = el('input', { type: 'text', placeholder: 'New collection…', style: 'width:150px' });
  const add = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    state.collections.push({ id: crypto.randomUUID(), name, evidenceIds: [] });
    nameInput.value = '';
    mutated();
  };
  nameInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') add(); });
  bar.append(nameInput, el('button', { onclick: add }, 'Create'));
  return bar;
}

export function render(container) {
  rootEl = container;
  clear(container);

  container.append(collectionsBar());

  const topicSelect = el('select', { onchange: (ev) => { filterTopic = ev.target.value; rerender(); } },
    el('option', { value: '' }, 'All topics'),
    state.topics.map((t) => el('option', { value: t.id, selected: filterTopic === t.id }, t.name)));
  const repoSelect = el('select', { onchange: (ev) => { filterRepo = ev.target.value; rerender(); } },
    el('option', { value: '' }, 'All repositories'),
    state.repositories.map((r) => el('option', { value: r.resourceId, selected: filterRepo === r.resourceId }, r.name)));
  const textInput = el('input', {
    type: 'search', placeholder: 'Filter text…', value: filterText, style: 'width:200px',
    oninput: (ev) => { filterText = ev.target.value; renderGroups(); },
  });
  container.append(el('div', { class: 'row', style: 'margin-bottom:12px' }, topicSelect, repoSelect, textInput));

  const groupsBox = el('div', { class: 'evidence-groups' });
  container.append(groupsBox);

  function renderGroups() {
    clear(groupsBox);
    const visible = state.evidence.filter(passesFilters);
    if (visible.length === 0) {
      groupsBox.append(el('p', { class: 'muted', text: state.evidence.length === 0
        ? 'No evidence yet. Capture exact line ranges in the Explorer.'
        : 'No evidence matches the current filters.' }));
      return;
    }
    const groups = [];
    for (const topic of state.topics) {
      const items = visible.filter((e) => (e.topicIds || []).includes(topic.id));
      if (items.length) groups.push({ topic, items });
    }
    const untagged = visible.filter((e) => !(e.topicIds || []).length);
    if (untagged.length) groups.push({ topic: null, items: untagged });

    for (const group of groups) {
      groupsBox.append(el('section', {},
        el('div', { class: 'group-title' },
          group.topic ? el('span', { class: 'dot', style: `background:${group.topic.color}` }) : null,
          el('h3', {}, group.topic ? group.topic.name : 'Untagged'),
          el('span', { class: 'muted small' }, `${group.items.length}`),
        ),
        el('div', { class: 'evidence-grid', style: 'margin-top:6px' }, group.items.map(evidenceCard)),
      ));
    }
  }
  renderGroups();
}
