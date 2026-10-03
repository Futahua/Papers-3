/** Owns the editor dialog: its session state (mode, item, chosen icon,
 * resolved target icon), the form/icon/target UI, and the save path that
 * updates or creates groups, shortcuts, and web links. Reads workspace state
 * through getState and commits through the injected commit(), so it never
 * mutates shared state directly. Also owns the linked-shortcut fork decision
 * layer that save can route through. */
export function createEditorDialog({
  elements,
  document,
  getState,
  getCurrentId,
  closeMenu,
  host,
  iconCache,
  compressIconFile,
  hydrateWebPreview,
  commit,
  commitWhenWorkspaceReady = commit,
  render,
  shortcut,
  isWebLink,
  placementCount,
  forkPlacement,
  anyActivePlacementId,
  visiblePlacementIdFor,
  updateGroup,
  createGroup,
  updateWebLink,
  createWebLink,
  updateShortcut,
  createShortcut,
}) {
  let editorMode = null;
  let editorIcon = null;
  let editorTargetIcon = null;
  let abortController = null;

  function showIconPreview(source) {
    if (!source) {
      elements.iconPreview.hidden = true;
      elements.iconFallback.removeAttribute('hidden');
      return;
    }
    elements.iconPreview.hidden = false;
    elements.iconPreview.src = source;
    elements.iconFallback.setAttribute('hidden', '');
  }

  async function resolveEditorTargetIcon() {
    if (editorIcon) return showIconPreview(editorIcon);
    if (editorTargetIcon) return showIconPreview(editorTargetIcon);
    if (editorMode?.kind === 'web') {
      const target = elements.target.value.trim();
      if (target) {
        return hydrateWebPreview(elements.iconPreview, elements.iconFallback, target);
      }
      return showIconPreview(null);
    }
    if (editorMode?.kind === 'shortcut' && editorMode.item?.id) {
      try {
        editorTargetIcon = await host.shortcutIcon({
          actionId: editorMode.item.id,
        });
      } catch {
        editorTargetIcon = null;
      }
    }
    showIconPreview(editorTargetIcon);
  }

  function showEditor(kind, existing = null, parentId = getCurrentId()) {
    closeMenu();
    const representedPlacementId =
      (kind === 'shortcut' || kind === 'web') && existing
        ? visiblePlacementIdFor(existing.id)
        : null;
    editorMode = { kind, item: existing, parentId, representedPlacementId };
    editorIcon = existing?.icon ?? null;
    editorTargetIcon =
      kind === 'shortcut' && existing && !existing.icon
        ? iconCache.get(existing.id) ?? null
        : null;
    elements.editorTitle.textContent = kind === 'group'
      ? existing ? 'Edit folder' : 'New folder'
      : kind === 'web'
        ? existing ? 'Edit web link' : 'Add web link'
        : existing ? 'Edit shortcut' : 'Add shortcut';
    elements.name.value = existing?.name ?? '';
    elements.description.value = existing?.description ?? '';
    elements.target.value = existing?.target ?? '';
    elements.descriptionLabel.hidden = kind === 'group';
    elements.targetFields.hidden = kind === 'group';
    elements.target.readOnly = kind !== 'web';
    elements.target.placeholder = kind === 'web' ? 'https://example.com' : '';
    elements.targetActions.hidden = kind === 'web';
    elements.iconFallback.textContent = kind === 'group' ? '▰' : '↗';
    elements.iconDefaultButton.textContent =
      kind === 'group' ? 'Use folder icon' : kind === 'web' ? 'Use website icon' : 'Use target icon';
    elements.iconInput.value = '';
    elements.editorError.textContent = '';
    elements.editorLayer.hidden = false;
    resolveEditorTargetIcon();
    elements.name.focus();
  }

  function hideEditor() {
    editorMode = null;
    editorIcon = null;
    editorTargetIcon = null;
    elements.editorLayer.hidden = true;
    elements.linkEditLayer.hidden = true;
  }

  async function chooseTarget(kind) {
    try {
      const result = await host.pickTarget(kind);
      if (!result) return;
      if (typeof result === 'string') {
        elements.target.value = result;
        editorTargetIcon = null;
      } else {
        if (!result.target) return;
        elements.target.value = result.target ?? '';
        editorTargetIcon = result.icon ?? null;
      }
      if (!editorIcon) showIconPreview(editorTargetIcon);
    } catch (error) {
      elements.editorError.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  function editedShortcutIsLinked() {
    if (editorMode?.kind !== 'shortcut' && editorMode?.kind !== 'web') return false;
    const existingId = editorMode.item?.id;
    if (!existingId) return false;
    const record = shortcut(existingId);
    return record ? placementCount(record) > 1 : false;
  }

  async function saveEditor() {
    if (!editorMode || elements.saveButton.disabled) return;
    if (editedShortcutIsLinked()) {
      elements.linkEditLayer.hidden = false;
      return;
    }
    await commitEditorSave(false);
  }

  async function commitEditorSave(forkFirst) {
    elements.saveButton.disabled = true;
    elements.saveButton.textContent = 'Saving…';
    try {
      let built = null;
      const buildNext = () => {
        const name = elements.name.value.trim();
        let workingState = getState();
        let editItemId = editorMode.item?.id;
        if (forkFirst && editItemId) {
          const representedPlacementId =
            editorMode.representedPlacementId ?? anyActivePlacementId(editItemId);
          if (representedPlacementId) {
            const knownIds = new Set(workingState.shortcuts.map((candidate) => candidate.id));
            workingState = forkPlacement(workingState, representedPlacementId);
            const forked = workingState.shortcuts.find((candidate) => !knownIds.has(candidate.id));
            if (forked) editItemId = forked.id;
          }
        }
        let next;
        if (editorMode.kind === 'group') {
          next = editorMode.item
            ? updateGroup(workingState, editorMode.item.id, { name, icon: editorIcon })
            : createGroup(workingState, name, editorMode.parentId, editorIcon);
        } else {
          const isNewShortcut = !editorMode.item && editorMode.kind === 'shortcut';
          const changes = {
            name,
            description: elements.description.value.trim(),
            target: elements.target.value.trim(),
            // A newly added shortcut defaults to the target's own Windows icon
            // (resolved when the target was picked) unless the creator chose a
            // project-owned image.
            icon: editorIcon ?? (isNewShortcut ? editorTargetIcon : null),
          };
          next = editorMode.kind === 'web'
            ? editorMode.item
              ? updateWebLink(workingState, editItemId, changes)
              : createWebLink(workingState, { ...changes, parentId: editorMode.parentId })
            : editorMode.item
              ? updateShortcut(workingState, editItemId, changes)
              : createShortcut(workingState, { ...changes, parentId: editorMode.parentId });
        }
        const editedShortcutId = editorMode.kind === 'group' ? null : editItemId;
        built = {
          next,
          editedShortcutId,
          refreshTargetIcon: Boolean(
            editedShortcutId
            && (!editorIcon || editorMode.item?.target !== elements.target.value.trim()),
          ),
        };
        return next;
      };
      buildNext();
      if (await commitWhenWorkspaceReady(() => buildNext(), 'Saved.')) {
        const { editedShortcutId, refreshTargetIcon } = built;
        if (refreshTargetIcon) {
          iconCache.delete(editedShortcutId);
          render();
        }
        hideEditor();
      }
    } catch (error) {
      elements.editorError.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent = 'Save';
    }
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;

    elements.editor.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveEditor();
    }, { signal });
    elements.saveButton.addEventListener('click', () => void saveEditor(), { signal });
    document.querySelector('#cancel-editor').addEventListener('click', hideEditor, { signal });
    document.querySelector('#pick-file').addEventListener('click', () => chooseTarget('file'), { signal });
    document.querySelector('#pick-folder').addEventListener('click', () => chooseTarget('folder'), { signal });
    elements.iconDefaultButton.addEventListener('click', () => {
      editorIcon = null;
      if (editorMode?.kind === 'group') editorTargetIcon = null;
      if (editorMode?.kind === 'web') {
        resolveEditorTargetIcon();
        return;
      }
      resolveEditorTargetIcon();
    }, { signal });
    elements.target.addEventListener('input', () => {
      if (editorMode?.kind !== 'web' || editorIcon) return;
      hydrateWebPreview(elements.iconPreview, elements.iconFallback, elements.target.value.trim());
    }, { signal });
    elements.iconInput.addEventListener('change', async () => {
      const file = elements.iconInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        elements.editorError.textContent = 'Choose an image file.';
        return;
      }
      elements.saveButton.disabled = true;
      elements.editorError.textContent = 'Preparing icon…';
      try {
        editorIcon = await compressIconFile(file);
        elements.editorError.textContent = '';
        showIconPreview(editorIcon);
      } catch (error) {
        elements.editorError.textContent =
          error instanceof Error ? error.message : String(error);
      } finally {
        elements.saveButton.disabled = false;
      }
    }, { signal });

    const iconDropZone = document.querySelector('.icon-choice');
    iconDropZone.addEventListener('dragover', (event) => {
      if (event.dataTransfer.types.includes('Files')) {
        event.preventDefault();
        event.stopPropagation();
        iconDropZone.classList.add('drag-over');
      }
    }, { signal });
    iconDropZone.addEventListener('dragleave', () => {
      iconDropZone.classList.remove('drag-over');
    }, { signal });
    iconDropZone.addEventListener('drop', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      iconDropZone.classList.remove('drag-over');
      const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (!file) {
        elements.editorError.textContent = 'Drop an image file.';
        return;
      }
      elements.saveButton.disabled = true;
      elements.editorError.textContent = 'Preparing icon…';
      try {
        editorIcon = await compressIconFile(file);
        elements.editorError.textContent = '';
        showIconPreview(editorIcon);
      } catch (error) {
        elements.editorError.textContent =
          error instanceof Error ? error.message : String(error);
      } finally {
        elements.saveButton.disabled = false;
      }
    }, { signal });

    document.querySelector('#cancel-link-edit').addEventListener('click', () => {
      elements.linkEditLayer.hidden = true;
    }, { signal });
    document.querySelector('#fork-link-edit').addEventListener('click', async () => {
      elements.linkEditLayer.hidden = true;
      await commitEditorSave(true);
    }, { signal });
    document.querySelector('#apply-everywhere-link-edit').addEventListener('click', async () => {
      elements.linkEditLayer.hidden = true;
      await commitEditorSave(false);
    }, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    hideEditor();
  }

  return { showEditor, hideEditor, saveEditor, mount, destroy };
}
