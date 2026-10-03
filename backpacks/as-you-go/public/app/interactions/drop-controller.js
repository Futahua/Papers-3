/** Owns the external file/URL drop gesture. It keeps DOM target detection,
 * DataTransfer parsing, hover classes, and event cancellation, then delegates
 * host resolution, document creation, commits, and status reporting to the
 * drop commands. Cleanup (removing hover classes) runs in finally. */
export function createDropController({
  document,
  elements,
  store,
  commands,
}) {
  const INLINE_NATIVE_ITEMS = 'application/x-papers-native-items';
  let abortController = null;

  function clearHoverClasses() {
    document.querySelectorAll('.drop-inside, .graph-drop-target').forEach((node) =>
      node.classList.remove('drop-inside', 'graph-drop-target'));
  }

  /** Pulls the first http(s) URL out of dropped text — dataTransfer's
   * text/uri-list is the canonical source when the browser provides it (a
   * dragged link), but a plain text/plain selection (e.g. a URL the user
   * highlighted and dragged, possibly with surrounding text) needs scanning
   * for the first URL-looking token instead of being used verbatim. */
  function extractDroppedUrl(dataTransfer) {
    const uriList = dataTransfer.getData('text/uri-list').trim();
    if (uriList) {
      const firstLine = uriList.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
      if (firstLine) return firstLine.trim();
    }
    const plain = dataTransfer.getData('text/plain').trim();
    const match = plain.match(/https?:\/\/\S+/i);
    return match ? match[0] : plain;
  }

  function destinationFor(event) {
    const session = store.getSession();
    const tile = event.target.closest('.icon-item');
    const blank = event.target.closest('[data-blank-parent]');
    return tile?.dataset.kind === 'group'
      ? tile.dataset.id
      : blank?.dataset.blankParent ?? session.currentId;
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;

    elements.grid.addEventListener('dragover', (event) => {
      if (store.getSession().binMode) return;
      event.preventDefault();
      clearHoverClasses();
      const types = event.dataTransfer.types;
      if (types.includes('Files') || types.includes('text/plain') || types.includes('text/uri-list') || types.includes(INLINE_NATIVE_ITEMS)) {
        const tile = event.target.closest('.icon-item');
        const shell = tile?.closest('.graph-node-shell');
        if (tile?.dataset.kind === 'group' && shell) {
          shell.classList.add('graph-drop-target');
          tile.classList.add('drop-inside');
        }
        event.dataTransfer.dropEffect = 'link';
        return;
      }
      event.dataTransfer.dropEffect = 'none';
    }, { signal });

    elements.grid.addEventListener('dragleave', (event) => {
      if (!elements.grid.contains(event.relatedTarget)) clearHoverClasses();
    }, { signal });

    elements.grid.addEventListener('drop', async (event) => {
      if (store.getSession().binMode) return;
      const droppedFiles = [...event.dataTransfer.files];
      const destination = destinationFor(event);
      const inlineNative = event.dataTransfer.getData(INLINE_NATIVE_ITEMS);

      if (inlineNative) {
        event.preventDefault();
        try {
          const parsed = JSON.parse(inlineNative);
          const targets = Array.isArray(parsed) ? parsed : [];
          await commands.dropResolvedTargets(
            targets
              .filter((item) => typeof item?.target === 'string' && item.target)
              .map((item) => ({ target: item.target, name: typeof item.name === 'string' ? item.name : item.target })),
            destination,
          );
        } finally {
          clearHoverClasses();
        }
        return;
      }

      if (droppedFiles.length === 0) {
        const url = extractDroppedUrl(event.dataTransfer);
        if (!url) return;
        event.preventDefault();
        try {
          await commands.dropUrl(url, destination);
        } finally {
          clearHoverClasses();
        }
        return;
      }

      event.preventDefault();
      try {
        await commands.dropFiles(droppedFiles, destination);
      } finally {
        clearHoverClasses();
      }
    }, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy };
}
