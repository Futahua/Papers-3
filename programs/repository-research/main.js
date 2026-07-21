/** Repository Research program coordinator. */
import { papers, identity } from './api.js';
import {
  state,
  initState,
  subscribe,
  mutated,
  mutatedQuiet,
  saveNow,
  onSaveStatus,
  applyUndo,
  nowIso,
} from './state.js';
import { renderTray, focusTray, clearSelection } from './tray.js';
import { handleResultProposal } from './proposals.js';
import { toast } from './ui.js';
import * as overview from './views/overview.js';
import * as explorer from './views/explorer.js';
import * as notes from './views/notes.js';
import * as evidence from './views/evidence.js';
import * as tasks from './views/tasks.js';
import * as draft from './views/draft.js';
import * as artifacts from './views/artifacts.js';

const content = document.getElementById('content');
const viewTitle = document.getElementById('view-title');
const undoButton = document.getElementById('undo-btn');
const saveStatus = document.getElementById('save-status');

const views = {
  overview: { label: 'Overview', module: overview },
  explorer: { label: 'Explorer', module: explorer },
  notes: { label: 'Notes', module: notes },
  evidence: { label: 'Evidence', module: evidence },
  tasks: { label: 'Coding Tasks', module: tasks },
  draft: { label: 'Draft Production', module: draft },
  artifacts: { label: 'Artifacts', module: artifacts },
};

let activeView = 'overview';

function renderCurrent() {
  const selected = views[activeView] || views.overview;
  viewTitle.textContent = selected.label;
  for (const button of document.querySelectorAll('.nav-btn')) {
    button.classList.toggle('active', button.dataset.view === activeView);
  }
  selected.module.render(content);
  undoButton.hidden = !state.undo;
  renderTray();
}

function setView(view) {
  if (!views[view]) return;
  activeView = view;
  renderCurrent();
}

async function configureHost() {
  await papers.commands.register([
    { id: 'rr.overview', label: 'Repository Research: Overview', description: 'Show repository and research status' },
    { id: 'rr.explorer', label: 'Repository Research: Explorer', description: 'Browse exact repository files and ranges' },
    { id: 'rr.notes', label: 'Repository Research: Notes', description: 'Open research notes' },
    { id: 'rr.capture-region', label: 'Capture selected code region', description: 'Create hash-provenanced evidence from the Explorer range' },
    { id: 'rr.focus-selection', label: 'Show selection tray', description: 'Show selected material and applicable agent actions' },
  ]);
  await papers.shelf.contribute([
    { id: 'rr-overview', label: 'Overview', commandId: 'rr.overview', title: 'Research overview' },
    { id: 'rr-explorer', label: 'Explorer', commandId: 'rr.explorer', title: 'Browse a registered repository' },
    { id: 'rr-notes', label: 'Notes', commandId: 'rr.notes', title: 'Open notes' },
    { id: 'rr-capture', label: 'Capture', commandId: 'rr.capture-region', title: 'Capture the active Explorer line range' },
    { id: 'rr-selection', label: 'Selection', commandId: 'rr.focus-selection', title: 'Show exact selection and agent actions' },
  ]);
}

async function init() {
  await identity();
  await initState();

  onSaveStatus((status) => {
    saveStatus.textContent = status === 'saving' ? 'saving…' : status === 'saved' ? 'saved' : status === 'error' ? 'save failed' : '·';
    saveStatus.classList.toggle('error', status === 'error');
  });
  subscribe(renderCurrent);

  document.getElementById('nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-btn');
    if (button) setView(button.dataset.view);
  });
  undoButton.addEventListener('click', () => {
    if (applyUndo()) toast('Restored the state captured before the last applied agent result.');
  });

  papers.events.onCommand(({ commandId }) => {
    if (commandId === 'rr.overview') setView('overview');
    if (commandId === 'rr.explorer') setView('explorer');
    if (commandId === 'rr.notes') setView('notes');
    if (commandId === 'rr.capture-region') {
      setView('explorer');
      void explorer.captureCurrentRegion();
    }
    if (commandId === 'rr.focus-selection') focusTray();
  });

  papers.events.onRunUpdate((update) => {
    const pending = state.pendingRuns[update.runId];
    if (!pending) return;
    pending.runState = update.state;
    pending.updatedAt = nowIso();
    if (update.state === 'failed' || update.state === 'cancelled') {
      pending.status = update.state;
      toast(`Run ${update.state}: ${pending.actionLabel}`, update.state === 'failed' ? 'error' : 'info');
      mutated();
    } else {
      mutatedQuiet();
      renderTray();
    }
  });
  papers.events.onResultProposal((proposal) => void handleResultProposal(proposal));

  await configureHost();
  renderCurrent();
  clearSelection();
  await saveNow();
  document.body.dataset.ready = 'true';
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = '<main style="padding:24px;font-family:system-ui"><h1>Repository Research failed to start</h1><pre></pre></main>';
  document.querySelector('pre').textContent = String(err?.stack ?? err);
});
