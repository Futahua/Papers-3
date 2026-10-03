const SEARCH_DEBOUNCE_MS = 120;
const VERIFY_ATTEMPTS = 40;
const VERIFY_DELAY_MS = 250;
const FULL_PAGE_PREVIEW_PARAM = 'papers-file-preview';
const FULL_PAGE_PREVIEW_STORAGE_PREFIX = 'papers:file-preview:';

export function isAbsoluteWindowsPath(value) {
  return typeof value === 'string'
    && (/^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value));
}

function basename(target) {
  const normalized = String(target || '').replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

function dirname(target) {
  const normalized = String(target || '').replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (slash <= 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, Math.max(3, slash + 1));
  return slash > 0 ? normalized.slice(0, slash) : normalized;
}

function joinPath(parent, leaf) {
  return String(parent || '').replace(/[\\/]+$/, '') + '\\' + leaf;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return String(value) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let current = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && current >= 1024; index += 1) {
    current /= 1024;
    unit = units[index];
  }
  return (current >= 10 ? current.toFixed(0) : current.toFixed(1)) + ' ' + unit;
}

function normalizePickerTarget(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && typeof result.target === 'string') return result.target;
  return null;
}

function createButton(documentRef, label, className) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  return button;
}

function setButtonSvg(documentRef, button, label, paths) {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  for (const definition of paths) {
    const node = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', definition);
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '1.5');
    node.setAttribute('stroke-linecap', 'round');
    node.setAttribute('stroke-linejoin', 'round');
    svg.append(node);
  }
  button.replaceChildren(svg);
  button.title = label;
  button.setAttribute('aria-label', label);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPathState(host, options) {
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    let presentOk = options.present == null;
    let absentOk = options.absent == null;
    if (options.present != null) {
      const result = await host.fileCapability('stat', { path: options.present }).catch(() => null);
      presentOk = result && result.ok === true;
    }
    if (options.absent != null) {
      const result = await host.fileCapability('stat', { path: options.absent }).catch(() => null);
      absentOk = result && result.ok === false && result.code === 'ENOENT';
    }
    if (presentOk && absentOk) return true;
    await sleep(VERIFY_DELAY_MS);
  }
  return false;
}

export function createFileCapabilityPanel(options) {
  const documentRef = options.document;
  const host = options.host;
  const setStatus = options.setStatus || (() => {});
  const retargetShortcut = options.retargetShortcut || (async () => false);
  const windowRef = documentRef?.defaultView ?? null;
  let launchedPreview = null;
  let launchToken = null;
  let embeddedSurface = null;
  try {
    const currentUrl = new URL(windowRef.location.href);
    const token = currentUrl.searchParams.get(FULL_PAGE_PREVIEW_PARAM);
    launchToken = token;
    embeddedSurface = currentUrl.searchParams.get('papers-embedded-surface');
    const raw = token ? windowRef.localStorage.getItem(FULL_PAGE_PREVIEW_STORAGE_PREFIX + token) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && isAbsoluteWindowsPath(parsed.path)) {
      launchedPreview = { path: parsed.path, name: parsed.name || basename(parsed.path) };
    }
  } catch {}

  if (!documentRef || !documentRef.body || !host || !host.fileCapability) {
    return Object.freeze({
      syncSelection() {},
      openSearch() {},
      refreshPreviewGeometry() {},
      destroy() {},
      isOpen: () => false,
    });
  }

  const state = {
    expanded: false,
    width: embeddedSurface === 'proxima'
      ? Math.min(620, Math.max(420, Math.round((windowRef?.innerWidth || 1000) * 0.48)))
      : 380,
    resizing: false,
    context: null,
    inspectedPath: null,
    inspectedUrl: null,
    searchTimer: null,
    searchGeneration: 0,
    inspectGeneration: 0,
    deleteArmed: false,
    previewObjectUrl: null,
    previewResourceId: null,
    nativePreviewSessionId: null,
    nativePreviewObserver: null,
    pdfPreviewSessionId: null,
    pdfPreviewObserver: null,
    pdfPreviewClosePromise: Promise.resolve(),
    htmlPreviewSessionId: null,
    htmlPreviewObserver: null,
    browserSessionId: null,
    browserObserver: null,
    imagePreviewObserver: null,
    markdownPreviewObserver: null,
    markdownAutoscrollCancel: null,
    fullPage: Boolean(launchedPreview || launchToken),
    lastPreviewResult: null,
  };

  const workspace = documentRef.querySelector('.workspace');
  const panel = documentRef.createElement('aside');
  panel.className = 'file-capability-panel';
  if (embeddedSurface === 'proxima') panel.classList.add('embedded-surface-proxima');
  panel.setAttribute('aria-label', 'File preview');
  panel.style.setProperty('--file-capability-width', state.width + 'px');
  workspace?.style.setProperty('--file-capability-width', state.width + 'px');
  workspace?.classList.add('file-capability-docked');
  const resizer = documentRef.createElement('div');
  resizer.className = 'file-capability-resizer';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize file preview');

  const header = documentRef.createElement('header');
  header.className = 'file-capability-header';
  const providerStatus = documentRef.createElement('span');
  providerStatus.className = 'file-capability-provider-status';
  const openTabButton = createButton(documentRef, 'Full screen', 'file-capability-icon-button file-capability-open-tab');
  openTabButton.hidden = true;
  setButtonSvg(documentRef, openTabButton, 'Open preview in a new Papers tab', [
    'M6 3H3v14h14v-3',
    'M10 3h7v7',
    'M9 11l8-8',
  ]);
  const expandButton = createButton(documentRef, '', 'file-capability-icon-button file-capability-expand');
  setButtonSvg(documentRef, expandButton, 'Expand file preview', ['M3.5 4.5h13v11h-13z']);
  expandButton.setAttribute('aria-pressed', 'false');
  header.append(openTabButton, expandButton);

  const searchWrap = documentRef.createElement('div');
  searchWrap.className = 'file-capability-search';
  const searchInput = documentRef.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search all files';
  searchInput.autocomplete = 'off';
  searchInput.spellcheck = false;
  const searchHint = documentRef.createElement('span');
  searchHint.textContent = 'Everything';
  searchWrap.append(searchInput, searchHint);

  const body = documentRef.createElement('div');
  body.className = 'file-capability-body';

  const resultsPane = documentRef.createElement('section');
  resultsPane.className = 'file-capability-results';
  const resultsStatus = documentRef.createElement('div');
  resultsStatus.className = 'file-capability-results-status';
  resultsStatus.textContent = 'Type to search the whole machine.';
  const resultsList = documentRef.createElement('div');
  resultsList.className = 'file-capability-results-list';
  resultsPane.append(resultsStatus, resultsList);

  const inspector = documentRef.createElement('section');
  inspector.className = 'file-capability-inspector';
  const itemTitle = documentRef.createElement('strong');
  itemTitle.className = 'file-capability-item-title';
  itemTitle.textContent = 'Select a file';
  const itemMeta = documentRef.createElement('span');
  itemMeta.className = 'file-capability-item-meta';
  const pathRow = documentRef.createElement('div');
  pathRow.className = 'file-capability-path-row';
  const pathText = documentRef.createElement('code');
  pathText.className = 'file-capability-path';
  pathText.textContent = 'Select a local file or folder in As you Go.';
  const copyPathButton = createButton(documentRef, 'Copy path', 'file-capability-icon-button');
  copyPathButton.hidden = true;
  setButtonSvg(documentRef, copyPathButton, 'Copy path', ['M6.5 6.5h8v8h-8z', 'M4 11.5H3.5A1.5 1.5 0 0 1 2 10V3.5A1.5 1.5 0 0 1 3.5 2H10A1.5 1.5 0 0 1 11.5 3.5V4']);
  pathRow.append(pathText);

  const actions = documentRef.createElement('div');
  actions.className = 'file-capability-actions';
  const openButton = createButton(documentRef, 'Open');
  const revealButton = createButton(documentRef, 'Reveal', 'file-capability-icon-button');
  revealButton.hidden = true;
  setButtonSvg(documentRef, revealButton, 'Reveal in file manager', ['M2.5 5.5h5l1.4 1.7h8.6v8.3A1.5 1.5 0 0 1 16 17H4a1.5 1.5 0 0 1-1.5-1.5z', 'M2.5 8h15']);
  pathRow.append(revealButton, copyPathButton);
  const copyButton = createButton(documentRef, 'Copy to…');
  const moveButton = createButton(documentRef, 'Move to…');
  const renameButton = createButton(documentRef, 'Rename');
  const deleteButton = createButton(documentRef, 'Delete', 'file-capability-delete');
  actions.append(openButton, revealButton, copyButton, moveButton, renameButton, deleteButton);
  actions.hidden = true;

  const renameRow = documentRef.createElement('form');
  renameRow.className = 'file-capability-rename';
  renameRow.hidden = true;
  const renameInput = documentRef.createElement('input');
  renameInput.type = 'text';
  renameInput.maxLength = 255;
  renameInput.autocomplete = 'off';
  const renameSave = createButton(documentRef, 'Save');
  renameSave.type = 'submit';
  const renameCancel = createButton(documentRef, 'Cancel');
  renameRow.append(renameInput, renameSave, renameCancel);

  const preview = documentRef.createElement('div');
  preview.className = 'file-capability-preview';
  const initialPreview = documentRef.createElement('p');
  initialPreview.className = 'file-capability-empty';
  initialPreview.textContent = 'Preview appears here.';
  preview.append(initialPreview);

  inspector.append(itemTitle, itemMeta, pathRow, preview);
  resultsPane.hidden = true;
  body.append(inspector);
  panel.append(resizer, header, body);
  documentRef.body.append(panel);
  if (state.fullPage) {
    panel.classList.add('full-page');
    documentRef.body.classList.add('file-capability-full-page');
  }

  function loadProviders() {
    if (providerStatus.textContent) return;
    void host.fileCapability('providers', {}).then((result) => {
      if (!result || !result.ok || !result.providers) return;
      const names = [];
      if (result.providers.everything) names.push('Everything');
      if (result.providers.directoryOpus) names.push('Opus');
      if (result.providers.libreOffice) names.push('LibreOffice');
      providerStatus.textContent = names.join(' · ');
    }).catch(() => {});
  }

  function setExpanded(expanded) {
    state.expanded = Boolean(expanded);
    panel.classList.toggle('expanded', state.expanded);
    workspace?.classList.toggle('file-capability-expanded', state.expanded);
    setButtonSvg(
      documentRef,
      expandButton,
      state.expanded ? 'Collapse file preview' : 'Expand file preview',
      state.expanded
        ? ['M3.5 4.5h13v11h-13z', 'M12.5 4.5v11']
        : ['M3.5 4.5h13v11h-13z'],
    );
    expandButton.setAttribute('aria-pressed', String(state.expanded));
    openTabButton.hidden = state.fullPage || !state.expanded || !state.inspectedPath;
  }

  function setPanelWidth(width) {
    const viewportWidth = documentRef.defaultView?.innerWidth ?? 1200;
    const maxWidth = Math.max(300, Math.min(900, Math.floor(viewportWidth * 0.75)));
    state.width = Math.max(300, Math.min(maxWidth, Math.round(width)));
    panel.style.setProperty('--file-capability-width', state.width + 'px');
    workspace?.style.setProperty('--file-capability-width', state.width + 'px');
  }

  loadProviders();

  function disarmDelete() {
    state.deleteArmed = false;
    deleteButton.classList.remove('armed');
    deleteButton.textContent = 'Delete';
  }

  function setBusy(button, busy, busyText) {
    if (busy) {
      button.dataset.previousText = button.textContent;
      button.textContent = busyText || 'Working…';
      button.disabled = true;
      return;
    }
    button.textContent = button.dataset.previousText || button.textContent;
    delete button.dataset.previousText;
    button.disabled = false;
  }

  function releasePreviewResource(resourceId = state.previewResourceId) {
    if (!resourceId) return;
    if (resourceId === state.previewResourceId) state.previewResourceId = null;
    void host.fileCapability('preview-release', { resourceId }).catch(() => {});
  }

  function closeNativePreview() {
    state.nativePreviewObserver?.disconnect();
    state.nativePreviewObserver = null;
    const sessionId = state.nativePreviewSessionId;
    state.nativePreviewSessionId = null;
    if (sessionId) void host.fileCapability('preview-native-close', { sessionId }).catch(() => {});
  }

  function closePdfPreview() {
    state.pdfPreviewObserver?.disconnect();
    state.pdfPreviewObserver = null;
    const sessionId = state.pdfPreviewSessionId;
    state.pdfPreviewSessionId = null;
    if (sessionId) {
      state.pdfPreviewClosePromise = Promise.resolve(state.pdfPreviewClosePromise)
        .catch(() => {})
        .then(() => host.fileCapability('preview-pdf-close', { sessionId }))
        .catch(() => {});
    }
    return state.pdfPreviewClosePromise;
  }

  function closeHtmlPreview() {
    state.htmlPreviewObserver?.disconnect();
    state.htmlPreviewObserver = null;
    const sessionId = state.htmlPreviewSessionId;
    state.htmlPreviewSessionId = null;
    if (sessionId) void host.fileCapability('preview-html-close', { sessionId }).catch(() => {});
  }

  function closeBrowserPreview() {
    state.browserObserver?.disconnect();
    state.browserObserver = null;
    const sessionId = state.browserSessionId;
    state.browserSessionId = null;
    if (sessionId) void host.fileCapability('browser-close', { sessionId }).catch(() => {});
  }

  function clearPreview({ preserveBrowser = false } = {}) {
    closeNativePreview();
    closePdfPreview();
    closeHtmlPreview();
    if (preserveBrowser) {
      state.browserObserver?.disconnect();
      state.browserObserver = null;
    } else {
      closeBrowserPreview();
    }
    state.imagePreviewObserver?.disconnect();
    state.imagePreviewObserver = null;
    state.markdownPreviewObserver?.disconnect();
    state.markdownPreviewObserver = null;
    state.markdownAutoscrollCancel?.();
    state.markdownAutoscrollCancel = null;
    releasePreviewResource();
    if (state.previewObjectUrl) {
      URL.revokeObjectURL(state.previewObjectUrl);
      state.previewObjectUrl = null;
    }
    preview.replaceChildren();
  }

  async function startBrowserPreview(url) {
    const generation = state.inspectGeneration;
    const surface = documentRef.createElement('div');
    surface.className = 'file-capability-native-preview file-capability-browser-preview';
    preview.append(surface);
    if (!state.expanded) {
      surface.textContent = 'Expand the preview pane to use this link.';
      return;
    }
    await nextLayoutTick();
    if (generation !== state.inspectGeneration || state.inspectedUrl !== url) return;
    const opened = await host.fileCapability('browser-open', {
      url,
      rect: nativePreviewRect(surface),
    }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (generation !== state.inspectGeneration || state.inspectedUrl !== url) {
      if (opened && opened.ok && typeof opened.sessionId === 'string') {
        void host.fileCapability('browser-close', { sessionId: opened.sessionId }).catch(() => {});
      }
      return;
    }
    if (!opened || !opened.ok || typeof opened.sessionId !== 'string') {
      surface.textContent = opened && (opened.message || opened.error)
        ? (opened.message || opened.error)
        : 'This link could not be opened in the viewer.';
      return;
    }
    state.browserSessionId = opened.sessionId;
    const move = () => {
      if (!state.browserSessionId || !state.expanded) return;
      void host.fileCapability('browser-move', {
        sessionId: state.browserSessionId,
        rect: nativePreviewRect(surface),
      }).catch(() => {});
    };
    if (typeof ResizeObserver === 'function') {
      state.browserObserver = new ResizeObserver(move);
      state.browserObserver.observe(surface);
    }
    documentRef.defaultView?.addEventListener('resize', move, { passive: true, once: true });
  }

  function renderWebSelection(source) {
    const url = typeof source?.url === 'string' ? source.url : '';
    if (!/^https?:\/\//i.test(url)) {
      renderEmptySelection(0);
      return;
    }
    ++state.inspectGeneration;
    state.context = null;
    state.inspectedPath = null;
    state.inspectedUrl = url;
    state.lastPreviewResult = null;
    disarmDelete();
    renameRow.hidden = true;
    itemTitle.textContent = source.name || url;
    itemMeta.textContent = 'Web link';
    pathText.textContent = url;
    copyPathButton.hidden = false;
    revealButton.hidden = true;
    openTabButton.hidden = true;
    actions.hidden = true;
    clearPreview({ preserveBrowser: true });
    void startBrowserPreview(url);
  }

  function renderImagePreview(source) {
    const shell = documentRef.createElement('div');
    shell.className = 'file-capability-image-shell';
    const toolbar = documentRef.createElement('div');
    toolbar.className = 'file-capability-image-toolbar';
    const zoomOut = createButton(documentRef, '−');
    zoomOut.title = 'Zoom out';
    zoomOut.setAttribute('aria-label', 'Zoom out');
    const zoomLabel = documentRef.createElement('span');
    zoomLabel.className = 'file-capability-image-zoom-label';
    const zoomIn = createButton(documentRef, '+');
    zoomIn.title = 'Zoom in';
    zoomIn.setAttribute('aria-label', 'Zoom in');
    const fit = createButton(documentRef, 'Fit');
    fit.title = 'Fit image to preview';
    toolbar.append(zoomOut, zoomLabel, zoomIn, fit);

    const viewport = documentRef.createElement('div');
    viewport.className = 'file-capability-image-viewport';
    const stage = documentRef.createElement('div');
    stage.className = 'file-capability-image-stage';
    const image = documentRef.createElement('img');
    image.src = source;
    image.alt = itemTitle.textContent || '';
    image.className = 'file-capability-preview-image';
    image.draggable = false;
    stage.append(image);
    viewport.append(stage);
    shell.append(toolbar, viewport);
    preview.append(shell);

    let scale = 1;
    let fitMode = true;
    const clamp = (value) => Math.max(0.05, Math.min(10, value));
    const apply = () => {
      const naturalWidth = image.naturalWidth || 1;
      const naturalHeight = image.naturalHeight || 1;
      if (fitMode && viewport.clientWidth > 0 && viewport.clientHeight > 0) {
        scale = clamp(Math.min(
          viewport.clientWidth / naturalWidth,
          viewport.clientHeight / naturalHeight,
        ));
      }
      const width = Math.max(1, Math.round(naturalWidth * scale));
      const height = Math.max(1, Math.round(naturalHeight * scale));
      image.style.width = width + 'px';
      image.style.height = height + 'px';
      stage.style.width = Math.max(viewport.clientWidth, width) + 'px';
      stage.style.height = Math.max(viewport.clientHeight, height) + 'px';
      zoomLabel.textContent = Math.round(scale * 100) + '%';
      fit.classList.toggle('active', fitMode);
    };
    const step = (factor, anchorClientX = null, anchorClientY = null) => {
      const rect = viewport.getBoundingClientRect();
      const anchorX = Number.isFinite(anchorClientX) ? anchorClientX - rect.left : viewport.clientWidth / 2;
      const anchorY = Number.isFinite(anchorClientY) ? anchorClientY - rect.top : viewport.clientHeight / 2;
      const beforeX = viewport.scrollLeft + anchorX;
      const beforeY = viewport.scrollTop + anchorY;
      const beforeScale = scale;
      fitMode = false;
      scale = clamp(scale * factor);
      apply();
      const ratio = scale / Math.max(0.0001, beforeScale);
      viewport.scrollLeft = Math.max(0, beforeX * ratio - anchorX);
      viewport.scrollTop = Math.max(0, beforeY * ratio - anchorY);
    };
    zoomOut.addEventListener('click', () => step(0.8));
    zoomIn.addEventListener('click', () => step(1.25));
    fit.addEventListener('click', () => {
      fitMode = true;
      apply();
    });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      step(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
    }, { passive: false });
    let pan = null;
    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      pan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: viewport.scrollLeft,
        scrollTop: viewport.scrollTop,
      };
      viewport.classList.add('panning');
      viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      viewport.scrollLeft = pan.scrollLeft - (event.clientX - pan.x);
      viewport.scrollTop = pan.scrollTop - (event.clientY - pan.y);
      event.preventDefault();
    });
    const finishPan = (event) => {
      if (!pan || pan.pointerId !== event.pointerId) return;
      if (viewport.hasPointerCapture?.(event.pointerId)) viewport.releasePointerCapture?.(event.pointerId);
      pan = null;
      viewport.classList.remove('panning');
    };
    viewport.addEventListener('pointerup', finishPan);
    viewport.addEventListener('pointercancel', finishPan);
    viewport.addEventListener('lostpointercapture', () => {
      pan = null;
      viewport.classList.remove('panning');
    });
    image.addEventListener('load', apply, { once: true });
    if (image.complete) apply();
    if (typeof ResizeObserver === 'function') {
      state.imagePreviewObserver = new ResizeObserver(() => {
        if (fitMode) apply();
      });
      state.imagePreviewObserver.observe(viewport);
    }
  }

  function previewBlobUrl(data) {
    if (!data || typeof data.dataUrl !== 'string') return null;
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(data.dataUrl);
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    state.previewObjectUrl = URL.createObjectURL(new Blob([bytes], { type: data.mime || match[1] }));
    return state.previewObjectUrl;
  }

  function previewSource(data) {
    if (data && typeof data.url === 'string') {
      try {
        const parsed = new URL(data.url);
        if (parsed.protocol === 'papers-file-preview:') return parsed.toString();
      } catch {}
    }
    return previewBlobUrl(data);
  }

  function renderEntry(entry) {
    if (!entry) {
      itemTitle.textContent = basename(state.inspectedPath) || 'File';
      itemMeta.textContent = '';
      return;
    }
    itemTitle.textContent = entry.name || basename(entry.path);
    const meta = [];
    meta.push(entry.kind === 'folder' ? 'Folder' : (entry.extension || 'File'));
    if (entry.kind === 'file' && Number.isFinite(entry.size)) meta.push(formatBytes(entry.size));
    if (Number.isFinite(entry.modifiedAt)) {
      try { meta.push(new Date(entry.modifiedAt).toLocaleString()); } catch {}
    }
    itemMeta.textContent = meta.filter(Boolean).join(' · ');
  }

  function renderDirectory(items) {
    clearPreview();
    const list = documentRef.createElement('div');
    list.className = 'file-capability-directory';
    for (const entry of items || []) {
      const button = createButton(documentRef, '', 'file-capability-directory-entry');
      const name = documentRef.createElement('strong');
      name.textContent = entry.name;
      const meta = documentRef.createElement('span');
      meta.textContent = entry.kind === 'folder' ? 'Folder' : formatBytes(entry.size);
      button.append(name, meta);
      button.addEventListener('click', () => void inspectPath(entry.path, null));
      list.append(button);
    }
    if (!list.childElementCount) {
      const empty = documentRef.createElement('p');
      empty.className = 'file-capability-empty';
      empty.textContent = 'This folder is empty.';
      list.append(empty);
    }
    preview.append(list);
  }

  function nativePreviewRect(node) {
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
  }

  function nextLayoutTick() {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      setTimeout(done, 50);
      const raf = documentRef.defaultView?.requestAnimationFrame;
      if (typeof raf === 'function') raf.call(documentRef.defaultView, done);
    });
  }

  async function startNativePreview(data) {
    const target = state.inspectedPath;
    const generation = state.inspectGeneration;
    const surface = documentRef.createElement('div');
    surface.className = 'file-capability-native-preview';
    preview.append(surface);
    if (!state.expanded || !target) {
      surface.textContent = 'Expand the preview pane to show the Windows preview.';
      return;
    }
    await nextLayoutTick();
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) return;
    const opened = await host.fileCapability('preview-native-open', { path: target, rect: nativePreviewRect(surface) }).catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      if (opened && opened.ok && typeof opened.sessionId === 'string') void host.fileCapability('preview-native-close', { sessionId: opened.sessionId }).catch(() => {});
      return;
    }
    if (!opened || !opened.ok || typeof opened.sessionId !== 'string') {
      surface.textContent = opened && opened.message ? opened.message : 'Windows preview could not be hosted.';
      return;
    }
    state.nativePreviewSessionId = opened.sessionId;
    const move = () => {
      if (!state.nativePreviewSessionId || !state.expanded) return;
      void host.fileCapability('preview-native-move', { sessionId: state.nativePreviewSessionId, rect: nativePreviewRect(surface) }).catch(() => {});
    };
    if (typeof ResizeObserver === 'function') {
      state.nativePreviewObserver = new ResizeObserver(move);
      state.nativePreviewObserver.observe(surface);
    }
    documentRef.defaultView?.addEventListener('resize', move, { passive: true, once: true });
  }

  async function startPdfPreview(data) {
    const target = state.inspectedPath;
    const generation = state.inspectGeneration;
    const resourceId = typeof data.resourceId === 'string' ? data.resourceId : null;
    const surface = documentRef.createElement('div');
    surface.className = 'file-capability-native-preview';
    preview.append(surface);
    if (!resourceId) {
      surface.textContent = 'PDF preview resource is unavailable.';
      return;
    }
    if (!state.expanded || !target) {
      surface.textContent = 'Expand the preview pane to show the PDF.';
      return;
    }
    await nextLayoutTick();
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      releasePreviewResource(resourceId);
      return;
    }
    await state.pdfPreviewClosePromise.catch(() => {});
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      releasePreviewResource(resourceId);
      return;
    }

    if (state.previewResourceId === resourceId) state.previewResourceId = null;
    const opened = await host.fileCapability('preview-pdf-open', {
      resourceId,
      rect: nativePreviewRect(surface),
      stateKey: typeof data.previewStateKey === 'string' ? data.previewStateKey : undefined,
    }).catch((error) => {
      releasePreviewResource(resourceId);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    });
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      if (opened && opened.ok && typeof opened.sessionId === 'string') {
        void host.fileCapability('preview-pdf-close', { sessionId: opened.sessionId }).catch(() => {});
      } else {
        releasePreviewResource(resourceId);
      }
      return;
    }
    if (!opened || !opened.ok || typeof opened.sessionId !== 'string') {
      releasePreviewResource(resourceId);
      surface.textContent = opened && opened.message ? opened.message : 'PDF preview could not be hosted.';
      return;
    }
    state.pdfPreviewSessionId = opened.sessionId;
    const move = () => {
      if (!state.pdfPreviewSessionId || !state.expanded) return;
      void host.fileCapability('preview-pdf-move', {
        sessionId: state.pdfPreviewSessionId,
        rect: nativePreviewRect(surface),
      }).catch(() => {});
    };
    if (typeof ResizeObserver === 'function') {
      state.pdfPreviewObserver = new ResizeObserver(move);
      state.pdfPreviewObserver.observe(surface);
    }
    documentRef.defaultView?.addEventListener('resize', move, { passive: true, once: true });
  }

  async function startHtmlPreview(data) {
    const target = state.inspectedPath;
    const generation = state.inspectGeneration;
    const resourceId = typeof data.resourceId === 'string' ? data.resourceId : null;
    const surface = documentRef.createElement('div');
    surface.className = 'file-capability-native-preview';
    preview.append(surface);
    if (!resourceId) {
      surface.textContent = 'Interactive HTML preview resource is unavailable.';
      return;
    }
    if (!state.expanded || !target) {
      surface.textContent = 'Expand the preview pane to use this page.';
      return;
    }
    await nextLayoutTick();
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      releasePreviewResource(resourceId);
      return;
    }

    if (state.previewResourceId === resourceId) state.previewResourceId = null;
    const opened = await host.fileCapability('preview-html-open', {
      resourceId,
      rect: nativePreviewRect(surface),
    }).catch((error) => {
      releasePreviewResource(resourceId);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    });
    if (generation !== state.inspectGeneration || state.inspectedPath !== target) {
      if (opened && opened.ok && typeof opened.sessionId === 'string') {
        void host.fileCapability('preview-html-close', { sessionId: opened.sessionId }).catch(() => {});
      } else {
        releasePreviewResource(resourceId);
      }
      return;
    }
    if (!opened || !opened.ok || typeof opened.sessionId !== 'string') {
      releasePreviewResource(resourceId);
      surface.textContent = opened && opened.message ? opened.message : 'Interactive HTML preview could not be hosted.';
      return;
    }
    state.htmlPreviewSessionId = opened.sessionId;
    const move = () => {
      if (!state.htmlPreviewSessionId || !state.expanded) return;
      void host.fileCapability('preview-html-move', {
        sessionId: state.htmlPreviewSessionId,
        rect: nativePreviewRect(surface),
      }).catch(() => {});
    };
    if (typeof ResizeObserver === 'function') {
      state.htmlPreviewObserver = new ResizeObserver(move);
      state.htmlPreviewObserver.observe(surface);
    }
    documentRef.defaultView?.addEventListener('resize', move, { passive: true, once: true });
  }

  function renderPreview(result) {
    clearPreview();
    state.lastPreviewResult = result;
    if (!result || !result.ok) {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty file-capability-error';
      message.textContent = result && result.message ? result.message : 'This item could not be inspected.';
      preview.append(message);
      return;
    }
    const data = result.preview || {};
    if (data.kind === 'windows-preview-handler') {
      void startNativePreview(data);
      return;
    }
    if (typeof data.resourceId === 'string') state.previewResourceId = data.resourceId;
    if (data.kind === 'hosted-pdf') {
      void startPdfPreview(data);
      return;
    }
    if (data.kind === 'hosted-html') {
      void startHtmlPreview(data);
      return;
    }
    if (data.kind === 'image') {
      const source = previewSource(data);
      if (source) {
        renderImagePreview(source);
        return;
      }
    }
    if (data.kind === 'pdf') {
      const source = previewSource(data);
      if (source) {
        const frame = documentRef.createElement('iframe');
        frame.src = source;
        frame.title = itemTitle.textContent || 'PDF preview';
        frame.className = 'file-capability-preview-frame';
        preview.append(frame);
        return;
      }
    }
    if (data.kind === 'audio' || data.kind === 'video') {
      const source = previewSource(data);
      if (source) {
        const media = documentRef.createElement(data.kind);
        media.src = source;
        media.controls = true;
        media.preload = 'metadata';
        media.className = 'file-capability-preview-' + data.kind;
        preview.append(media);
        return;
      }
    }
    if (data.kind === 'text') {
      const scroller = documentRef.createElement('div');
      scroller.className = 'file-capability-text-scroller';
      const pre = documentRef.createElement('pre');
      pre.className = 'file-capability-preview-text';
      pre.textContent = data.text || '';
      scroller.append(pre);
      preview.append(scroller);

      let nextOffset = Number.isSafeInteger(data.nextOffset) ? data.nextOffset : 0;
      let eof = data.eof === true;
      let loading = false;
      const target = state.inspectedPath;
      const generation = state.inspectGeneration;
      const loadMore = async () => {
        if (loading || eof || !target || generation !== state.inspectGeneration || state.inspectedPath !== target) return;
        loading = true;
        try {
          const chunk = await host.fileCapability('preview-text-chunk', {
            path: target,
            offset: nextOffset,
          });
          if (generation !== state.inspectGeneration || state.inspectedPath !== target) return;
          if (!chunk || !chunk.ok) throw new Error(chunk && chunk.message ? chunk.message : 'Could not continue text preview.');
          if (typeof chunk.text === 'string') pre.textContent += chunk.text;
          if (Number.isSafeInteger(chunk.nextOffset)) nextOffset = chunk.nextOffset;
          eof = chunk.eof === true;
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
          eof = true;
        } finally {
          loading = false;
        }
      };
      scroller.addEventListener('scroll', () => {
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 320) void loadMore();
      }, { passive: true });
      if (!eof && scroller.scrollHeight <= scroller.clientHeight + 320) void loadMore();
      return;
    }
    if (data.kind === 'directory') {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty';
      message.textContent = 'Folder navigation stays in your file manager.';
      preview.append(message);
      return;
    }
    if (data.kind === 'binary') {
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty';
      message.textContent = 'No visual preview available yet.';
      preview.append(message);
      return;
    }
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = 'No preview data was returned.';
    preview.append(message);
  }

  function escapeHtmlAttribute(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderObsidianMarkdown(result) {
    clearPreview();
    const frame = documentRef.createElement('iframe');
    frame.className = 'file-capability-obsidian-markdown';
    frame.title = itemTitle.textContent || 'Obsidian Markdown preview';
    frame.setAttribute('sandbox', 'allow-same-origin');
    const bodyClass = escapeHtmlAttribute(result.bodyClass || '');
    const previewClass = escapeHtmlAttribute(result.previewClass || 'markdown-preview-view markdown-rendered is-readable-line-width');
    const variables = typeof result.variables === 'string' ? result.variables : '';
    const obsidianCss = typeof result.css === 'string'
      ? result.css.replace(/<\/style/gi, '<\\/style')
      : '';
    const html = typeof result.html === 'string' ? result.html : '';
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
      :root{${variables}}
      ${obsidianCss}
      html,body{margin:0!important;width:100%!important;min-height:100%!important;overflow:hidden!important;background:var(--background-primary)!important;color:var(--text-normal)!important}
      body{box-sizing:border-box!important;padding:16px!important}
      .markdown-reading-view{position:static!important;display:block!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;transform:none!important}
      .markdown-reading-view>.markdown-preview-view{position:static!important;display:block!important;box-sizing:border-box!important;width:100%!important;max-width:none!important;height:auto!important;min-height:100%!important;overflow:visible!important;color:var(--text-normal)!important;font-family:var(--font-text)!important}
      .markdown-reading-view h1{color:var(--h1-color,var(--text-normal))!important}
      .markdown-reading-view h2{color:var(--h2-color,var(--text-normal))!important}
      .markdown-reading-view h3{color:var(--h3-color,var(--text-normal))!important}
      .markdown-reading-view h4{color:var(--h4-color,var(--text-normal))!important}
      .markdown-reading-view h5{color:var(--h5-color,var(--text-normal))!important}
      .markdown-reading-view h6{color:var(--h6-color,var(--text-normal))!important}
      .markdown-reading-view img{max-width:100%!important;height:auto}
      .markdown-reading-view pre,.markdown-reading-view table{max-width:100%}
      .papers-markdown-autoscroll-indicator{position:fixed!important;z-index:2147483647!important;width:20px!important;height:20px!important;margin:-10px 0 0 -10px!important;border:1px solid var(--background-modifier-border-focus,var(--background-modifier-border))!important;border-radius:999px!important;background:var(--background-secondary)!important;box-shadow:0 4px 14px rgba(0,0,0,.35)!important;pointer-events:none!important}
      .papers-markdown-autoscroll-indicator::before{content:'';position:absolute;inset:5px;border:1px solid var(--text-muted)!important;border-radius:999px;opacity:.8}
      html.papers-markdown-autoscrolling,html.papers-markdown-autoscrolling *{cursor:all-scroll!important}
    </style></head><body class="${bodyClass}"><div class="markdown-reading-view"><div class="${previewClass}">${html}</div></div></body></html>`;
    preview.append(frame);
    frame.addEventListener('load', () => {
      const child = frame.contentDocument;
      if (!child?.documentElement || !child.body) return;
      let scale = 1;
      const resizeToContent = () => {
        frame.style.height = '1px';
        const height = Math.max(260, child.documentElement.scrollHeight, child.body.scrollHeight);
        frame.style.height = `${Math.ceil(height)}px`;
      };
      const applyScale = (nextScale) => {
        scale = Math.max(0.5, Math.min(2, nextScale));
        child.documentElement.style.zoom = String(scale);
        resizeToContent();
      };
      child.addEventListener('wheel', (event) => {
        if (event.ctrlKey) {
          event.preventDefault();
          applyScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
          return;
        }
        if (event.deltaY) {
          event.preventDefault();
          preview.scrollTop += event.deltaY;
        }
        if (event.deltaX) preview.scrollLeft += event.deltaX;
      }, { passive: false });
      const childView = child.defaultView || windowRef;
      const indicator = child.createElement('div');
      indicator.className = 'papers-markdown-autoscroll-indicator';
      indicator.hidden = true;
      child.body.append(indicator);
      let autoscroll = null;
      let autoscrollFrame = 0;
      const axisSpeed = (delta) => {
        const magnitude = Math.max(0, Math.abs(delta) - 10);
        return magnitude === 0 ? 0 : Math.sign(delta) * Math.min(36, magnitude * 0.16);
      };
      const stopAutoscroll = () => {
        autoscroll = null;
        indicator.hidden = true;
        child.documentElement.classList.remove('papers-markdown-autoscrolling');
        if (autoscrollFrame) childView?.cancelAnimationFrame?.(autoscrollFrame);
        autoscrollFrame = 0;
      };
      const tickAutoscroll = () => {
        if (!autoscroll || !frame.isConnected) {
          stopAutoscroll();
          return;
        }
        preview.scrollBy(
          axisSpeed(autoscroll.x - autoscroll.originX),
          axisSpeed(autoscroll.y - autoscroll.originY),
        );
        autoscrollFrame = childView?.requestAnimationFrame?.(tickAutoscroll) || 0;
      };
      child.addEventListener('pointerdown', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          if (autoscroll) {
            stopAutoscroll();
            return;
          }
          autoscroll = {
            originX: event.clientX,
            originY: event.clientY,
            x: event.clientX,
            y: event.clientY,
          };
          indicator.style.left = event.clientX + 'px';
          indicator.style.top = event.clientY + 'px';
          indicator.hidden = false;
          child.documentElement.classList.add('papers-markdown-autoscrolling');
          autoscrollFrame = childView?.requestAnimationFrame?.(tickAutoscroll) || 0;
          return;
        }
        if (autoscroll) stopAutoscroll();
      }, { capture: true });
      child.addEventListener('pointermove', (event) => {
        if (!autoscroll) return;
        autoscroll.x = event.clientX;
        autoscroll.y = event.clientY;
      }, { passive: true });
      child.addEventListener('auxclick', (event) => {
        if (event.button === 1) event.preventDefault();
      }, { capture: true });
      child.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && autoscroll) stopAutoscroll();
      });
      childView?.addEventListener?.('blur', stopAutoscroll);
      state.markdownAutoscrollCancel = stopAutoscroll;
      resizeToContent();
      state.markdownPreviewObserver = new ResizeObserver(resizeToContent);
      state.markdownPreviewObserver.observe(child.body);
    }, { once: true });
  }

  function renderEmptySelection(selectionCount = 0) {
    ++state.inspectGeneration;
    state.context = null;
    state.inspectedPath = null;
    state.inspectedUrl = null;
    state.lastPreviewResult = null;
    disarmDelete();
    renameRow.hidden = true;
    itemTitle.textContent = selectionCount > 0 ? `${selectionCount} item${selectionCount === 1 ? '' : 's'} selected` : 'Select a file';
    itemMeta.textContent = selectionCount > 0 ? 'No local file content in this selection yet.' : '';
    pathText.textContent = selectionCount > 0 ? 'Selection stays fully controlled by As you Go.' : 'Select a local file or folder in As you Go.';
    copyPathButton.hidden = true;
    revealButton.hidden = true;
    openTabButton.hidden = true;
    actions.hidden = true;
    clearPreview();
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = selectionCount > 0
      ? 'The file pane is observing this selection without changing how AYG selection or dragging works.'
      : 'Preview appears here.';
    preview.append(message);
  }

  function renderMultipleSelection(selection) {
    ++state.inspectGeneration;
    state.context = null;
    state.inspectedPath = null;
    state.lastPreviewResult = null;
    const count = Number.isSafeInteger(selection?.selectionCount) ? selection.selectionCount : selection.items.length;
    itemTitle.textContent = `${count} items selected`;
    itemMeta.textContent = '';
    pathText.textContent = 'Multiple preview is not defined yet.';
    copyPathButton.hidden = true;
    revealButton.hidden = true;
    openTabButton.hidden = true;
    clearPreview();
    const message = documentRef.createElement('p');
    message.className = 'file-capability-empty';
    message.textContent = 'Multiple preview will take shape here.';
    preview.append(message);
  }

  async function inspectPath(target, context) {
    if (!isAbsoluteWindowsPath(target)) return false;
    const generation = ++state.inspectGeneration;
    state.inspectedPath = target;
    state.inspectedUrl = null;
    if (context !== undefined) state.context = context;
    disarmDelete();
    renameRow.hidden = true;
    itemTitle.textContent = basename(target) || target;
    itemMeta.textContent = 'Loading…';
    pathText.textContent = target;
    copyPathButton.hidden = false;
    revealButton.hidden = false;
    openTabButton.hidden = state.fullPage || !state.expanded;
    state.lastPreviewResult = null;
    actions.hidden = false;
    clearPreview();
    const loading = documentRef.createElement('p');
    loading.className = 'file-capability-empty';
    loading.textContent = 'Loading preview…';
    preview.append(loading);

    const result = await host.fileCapability('preview', { path: target }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (generation !== state.inspectGeneration) {
      const staleResourceId = result && result.preview && typeof result.preview.resourceId === 'string'
        ? result.preview.resourceId
        : null;
      if (staleResourceId) releasePreviewResource(staleResourceId);
      return false;
    }
    renderEntry(result && result.entry);
    if (
      result?.ok === true
      && result?.preview?.kind === 'text'
      && /\.(?:md|markdown)$/i.test(target)
    ) {
      const obsidian = await host.fileCapability('preview-markdown-obsidian', { path: target }).catch(() => null);
      if (generation !== state.inspectGeneration || state.inspectedPath !== target) return false;
      if (obsidian?.ok && typeof obsidian.html === 'string') {
        renderObsidianMarkdown(obsidian);
        return true;
      }
    }
    renderPreview(result);
    return result && result.ok === true;
  }

  function renderSearchResults(result, query) {
    resultsList.replaceChildren();
    if (!query) {
      resultsPane.hidden = true;
      resultsStatus.textContent = 'Type to search the whole machine.';
      return;
    }
    resultsPane.hidden = false;
    if (!result || !result.ok) {
      resultsStatus.textContent = result && result.message ? result.message : 'Everything search is unavailable.';
      return;
    }
    const rows = Array.isArray(result.results) ? result.results : [];
    const total = Number.isFinite(result.total) ? result.total : rows.length;
    resultsStatus.textContent = total.toLocaleString() + ' result' + (total === 1 ? '' : 's');
    for (const entry of rows) {
      const button = createButton(documentRef, '', 'file-capability-result');
      const name = documentRef.createElement('strong');
      name.textContent = entry.name;
      const parent = documentRef.createElement('span');
      parent.textContent = dirname(entry.path);
      const meta = documentRef.createElement('small');
      meta.textContent = entry.kind === 'folder' ? 'Folder' : formatBytes(entry.size);
      button.append(name, parent, meta);
      button.addEventListener('click', () => void inspectPath(entry.path, null));
      resultsList.append(button);
    }
    if (!rows.length) {
      const empty = documentRef.createElement('p');
      empty.className = 'file-capability-empty';
      empty.textContent = 'No matches.';
      resultsList.append(empty);
    }
  }

  async function runSearch(query) {
    const generation = ++state.searchGeneration;
    const trimmed = query.trim();
    if (!trimmed) {
      renderSearchResults({ ok: true, results: [], total: 0 }, '');
      return;
    }
    resultsStatus.textContent = 'Searching…';
    const result = await host.fileCapability('search', { query: trimmed, limit: 150 }).catch((error) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      results: [],
    }));
    if (generation !== state.searchGeneration) return;
    renderSearchResults(result, trimmed);
  }

  async function chooseDestination() {
    const picked = await host.pickTarget('folder').catch(() => null);
    const target = normalizePickerTarget(picked);
    return isAbsoluteWindowsPath(target) ? target : null;
  }

  async function verifyAndRetarget(oldPath, expectedPath) {
    if (!state.context || !state.context.shortcutId) return false;
    const verified = await waitForPathState(host, { present: expectedPath, absent: oldPath });
    if (!verified) return false;
    const nextName = state.context.name === basename(oldPath) ? basename(expectedPath) : state.context.name;
    const changed = await retargetShortcut({
      shortcutId: state.context.shortcutId,
      oldPath,
      newPath: expectedPath,
      nextName,
    });
    if (changed) state.context = { shortcutId: state.context.shortcutId, path: expectedPath, name: nextName };
    return changed;
  }

  function setExpandedWithPreviewLifecycle(expanded) {
    const next = Boolean(expanded);
    if (next === state.expanded) return;
    setExpanded(next);
    if (!next) {
      closeNativePreview();
      closePdfPreview();
      closeHtmlPreview();
    }
    else if (state.lastPreviewResult?.preview?.kind === 'windows-preview-handler') renderPreview(state.lastPreviewResult);
    else if (['hosted-pdf', 'hosted-html'].includes(state.lastPreviewResult?.preview?.kind) && state.inspectedPath) {
      void inspectPath(state.inspectedPath, state.context);
    }
  }
  expandButton.addEventListener('click', () => {
    setExpandedWithPreviewLifecycle(!state.expanded);
  });
  openTabButton.addEventListener('click', async () => {
    if (!state.inspectedPath || !windowRef || typeof host.openNewSurface !== 'function') return;
    try {
      const iconResult = await host.fileCapability('icon', { path: state.inspectedPath }).catch(() => null);
      const payload = {
        path: state.inspectedPath,
        name: itemTitle.textContent || basename(state.inspectedPath),
        previewIcon: iconResult?.ok && typeof iconResult.icon === 'string' ? iconResult.icon : null,
        workspaceTitle: documentRef.title,
        workspaceIcon: documentRef.head.querySelector('link[data-papers-tab-icon]')?.getAttribute('href') || null,
      };
      const launch = await host.fileCapability('preview-launch-create', payload);
      if (!launch?.ok || typeof launch.token !== 'string') throw new Error(launch?.message || 'Preview tab state could not be created.');
      const token = launch.token;
      try {
        windowRef.localStorage.setItem(FULL_PAGE_PREVIEW_STORAGE_PREFIX + token, JSON.stringify(payload));
      } catch { /* optional same-partition fallback only */ }
      const next = new URL(windowRef.location.href);
      next.searchParams.set(FULL_PAGE_PREVIEW_PARAM, token);
      void host.openNewSurface(next.toString()).catch((error) => {
        setStatus(error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });
  resizer.addEventListener('pointerdown', (event) => {
    if (!state.expanded || event.button !== 0) return;
    state.resizing = true;
    panel.classList.add('resizing');
    resizer.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  });
  resizer.addEventListener('pointermove', (event) => {
    if (!state.resizing) return;
    const viewportWidth = documentRef.defaultView?.innerWidth ?? 0;
    if (viewportWidth > 0) setPanelWidth(viewportWidth - event.clientX - 8);
    event.preventDefault();
  });
  const finishResize = (event) => {
    if (!state.resizing) return;
    state.resizing = false;
    panel.classList.remove('resizing');
    if (resizer.hasPointerCapture?.(event.pointerId)) resizer.releasePointerCapture?.(event.pointerId);
  };
  resizer.addEventListener('pointerup', finishResize);
  resizer.addEventListener('pointercancel', finishResize);
  searchInput.addEventListener('input', () => {
    if (state.searchTimer) clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.searchTimer = null;
      void runSearch(searchInput.value);
    }, SEARCH_DEBOUNCE_MS);
  });

  copyPathButton.addEventListener('click', () => {
    const value = state.inspectedPath || state.inspectedUrl;
    if (!value) return;
    void host.copyText(value)
      .then(() => setStatus('Path copied.', { level: 'success' }))
      .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  });
  openButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    void host.fileCapability('open', { path: state.inspectedPath }).then((result) => {
      if (!result || !result.ok) setStatus(result && result.message ? result.message : 'Could not open that item.');
    });
  });
  revealButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    void host.fileCapability('reveal', { path: state.inspectedPath }).then((result) => {
      if (!result || !result.ok) setStatus(result && result.message ? result.message : 'Could not reveal that item.');
    });
  });
  copyButton.addEventListener('click', async () => {
    const source = state.inspectedPath;
    const destination = source ? await chooseDestination() : null;
    if (!source || !destination) return;
    setBusy(copyButton, true, 'Copying…');
    try {
      const result = await host.fileCapability('copy', { paths: [source], destination });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Copy failed.');
      setStatus('Copy sent to Directory Opus.', { level: 'success' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(copyButton, false);
    }
  });
  moveButton.addEventListener('click', async () => {
    const source = state.inspectedPath;
    const destination = source ? await chooseDestination() : null;
    if (!source || !destination) return;
    const expected = joinPath(destination, basename(source));
    setBusy(moveButton, true, 'Moving…');
    try {
      const result = await host.fileCapability('move', { paths: [source], destination });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Move failed.');
      const retargeted = await verifyAndRetarget(source, expected);
      if (state.context && state.context.shortcutId && !retargeted) {
        setStatus('Move was submitted, but the new path was not verified; the AYG reference was left unchanged.');
        return;
      }
      setStatus('Moved with Directory Opus.', { level: 'success' });
      await inspectPath(expected, state.context);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(moveButton, false);
    }
  });
  renameButton.addEventListener('click', () => {
    if (!state.inspectedPath) return;
    renameInput.value = basename(state.inspectedPath);
    renameRow.hidden = false;
    renameInput.focus();
    renameInput.select();
  });
  renameCancel.addEventListener('click', () => { renameRow.hidden = true; });
  renameRow.addEventListener('submit', async (event) => {
    event.preventDefault();
    const source = state.inspectedPath;
    const newName = renameInput.value.trim();
    if (!source || !newName || newName === basename(source)) {
      renameRow.hidden = true;
      return;
    }
    const expected = joinPath(dirname(source), newName);
    setBusy(renameSave, true, 'Renaming…');
    try {
      const result = await host.fileCapability('rename', { path: source, newName });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Rename failed.');
      const retargeted = await verifyAndRetarget(source, expected);
      if (state.context && state.context.shortcutId && !retargeted) {
        setStatus('Rename was submitted, but the new path was not verified; the AYG reference was left unchanged.');
        return;
      }
      renameRow.hidden = true;
      setStatus('Renamed with Directory Opus.', { level: 'success' });
      await inspectPath(expected, state.context);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(renameSave, false);
    }
  });
  deleteButton.addEventListener('pointerleave', disarmDelete);
  deleteButton.addEventListener('click', async () => {
    const target = state.inspectedPath;
    if (!target) return;
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      deleteButton.classList.add('armed');
      deleteButton.textContent = 'Delete again';
      return;
    }
    disarmDelete();
    setBusy(deleteButton, true, 'Deleting…');
    try {
      const result = await host.fileCapability('delete', { paths: [target] });
      if (!result || !result.ok) throw new Error(result && result.message ? result.message : 'Delete failed.');
      const removed = await waitForPathState(host, { absent: target });
      if (!removed) {
        setStatus('Directory Opus accepted the recycle request, but disappearance was not verified.');
        return;
      }
      setStatus('Moved to Recycle Bin. The AYG reference was kept.', { level: 'success' });
      itemMeta.textContent = 'Missing';
      clearPreview();
      const message = documentRef.createElement('p');
      message.className = 'file-capability-empty';
      message.textContent = 'The file is now in Recycle Bin. This As you Go reference is still here.';
      preview.append(message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(deleteButton, false);
    }
  });

  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('click', (event) => event.stopPropagation());

  function syncSelection(selection) {
    if (state.fullPage) return;
    if (selection?.mode === 'web') {
      renderWebSelection(selection.item);
      return;
    }
    if (selection?.mode === 'multiple') {
      renderMultipleSelection({
        selectionCount: selection.selectionCount,
        items: Array.isArray(selection.items) ? selection.items.filter((entry) => isAbsoluteWindowsPath(entry?.path)) : [],
      });
      return;
    }
    if (selection?.mode === 'empty') {
      renderEmptySelection(selection.selectionCount ?? 0);
      return;
    }
    const source = selection?.mode === 'single' ? selection.item : selection;
    const next = source && isAbsoluteWindowsPath(source.path)
      ? { shortcutId: source.shortcutId || null, path: source.path, name: source.name || basename(source.path) }
      : null;
    const same = next && state.context
      && next.shortcutId === state.context.shortcutId
      && next.path === state.context.path;
    state.context = next;
    if (!next) {
      renderEmptySelection(0);
      return;
    }
    if (!same || state.inspectedPath !== next.path) void inspectPath(next.path, next);
  }

  function refreshPreviewGeometry() {
    if (!state.expanded) return;
    const surface = preview.querySelector('.file-capability-native-preview');
    if (!surface) return;
    const rect = nativePreviewRect(surface);
    if (state.nativePreviewSessionId) {
      void host.fileCapability('preview-native-move', {
        sessionId: state.nativePreviewSessionId,
        rect,
      }).catch(() => {});
    }
    if (state.pdfPreviewSessionId) {
      void host.fileCapability('preview-pdf-move', {
        sessionId: state.pdfPreviewSessionId,
        rect,
      }).catch(() => {});
    }
    if (state.htmlPreviewSessionId) {
      void host.fileCapability('preview-html-move', {
        sessionId: state.htmlPreviewSessionId,
        rect,
      }).catch(() => {});
    }
    if (state.browserSessionId) {
      void host.fileCapability('browser-move', {
        sessionId: state.browserSessionId,
        rect,
      }).catch(() => {});
    }
  }

  const api = Object.freeze({
    syncSelection,
    previewPath(path, name = basename(path)) {
      if (!isAbsoluteWindowsPath(path)) return false;
      return inspectPath(path, { shortcutId: null, path, name });
    },
    openSearch() {
      setExpandedWithPreviewLifecycle(true);
    },
    setExpanded: setExpandedWithPreviewLifecycle,
    refreshPreviewGeometry,
    destroy() {
      if (state.searchTimer) clearTimeout(state.searchTimer);
      clearPreview();
      workspace?.classList.remove('file-capability-docked', 'file-capability-expanded');
      workspace?.style.removeProperty('--file-capability-width');
      documentRef.body.classList.remove('file-capability-full-page');
      panel.remove();
    },
    isOpen: () => true,
    isExpanded: () => state.expanded,
    isFullPage: () => state.fullPage,
  });

  if (launchedPreview) {
    setExpanded(true);
    expandButton.hidden = true;
    openTabButton.hidden = true;
    state.context = { shortcutId: null, path: launchedPreview.path, name: launchedPreview.name };
    queueMicrotask(() => void inspectPath(launchedPreview.path, state.context));
  } else if (launchToken) {
    setExpanded(true);
    expandButton.hidden = true;
    openTabButton.hidden = true;
    queueMicrotask(async () => {
      const resolved = await host.fileCapability('preview-launch-resolve', { token: launchToken });
      if (!resolved?.ok || !isAbsoluteWindowsPath(resolved.path)) {
        setStatus(resolved?.message || 'Preview launch state is unavailable.');
        return;
      }
      const name = resolved.name || basename(resolved.path);
      if (name) documentRef.title = name;
      if (typeof resolved.previewIcon === 'string' && resolved.previewIcon) {
        let favicon = documentRef.head.querySelector('link[data-papers-tab-icon]');
        if (!favicon) {
          favicon = documentRef.createElement('link');
          favicon.rel = 'icon';
          favicon.setAttribute('data-papers-tab-icon', 'true');
          documentRef.head.append(favicon);
        }
        favicon.setAttribute('href', resolved.previewIcon);
      }
      state.context = { shortcutId: null, path: resolved.path, name };
      await inspectPath(resolved.path, state.context);
    });
  }
  return api;
}
