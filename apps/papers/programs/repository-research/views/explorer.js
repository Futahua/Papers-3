/** Explorer: browse a registered repository, read files, capture evidence. */
import { el, clear, shortCommit } from '../dom.js';
import * as api from '../api.js';
import { state, mutated, findRepo, nowIso } from '../state.js';
import { toast } from '../ui.js';
import { toggleItem, isSelected, itemKey } from '../tray.js';

const MAX_RENDER_LINES = 8000;

const cur = {
  repoId: null,
  files: [], filesTruncated: false, filesLoaded: false, filesError: null, filesLoading: false,
  filter: '',
  filePath: null, fileData: null, fileError: null, fileLoading: false,
  selStart: null, selEnd: null,
  searchPattern: '', searchResults: null, searchError: null, searching: false,
  pendingScrollLine: null,
};

let rootEl = null;
let rowEls = [];

function rerender() {
  if (rootEl && rootEl.isConnected) render(rootEl);
}

function currentRepo() { return cur.repoId ? findRepo(cur.repoId) : null; }

// ---- data loading -------------------------------------------------------

function selectRepo(resourceId) {
  cur.repoId = resourceId || null;
  cur.files = []; cur.filesTruncated = false; cur.filesLoaded = false; cur.filesError = null;
  cur.filePath = null; cur.fileData = null; cur.fileError = null;
  cur.selStart = null; cur.selEnd = null;
  cur.searchResults = null; cur.searchError = null;
  if (cur.repoId) loadFiles();
  rerender();
}

function loadFiles() {
  cur.filesLoading = true;
  api.repo.listFiles(cur.repoId).then((result) => {
    cur.files = result.files || [];
    cur.filesTruncated = Boolean(result.truncated);
    cur.filesError = null;
  }).catch((err) => {
    cur.filesError = api.parseCapabilityError(err).message;
  }).finally(() => {
    cur.filesLoading = false;
    cur.filesLoaded = true;
    rerender();
  });
}

function openFile(filePath, atLine = null) {
  cur.filePath = filePath;
  cur.fileData = null; cur.fileError = null; cur.fileLoading = true;
  cur.selStart = atLine; cur.selEnd = atLine;
  cur.pendingScrollLine = atLine;
  rerender();
  api.repo.readFile(cur.repoId, filePath).then((result) => {
    cur.fileData = result;
  }).catch((err) => {
    cur.fileError = api.parseCapabilityError(err).message;
  }).finally(() => {
    cur.fileLoading = false;
    rerender();
  });
}

function runSearch() {
  if (!cur.repoId || !cur.searchPattern.trim()) return;
  cur.searching = true;
  rerender();
  api.repo.search(cur.repoId, cur.searchPattern.trim()).then((result) => {
    cur.searchResults = result;
    cur.searchError = null;
  }).catch((err) => {
    cur.searchResults = null;
    cur.searchError = api.parseCapabilityError(err).message;
  }).finally(() => {
    cur.searching = false;
    rerender();
  });
}

// ---- selection / capture ------------------------------------------------

function gutterClick(line) {
  if (cur.selStart == null || (cur.selStart != null && cur.selEnd != null && cur.selStart !== cur.selEnd)) {
    cur.selStart = line; cur.selEnd = line;
  } else if (line < cur.selStart) {
    cur.selEnd = cur.selStart; cur.selStart = line;
  } else {
    cur.selEnd = line;
  }
  updateHighlight();
}

function updateHighlight() {
  for (const row of rowEls) {
    const n = Number(row.dataset.line);
    const sel = cur.selStart != null && n >= cur.selStart && n <= (cur.selEnd ?? cur.selStart);
    row.classList.toggle('sel', sel);
  }
  const label = document.getElementById('sel-range-label');
  if (label) {
    label.textContent = cur.selStart == null
      ? 'no lines selected'
      : `lines ${cur.selStart}–${cur.selEnd ?? cur.selStart}`;
  }
}

function selectAllLines() {
  if (!cur.fileData) return;
  cur.selStart = 1;
  cur.selEnd = cur.fileData.content.split('\n').length;
  updateHighlight();
}

function currentRegion() {
  if (!cur.fileData || cur.selStart == null) return null;
  const start = cur.selStart;
  const end = cur.selEnd ?? cur.selStart;
  const excerpt = cur.fileData.content.split('\n').slice(start - 1, end).join('\n');
  const repoEntry = currentRepo();
  return {
    resourceId: cur.repoId,
    repoName: repoEntry ? repoEntry.name : '(repository)',
    filePath: cur.filePath,
    commit: cur.fileData.commit,
    startLine: start,
    endLine: end,
    excerpt,
  };
}

async function captureEvidence() {
  const region = currentRegion();
  if (!region) { toast('Open a file and select a line range first.', 'error'); return; }
  const contentHash = await api.sha256Hex(region.excerpt);
  state.evidence.unshift({
    id: crypto.randomUUID(),
    title: `${region.filePath}:${region.startLine}-${region.endLine}`,
    excerpt: region.excerpt,
    note: '',
    topicIds: [],
    provenance: {
      resourceId: region.resourceId, repoName: region.repoName, filePath: region.filePath,
      commit: region.commit, startLine: region.startLine, endLine: region.endLine, contentHash,
    },
    createdAt: nowIso(),
  });
  mutated();
  toast(`Evidence captured: ${region.filePath}:${region.startLine}-${region.endLine}`);
}

/** Used by the shelf command rr.capture-selection. */
export function captureCurrentRegion() {
  void captureEvidence();
}

function pinRegion() {
  const region = currentRegion();
  if (!region) { toast('Open a file and select a line range first.', 'error'); return; }
  toggleItem('code-regions', {
    resourceId: region.resourceId, repoName: region.repoName, filePath: region.filePath,
    startLine: region.startLine, endLine: region.endLine, excerpt: region.excerpt, commit: region.commit,
  });
}

// ---- rendering ----------------------------------------------------------

function renderFileList(box) {
  clear(box);
  const filter = cur.filter.toLowerCase();
  const files = filter ? cur.files.filter((f) => f.toLowerCase().includes(filter)) : cur.files;
  if (cur.filesLoading) { box.append(el('p', { class: 'muted small', text: 'Listing files…' })); return; }
  if (cur.filesError) { box.append(el('p', { class: 'small', style: 'color:var(--danger)', text: cur.filesError })); return; }
  if (!cur.filesLoaded) return;
  if (files.length === 0) { box.append(el('p', { class: 'muted small', text: 'No files match.' })); }
  const shown = files.slice(0, 2000);
  for (const filePath of shown) {
    const key = itemKey('files', { resourceId: cur.repoId, filePath });
    const checkbox = el('input', {
      type: 'checkbox',
      checked: isSelected('files', key),
      title: 'Add this file to the selection tray',
      onchange: () => {
        const repoEntry = currentRepo();
        toggleItem('files', { resourceId: cur.repoId, repoName: repoEntry ? repoEntry.name : '', filePath });
      },
    });
    box.append(el('div', { class: `file-row${cur.filePath === filePath ? ' open' : ''}` },
      checkbox,
      el('button', { title: filePath, onclick: () => openFile(filePath) }, filePath),
    ));
  }
  if (files.length > shown.length) {
    box.append(el('p', { class: 'muted small', text: `Showing ${shown.length} of ${files.length} matching files — narrow the filter.` }));
  }
  if (cur.filesTruncated) {
    box.append(el('p', { class: 'small' }, el('span', { class: 'badge warn', text: 'file list truncated by the host — not all files are shown' })));
  }
}

function renderContent(box) {
  clear(box);
  rowEls = [];
  if (!cur.filePath) {
    box.append(el('p', { class: 'muted', text: 'Pick a file from the list, or search the repository.' }));
    return;
  }
  if (cur.fileLoading) { box.append(el('p', { class: 'muted small', text: `Reading ${cur.filePath}…` })); return; }
  if (cur.fileError) { box.append(el('p', { class: 'small', style: 'color:var(--danger)', text: cur.fileError })); return; }
  if (!cur.fileData) return;

  const head = el('div', { class: 'row', style: 'margin-bottom:6px' },
    el('span', { class: 'mono small', text: cur.filePath }),
    el('span', { class: 'badge plain', title: cur.fileData.commit, text: `@${shortCommit(cur.fileData.commit)}` }),
    cur.fileData.truncated ? el('span', { class: 'badge warn', text: 'content truncated by the host' }) : null,
    el('span', { id: 'sel-range-label', class: 'muted small', text: cur.selStart == null ? 'no lines selected' : `lines ${cur.selStart}–${cur.selEnd ?? cur.selStart}` }),
  );
  const buttons = el('div', { class: 'row', style: 'margin-bottom:8px' },
    el('button', { onclick: selectAllLines }, 'Select all lines'),
    el('button', { class: 'primary', onclick: () => { void captureEvidence(); } }, 'Capture evidence'),
    el('button', { onclick: pinRegion, title: 'Add the selected region to the selection tray' }, 'Pin region to tray'),
    el('button', { onclick: () => { cur.selStart = null; cur.selEnd = null; updateHighlight(); } }, 'Clear line selection'),
  );
  box.append(head, buttons);

  const lines = cur.fileData.content.split('\n');
  const table = el('table', { class: 'code' });
  const shownCount = Math.min(lines.length, MAX_RENDER_LINES);
  for (let i = 0; i < shownCount; i += 1) {
    const n = i + 1;
    const row = el('tr', { dataset: { line: String(n) }, id: `L${n}` },
      el('td', { class: 'gutter' },
        el('button', { title: `Select from/to line ${n}`, onclick: () => gutterClick(n) }, String(n))),
      el('td', { class: 'codeline', text: lines[i] === '' ? ' ' : lines[i] }),
    );
    rowEls.push(row);
    table.append(row);
  }
  const wrap = el('div', { class: 'code-wrap' }, table);
  box.append(wrap);
  if (lines.length > shownCount) {
    box.append(el('p', { class: 'small' },
      el('span', { class: 'badge warn', text: `showing the first ${shownCount} of ${lines.length} lines — line selection is limited to what is shown; “Select all lines” still covers the whole file` })));
  }
  updateHighlight();

  if (cur.pendingScrollLine != null) {
    const target = document.getElementById(`L${cur.pendingScrollLine}`);
    cur.pendingScrollLine = null;
    if (target) setTimeout(() => target.scrollIntoView({ block: 'center' }), 0);
  }
}

function renderSearch() {
  const box = el('section', { class: 'block' });
  if (cur.searching) box.append(el('p', { class: 'muted small', text: 'Searching…' }));
  if (cur.searchError) box.append(el('p', { class: 'small', style: 'color:var(--danger)', text: cur.searchError }));
  if (cur.searchResults) {
    const { matches = [], truncated } = cur.searchResults;
    box.append(el('h3', {}, `Search results (${matches.length}${truncated ? ', truncated by the host' : ''})`));
    if (matches.length === 0) box.append(el('p', { class: 'muted small', text: 'No matches.' }));
    const hits = el('div', { class: 'search-hits' });
    for (const m of matches) {
      hits.append(el('div', { class: 'search-hit' },
        el('button', { onclick: () => openFile(m.path, m.line) }, `${m.path}:${m.line}`),
        el('span', { class: 'txt', title: m.text, text: m.text }),
      ));
    }
    box.append(hits);
  }
  return box;
}

export function render(container) {
  rootEl = container;
  clear(container);

  if (state.repositories.length === 0) {
    container.append(el('p', { class: 'muted', text: 'Register a repository in the Overview first.' }));
    return;
  }
  if (cur.repoId && !findRepo(cur.repoId)) {
    cur.repoId = null;
    cur.files = []; cur.filesLoaded = false; cur.filesError = null;
    cur.filePath = null; cur.fileData = null; cur.fileError = null;
    cur.selStart = null; cur.selEnd = null;
    cur.searchResults = null; cur.searchError = null;
  }
  if (!cur.repoId) {
    // default to the first repository
    cur.repoId = state.repositories[0].resourceId;
    loadFiles();
  }

  const repoSelect = el('select', {
    onchange: (ev) => selectRepo(ev.target.value),
  }, state.repositories.map((r) => el('option', { value: r.resourceId, selected: r.resourceId === cur.repoId }, r.name)));

  const searchInput = el('input', {
    type: 'search', placeholder: 'Search pattern…', value: cur.searchPattern, style: 'width:220px',
    oninput: (ev) => { cur.searchPattern = ev.target.value; },
    onkeydown: (ev) => { if (ev.key === 'Enter') runSearch(); },
  });
  container.append(el('div', { class: 'explorer-top' },
    el('label', { class: 'small muted' }, 'Repository'),
    repoSelect,
    searchInput,
    el('button', { onclick: runSearch }, 'Search'),
    cur.searchResults || cur.searchError
      ? el('button', { class: 'linkish small', onclick: () => { cur.searchResults = null; cur.searchError = null; rerender(); } }, 'Clear results')
      : null,
  ));

  if (cur.searching || cur.searchResults || cur.searchError) container.append(renderSearch());

  const fileListBox = el('div', { class: 'file-list' });
  const filterInput = el('input', {
    type: 'search', placeholder: 'Filter files…', value: cur.filter, style: 'width:100%',
    oninput: (ev) => { cur.filter = ev.target.value; renderFileList(fileListBox); },
  });
  const contentBox = el('div', {});
  container.append(el('div', { class: 'explorer-cols' },
    el('div', { class: 'stack', style: 'gap:6px' }, filterInput, fileListBox),
    contentBox,
  ));
  renderFileList(fileListBox);
  renderContent(contentBox);
}
