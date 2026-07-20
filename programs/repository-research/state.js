/**
 * Program state: single mutable object persisted through papers.state
 * (debounced), plus a published cross-program summary. Unknown fields from
 * older/newer versions of the loaded state are preserved on save.
 */
import { papers } from './api.js';

const SAVE_DEBOUNCE_MS = 500;

/** Keys this version of the program owns inside the persisted object. */
const DATA_KEYS = [
  'repositories', 'topics', 'notes', 'evidence', 'collections',
  'tasks', 'drafts', 'artifacts', 'undo', 'pendingRuns',
];

/** Arrays captured in the one-deep undo snapshot before applying a proposal. */
const UNDO_KEYS = ['topics', 'notes', 'evidence', 'collections', 'tasks', 'drafts'];

function freshState() {
  return {
    schemaVersion: 1,
    repositories: [],
    topics: [],
    notes: [],
    evidence: [],
    collections: [],
    tasks: [],
    drafts: [],
    artifacts: [],
    undo: null,
    pendingRuns: {},
  };
}

export const state = freshState();

/** The raw loaded object; spread on save so unknown fields survive. */
let loadedRaw = null;
let saveTimer = null;
let saveStatusCb = null;
const listeners = new Set();

export function onSaveStatus(cb) { saveStatusCb = cb; }

export async function initState() {
  const loaded = await papers.state.load();
  if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
    loadedRaw = loaded;
    for (const key of DATA_KEYS) {
      if (key in loaded && loaded[key] != null) state[key] = loaded[key];
    }
    if (typeof state.pendingRuns !== 'object' || state.pendingRuns == null) state.pendingRuns = {};
    // A run still marked live after a restart was interrupted — say so honestly.
    for (const run of Object.values(state.pendingRuns)) {
      if (run && run.status === 'pending') run.status = 'interrupted';
    }
  }
}

// ---- change propagation -------------------------------------------------

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (err) { console.error('listener failed', err); }
  }
}

/** Structural mutation: re-render views and schedule a save. */
export function mutated() {
  notify();
  scheduleSave();
}

/** Text-input mutation: save without re-rendering (keeps focus in fields). */
export function mutatedQuiet() {
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveNow(); }, SAVE_DEBOUNCE_MS);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const payload = { ...(loadedRaw || {}), schemaVersion: 1 };
  for (const key of DATA_KEYS) payload[key] = state[key];
  try {
    if (saveStatusCb) saveStatusCb('saving');
    await papers.state.save(payload);
    loadedRaw = payload;
    if (saveStatusCb) saveStatusCb('saved');
  } catch (err) {
    console.error('state.save failed', err);
    if (saveStatusCb) saveStatusCb('error');
    return;
  }
  try {
    await publishSummary();
  } catch (err) {
    console.error('summary.publish failed', err);
  }
}

async function publishSummary() {
  const tasksByStatus = {};
  for (const t of state.tasks) tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
  await papers.summary.publish({
    schemaVersion: 1,
    repositories: state.repositories.map((r) => ({ name: r.name })),
    counts: {
      notes: state.notes.length,
      evidence: state.evidence.length,
      topics: state.topics.length,
      tasks: state.tasks.length,
      drafts: state.drafts.length,
      artifacts: state.artifacts.length,
    },
    tasksByStatus,
    topics: state.topics.map((t) => ({
      name: t.name,
      evidenceCount: state.evidence.filter((e) => (e.topicIds || []).includes(t.id)).length,
    })),
    updatedAt: new Date().toISOString(),
  });
}

// ---- undo (one-deep) ----------------------------------------------------

export function snapshotUndo(label) {
  const snap = {};
  for (const key of UNDO_KEYS) snap[key] = JSON.parse(JSON.stringify(state[key]));
  state.undo = { label, at: new Date().toISOString(), state: snap };
}

export function applyUndo() {
  if (!state.undo || !state.undo.state) return false;
  for (const key of UNDO_KEYS) {
    if (state.undo.state[key] != null) state[key] = state.undo.state[key];
  }
  state.undo = null;
  mutated();
  return true;
}

// ---- lookups ------------------------------------------------------------

export const findRepo = (resourceId) => state.repositories.find((r) => r.resourceId === resourceId) || null;
export const findTopic = (id) => state.topics.find((t) => t.id === id) || null;
export const findNote = (id) => state.notes.find((n) => n.id === id) || null;
export const findEvidence = (id) => state.evidence.find((e) => e.id === id) || null;
export const findCollection = (id) => state.collections.find((c) => c.id === id) || null;
export const findTask = (id) => state.tasks.find((t) => t.id === id) || null;
export const findDraft = (id) => state.drafts.find((d) => d.id === id) || null;

export function findSection(sectionId) {
  for (const draft of state.drafts) {
    const section = (draft.sections || []).find((s) => s.id === sectionId);
    if (section) return { draft, section };
  }
  return null;
}

// ---- canonical shared-content builders ----------------------------------
// Used both when building sharedMaterial and when re-checking staleness, so
// the hashes are comparable.

export const contentForEvidence = (ev) => ev.excerpt ?? '';
export const contentForNote = (note) => `${note.title ?? ''}\n\n${note.body ?? ''}`;
export const contentForSection = (section) => `${section.heading ?? ''}\n\n${section.body ?? ''}`;
export const contentForTask = (task) =>
  `Title: ${task.title ?? ''}\nDescription:\n${task.description ?? ''}\nAcceptance criteria:\n${task.acceptance ?? ''}`;

// ---- small factories ----------------------------------------------------

export function nowIso() { return new Date().toISOString(); }

export function makeNote({ title, body, topicIds = [], evidenceIds = [], sourceRunId = null }) {
  const at = nowIso();
  return { id: crypto.randomUUID(), title, body, topicIds, evidenceIds, sourceRunId, createdAt: at, updatedAt: at };
}

export function makeTask({ title, description, acceptance, worker = 'hermes' }) {
  const at = nowIso();
  return {
    id: crypto.randomUUID(), title, description, acceptance,
    status: 'proposed', worker, worktree: null, runId: null,
    diffStat: null, resultSummary: null, createdAt: at, updatedAt: at,
  };
}

export function makeDraft({ title, sections = [] }) {
  return {
    id: crypto.randomUUID(),
    title,
    sections: sections.map((s) => ({
      id: crypto.randomUUID(), heading: s.heading ?? '', body: s.body ?? '', evidenceIds: s.evidenceIds ?? [],
    })),
    updatedAt: nowIso(),
  };
}
