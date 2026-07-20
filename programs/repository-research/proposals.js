/**
 * AgentResultProposal handling: validate, check destination, detect staleness,
 * preview in-program, and apply through program code with a one-deep undo.
 */
import * as api from './api.js';
import {
  state, mutated, snapshotUndo, nowIso,
  findEvidence, findNote, findDraft, findTask, findSection,
  contentForEvidence, contentForNote, contentForSection, contentForTask,
  makeNote, makeTask, makeDraft,
} from './state.js';
import { el } from './dom.js';
import { toast, showModal } from './ui.js';

/**
 * Recompute hashes for the shared objects as they are NOW. File and region
 * content is not refetched; those entries are skipped. A deleted object
 * counts as stale.
 */
async function checkStaleness(pending) {
  const staleRefs = [];
  for (const entry of pending.sharedHashes || []) {
    let current = null;
    switch (entry.kind) {
      case 'evidence': {
        const ev = findEvidence(entry.refId);
        current = ev ? contentForEvidence(ev) : null;
        break;
      }
      case 'note': {
        const note = findNote(entry.refId);
        current = note ? contentForNote(note) : null;
        break;
      }
      case 'section': {
        const found = findSection(entry.refId);
        current = found ? contentForSection(found.section) : null;
        break;
      }
      case 'task': {
        const task = findTask(entry.refId);
        current = task ? contentForTask(task) : null;
        break;
      }
      default:
        continue; // file / region: skip, not refetched
    }
    if (current == null) {
      staleRefs.push(`${entry.refType} ${entry.refId} (deleted)`);
      continue;
    }
    const hash = await api.sha256Hex(current);
    if (hash !== entry.hash) staleRefs.push(`${entry.refType} ${entry.refId} (edited)`);
  }
  return staleRefs;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function describeTarget(pending, stale) {
  switch (pending.destinationType) {
    case 'notes': return 'A new note will be created.';
    case 'draft': return 'A new draft with the proposed sections will be created.';
    case 'draft-section': {
      const draft = findDraft(pending.destinationDraftId);
      if (!draft) return 'The target draft no longer exists — a NEW draft will be created instead.';
      if (stale) return `Selection changed since the invocation — a NEW draft will be created instead of modifying “${draft.title}”.`;
      return `A new section will be appended to draft “${draft.title}”.`;
    }
    case 'tasks':
      if (pending.actionId === 'implement-task') {
        const task = findTask(pending.taskId);
        return task
          ? `Task “${task.title}” moves to review with the run result attached.`
          : 'The delegated task no longer exists — the result will be kept as a note.';
      }
      return 'A new proposed task will be created.';
    default: return '';
  }
}

function structuredPreview(structured) {
  if (!structured) return el('p', { class: 'muted small', text: 'No structured output — the summary text will be used.' });
  const dl = el('dl', { class: 'kv' });
  for (const [key, value] of Object.entries(structured)) {
    dl.append(el('dt', { text: key }));
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
    dl.append(el('dd', {}, el('span', { class: 'small', style: 'white-space:pre-wrap' }, String(text).slice(0, 1200))));
  }
  return dl;
}

// ---- apply --------------------------------------------------------------

function applyProposal(pending, proposal, stale) {
  const structured = asObject(proposal.structuredOutput);
  const runId = pending.runId;

  if (pending.destinationType === 'notes') {
    state.notes.unshift(makeNote({
      title: (structured && typeof structured.noteTitle === 'string' && structured.noteTitle) || pending.actionLabel,
      body: (structured && typeof structured.noteBody === 'string' && structured.noteBody) || proposal.summary,
      evidenceIds: [...(pending.evidenceIds || [])].filter((id) => findEvidence(id)),
      sourceRunId: runId,
    }));
    return 'Note created.';
  }

  if (pending.destinationType === 'draft') {
    const sections = Array.isArray(structured?.sections)
      ? structured.sections
        .filter((s) => asObject(s))
        .map((s) => ({ heading: String(s.heading ?? ''), body: String(s.body ?? '') }))
      : [{ heading: pending.actionLabel, body: proposal.summary }];
    state.drafts.unshift(makeDraft({
      title: (structured && typeof structured.draftTitle === 'string' && structured.draftTitle) || pending.actionLabel,
      sections,
    }));
    return 'Draft created from the proposed outline.';
  }

  if (pending.destinationType === 'draft-section') {
    const section = {
      id: crypto.randomUUID(),
      heading: (structured && typeof structured.heading === 'string' && structured.heading) || pending.actionLabel,
      body: (structured && typeof structured.body === 'string' && structured.body) || proposal.summary,
      evidenceIds: [...(pending.evidenceIds || [])].filter((id) => findEvidence(id)),
    };
    const target = stale ? null : findDraft(pending.destinationDraftId);
    if (target) {
      target.sections.push(section);
      target.updatedAt = nowIso();
      return `Section appended to “${target.title}”.`;
    }
    const draft = makeDraft({ title: section.heading || pending.actionLabel });
    draft.sections.push(section);
    state.drafts.unshift(draft);
    return 'Target draft was unavailable — created a new draft with the section.';
  }

  if (pending.destinationType === 'tasks' && pending.actionId === 'implement-task') {
    const task = findTask(pending.taskId);
    if (!task) {
      state.notes.unshift(makeNote({
        title: `Result of deleted task run`, body: proposal.summary, sourceRunId: runId,
      }));
      return 'Task was deleted — kept the run result as a note.';
    }
    task.status = 'review';
    task.updatedAt = nowIso();
    const lines = [];
    if (structured && typeof structured.notes === 'string' && structured.notes) lines.push(structured.notes);
    else lines.push(proposal.summary);
    if (Array.isArray(structured?.changedFiles) && structured.changedFiles.length) {
      lines.push(`Changed files: ${structured.changedFiles.map(String).join(', ')}`);
    }
    if (structured && typeof structured.checksRun === 'string' && structured.checksRun) {
      lines.push(`Checks run: ${structured.checksRun} — ${structured.checksPassed === true ? 'passed' : structured.checksPassed === false ? 'FAILED' : 'result unknown'}`);
    }
    task.resultSummary = lines.join('\n\n');
    if (task.worktree && task.worktree.resourceId) {
      void api.repo.worktreeDiff(task.worktree.resourceId)
        .then((diff) => { task.diffStat = diff.stat || null; mutated(); })
        .catch(() => { /* diff stat stays unknown; the Tasks view can retry */ });
    }
    return 'Task moved to review.';
  }

  if (pending.destinationType === 'tasks') {
    state.tasks.unshift(makeTask({
      title: (structured && typeof structured.title === 'string' && structured.title) || pending.actionLabel,
      description: (structured && typeof structured.description === 'string' && structured.description) || proposal.summary,
      acceptance: (structured && typeof structured.acceptance === 'string' && structured.acceptance) || '',
    }));
    return 'Proposed task created.';
  }

  return 'Nothing applied (unknown destination).';
}

// ---- entry point --------------------------------------------------------

export async function handleResultProposal(proposal) {
  if (!proposal || typeof proposal.invocationId !== 'string') return;
  const pending = state.pendingRuns[proposal.invocationId];
  if (!pending) return; // not one of ours (or long forgotten)
  if (typeof proposal.summary !== 'string') return;

  const staleRefs = await checkStaleness(pending);
  const stale = staleRefs.length > 0;

  const body = el('div', { class: 'stack' });
  if (stale) {
    body.append(el('div', { class: 'stale-banner' },
      el('strong', {}, 'Stale result. '),
      'The selected material changed after this run was invoked: ',
      staleRefs.join('; '),
      '. Accepting will only create new objects, never modify existing ones.'));
  }
  body.append(el('dl', { class: 'kv' },
    el('dt', { text: 'Action' }), el('dd', { text: pending.actionLabel }),
    el('dt', { text: 'Session' }), el('dd', {}, el('span', { class: 'mono small', text: proposal.sessionId || '(unknown)' })),
    el('dt', { text: 'Target' }), el('dd', { text: describeTarget(pending, stale) }),
  ));
  body.append(el('h4', { text: 'Summary' }));
  body.append(el('div', { class: 'proposal-summary', text: proposal.summary.slice(0, 6000) }));
  body.append(el('h4', { text: 'Structured output' }));
  body.append(structuredPreview(asObject(proposal.structuredOutput)));

  showModal({
    title: `Agent result: ${pending.actionLabel}`,
    wide: true,
    body,
    actions: [
      {
        label: 'Reject',
        onClick: () => {
          pending.status = 'rejected';
          pending.resolvedAt = nowIso();
          mutated();
          toast('Result rejected. The run record is kept.');
        },
      },
      {
        label: stale ? 'Accept (create new only)' : 'Accept',
        kind: 'primary',
        onClick: () => {
          snapshotUndo(`Apply “${pending.actionLabel}”`);
          const outcome = applyProposal(pending, proposal, stale);
          pending.status = 'applied';
          pending.resolvedAt = nowIso();
          mutated();
          toast(`Applied — Undo available. ${outcome}`);
        },
      },
    ],
  });
}
