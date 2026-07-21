/** Overview: registered repositories with live info, register form, counts, recent work. */
import { el, clear, fmtDate, shortCommit, clampText } from '../dom.js';
import * as api from '../api.js';
import { state, mutated } from '../state.js';
import { toast } from '../ui.js';

/** resourceId → { loading, data, error } */
const infoCache = new Map();

function loadInfo(resourceId, container) {
  const cached = infoCache.get(resourceId);
  if (cached && (cached.loading || cached.data || cached.error)) {
    renderInfo(container, cached);
    return;
  }
  refreshInfo(resourceId, container);
}

function refreshInfo(resourceId, container) {
  const entry = { loading: true, data: null, error: null };
  infoCache.set(resourceId, entry);
  renderInfo(container, entry);
  api.repo.info(resourceId).then((data) => {
    infoCache.set(resourceId, { loading: false, data, error: null });
  }).catch((err) => {
    infoCache.set(resourceId, { loading: false, data: null, error: api.parseCapabilityError(err).message });
  }).finally(() => {
    const latest = infoCache.get(resourceId);
    if (container.isConnected) renderInfo(container, latest);
  });
}

function renderInfo(container, entry) {
  clear(container);
  if (entry.loading) {
    container.append(el('span', { class: 'muted small', text: 'Reading repository info…' }));
    return;
  }
  if (entry.error) {
    container.append(el('span', { class: 'small', style: 'color:var(--danger)', text: `Info unavailable: ${entry.error}` }));
    return;
  }
  const d = entry.data;
  container.append(
    el('div', { class: 'row small' },
      el('span', { class: 'badge', text: d.branch || '(no branch)' }),
      el('span', { class: 'mono', text: `${shortCommit(d.headCommit)}` }),
      el('span', { class: 'muted', text: clampText(d.headSubject || '', 80) }),
    ),
    el('div', { class: 'row small' },
      d.clean
        ? el('span', { class: 'badge plain', text: 'clean' })
        : el('span', { class: 'badge warn', text: `dirty — ${d.changedFiles} changed file(s)` }),
      d.remoteUrl ? el('span', { class: 'muted mono', text: clampText(d.remoteUrl, 60) }) : null,
    ),
  );
}

function repoCard(repoEntry) {
  const infoBox = el('div', { class: 'stack', style: 'gap:4px; margin-top:6px' });
  const card = el('div', { class: 'card' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('h4', { text: repoEntry.name }),
      el('button', { class: 'linkish small', onclick: () => refreshInfo(repoEntry.resourceId, infoBox) }, 'Refresh'),
    ),
    el('div', { class: 'prov', text: repoEntry.path }),
    infoBox,
  );
  loadInfo(repoEntry.resourceId, infoBox);
  return card;
}

function registerForm() {
  const pathInput = el('input', { type: 'text', placeholder: 'Absolute path to a local Git repository', style: 'flex:1; min-width:260px' });
  const nameInput = el('input', { type: 'text', placeholder: 'Display name (optional)', style: 'width:180px' });
  const button = el('button', { class: 'primary' }, 'Register repository…');
  button.addEventListener('click', async () => {
    const path = pathInput.value.trim();
    if (!path) { toast('Enter the absolute path of a local Git repository.', 'error'); return; }
    button.disabled = true;
    try {
      const result = await api.repo.register(path, nameInput.value.trim() || undefined);
      if (state.repositories.some((r) => r.resourceId === result.resourceId)) {
        toast('That repository is already registered.');
      } else {
        state.repositories.push({ resourceId: result.resourceId, name: result.name, path: result.path });
        mutated();
        toast(`Registered “${result.name}”.`);
      }
      pathInput.value = '';
      nameInput.value = '';
    } catch (err) {
      toast(`Could not register: ${api.parseCapabilityError(err).message}`, 'error');
    } finally {
      button.disabled = false;
    }
  });
  return el('div', { class: 'row', style: 'margin-top:8px' }, pathInput, nameInput, button);
}

function countTile(label, n) {
  return el('div', { class: 'card count-tile' }, el('span', { class: 'n', text: String(n) }), el('span', { class: 'small muted', text: label }));
}

export function render(container) {
  clear(container);

  const repoSection = el('section', { class: 'block' }, el('h3', { text: 'Repositories' }));
  if (state.repositories.length === 0) {
    repoSection.append(el('p', { class: 'muted', text: 'No repository registered yet. Register a local Git repository to start reading it as research material — Papers never copies or modifies it.' }));
  } else {
    repoSection.append(el('div', { class: 'stack' }, state.repositories.map(repoCard)));
  }
  repoSection.append(registerForm());
  container.append(repoSection);

  container.append(el('section', { class: 'block' },
    el('h3', { text: 'At a glance' }),
    el('div', { class: 'grid-counts' },
      countTile('notes', state.notes.length),
      countTile('evidence', state.evidence.length),
      countTile('topics', state.topics.length),
      countTile('tasks', state.tasks.length),
      countTile('drafts', state.drafts.length),
      countTile('artifacts', state.artifacts.length),
    ),
  ));

  const recentNotes = [...state.notes]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 5);
  const recentEvidence = [...state.evidence]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);

  container.append(el('section', { class: 'block' },
    el('h3', { text: 'Recent work' }),
    el('div', { class: 'two-col' },
      el('div', {},
        el('h4', { text: 'Notes' }),
        recentNotes.length === 0
          ? el('p', { class: 'muted small', text: 'No notes yet.' })
          : el('ul', { class: 'plain' }, recentNotes.map((n) =>
            el('li', { class: 'small' },
              el('strong', { text: clampText(n.title, 70) }), ' ',
              el('span', { class: 'muted', text: fmtDate(n.updatedAt) })))),
      ),
      el('div', {},
        el('h4', { text: 'Evidence' }),
        recentEvidence.length === 0
          ? el('p', { class: 'muted small', text: 'No evidence captured yet.' })
          : el('ul', { class: 'plain' }, recentEvidence.map((e) =>
            el('li', { class: 'small' },
              el('strong', { text: clampText(e.title, 70) }), ' ',
              el('span', { class: 'muted', text: fmtDate(e.createdAt) })))),
      ),
    ),
  ));
}
