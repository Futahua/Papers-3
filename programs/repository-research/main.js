/**
 * Repository Research — program-owned workflow controller.
 *
 * This renderer is sandboxed. It receives no Node/Electron primitives and
 * reaches the machine only through the narrow `window.papers` capability API.
 */
import {
  papers,
  identity,
  repo,
  create,
  external,
  clipboardWrite,
  sha256Hex,
  byteLength,
  parseCapabilityError,
} from './api.js';
import {
  state,
  initState,
  subscribe,
  mutated,
  mutatedQuiet,
  saveNow,
  onSaveStatus,
  snapshotUndo,
  applyUndo,
  findRepo,
  findEvidence,
  findNote,
  findTask,
  findDraft,
  findSection,
  contentForEvidence,
  contentForNote,
  contentForSection,
  contentForTask,
  makeNote,
  makeTask,
  makeDraft,
  nowIso,
} from './state.js';
import { buildFodt, slugify } from './fodt.js';
import { el, clear, fmtDate, clampText, provenanceLine, shortCommit, shortHash } from './dom.js';
import { showModal, confirmModal, toast } from './ui.js';

const content = document.getElementById('content');
const tray = document.getElementById('tray');
const title = document.getElementById('view-title');
const undoButton = document.getElementById('undo-btn');
const saveStatus = document.getElementById('save-status');

const runtime = {
  view: 'overview',
  activeRepoId: null,
  repoInfo: new Map(),
  files: [],
  filesTruncated: false,
  openFile: null,
  selectionStart: null,
  selectionEnd: null,
  searchPattern: '',
  searchHits: [],
  activeNoteId: null,
  activeTaskId: null,
  activeDraftId: null,
  selected: [],
  busy: new Set(),
};

const VIEW_LABELS = {
  overview: 'Overview',
  explorer: 'Explorer',
  notes: 'Notes',
  evidence: 'Evidence',
  tasks: 'Coding Tasks',
  draft: 'Draft',
  artifacts: 'Artifacts',
};

function messageOf(err) {
  return parseCapabilityError(err).message;
}

async function guarded(key, work) {
  if (runtime.busy.has(key)) return undefined;
  runtime.busy.add(key);
  try {
    return await work();
  } catch (err) {
    console.error(err);
    toast(messageOf(err), 'error');
    return undefined;
  } finally {
    runtime.busy.delete(key);
  }
}

function setView(view) {
  if (!(view in VIEW_LABELS)) return;
  runtime.view = view;
  for (const button of document.querySelectorAll('.nav-btn')) {
    button.classList.toggle('active', button.dataset.view === view);
  }
  title.textContent = VIEW_LABELS[view];
  render();
}

function countTile(label, value, view) {
  return el('button', {
    class: 'card count-tile',
    onclick: () => setView(view),
    title: `Open ${label}`,
  }, el('span', { class: 'n', text: value }), label);
}

function emptyCard(text) {
  return el('div', { class: 'card muted', text });
}

function selectRepo(resourceId) {
  runtime.activeRepoId = resourceId;
  runtime.files = [];
  runtime.openFile = null;
  runtime.selectionStart = null;
  runtime.selectionEnd = null;
}

async function refreshRepoInfo(resourceId, rerender = true) {
  const info = await repo.info(resourceId);
  runtime.repoInfo.set(resourceId, info);
  const saved = findRepo(resourceId);
  if (saved) {
    saved.branch = info.branch;
    saved.headCommit = info.headCommit;
    saved.clean = info.clean;
    saved.remoteUrl = info.remoteUrl;
    saved.updatedAt = nowIso();
    mutatedQuiet();
  }
  if (rerender && runtime.view === 'overview') render();
  return info;
}

async function registerRepository() {
  const pathInput = el('input', { type: 'text', placeholder: 'C:\\path\\to\\repository' });
  const nameInput = el('input', { type: 'text', placeholder: 'Display name (optional)' });
  const body = el('div', { class: 'stack' },
    el('p', { class: 'muted', text: 'Papers registers the existing repository for bounded reading. Nothing is copied or modified.' }),
    el('div', { class: 'field' }, el('label', { text: 'Local Git repository path' }), pathInput),
    el('div', { class: 'field' }, el('label', { text: 'Name' }), nameInput),
  );
  const handle = showModal({
    title: 'Register repository',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Register', kind: 'primary', autoClose: false, onClick: async () => {
          const path = pathInput.value.trim();
          if (!path) return false;
          const result = await guarded('register-repository', () => repo.register(path, nameInput.value.trim()));
          if (!result) return false;
          const info = await guarded('repo-info', () => repo.info(result.resourceId));
          state.repositories.push({
            resourceId: result.resourceId,
            name: result.name,
            path: result.path,
            branch: info?.branch ?? '',
            headCommit: info?.headCommit ?? '',
            clean: info?.clean ?? true,
            remoteUrl: info?.remoteUrl ?? null,
            registeredAt: nowIso(),
            updatedAt: nowIso(),
          });
          selectRepo(result.resourceId);
          mutated();
          handle.close();
          toast(`Registered ${result.name}`);
          setView('explorer');
          return false;
        },
      },
    ],
  });
  setTimeout(() => pathInput.focus(), 0);
}

function renderOverview() {
  const counts = el('div', { class: 'grid-counts' },
    countTile('repositories', state.repositories.length, 'explorer'),
    countTile('notes', state.notes.length, 'notes'),
    countTile('evidence', state.evidence.length, 'evidence'),
    countTile('coding tasks', state.tasks.length, 'tasks'),
    countTile('drafts', state.drafts.length, 'draft'),
    countTile('artifacts', state.artifacts.length, 'artifacts'),
  );

  const repoCards = state.repositories.length === 0
    ? emptyCard('No repository registered. Register a local Git repository to begin research.')
    : el('div', { class: 'stack' }, state.repositories.map((item) => {
        const info = runtime.repoInfo.get(item.resourceId);
        if (!info && !runtime.busy.has(`info:${item.resourceId}`)) {
          void guarded(`info:${item.resourceId}`, () => refreshRepoInfo(item.resourceId));
        }
        return el('div', { class: 'card' },
          el('div', { class: 'row' },
            el('h4', { text: item.name }),
            el('span', { class: `badge ${info?.clean === false ? 'warn' : ''}`, text: info ? (info.clean ? 'clean' : `${info.changedFiles} changed`) : 'checking…' }),
            el('span', { class: 'badge plain', text: info?.branch ?? item.branch ?? '?' }),
          ),
          el('div', { class: 'prov', text: info ? `${shortCommit(info.headCommit)} ${info.headSubject}` : item.path }),
          el('div', { class: 'row' },
            el('button', { onclick: () => { selectRepo(item.resourceId); setView('explorer'); } }, 'Explore'),
            el('button', { onclick: () => void guarded(`info:${item.resourceId}`, () => refreshRepoInfo(item.resourceId)) }, 'Refresh'),
          ),
        );
      }));

  content.append(
    el('div', { class: 'view-head' },
      el('h3', { text: 'Your repository workbench' }),
      el('span', { class: 'muted', text: 'Exact selections become inspectable agent invocations.' }),
      el('button', { class: 'primary', onclick: registerRepository }, 'Register repository'),
    ),
    counts,
    el('section', { class: 'block' }, el('h3', { text: 'Repositories' }), repoCards),
    el('section', { class: 'block' },
      el('h3', { text: 'Workflow boundary' }),
      el('div', { class: 'card' },
        'Entering this Backpack does not invoke an agent. Choose a program command, inspect the exact selection and destination, then confirm the Hermes preview.'),
    ),
  );
}

async function loadFiles() {
  if (!runtime.activeRepoId) return;
  const result = await guarded('list-files', () => repo.listFiles(runtime.activeRepoId));
  if (!result) return;
  runtime.files = result.files;
  runtime.filesTruncated = result.truncated;
  if (runtime.view === 'explorer') render();
}

async function openRepositoryFile(path, line = null) {
  if (!runtime.activeRepoId) return;
  const result = await guarded('read-file', () => repo.readFile(runtime.activeRepoId, path));
  if (!result) return;
  runtime.openFile = result;
  runtime.selectionStart = line;
  runtime.selectionEnd = line;
  if (runtime.view === 'explorer') render();
  if (line != null) setTimeout(() => document.querySelector(`tr[data-line="${line}"]`)?.scrollIntoView({ block: 'center' }), 0);
}

async function searchRepository(pattern) {
  runtime.searchPattern = pattern;
  if (!runtime.activeRepoId || pattern.trim().length < 2) {
    runtime.searchHits = [];
    render();
    return;
  }
  const result = await guarded('search', () => repo.search(runtime.activeRepoId, pattern.trim()));
  if (!result) return;
  runtime.searchHits = result.matches;
  if (runtime.view === 'explorer') render();
}

function selectLine(line, extend) {
  if (runtime.selectionStart == null || !extend) {
    runtime.selectionStart = line;
    runtime.selectionEnd = line;
  } else {
    runtime.selectionEnd = line;
  }
  render();
}

function currentRange() {
  if (!runtime.openFile || runtime.selectionStart == null || runtime.selectionEnd == null) return null;
  const start = Math.min(runtime.selectionStart, runtime.selectionEnd);
  const end = Math.max(runtime.selectionStart, runtime.selectionEnd);
  const lines = runtime.openFile.content.split('\n');
  return { start, end, excerpt: lines.slice(start - 1, end).join('\n') };
}

async function captureEvidence() {
  const range = currentRange();
  const sourceRepo = findRepo(runtime.activeRepoId);
  if (!range || !sourceRepo || !runtime.openFile) return;
  const contentHash = await sha256Hex(range.excerpt);
  const evidence = {
    id: crypto.randomUUID(),
    title: `${runtime.openFile.path}:${range.start}-${range.end}`,
    excerpt: range.excerpt,
    topicIds: [],
    noteIds: [],
    provenance: {
      resourceId: sourceRepo.resourceId,
      repoName: sourceRepo.name,
      filePath: runtime.openFile.path,
      commit: runtime.openFile.commit,
      startLine: range.start,
      endLine: range.end,
      contentHash,
      truncatedSource: Boolean(runtime.openFile.truncated),
    },
    createdAt: nowIso(),
  };
  state.evidence.push(evidence);
  mutated();
  await addReferenceToTray({ type: 'evidence', id: evidence.id });
  toast('Evidence captured with commit and content hash provenance');
}

function renderExplorer() {
  const select = el('select', { onchange: (event) => { selectRepo(event.target.value); void loadFiles(); render(); } },
    el('option', { value: '', selected: !runtime.activeRepoId }, 'Choose repository…'),
    state.repositories.map((r) => el('option', { value: r.resourceId, selected: r.resourceId === runtime.activeRepoId }, r.name)),
  );
  const search = el('input', { type: 'search', value: runtime.searchPattern, placeholder: 'Search tracked files…' });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void searchRepository(search.value);
  });

  content.append(el('div', { class: 'explorer-top' },
    select,
    el('button', { onclick: () => void loadFiles(), disabled: !runtime.activeRepoId }, 'List files'),
    search,
    el('button', { onclick: () => void searchRepository(search.value), disabled: !runtime.activeRepoId }, 'Search'),
    el('button', { onclick: registerRepository }, 'Register another'),
  ));

  if (!runtime.activeRepoId) {
    content.append(emptyCard('Choose or register a repository.'));
    return;
  }
  if (runtime.files.length === 0 && !runtime.busy.has('list-files')) void loadFiles();

  if (runtime.searchHits.length > 0) {
    content.append(el('section', { class: 'card search-hits' },
      el('div', { class: 'view-head' }, el('h3', { text: `Search results for “${runtime.searchPattern}”` }), el('span', { class: 'muted small', text: `${runtime.searchHits.length} bounded matches` })),
      runtime.searchHits.map((hit) => el('div', { class: 'search-hit' },
        el('button', { onclick: () => void openRepositoryFile(hit.path, hit.line) }, `${hit.path}:${hit.line}`),
        el('span', { class: 'txt', text: hit.text }),
      )),
    ));
  }

  const fileList = el('div', { class: 'card file-list' },
    runtime.filesTruncated ? el('div', { class: 'stale-banner', text: 'File list was truncated by the bounded repository API.' }) : null,
    runtime.files.map((path) => el('div', { class: `file-row ${runtime.openFile?.path === path ? 'open' : ''}` },
      el('button', { onclick: () => void openRepositoryFile(path), title: path }, path),
    )),
  );

  let filePanel = emptyCard('Choose a tracked file.');
  if (runtime.openFile) {
    const range = currentRange();
    const lines = runtime.openFile.content.split('\n');
    filePanel = el('div', { class: 'stack' },
      el('div', { class: 'card' },
        el('div', { class: 'row' },
          el('strong', { class: 'mono', text: runtime.openFile.path }),
          el('span', { class: 'badge plain', text: shortCommit(runtime.openFile.commit) }),
          runtime.openFile.truncated ? el('span', { class: 'badge warn', text: `truncated from ${runtime.openFile.byteLength} bytes` }) : null,
          el('button', { class: 'primary', disabled: !range, onclick: () => void captureEvidence() }, range ? `Capture lines ${range.start}–${range.end}` : 'Select lines'),
        ),
        el('p', { class: 'small muted', text: 'Click a line number to start a selection; Shift-click another to extend it.' }),
      ),
      el('div', { class: 'code-wrap' },
        el('table', { class: 'code' }, el('tbody', {}, lines.map((lineText, index) => {
          const line = index + 1;
          const selected = range && line >= range.start && line <= range.end;
          return el('tr', { class: selected ? 'sel' : '', dataset: { line } },
            el('td', { class: 'gutter' }, el('button', { onclick: (event) => selectLine(line, event.shiftKey) }, line)),
            el('td', { class: 'codeline', text: lineText || ' ' }),
          );
        }))),
      ),
    );
  }
  content.append(el('div', { class: 'explorer-cols' }, fileList, filePanel));
}

function createNoteModal() {
  const titleInput = el('input', { type: 'text', placeholder: 'Note title' });
  const bodyInput = el('textarea', { rows: 10, placeholder: 'Research note…' });
  const handle = showModal({
    title: 'New research note',
    body: el('div', { class: 'stack' }, titleInput, bodyInput),
    actions: [
      { label: 'Cancel' },
      { label: 'Create', kind: 'primary', onClick: () => {
        const note = makeNote({ title: titleInput.value.trim() || 'Untitled note', body: bodyInput.value });
        state.notes.unshift(note);
        runtime.activeNoteId = note.id;
        mutated();
        handle.close();
        render();
        return false;
      } },
    ],
  });
  setTimeout(() => titleInput.focus(), 0);
}

function renderNotes() {
  if (!runtime.activeNoteId && state.notes[0]) runtime.activeNoteId = state.notes[0].id;
  const active = findNote(runtime.activeNoteId);
  const list = el('div', { class: 'card stack' },
    el('button', { class: 'primary', onclick: createNoteModal }, 'New note'),
    state.notes.length === 0 ? el('span', { class: 'muted', text: 'No notes yet.' }) : null,
    state.notes.map((note) => el('div', { class: `note-row ${note.id === runtime.activeNoteId ? 'current' : ''}` },
      el('button', { class: 'title-btn', onclick: () => { runtime.activeNoteId = note.id; render(); } }, note.title || 'Untitled'),
      el('span', { class: 'muted small', text: fmtDate(note.updatedAt) }),
    )),
  );
  let editor = emptyCard('Choose or create a note.');
  if (active) {
    const titleInput = el('input', { type: 'text', value: active.title });
    const bodyInput = el('textarea', { rows: 20, value: active.body });
    const update = () => {
      active.title = titleInput.value;
      active.body = bodyInput.value;
      active.updatedAt = nowIso();
      mutatedQuiet();
    };
    titleInput.addEventListener('input', update);
    bodyInput.addEventListener('input', update);
    editor = el('div', { class: 'card stack' },
      el('div', { class: 'row' },
        el('button', { onclick: () => void addReferenceToTray({ type: 'note', id: active.id }) }, 'Add to selection'),
        el('button', { onclick: () => void clipboardWrite(contentForNote(active)) }, 'Copy'),
        el('button', { class: 'danger', onclick: async () => {
          if (!(await confirmModal('Delete note?', 'This removes the note from this program.'))) return;
          state.notes = state.notes.filter((n) => n.id !== active.id);
          runtime.activeNoteId = state.notes[0]?.id ?? null;
          removeReferenceFromTray('note', active.id);
          mutated();
        } }, 'Delete'),
      ),
      el('div', { class: 'field' }, el('label', { text: 'Title' }), titleInput),
      el('div', { class: 'field' }, el('label', { text: 'Body' }), bodyInput),
      el('div', { class: 'prov', text: active.sourceRunId ? `Created from run ${active.sourceRunId}` : `Created ${fmtDate(active.createdAt)}` }),
    );
  }
  content.append(el('div', { class: 'two-col' }, list, editor));
}

function ensureTopic(name) {
  const normalized = name.trim();
  if (!normalized) return null;
  let topic = state.topics.find((t) => t.name.toLowerCase() === normalized.toLowerCase());
  if (!topic) {
    topic = { id: crypto.randomUUID(), name: normalized, color: '#2f6f4f', createdAt: nowIso() };
    state.topics.push(topic);
  }
  return topic;
}

function editEvidenceTopics(evidence) {
  const input = el('input', {
    type: 'text',
    value: (evidence.topicIds || []).map((id) => state.topics.find((t) => t.id === id)?.name).filter(Boolean).join(', '),
    placeholder: 'architecture, persistence',
  });
  const handle = showModal({
    title: 'Evidence topics',
    body: el('div', { class: 'field' }, el('label', { text: 'Comma-separated topics' }), input),
    actions: [
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: () => {
        evidence.topicIds = input.value.split(',').map(ensureTopic).filter(Boolean).map((t) => t.id);
        mutated();
        handle.close();
        return false;
      } },
    ],
  });
}

function renderEvidence() {
  const groups = new Map();
  for (const evidence of state.evidence) {
    const key = evidence.provenance?.repoName || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evidence);
  }
  content.append(
    el('div', { class: 'view-head' },
      el('h3', { text: 'Captured evidence' }),
      el('span', { class: 'muted', text: 'Every excerpt retains its commit, path, range, and SHA-256.' }),
      el('button', { onclick: () => setView('explorer') }, 'Capture from Explorer'),
    ),
    groups.size === 0 ? emptyCard('No evidence captured yet.') : el('div', { class: 'evidence-groups' },
      [...groups].map(([name, entries]) => el('section', {},
        el('h3', { class: 'group-title' }, el('span', { class: 'dot', style: 'background:#2f6f4f' }), name),
        el('div', { class: 'evidence-grid' }, entries.map((evidence) => el('div', { class: 'card' },
          el('h4', { text: evidence.title }),
          el('div', { class: 'prov', text: provenanceLine(evidence.provenance) }),
          el('div', { class: 'prov', text: `sha256 ${shortHash(evidence.provenance?.contentHash)}` }),
          el('div', { class: 'excerpt-clamp', text: evidence.excerpt }),
          el('div', { class: 'row' },
            (evidence.topicIds || []).map((id) => el('span', { class: 'badge', text: state.topics.find((t) => t.id === id)?.name ?? 'missing topic' })),
            el('button', { onclick: () => void addReferenceToTray({ type: 'evidence', id: evidence.id }) }, 'Add to selection'),
            el('button', { onclick: () => editEvidenceTopics(evidence) }, 'Topics'),
            el('button', { class: 'danger', onclick: async () => {
              if (!(await confirmModal('Delete evidence?', 'The excerpt and its provenance will be removed.'))) return;
              state.evidence = state.evidence.filter((item) => item.id !== evidence.id);
              removeReferenceFromTray('evidence', evidence.id);
              mutated();
            } }, 'Delete'),
          ),
        ))),
      )),
    ),
  );
}

function createTaskModal() {
  const titleInput = el('input', { type: 'text', placeholder: 'Task title' });
  const descInput = el('textarea', { rows: 6, placeholder: 'What should change?' });
  const acceptanceInput = el('textarea', { rows: 4, placeholder: 'Acceptance criteria' });
  const worker = el('select', {},
    el('option', { value: 'hermes' }, 'Hermes'),
    el('option', { value: 'codex' }, 'Codex through Hermes'),
    el('option', { value: 'opencode' }, 'OpenCode through Hermes'),
  );
  const handle = showModal({
    title: 'New isolated coding task',
    body: el('div', { class: 'stack' }, titleInput, descInput, acceptanceInput, worker),
    actions: [
      { label: 'Cancel' },
      { label: 'Create', kind: 'primary', onClick: () => {
        const task = makeTask({
          title: titleInput.value.trim() || 'Untitled task',
          description: descInput.value,
          acceptance: acceptanceInput.value,
          worker: worker.value,
        });
        state.tasks.push(task);
        runtime.activeTaskId = task.id;
        mutated();
        handle.close();
        render();
        return false;
      } },
    ],
  });
}

async function createTaskWorktree(task) {
  const baseId = runtime.activeRepoId || state.repositories[0]?.resourceId;
  if (!baseId) {
    toast('Register and select a repository first.', 'error');
    return;
  }
  const slug = `${slugify(task.title).slice(0, 32)}-${task.id.slice(0, 6)}`;
  const result = await guarded(`worktree:${task.id}`, () => create.worktree(baseId, slug));
  if (!result) return;
  task.worktree = {
    resourceId: result.resourceId,
    path: result.worktreePath,
    branch: result.branch,
    baseCommit: result.baseCommit,
    baseResourceId: baseId,
  };
  task.status = 'approved';
  task.updatedAt = nowIso();
  mutated();
  toast(`Created isolated worktree ${result.branch}`);
}

async function delegateTask(task) {
  if (!task.worktree) {
    toast('Create an isolated worktree first.', 'error');
    return;
  }
  const material = await materialForReference({ type: 'task', id: task.id });
  if (!material) return;
  const invocation = await makeInvocation({
    commandId: 'repository-research.delegate-task',
    actionId: 'delegate-coding-task',
    label: `Delegate “${task.title}” to ${task.worker}`,
    instruction: 'Implement the selected coding task completely in the supplied isolated worktree. Run relevant checks and report files changed, checks, limitations, and any remaining work.',
    materials: [material],
    destination: { programId: (await identity()).programId, type: 'task-result', reference: { type: 'task', id: task.id } },
    execution: { cwd: task.worktree.path, preferredWorker: task.worker },
  });
  await invokeAndTrack(invocation, { type: 'task-result', reference: { type: 'task', id: task.id } });
  task.status = 'delegated';
  task.updatedAt = nowIso();
  mutated();
}

async function refreshTaskDiff(task) {
  if (!task.worktree) return;
  const result = await guarded(`diff:${task.id}`, () => repo.worktreeDiff(task.worktree.resourceId));
  if (!result) return;
  task.diff = result.diff;
  task.diffStat = result.stat;
  task.diffTruncated = result.truncated;
  task.updatedAt = nowIso();
  mutated();
}

async function rejectTask(task) {
  if (!(await confirmModal('Reject coding task?', 'The disposable worktree and its papers/* branch will be removed. The base repository remains untouched.', 'Reject and remove'))) return;
  if (task.worktree) {
    const removed = await guarded(`remove:${task.id}`, () => create.removeWorktree(task.worktree.resourceId));
    if (!removed) return;
  }
  task.worktree = null;
  task.status = 'rejected';
  task.updatedAt = nowIso();
  mutated();
}

function taskDetail(task) {
  if (!task) return emptyCard('Choose or create a task.');
  const description = el('textarea', { rows: 5, value: task.description });
  const acceptance = el('textarea', { rows: 4, value: task.acceptance });
  const worker = el('select', {}, ['hermes', 'codex', 'opencode'].map((value) => el('option', { value, selected: task.worker === value }, value)));
  const update = () => {
    task.description = description.value;
    task.acceptance = acceptance.value;
    task.worker = worker.value;
    task.updatedAt = nowIso();
    mutatedQuiet();
  };
  description.addEventListener('input', update);
  acceptance.addEventListener('input', update);
  worker.addEventListener('change', update);
  return el('div', { class: 'stack' },
    el('div', { class: 'card stack' },
      el('div', { class: 'row' },
        el('h3', { text: task.title }),
        el('span', { class: 'badge', text: task.status }),
        el('button', { onclick: () => void addReferenceToTray({ type: 'task', id: task.id }) }, 'Add to selection'),
      ),
      el('div', { class: 'field' }, el('label', { text: 'Description' }), description),
      el('div', { class: 'field' }, el('label', { text: 'Acceptance criteria' }), acceptance),
      el('div', { class: 'field' }, el('label', { text: 'Worker' }), worker),
      task.worktree ? el('div', { class: 'prov', text: `${task.worktree.branch} @ ${shortCommit(task.worktree.baseCommit)} — ${task.worktree.path}` }) : null,
      el('div', { class: 'row' },
        el('button', { onclick: () => void createTaskWorktree(task), disabled: Boolean(task.worktree) }, 'Create isolated worktree'),
        el('button', { class: 'primary', onclick: () => void delegateTask(task), disabled: !task.worktree || task.status === 'delegated' }, 'Delegate through Hermes'),
        el('button', { onclick: () => void refreshTaskDiff(task), disabled: !task.worktree }, 'Inspect diff'),
        el('button', { onclick: () => { task.status = 'accepted'; task.updatedAt = nowIso(); mutated(); }, disabled: task.status !== 'review' }, 'Accept result'),
        el('button', { class: 'danger', onclick: () => void rejectTask(task), disabled: !task.worktree }, 'Reject'),
      ),
      task.resultSummary ? el('div', { class: 'proposal-summary', text: task.resultSummary }) : null,
    ),
    task.diffStat ? el('div', { class: 'card' }, el('strong', { text: 'Diff stat' }), el('pre', { text: task.diffStat })) : null,
    task.diff ? el('pre', { class: 'diff-panel', text: task.diff }) : null,
  );
}

function renderTasks() {
  if (!runtime.activeTaskId && state.tasks[0]) runtime.activeTaskId = state.tasks[0].id;
  const statuses = ['proposed', 'approved', 'delegated', 'review', 'accepted'];
  content.append(
    el('div', { class: 'view-head' },
      el('h3', { text: 'Isolated coding tasks' }),
      el('span', { class: 'muted', text: 'Hermes supervises workers; the base repository is never their working directory.' }),
      el('button', { class: 'primary', onclick: createTaskModal }, 'New task'),
    ),
    el('div', { class: 'task-cols' }, statuses.map((status) => el('div', { class: 'task-col' },
      el('h4', { text: status }),
      state.tasks.filter((task) => task.status === status).map((task) => el('div', {
        class: `card task-card ${task.id === runtime.activeTaskId ? 'current' : ''}`,
        onclick: () => { runtime.activeTaskId = task.id; render(); },
      }, el('strong', { text: task.title }), el('div', { class: 'small muted', text: task.worker }))),
    ))),
    state.tasks.filter((task) => task.status === 'rejected').length
      ? el('p', { class: 'small muted', text: `${state.tasks.filter((task) => task.status === 'rejected').length} rejected task(s) retained as history.` })
      : null,
    taskDetail(findTask(runtime.activeTaskId)),
  );
}

function newDraftModal() {
  const input = el('input', { type: 'text', placeholder: 'Report title' });
  const handle = showModal({
    title: 'New report draft',
    body: input,
    actions: [
      { label: 'Cancel' },
      { label: 'Create', kind: 'primary', onClick: () => {
        const draft = makeDraft({ title: input.value.trim() || 'Research report', sections: [{ heading: 'Findings', body: '', evidenceIds: [] }] });
        state.drafts.push(draft);
        runtime.activeDraftId = draft.id;
        mutated();
        handle.close();
        render();
        return false;
      } },
    ],
  });
}

async function generateDraftArtifact(draft) {
  const fodt = buildFodt(draft, findEvidence);
  const result = await guarded(`artifact:${draft.id}`, () => create.artifactFile(draft.title, `${slugify(draft.title)}.fodt`, fodt));
  if (!result) return;
  const artifact = {
    id: crypto.randomUUID(),
    resourceId: result.resourceId,
    title: draft.title,
    path: result.path,
    draftId: draft.id,
    createdAt: nowIso(),
  };
  state.artifacts.unshift(artifact);
  mutated();
  toast('Editable OpenDocument report created');
  setView('artifacts');
}

function renderDraft() {
  if (!runtime.activeDraftId && state.drafts[0]) runtime.activeDraftId = state.drafts[0].id;
  const draft = findDraft(runtime.activeDraftId);
  const draftList = el('div', { class: 'card stack' },
    el('button', { class: 'primary', onclick: newDraftModal }, 'New draft'),
    state.drafts.map((item) => el('button', { class: item.id === runtime.activeDraftId ? 'primary' : '', onclick: () => { runtime.activeDraftId = item.id; render(); } }, item.title)),
  );
  let editor = emptyCard('Choose or create a draft.');
  if (draft) {
    const titleInput = el('input', { type: 'text', value: draft.title });
    titleInput.addEventListener('input', () => { draft.title = titleInput.value; draft.updatedAt = nowIso(); mutatedQuiet(); });
    editor = el('div', { class: 'stack' },
      el('div', { class: 'card stack' },
        titleInput,
        el('div', { class: 'row' },
          el('button', { onclick: () => {
            draft.sections.push({ id: crypto.randomUUID(), heading: 'New section', body: '', evidenceIds: [] });
            draft.updatedAt = nowIso();
            mutated();
          } }, 'Add section'),
          el('button', { class: 'primary', onclick: () => void generateDraftArtifact(draft) }, 'Generate editable report'),
        ),
      ),
      draft.sections.map((section) => {
        const heading = el('input', { type: 'text', value: section.heading });
        const body = el('textarea', { rows: 9, value: section.body });
        const update = () => {
          section.heading = heading.value;
          section.body = body.value;
          draft.updatedAt = nowIso();
          mutatedQuiet();
        };
        heading.addEventListener('input', update);
        body.addEventListener('input', update);
        return el('div', { class: 'card stack section-card' },
          heading,
          body,
          el('div', { class: 'field' },
            el('label', { text: 'Evidence appendix references' }),
            el('div', { class: 'stack' }, state.evidence.map((evidence) => {
              const box = el('input', { type: 'checkbox', checked: (section.evidenceIds || []).includes(evidence.id) });
              box.addEventListener('change', () => {
                section.evidenceIds ||= [];
                if (box.checked && !section.evidenceIds.includes(evidence.id)) section.evidenceIds.push(evidence.id);
                if (!box.checked) section.evidenceIds = section.evidenceIds.filter((id) => id !== evidence.id);
                mutatedQuiet();
              });
              return el('label', { class: 'row' }, box, clampText(evidence.title, 80));
            })),
          ),
          el('div', { class: 'row' },
            el('button', { onclick: () => void addReferenceToTray({ type: 'draft-section', id: section.id }) }, 'Add section to selection'),
            el('button', { class: 'danger', onclick: () => { draft.sections = draft.sections.filter((s) => s.id !== section.id); mutated(); } }, 'Delete section'),
          ),
        );
      }),
    );
  }
  content.append(el('div', { class: 'two-col' }, draftList, editor));
}

function renderArtifacts() {
  content.append(
    el('div', { class: 'view-head' }, el('h3', { text: 'Produced artifacts' }), el('span', { class: 'muted', text: 'Files remain editable and live in this program’s own artifact directory.' })),
    state.artifacts.length === 0 ? emptyCard('No artifacts yet. Generate one from a report draft.') : el('div', { class: 'stack' },
      state.artifacts.map((artifact) => el('div', { class: 'card' },
        el('h4', { text: artifact.title }),
        el('div', { class: 'prov', text: artifact.path }),
        el('div', { class: 'small muted', text: fmtDate(artifact.createdAt) }),
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => void guarded(`writer:${artifact.id}`, () => external.launchWriter(artifact.resourceId)) }, 'Open in LibreOffice Writer'),
          el('button', { onclick: () => void guarded(`open:${artifact.id}`, () => external.openResource(artifact.resourceId)) }, 'Open'),
          el('button', { onclick: () => void guarded(`folder:${artifact.id}`, () => external.showInFolder(artifact.resourceId)) }, 'Show in folder'),
        ),
      )),
    ),
  );
}

async function materialForReference(reference) {
  let titleText;
  let contentText;
  let mediaType = 'text/plain';
  if (reference.type === 'evidence') {
    const value = findEvidence(reference.id);
    if (!value) return null;
    titleText = value.title;
    contentText = contentForEvidence(value);
  } else if (reference.type === 'note') {
    const value = findNote(reference.id);
    if (!value) return null;
    titleText = value.title;
    contentText = contentForNote(value);
    mediaType = 'text/markdown';
  } else if (reference.type === 'task') {
    const value = findTask(reference.id);
    if (!value) return null;
    titleText = value.title;
    contentText = contentForTask(value);
    mediaType = 'text/markdown';
  } else if (reference.type === 'draft-section') {
    const found = findSection(reference.id);
    if (!found) return null;
    titleText = found.section.heading;
    contentText = contentForSection(found.section);
    mediaType = 'text/markdown';
  } else {
    return null;
  }
  const originalByteLength = byteLength(contentText);
  const maxChars = 480_000;
  const shared = contentText.length > maxChars ? contentText.slice(0, maxChars) : contentText;
  return {
    reference,
    title: titleText || `${reference.type} ${reference.id}`,
    mediaType,
    preview: clampText(shared, 240),
    contentHash: await sha256Hex(shared),
    content: shared,
    ...(shared.length < contentText.length ? { truncated: true, originalByteLength } : {}),
  };
}

async function addReferenceToTray(reference) {
  if (runtime.selected.some((item) => item.reference.type === reference.type && item.reference.id === reference.id)) return;
  const material = await materialForReference(reference);
  if (!material) {
    toast('That selection no longer exists.', 'error');
    return;
  }
  runtime.selected.push(material);
  renderTray();
}

function removeReferenceFromTray(type, id) {
  runtime.selected = runtime.selected.filter((item) => !(item.reference.type === type && item.reference.id === id));
  renderTray();
}

async function refreshSelectionMaterials() {
  const refreshed = [];
  for (const item of runtime.selected) {
    const current = await materialForReference(item.reference);
    if (current) refreshed.push(current);
  }
  runtime.selected = refreshed;
  return refreshed;
}

async function makeInvocation({ commandId, actionId, label, instruction, materials, destination, execution }) {
  const id = await identity();
  return {
    version: 1,
    origin: { backpackId: id.backpackId, programId: id.programId, viewId: runtime.view, commandId },
    action: { id: actionId, label, creatorInstruction: instruction },
    selection: { type: 'repository-research-selection', references: materials.map((item) => item.reference) },
    sharedMaterial: materials,
    destination,
    permissions: ['agent.invoke'],
    ...(execution ? { execution } : {}),
  };
}

async function invokeAndTrack(invocation, destination) {
  const ref = await guarded('agent-invoke', () => papers.agent.invoke(invocation));
  if (!ref) return null;
  state.pendingRuns[ref.runId] = {
    runId: ref.runId,
    status: 'pending',
    actionId: invocation.action.id,
    destination,
    selection: invocation.sharedMaterial.map((item) => ({ reference: item.reference, contentHash: item.contentHash })),
    createdAt: nowIso(),
  };
  mutated();
  toast(`Hermes run started: ${ref.runId.slice(0, 10)}…`);
  return ref;
}

async function invokeSelection(kind) {
  const materials = await refreshSelectionMaterials();
  if (materials.length === 0) {
    toast('Add evidence, notes, tasks, or a draft section to the selection tray first.', 'error');
    return;
  }
  const id = await identity();
  const config = kind === 'synthesize'
    ? {
        actionId: 'synthesize-selection',
        label: 'Synthesize selected research',
        instruction: 'Synthesize only the selected material into a concise research note. Distinguish direct evidence from inference and cite each selected item by its title.',
      }
    : {
        actionId: 'explain-selection',
        label: 'Explain selected architecture',
        instruction: 'Explain the selected material to a technically competent reader. Identify responsibilities, relationships, risks, and uncertainties. Do not claim access to anything outside the supplied selection.',
      };
  const invocation = await makeInvocation({
    commandId: `repository-research.${kind}`,
    ...config,
    materials,
    destination: { programId: id.programId, type: 'new-note' },
  });
  await invokeAndTrack(invocation, { type: 'new-note' });
}

function renderTray() {
  clear(tray);
  const pending = Object.values(state.pendingRuns).filter((run) => run.status === 'pending').length;
  tray.append(
    el('div', { class: 'tray-head' },
      el('span', { class: 'tray-title', text: 'Exact selection' }),
      el('span', { class: 'muted small', text: `${runtime.selected.length} item(s)` }),
      pending ? el('span', { class: 'badge warn run-chip', text: `${pending} run(s) active` }) : null,
      runtime.selected.length ? el('button', { onclick: () => { runtime.selected = []; renderTray(); } }, 'Clear') : null,
    ),
    runtime.selected.length
      ? el('div', { class: 'tray-items' }, runtime.selected.map((item) => el('button', {
          class: 'tray-item',
          title: 'Remove from selection',
          onclick: () => removeReferenceFromTray(item.reference.type, item.reference.id),
        }, `${item.reference.type}: ${item.title}`)))
      : el('div', { class: 'muted small', text: 'Nothing selected. Capture evidence or add a note, task, or draft section.' }),
    el('div', { class: 'tray-actions' },
      el('button', { class: 'primary', disabled: runtime.selected.length === 0, onclick: () => void invokeSelection('explain') }, 'Explain selected architecture'),
      el('button', { disabled: runtime.selected.length === 0, onclick: () => void invokeSelection('synthesize') }, 'Synthesize into note'),
    ),
  );
}

async function selectionIsStale(pending) {
  for (const captured of pending.selection || []) {
    const current = await materialForReference(captured.reference);
    if (!current || current.contentHash !== captured.contentHash) return true;
  }
  if (pending.destination?.reference) {
    const ref = pending.destination.reference;
    if (ref.type === 'task' && !findTask(ref.id)) return true;
    if (ref.type === 'note' && !findNote(ref.id)) return true;
    if (ref.type === 'draft-section' && !findSection(ref.id)) return true;
  }
  return false;
}

function proposalText(proposal) {
  if (proposal.structuredOutput && typeof proposal.structuredOutput === 'object') {
    const value = proposal.structuredOutput;
    if (typeof value.body === 'string') return value.body;
    if (typeof value.note === 'string') return value.note;
    if (typeof value.summary === 'string') return value.summary;
  }
  return proposal.summary || 'Hermes returned no textual summary.';
}

async function applyProposal(proposal, pending) {
  const destination = pending.destination || { type: 'new-note' };
  const text = proposalText(proposal);
  snapshotUndo(`Apply ${pending.actionId || 'agent result'}`);
  if (destination.type === 'task-result' && destination.reference) {
    const task = findTask(destination.reference.id);
    if (!task) throw new Error('The destination task no longer exists.');
    task.resultSummary = text;
    task.runId = proposal.invocationId;
    task.status = 'review';
    task.updatedAt = nowIso();
    if (task.worktree) await refreshTaskDiff(task);
  } else if (destination.type === 'note' && destination.reference) {
    const note = findNote(destination.reference.id);
    if (!note) throw new Error('The destination note no longer exists.');
    note.body = `${note.body}\n\n${text}`.trim();
    note.sourceRunId = proposal.invocationId;
    note.updatedAt = nowIso();
  } else if (destination.type === 'draft-section' && destination.reference) {
    const found = findSection(destination.reference.id);
    if (!found) throw new Error('The destination section no longer exists.');
    found.section.body = `${found.section.body}\n\n${text}`.trim();
    found.draft.updatedAt = nowIso();
  } else {
    const structuredTitle = proposal.structuredOutput && typeof proposal.structuredOutput.title === 'string'
      ? proposal.structuredOutput.title
      : `Hermes — ${pending.actionId || 'research result'}`;
    const note = makeNote({ title: structuredTitle, body: text, sourceRunId: proposal.invocationId });
    state.notes.unshift(note);
    runtime.activeNoteId = note.id;
  }
  pending.status = 'applied';
  pending.appliedAt = nowIso();
  mutated();
  await saveNow();
}

async function handleProposal(proposal) {
  const pending = state.pendingRuns[proposal.invocationId];
  if (!pending) {
    toast(`Received a result for unknown run ${proposal.invocationId}`, 'error');
    return;
  }
  const stale = await selectionIsStale(pending);
  const body = el('div', { class: 'stack' },
    stale ? el('div', { class: 'stale-banner', text: 'The original selection or destination changed after invocation. This proposal is stale and cannot be applied automatically.' }) : null,
    el('dl', { class: 'kv' },
      el('dt', { text: 'Run' }), el('dd', { class: 'mono', text: proposal.invocationId }),
      el('dt', { text: 'Hermes session' }), el('dd', { class: 'mono', text: proposal.sessionId }),
      el('dt', { text: 'Destination' }), el('dd', { text: pending.destination?.type || 'new-note' }),
    ),
    el('div', { class: 'proposal-summary', text: proposalText(proposal) }),
  );
  const handle = showModal({
    title: 'Hermes result proposal',
    body,
    wide: true,
    actions: [
      { label: 'Keep unapplied', onClick: () => { pending.status = stale ? 'stale' : 'unapplied'; mutated(); } },
      {
        label: stale ? 'Selection changed' : 'Apply result',
        kind: 'primary',
        disabled: stale,
        onClick: async () => {
          if (stale) return false;
          await applyProposal(proposal, pending);
          handle.close();
          toast('Agent result applied through the program’s own mutation path');
          if (pending.destination?.type === 'task-result') setView('tasks');
          else setView('notes');
          return false;
        },
      },
    ].map((action) => action.disabled ? { ...action, onClick: () => false } : action),
  });
  if (stale) {
    const apply = handle && document.querySelector('.modal footer button.primary');
    if (apply) apply.disabled = true;
  }
}

function render() {
  clear(content);
  undoButton.hidden = !state.undo;
  switch (runtime.view) {
    case 'overview': renderOverview(); break;
    case 'explorer': renderExplorer(); break;
    case 'notes': renderNotes(); break;
    case 'evidence': renderEvidence(); break;
    case 'tasks': renderTasks(); break;
    case 'draft': renderDraft(); break;
    case 'artifacts': renderArtifacts(); break;
    default: renderOverview();
  }
  renderTray();
}

async function configureHostContributions() {
  await papers.commands.register([
    { id: 'rr.overview', label: 'Repository Research: Overview', description: 'Show the research overview' },
    { id: 'rr.explorer', label: 'Repository Research: Explorer', description: 'Explore an explicitly registered repository' },
    { id: 'rr.new-note', label: 'Repository Research: New note', description: 'Create a research note' },
    { id: 'rr.explain-selection', label: 'Explain selected architecture', description: 'Invoke Hermes with the exact selection tray' },
  ]);
  await papers.shelf.contribute([
    { id: 'rr-overview', label: 'Overview', commandId: 'rr.overview', title: 'Research overview' },
    { id: 'rr-explorer', label: 'Explorer', commandId: 'rr.explorer', title: 'Browse registered repository' },
    { id: 'rr-note', label: 'New note', commandId: 'rr.new-note', title: 'Create research note' },
    { id: 'rr-explain', label: 'Explain selection', commandId: 'rr.explain-selection', title: 'Preview an exact Hermes invocation' },
  ]);
}

async function init() {
  await identity();
  await initState();
  if (!runtime.activeRepoId && state.repositories[0]) runtime.activeRepoId = state.repositories[0].resourceId;
  onSaveStatus((status) => {
    saveStatus.textContent = status === 'saving' ? 'saving…' : status === 'saved' ? 'saved' : status === 'error' ? 'save failed' : '·';
    saveStatus.classList.toggle('error', status === 'error');
  });
  subscribe(render);
  document.getElementById('nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-btn');
    if (button) setView(button.dataset.view);
  });
  undoButton.addEventListener('click', () => {
    if (applyUndo()) toast('Restored the state captured before the last applied result');
  });
  papers.events.onCommand(({ commandId }) => {
    if (commandId === 'rr.overview') setView('overview');
    if (commandId === 'rr.explorer') setView('explorer');
    if (commandId === 'rr.new-note') { setView('notes'); createNoteModal(); }
    if (commandId === 'rr.explain-selection') void invokeSelection('explain');
  });
  papers.events.onRunUpdate((update) => {
    const pending = state.pendingRuns[update.runId];
    if (!pending) return;
    pending.status = update.state;
    pending.updatedAt = nowIso();
    mutatedQuiet();
    renderTray();
  });
  papers.events.onResultProposal((proposal) => void handleProposal(proposal));
  await configureHostContributions();
  render();
  await saveNow();
  document.body.dataset.ready = 'true';
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<main style="padding:24px;font-family:system-ui"><h1>Repository Research failed to start</h1><pre></pre></main>`;
  document.querySelector('pre').textContent = String(err?.stack ?? err);
});
