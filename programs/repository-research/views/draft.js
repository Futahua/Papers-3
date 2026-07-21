/** Draft Production: edit evidence-backed sections and create FODT reports. */
import { el, clear, fmtDate, clampText } from '../dom.js';
import * as api from '../api.js';
import {
  state,
  mutated,
  mutatedQuiet,
  findDraft,
  findEvidence,
  makeDraft,
  nowIso,
} from '../state.js';
import { buildFodt, slugify } from '../fodt.js';
import { toast, confirmModal } from '../ui.js';
import { toggleItem, isSelected } from '../tray.js';

let selectedDraftId = null;
let rootEl = null;

function rerender() {
  if (rootEl?.isConnected) render(rootEl);
}

function createDraft() {
  const value = makeDraft({
    title: 'Research report',
    sections: [{ heading: 'Findings', body: '', evidenceIds: [] }],
  });
  state.drafts.unshift(value);
  selectedDraftId = value.id;
  mutated();
}

async function generateArtifact(value) {
  const content = buildFodt(value, findEvidence);
  try {
    const result = await api.create.artifactFile(
      value.title || 'Research report',
      `${slugify(value.title)}.fodt`,
      content,
    );
    state.artifacts.unshift({
      id: crypto.randomUUID(),
      resourceId: result.resourceId,
      title: value.title || 'Research report',
      path: result.path,
      draftId: value.id,
      createdAt: nowIso(),
    });
    mutated();
    toast('Editable OpenDocument report created. Open Artifacts to inspect it.');
  } catch (err) {
    toast(`Report not created: ${api.parseCapabilityError(err).message}`, 'error');
  }
}

function evidencePicker(section) {
  const box = el('div', { class: 'stack' });
  if (state.evidence.length === 0) {
    box.append(el('span', { class: 'muted small', text: 'No evidence captured yet.' }));
    return box;
  }
  for (const evidence of state.evidence) {
    const input = el('input', {
      type: 'checkbox',
      checked: (section.evidenceIds || []).includes(evidence.id),
      onchange: () => {
        section.evidenceIds ||= [];
        section.evidenceIds = input.checked
          ? [...new Set([...section.evidenceIds, evidence.id])]
          : section.evidenceIds.filter((id) => id !== evidence.id);
        mutated();
      },
    });
    box.append(el('label', { class: 'row small', title: evidence.title },
      input,
      clampText(evidence.title, 76),
    ));
  }
  return box;
}

function sectionCard(value, section) {
  const selected = isSelected('draft-sections', `${value.id}|${section.id}`);
  return el('div', { class: 'card stack section-card' },
    el('div', { class: 'row' },
      el('input', {
        type: 'checkbox', checked: selected,
        title: 'Add this section to the exact selection tray',
        onchange: () => toggleItem('draft-sections', { draftId: value.id, sectionId: section.id }),
      }),
      el('input', {
        type: 'text', value: section.heading || '', style: 'flex:1',
        oninput: (event) => { section.heading = event.target.value; value.updatedAt = nowIso(); mutatedQuiet(); },
        onchange: () => mutated(),
      }),
      el('button', {
        class: 'danger linkish small',
        onclick: async () => {
          if (!(await confirmModal('Delete section', `Delete “${section.heading || 'Untitled section'}”?`, 'Delete'))) return;
          value.sections = value.sections.filter((item) => item.id !== section.id);
          value.updatedAt = nowIso();
          mutated();
        },
      }, 'delete'),
    ),
    el('textarea', {
      rows: 10, value: section.body || '', placeholder: 'Section body…',
      oninput: (event) => { section.body = event.target.value; value.updatedAt = nowIso(); mutatedQuiet(); },
      onchange: () => mutated(),
    }),
    el('div', { class: 'field' },
      el('label', { text: 'Evidence appendix references' }),
      evidencePicker(section),
    ),
  );
}

function editor(value) {
  if (!value) return el('div', { class: 'card muted', text: 'Select or create a draft.' });
  return el('div', { class: 'stack' },
    el('div', { class: 'card stack' },
      el('input', {
        type: 'text', value: value.title || '',
        oninput: (event) => { value.title = event.target.value; value.updatedAt = nowIso(); mutatedQuiet(); },
        onchange: () => mutated(),
      }),
      el('div', { class: 'row' },
        el('span', { class: 'muted small', text: `Updated ${fmtDate(value.updatedAt)}` }),
        el('button', {
          onclick: () => {
            value.sections.push({ id: crypto.randomUUID(), heading: 'New section', body: '', evidenceIds: [] });
            value.updatedAt = nowIso();
            mutated();
          },
        }, 'Add section'),
        el('button', { class: 'primary', onclick: () => void generateArtifact(value) }, 'Generate editable report'),
      ),
    ),
    value.sections.map((section) => sectionCard(value, section)),
  );
}

export function render(container) {
  rootEl = container;
  clear(container);
  if (selectedDraftId && !findDraft(selectedDraftId)) selectedDraftId = null;
  if (!selectedDraftId && state.drafts[0]) selectedDraftId = state.drafts[0].id;

  const list = el('div', { class: 'card stack' },
    el('button', { class: 'primary', onclick: createDraft }, 'New draft'),
    state.drafts.length === 0 ? el('span', { class: 'muted small', text: 'No drafts yet.' }) : null,
    state.drafts.map((value) => el('button', {
      class: value.id === selectedDraftId ? 'primary' : '',
      onclick: () => { selectedDraftId = value.id; rerender(); },
    }, value.title || 'Untitled draft')),
  );
  container.append(el('div', { class: 'two-col' }, list, editor(findDraft(selectedDraftId))));
}
