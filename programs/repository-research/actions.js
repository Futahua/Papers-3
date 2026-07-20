/**
 * The agent-action catalog and the exact-invocation builder.
 * Every invocation is constructed from the program-owned selection with
 * hash-verified shared material; Papers previews it before anything runs.
 */
import * as api from './api.js';
import {
  state, mutated, findEvidence, findNote, findDraft, findTask, findSection,
  contentForEvidence, contentForNote, contentForSection, contentForTask,
  makeDraft, nowIso,
} from './state.js';
import { toast, showModal } from './ui.js';
import { el } from './dom.js';

const MAX_FILE_SHARE_CHARS = 120000;
const MAX_ITEM_CHARS = 512000;
const MAX_TOTAL_BYTES = 1500000;

const NOTE_JSON =
  'Reply with your analysis, then a single ```json fenced block shaped exactly as ' +
  '{"noteTitle": string, "noteBody": string} where noteBody is markdown.';

export const ACTIONS = [
  {
    id: 'explain-files', label: 'Explain selected files',
    selectionTypes: ['files', 'code-regions'], min: 1, destinationType: 'notes',
    instruction: 'Explain the selected files or code regions from this repository: their purpose, '
      + 'structure, key functions and types, and how the pieces relate to each other. ' + NOTE_JSON,
  },
  {
    id: 'compare-implementations', label: 'Compare selected implementations',
    selectionTypes: ['files', 'code-regions'], min: 2, destinationType: 'notes',
    instruction: 'Compare the selected implementations: shared responsibilities, differences in '
      + 'approach, trade-offs, and which situations favour each. ' + NOTE_JSON,
  },
  {
    id: 'summarize-evidence', label: 'Summarize selected evidence',
    selectionTypes: ['evidence'], min: 1, destinationType: 'notes',
    instruction: 'Summarize the selected evidence excerpts into one coherent research note, citing '
      + 'each excerpt by its title. ' + NOTE_JSON,
  },
  {
    id: 'find-disagreements', label: 'Find disagreements or inconsistencies',
    selectionTypes: ['evidence'], min: 1, destinationType: 'notes',
    instruction: 'Examine the selected evidence excerpts for disagreements, inconsistencies, or '
      + 'contradictions between them, pointing at the exact excerpts involved. ' + NOTE_JSON,
  },
  {
    id: 'map-dependencies', label: 'Map dependencies of selected code',
    selectionTypes: ['files', 'code-regions'], min: 1, destinationType: 'notes',
    instruction: 'Map the dependencies of the selected code: what it imports or calls, what appears '
      + 'to depend on it, and the overall dependency structure. ' + NOTE_JSON,
  },
  {
    id: 'organize-notes', label: 'Organize selected notes',
    selectionTypes: ['notes'], min: 1, destinationType: 'notes',
    instruction: 'Organize the selected notes: propose a coherent structure, merge overlapping '
      + 'content, and point out gaps. ' + NOTE_JSON,
  },
  {
    id: 'suggest-outline', label: 'Suggest an outline',
    selectionTypes: ['evidence', 'notes'], min: 1, destinationType: 'draft',
    instruction: 'Suggest an outline for a research document based on the selected material. Reply '
      + 'with your reasoning, then a single ```json fenced block shaped exactly as '
      + '{"draftTitle": string, "sections": [{"heading": string, "body": string}]} '
      + 'where each body sketches the section in markdown.',
  },
  {
    id: 'draft-from-evidence', label: 'Draft from selected evidence',
    selectionTypes: ['evidence'], min: 1, destinationType: 'draft-section',
    instruction: 'Write one draft section grounded strictly in the selected evidence excerpts. Reply '
      + 'with your reasoning, then a single ```json fenced block shaped exactly as '
      + '{"heading": string, "body": string} with body in markdown.',
  },
  {
    id: 'check-claims', label: 'Check claims in selected draft sections',
    selectionTypes: ['draft-sections'], min: 1, destinationType: 'notes',
    instruction: 'Check the factual and technical claims in the selected draft sections. Flag claims '
      + 'that are unsupported, doubtful, or wrong, and say why. ' + NOTE_JSON,
  },
  {
    id: 'suggest-missing-evidence', label: 'Suggest missing evidence',
    selectionTypes: ['draft-sections', 'evidence'], min: 1, destinationType: 'notes',
    instruction: 'Given the selected material, suggest what evidence is missing: which claims lack '
      + 'support and where in a repository one might look for it. ' + NOTE_JSON,
  },
  {
    id: 'propose-coding-task', label: 'Propose a coding task from selected evidence',
    selectionTypes: ['evidence', 'notes'], min: 1, destinationType: 'tasks',
    instruction: 'Propose one concrete, well-scoped coding task grounded in the selected material. '
      + 'Reply with your reasoning, then a single ```json fenced block shaped exactly as '
      + '{"title": string, "description": string, "acceptance": string}.',
  },
  {
    id: 'implement-task', label: 'Implement approved task in worktree',
    selectionTypes: ['task'], min: 1, destinationType: 'tasks',
    instruction: 'Work ONLY inside the working directory (an isolated disposable git worktree). '
      + 'Implement the task described in the shared material. Run any quick checks that exist. '
      + 'Then report. Reply with a single ```json fenced block shaped exactly as '
      + '{"changedFiles": [string], "checksRun": string, "checksPassed": boolean, "notes": string}.',
  },
];

export function applicableActions(selection) {
  if (!selection || !selection.type || selection.items.length === 0) return [];
  return ACTIONS.filter((a) => {
    if (!a.selectionTypes.includes(selection.type)) return false;
    if (selection.items.length < a.min) return false;
    if (a.id === 'implement-task') {
      const task = findTask(selection.items[0]?.id);
      return Boolean(task && task.status === 'approved' && task.worktree);
    }
    return true;
  });
}

// ---- shared-material construction ---------------------------------------

function capContent(content, cap) {
  const capped = content.length > cap;
  return {
    content: capped ? content.slice(0, cap) : content,
    capped,
    originalByteLength: api.byteLength(content),
  };
}

async function materialItem({ kind, reference, title, mediaType, rawContent, hostTruncated, hostByteLength }) {
  const cap = kind === 'file' ? MAX_FILE_SHARE_CHARS : MAX_ITEM_CHARS;
  const { content, capped, originalByteLength } = capContent(rawContent, cap);
  const item = {
    reference,
    title: (title || 'Untitled').slice(0, 300),
    mediaType,
    preview: content.slice(0, 200),
    contentHash: await api.sha256Hex(content),
    content,
  };
  if (capped || hostTruncated) {
    item.truncated = true;
    item.originalByteLength = hostByteLength ?? originalByteLength;
  }
  return { item, kind };
}

async function buildMaterial(selection) {
  const references = [];
  const entries = [];
  for (const sel of selection.items) {
    if (selection.type === 'files') {
      const result = await api.repo.readFile(sel.resourceId, sel.filePath);
      const reference = { type: 'source-file', id: sel.filePath, detail: { resourceId: sel.resourceId } };
      references.push(reference);
      entries.push(await materialItem({
        kind: 'file', reference, title: sel.filePath, mediaType: 'text/plain',
        rawContent: result.content ?? '', hostTruncated: Boolean(result.truncated),
        hostByteLength: result.byteLength,
      }));
    } else if (selection.type === 'code-regions') {
      const id = `${sel.filePath}:${sel.startLine}-${sel.endLine}`;
      const reference = {
        type: 'code-region', id,
        detail: { resourceId: sel.resourceId, filePath: sel.filePath, startLine: sel.startLine, endLine: sel.endLine },
      };
      references.push(reference);
      entries.push(await materialItem({
        kind: 'region', reference, title: id, mediaType: 'text/plain', rawContent: sel.excerpt ?? '',
      }));
    } else if (selection.type === 'evidence') {
      const ev = findEvidence(sel.id);
      if (!ev) throw new Error(`Selected evidence no longer exists (${sel.id}).`);
      const reference = { type: 'evidence', id: ev.id };
      references.push(reference);
      entries.push(await materialItem({
        kind: 'evidence', reference, title: ev.title, mediaType: 'text/plain',
        rawContent: contentForEvidence(ev),
      }));
    } else if (selection.type === 'notes') {
      const note = findNote(sel.id);
      if (!note) throw new Error(`Selected note no longer exists (${sel.id}).`);
      const reference = { type: 'note', id: note.id };
      references.push(reference);
      entries.push(await materialItem({
        kind: 'note', reference, title: note.title, mediaType: 'text/markdown',
        rawContent: contentForNote(note),
      }));
    } else if (selection.type === 'draft-sections') {
      const found = findSection(sel.sectionId);
      if (!found) throw new Error('A selected draft section no longer exists.');
      const reference = { type: 'draft-section', id: found.section.id };
      references.push(reference);
      entries.push(await materialItem({
        kind: 'section', reference, title: found.section.heading || 'Untitled section',
        mediaType: 'text/markdown', rawContent: contentForSection(found.section),
      }));
    } else if (selection.type === 'task') {
      const task = findTask(sel.id);
      if (!task) throw new Error('The selected task no longer exists.');
      const reference = { type: 'coding-task', id: task.id };
      references.push(reference);
      entries.push(await materialItem({
        kind: 'task', reference, title: task.title, mediaType: 'text/plain',
        rawContent: contentForTask(task),
      }));
    } else {
      throw new Error(`Unsupported selection type: ${selection.type}`);
    }
  }
  const total = entries.reduce((sum, e) => sum + api.byteLength(e.item.content), 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new Error('Selection is too large to share (over 1.5 MB). Select fewer or smaller items.');
  }
  return { references, entries };
}

// ---- draft target picker (for draft-from-evidence) ----------------------

function pickTargetDraft() {
  return new Promise((resolve) => {
    const select = el('select', {});
    for (const draft of state.drafts) {
      select.append(el('option', { value: draft.id }, draft.title || 'Untitled draft'));
    }
    select.append(el('option', { value: '__new__' }, 'New draft…'));
    let settled = false;
    showModal({
      title: 'Choose the target draft',
      body: el('div', { class: 'stack' },
        el('p', { class: 'muted small', text: 'The generated section will be appended to this draft after you review the result.' }),
        select),
      actions: [
        { label: 'Cancel', onClick: () => { settled = true; resolve(null); } },
        {
          label: 'Use this draft', kind: 'primary',
          onClick: () => {
            settled = true;
            if (select.value === '__new__' || !select.value) {
              const draft = makeDraft({ title: 'Draft from evidence' });
              state.drafts.push(draft);
              mutated();
              resolve(draft.id);
            } else {
              resolve(select.value);
            }
          },
        },
      ],
    });
    // If the modal is dismissed via Escape the promise must still settle.
    const observer = new MutationObserver(() => {
      if (!document.getElementById('modal-root').firstChild) {
        observer.disconnect();
        if (!settled) resolve(null);
      }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

// ---- invocation ---------------------------------------------------------

export async function runAction(actionId, selection) {
  const action = ACTIONS.find((a) => a.id === actionId);
  if (!action) return;
  if (!applicableActions(selection).some((a) => a.id === actionId)) {
    toast('That action does not apply to the current selection.', 'error');
    return;
  }

  let destinationDraftId = null;
  if (action.destinationType === 'draft-section') {
    destinationDraftId = await pickTargetDraft();
    if (!destinationDraftId) return;
  }

  const identity = await api.identity();
  let built;
  try {
    built = await buildMaterial(selection);
  } catch (err) {
    toast(api.parseCapabilityError(err).message, 'error');
    return;
  }

  const destination = { programId: 'repository-research', type: action.destinationType };
  if (destinationDraftId) destination.reference = { type: 'draft', id: destinationDraftId };
  const task = selection.type === 'task' ? findTask(selection.items[0].id) : null;
  if (task) destination.reference = { type: 'coding-task', id: task.id };

  const invocation = {
    version: 1,
    origin: {
      backpackId: identity.backpackId,
      programId: identity.programId,
      commandId: `rr.${action.id}`,
    },
    action: { id: action.id, label: action.label, creatorInstruction: action.instruction },
    selection: { type: selection.type, references: built.references },
    sharedMaterial: built.entries.map((e) => e.item),
    destination,
    permissions: ['agent.invoke'],
  };
  if (action.id === 'implement-task' && task && task.worktree) {
    invocation.execution = { cwd: task.worktree.worktreePath, preferredWorker: task.worker || 'hermes' };
  }

  let ref;
  try {
    ref = await api.papers.agent.invoke(invocation);
  } catch (err) {
    const parsed = api.parseCapabilityError(err);
    if (/not confirmed/i.test(parsed.message)) {
      toast('Invocation cancelled at the preview.');
    } else {
      toast(`Invocation failed: ${parsed.message}`, 'error');
    }
    return;
  }

  state.pendingRuns[ref.runId] = {
    runId: ref.runId,
    actionId: action.id,
    actionLabel: action.label,
    destinationType: action.destinationType,
    destinationDraftId,
    taskId: task ? task.id : null,
    evidenceIds: selection.type === 'evidence' ? selection.items.map((i) => i.id) : [],
    sharedHashes: built.entries.map((e) => ({
      kind: e.kind, refType: e.item.reference.type, refId: e.item.reference.id, hash: e.item.contentHash,
    })),
    status: 'pending',
    runState: 'queued',
    createdAt: nowIso(),
  };
  if (action.id === 'implement-task' && task) {
    task.status = 'delegated';
    task.runId = ref.runId;
    task.updatedAt = nowIso();
  }
  mutated();
  toast(`Run started: ${action.label}`);
}

export async function cancelRun(runId) {
  try {
    await api.papers.agent.cancel(runId);
    toast('Cancellation requested.');
  } catch (err) {
    toast(`Cancel failed: ${api.parseCapabilityError(err).message}`, 'error');
  }
}
