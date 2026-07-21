/** Coding Tasks: status columns, task detail, worktrees, delegation. */
import { el, clear, fmtDate, clampText, shortCommit } from '../dom.js';
import * as api from '../api.js';
import { state, mutated, mutatedQuiet, findTask, findRepo, nowIso, makeTask } from '../state.js';
import { toast, showModal, confirmModal } from '../ui.js';
import { setSelection, isSelected } from '../tray.js';
import { runAction, cancelRun } from '../actions.js';

const COLUMNS = [
  { key: 'proposed', label: 'Proposed' },
  { key: 'approved', label: 'Approved' },
  { key: 'delegated', label: 'Delegated' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

let selectedTaskId = null;
let rootEl = null;
/** taskId → { loading, data, error } for worktree diffs */
const diffCache = new Map();

function rerender() { if (rootEl && rootEl.isConnected) render(rootEl); }

function columnOf(task) {
  if (task.status === 'accepted' || task.status === 'rejected') return 'done';
  return task.status;
}

function runChip(task) {
  if (!task.runId) return null;
  const run = state.pendingRuns[task.runId];
  if (!run) return null;
  const label = run.status === 'pending' ? (run.runState || 'queued') : run.status;
  const warn = ['failed', 'cancelled', 'interrupted'].includes(label);
  return el('span', { class: `badge run-chip${warn ? ' warn' : ''}`, title: `run ${task.runId}` }, label);
}

function taskCard(task) {
  return el('div', {
    class: `card task-card${task.id === selectedTaskId ? ' current' : ''}`,
    onclick: () => {
      selectedTaskId = task.id;
      setSelection('task', [{ id: task.id }]);
      rerender();
    },
  },
    el('h4', { text: clampText(task.title, 60) }),
    el('div', { class: 'row small' },
      el('span', { class: 'badge plain', text: task.worker || 'hermes' }),
      runChip(task),
      task.status === 'rejected' ? el('span', { class: 'badge warn', text: 'rejected' }) : null,
      task.status === 'accepted' ? el('span', { class: 'badge', text: 'accepted' }) : null,
    ),
  );
}

// ---- worktree / delegation ----------------------------------------------

async function createWorktree(task, repoResourceId) {
  if (!repoResourceId) { toast('Pick the repository the worktree should branch from.', 'error'); return; }
  const name = `task-${task.id.slice(0, 8)}`;
  try {
    const result = await api.create.worktree(repoResourceId, name);
    task.worktree = {
      resourceId: result.resourceId,
      worktreePath: result.worktreePath,
      branch: result.branch,
      baseCommit: result.baseCommit,
    };
    task.updatedAt = nowIso();
    mutated();
    toast(`Worktree created on branch ${result.branch}.`);
  } catch (err) {
    toast(`Worktree not created: ${api.parseCapabilityError(err).message}`, 'error');
  }
}

function loadDiff(task, force = false) {
  if (!task.worktree) return;
  const cached = diffCache.get(task.id);
  if (cached && !force && (cached.loading || cached.data || cached.error)) return;
  diffCache.set(task.id, { loading: true, data: null, error: null });
  rerender();
  api.repo.worktreeDiff(task.worktree.resourceId).then((data) => {
    diffCache.set(task.id, { loading: false, data, error: null });
    if (data.stat != null) { task.diffStat = data.stat; mutatedQuiet(); }
  }).catch((err) => {
    diffCache.set(task.id, { loading: false, data: null, error: api.parseCapabilityError(err).message });
  }).finally(rerender);
}

function rejectTask(task) {
  showModal({
    title: 'Reject task',
    body: el('div', { class: 'stack' },
      el('p', { text: `Reject “${task.title}”?` }),
      task.worktree
        ? el('p', { class: 'muted small', text: 'You can also remove its worktree. The base repository is never touched either way.' })
        : null),
    actions: [
      { label: 'Cancel', onClick: () => {} },
      {
        label: 'Reject, keep worktree', kind: 'danger',
        onClick: () => { task.status = 'rejected'; task.updatedAt = nowIso(); mutated(); },
      },
      ...(task.worktree ? [{
        label: 'Reject and remove worktree', kind: 'danger',
        onClick: () => {
          const worktreeId = task.worktree.resourceId;
          task.status = 'rejected';
          task.updatedAt = nowIso();
          mutated();
          api.create.removeWorktree(worktreeId).then(() => {
            task.worktree = null;
            diffCache.delete(task.id);
            mutated();
            toast('Worktree removed.');
          }).catch((err) => {
            toast(`Worktree not removed: ${api.parseCapabilityError(err).message}`, 'error');
          });
        },
      }] : []),
    ],
  });
}

// ---- detail pane --------------------------------------------------------

function detailPane(task) {
  const box = el('div', { class: 'card stack' });
  if (!task) {
    box.append(el('p', { class: 'muted', text: 'Select a task, or create one below.' }));
    return box;
  }
  const editable = task.status === 'proposed' || task.status === 'approved';

  box.append(el('div', { class: 'row' },
    el('span', { class: 'badge', text: task.status }),
    runChip(task),
    el('span', { class: 'muted small', text: `updated ${fmtDate(task.updatedAt)}` }),
    task.status === 'proposed' ? el('button', {
      class: 'danger', style: 'margin-left:auto',
      onclick: async () => {
        if (!(await confirmModal('Delete task', `Delete task “${task.title}”?`, 'Delete'))) return;
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        if (selectedTaskId === task.id) selectedTaskId = null;
        mutated();
      },
    }, 'Delete') : null,
  ));

  box.append(el('div', { class: 'field' }, el('label', { text: 'Title' }),
    el('input', {
      type: 'text', value: task.title, disabled: !editable,
      oninput: (ev) => { task.title = ev.target.value; task.updatedAt = nowIso(); mutatedQuiet(); },
      onchange: () => mutated(),
    })));
  box.append(el('div', { class: 'field' }, el('label', { text: 'Description' }),
    el('textarea', {
      rows: 5, value: task.description || '', disabled: !editable,
      oninput: (ev) => { task.description = ev.target.value; task.updatedAt = nowIso(); mutatedQuiet(); },
    })));
  box.append(el('div', { class: 'field' }, el('label', { text: 'Acceptance criteria' }),
    el('textarea', {
      rows: 3, value: task.acceptance || '', disabled: !editable,
      oninput: (ev) => { task.acceptance = ev.target.value; task.updatedAt = nowIso(); mutatedQuiet(); },
    })));
  box.append(el('div', { class: 'field' }, el('label', { text: 'Worker' }),
    el('select', {
      disabled: !editable,
      onchange: (ev) => { task.worker = ev.target.value; task.updatedAt = nowIso(); mutated(); },
    },
      ['hermes', 'codex', 'opencode'].map((w) => el('option', { value: w, selected: (task.worker || 'hermes') === w }, w)))));

  if (task.worktree) {
    box.append(el('div', { class: 'field' }, el('label', { text: 'Worktree' }),
      el('div', { class: 'prov' }, `${task.worktree.branch} @ ${shortCommit(task.worktree.baseCommit)} — ${task.worktree.worktreePath}`)));
  }
  if (task.diffStat) {
    box.append(el('div', { class: 'field' }, el('label', { text: 'Diff stat' }),
      el('pre', { class: 'small mono', style: 'margin:0;white-space:pre-wrap', text: task.diffStat })));
  }
  if (task.resultSummary) {
    box.append(el('div', { class: 'field' }, el('label', { text: 'Run result' }),
      el('div', { class: 'proposal-summary small', text: task.resultSummary })));
  }

  const buttons = el('div', { class: 'row' });
  if (task.status === 'proposed') {
    buttons.append(el('button', {
      class: 'primary',
      onclick: () => { task.status = 'approved'; task.updatedAt = nowIso(); mutated(); },
    }, 'Approve'));
  }
  if (task.status === 'approved') {
    if (!task.worktree) {
      const repoSelect = el('select', {},
        state.repositories.map((r) => el('option', { value: r.resourceId }, r.name)));
      buttons.append(repoSelect, el('button', {
        onclick: () => { void createWorktree(task, repoSelect.value); },
        disabled: state.repositories.length === 0,
        title: state.repositories.length === 0 ? 'Register a repository first' : 'Create an isolated worktree beside the repository',
      }, 'Create worktree'));
    }
    buttons.append(el('button', {
      class: 'primary', disabled: !task.worktree,
      title: task.worktree ? 'Delegate to the chosen worker inside the worktree' : 'Create a worktree first',
      onclick: () => { void runAction('implement-task', { type: 'task', items: [{ id: task.id }] }); },
    }, 'Delegate'));
  }
  if (task.status === 'delegated' && task.runId) {
    buttons.append(el('button', { onclick: () => { void cancelRun(task.runId); } }, 'Cancel run'));
  }
  if (task.status === 'review' || (task.worktree && (task.status === 'accepted' || task.status === 'rejected'))) {
    buttons.append(el('button', { onclick: () => loadDiff(task, true) }, 'Show diff'));
  }
  if (task.status === 'review') {
    buttons.append(
      el('button', {
        class: 'primary',
        onclick: () => { task.status = 'accepted'; task.updatedAt = nowIso(); mutated(); toast('Task accepted. The worktree is kept.'); },
      }, 'Accept'),
      el('button', { class: 'danger', onclick: () => rejectTask(task) }, 'Reject'),
    );
  }
  box.append(buttons);

  const diff = diffCache.get(task.id);
  if (diff) {
    if (diff.loading) box.append(el('p', { class: 'muted small', text: 'Reading worktree diff…' }));
    if (diff.error) box.append(el('p', { class: 'small', style: 'color:var(--danger)', text: diff.error }));
    if (diff.data) {
      box.append(el('div', { class: 'diff-panel' },
        `${diff.data.stat || '(no stat)'}\n\n${diff.data.diff || '(empty diff)'}${diff.data.truncated ? '\n\n[diff truncated by the host]' : ''}`));
    }
  }
  return box;
}

function newTaskForm() {
  const title = el('input', { type: 'text', placeholder: 'Task title', style: 'width:100%' });
  const description = el('textarea', { rows: 3, placeholder: 'Description', style: 'width:100%' });
  const acceptance = el('textarea', { rows: 2, placeholder: 'Acceptance criteria', style: 'width:100%' });
  const worker = el('select', {}, ['hermes', 'codex', 'opencode'].map((w) => el('option', { value: w }, w)));
  return el('section', { class: 'block' },
    el('h3', { text: 'New task' }),
    el('div', { class: 'stack', style: 'max-width:560px' },
      title, description, acceptance,
      el('div', { class: 'row' },
        el('label', { class: 'small muted' }, 'Worker'), worker,
        el('button', {
          class: 'primary',
          onclick: () => {
            if (!title.value.trim()) { toast('Give the task a title.', 'error'); return; }
            const task = makeTask({
              title: title.value.trim(), description: description.value,
              acceptance: acceptance.value, worker: worker.value,
            });
            state.tasks.unshift(task);
            selectedTaskId = task.id;
            mutated();
          },
        }, 'Create task'),
      ),
    ));
}

export function render(container) {
  rootEl = container;
  clear(container);
  if (selectedTaskId && !findTask(selectedTaskId)) selectedTaskId = null;

  const cols = el('div', { class: 'task-cols' });
  for (const column of COLUMNS) {
    const tasks = state.tasks.filter((t) => columnOf(t) === column.key);
    cols.append(el('div', { class: 'task-col' },
      el('h4', {}, `${column.label} (${tasks.length})`),
      el('div', { class: 'stack' }, tasks.map(taskCard)),
    ));
  }
  container.append(cols);
  container.append(detailPane(selectedTaskId ? findTask(selectedTaskId) : null));
  container.append(newTaskForm());
}
