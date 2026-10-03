import {
  createItemSet,
  selectAllScope,
  setMembership,
  applyMembershipChanges,
  normalizeSetTitle,
} from '../sets-model.js';

/** Application command layer. Commands are the named user-intent operations
 * that coordinate session mutation, persistence, and narrow rendering/host
 * effects. They depend only on the store, model/host operations, and the
 * injected effect callbacks — never on UI components or browser events.
 * Event handlers and the menu map call these instead of orchestrating the
 * store inline. */
export function createWorkspaceCommands({
  store,
  group,
  // A persisted window-layout record lookup, mirroring group(): window
  // layouts are single-parent entities (copy/cut/move/bin/paste treat them
  // like folders, never like linked shortcut placements).
  windowLayout = () => null,
  shortcut,
  item,
  isWebLink,
  host,
  graph,
  resolveBinTargets,
  visiblePlacementIdFor,
  visibleParentCountFor,
  allActivePlacementIds,
  anyActivePlacementId,
  moveSelection,
  copySelection: copySelectionModel,
  collapsePlacements,
  binSelection,
  graphContextId,
  scopeRootId = null,
  isItemInScope = () => true,
  isDestinationInScope = () => true,
  removeGraphPositions,
  removeGraphRestPositions,
  setGraphPositions,
  createWebLink,
  createDroppedShortcuts,
  setItemSets,
  // Every folder an item sits inside. Supplied by the graph, which knows the
  // visible parentage — the stored folder tree cannot answer for a shortcut,
  // whose graph node is keyed by its shared record id rather than by any one
  // placement, so it would inherit nothing.
  ancestorsOfNode = null,
  // Whether an id is an ancestor of the current folder (Assignment 003:
  // the trail as ordinary folder contents). Ancestors are part of the
  // path here: the drag-drop commands refuse to bin or move them. They
  // never enter the selection by construction, so nothing else needs the
  // predicate.
  isAncestorItem = () => false,
  syncSelection,
  saveWorkspaceView,
  closeMenu,
  render,
  setStatus,
}) {
  let internalClipboardFingerprint = null;
  let internalClipboardFingerprintPending = false;

  async function readClipboardSnapshot() {
    try {
      const snapshot = await host.fileCapability?.('clipboard-read', {});
      return snapshot?.ok === true ? snapshot : null;
    } catch {
      return null;
    }
  }

  function rememberClipboardAtInternalCopy() {
    internalClipboardFingerprintPending = true;
    void readClipboardSnapshot()
      .then((snapshot) => { internalClipboardFingerprint = snapshot?.fingerprint ?? null; })
      .finally(() => { internalClipboardFingerprintPending = false; });
  }

  function scopeAllowsSelection(ids) {
    if (!scopeRootId || ids.every((id) => isItemInScope(id))) return true;
    setStatus('That item is outside this project folder.');
    return false;
  }

  function scopedDestination(destinationId) {
    return scopeRootId && destinationId === 'root' ? scopeRootId : destinationId;
  }

  function scopeAllowsDestination(destinationId) {
    if (!scopeRootId || isDestinationInScope(scopedDestination(destinationId))) return true;
    setStatus('That destination is outside this project folder.');
    return false;
  }

  /** Applies click / ctrl-click / shift-click selection rules. Takes plain
   * modifier flags and the ordered visible ids, not a DOM event. */
  function selectItem(itemId, { shiftKey, ctrlKey, visibleItemIds }) {
    const session = store.getSession();
    if (shiftKey && session.selectionAnchor) {
      const from = visibleItemIds.indexOf(session.selectionAnchor);
      const to = visibleItemIds.indexOf(itemId);
      if (from >= 0 && to >= 0) {
        if (!ctrlKey) store.clearSelection();
        const [start, end] = from < to ? [from, to] : [to, from];
        visibleItemIds.slice(start, end + 1).forEach((id) => store.addToSelection(id));
      }
    } else if (ctrlKey) {
      if (session.selected.has(itemId)) store.removeFromSelection(itemId);
      else store.addToSelection(itemId);
      store.setSelectionAnchor(itemId);
    } else {
      store.setSelection([itemId]);
      store.setSelectionAnchor(itemId);
    }
    syncSelection();
    saveWorkspaceView();
  }

  function clearSelection() {
    store.clearSelection();
    syncSelection();
    saveWorkspaceView();
  }

  /** Ctrl+A, scoped by sets.
   *
   * Inside a set it selects that set's members; outside every set it selects
   * only the setless items. Selecting literally everything is rarely what is
   * wanted once sets exist — the useful move is "the rest of this group", and
   * selectAllScope decides which group that is from the anchor. */
  function selectAllVisible(visibleItemIds) {
    const session = store.getSession();
    const sets = store.getSnapshot().view?.itemSets ?? [];
    store.setSelection(
      selectAllScope
        ? selectAllScope(sets, visibleItemIds, session.selectionAnchor, ancestorsOf)
        : visibleItemIds,
    );
    store.setSelectionAnchor(null);
    syncSelection();
    saveWorkspaceView();
  }

  /** The folder chain for an item, so a folder's contents inherit its sets.
   *
   * Passing nothing makes inheritance silently stop working rather than fail
   * loudly, so the absence is worth being explicit about. */
  function ancestorsOf(itemId) {
    return ancestorsOfNode ? ancestorsOfNode(itemId) : [];
  }

  /** Groups the current selection into a new set.
   *
   * The set stores ids only — never positions or a shape. Where its outline
   * ends up is decided by the simulation, so a set grouped here and then
   * dragged apart keeps its membership while its boundary follows. */
  async function groupSelectionIntoSet() {
    const selected = [...store.getSession().selected];
    if (selected.length === 0) {
      setStatus('Select items first, then press G to group them.');
      return;
    }
    try {
      // getSnapshot, not getState: the store exposes the former, and calling
      // the latter threw on every G press. The throw was invisible because the
      // caller used optional chaining and dropped the returned promise, so a
      // broken command and an unbound key looked identical. Everything here is
      // wrapped for the same reason.
      const state = store.getSnapshot();
      const next = setItemSets(state, [
        ...(state.view?.itemSets ?? []),
        createItemSet(selected),
      ]);
      await store.commit(next);
      const count = next.view?.itemSets?.length ?? 0;
      setStatus(`Grouped ${selected.length} item${selected.length === 1 ? '' : 's'} (${count} set${count === 1 ? '' : 's'}).`, { level: 'success' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Selects sets rather than items. Sets and items are separate selections, so
   * picking a set never disturbs what items are selected — and Delete means two
   * different things depending on which one is live. */
  function selectSets(setIds, { additive = false } = {}) {
    const next = additive ? [...store.getSession().selectedSets, ...setIds] : setIds;
    store.setSelectedSets(next);
    render();
  }

  function clearSetSelection() {
    if (store.getSession().selectedSets.size === 0) return;
    store.clearSelectedSets();
    render();
  }

  async function renameSet(setId, title) {
    const current = store.getSnapshot().view?.itemSets ?? [];
    if (!current.some((candidate) => candidate.id === setId)) return false;
    const next = current.map((candidate) => candidate.id === setId
      ? { ...candidate, title: normalizeSetTitle(title) }
      : candidate);
    try {
      await store.commit(setItemSets(store.getSnapshot(), next));
      setStatus('');
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /** Delete on a selected set removes the grouping only.
   *
   * The items are untouched, which is the whole distinction from Delete on an
   * item selection — so the status line says so rather than leaving the user to
   * wonder what just happened to their files. */
  async function deleteSelectedSets() {
    const setIds = [...store.getSession().selectedSets];
    if (setIds.length === 0) return;
    try {
      const snapshot = store.getSnapshot();
      const current = snapshot.view?.itemSets ?? [];
      const next = current.filter((candidate) => !setIds.includes(candidate.id));
      if (next.length === current.length) return;
      store.clearSelectedSets();
      await store.commit(setItemSets(snapshot, next));
      setStatus(`Deleted ${setIds.length} ${setIds.length === 1 ? 'set' : 'sets'}. The items are unchanged.`, { level: 'success' });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Ctrl+G: applies the picker's membership decision to the selection.
   *
   * Takes per-set state maps (all / none / mixed) rather than a list of chosen
   * ids. A list cannot express "leave this set as it is", so applying one to a
   * mixed selection edits sets the user never touched — passing both the
   * captured and the current matrix means only real changes are applied. */
  async function shareSelectionWithSets(desired, itemIds = null, before = null) {
    const ids = itemIds ?? [...store.getSession().selected];
    if (ids.length === 0) return;
    try {
      const snapshot = store.getSnapshot();
      const current = snapshot.view?.itemSets ?? [];
      const next = desired instanceof Map
        ? applyMembershipChanges(current, ids, before ?? new Map(), desired, ancestorsOf)
        : setMembership(current, ids, desired, ancestorsOf);
      if (next === current) return;
      await store.commit(setItemSets(snapshot, next));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Begins a marquee gesture. With preserveSelection, the current selection
   * is kept as the base; otherwise it is cleared. Returns the base ids. */
  function beginMarqueeSelection({ preserveSelection }) {
    if (preserveSelection) return [...store.getSession().selected];
    store.clearSelection();
    store.setSelectionAnchor(null);
    syncSelection();
    return [];
  }

  /** Replaces the transient marquee selection without saving on every move. */
  function updateMarqueeSelection(ids) {
    store.setSelection(ids);
    syncSelection();
  }

  /** Ends a marquee gesture; saves the view only when it actually moved. */
  function finishMarqueeSelection({ moved }) {
    if (moved) saveWorkspaceView();
  }

  /** The one place the workspace goes to a folder it is not already in.
   *
   * It takes any folder id, including the workspace root, which is a synthetic
   * id with no group record behind it - the root breadcrumb navigates with
   * exactly this call. activateItem() reaches it only for an id it can find as
   * a group, which is why a caller whose destination may be the root (Quick
   * Run's reveal) names this command instead. */
  function navigateToFolder(folderId) {
    const session = store.getSession();
    if (session.binMode) {
      // Drilling into a binned folder stays inside the Bin — it must never
      // jump to the real explorer, since the folder (and everything under
      // it) is still hidden there and would just show up empty.
      store.setNavigation({ binCurrentId: folderId });
    } else {
      store.setNavigation({ currentId: folderId });
    }
    store.clearSelection();
    graph.destroyGraphView();
    closeMenu();
    render();
    saveWorkspaceView({ persistSurfaceLocation: !session.binMode });
  }

  /** The workspace navigation a revealed occurrence needs, as opposed to the Bin-local one.
   *
   * navigateToFolder() follows the Bin while it is open, which is what drilling inside the Bin means for a
   * click in the Bin. Quick Run never shows Bin contents - its universe excludes them - so every folder it
   * can name belongs to the active workspace, and inheriting the Bin's semantics left the reader sitting in
   * the Bin looking at an empty view while Quick Run reported success. So this leaves the Bin first, using
   * the sequence the Bin control itself uses (bin mode off, drill-down reset to the Bin root), and then
   * navigates the workspace. */
  function goToWorkspaceFolder(folderId) {
    if (!scopeAllowsDestination(folderId)) return;
    if (store.getSession().binMode) store.setNavigation({ binMode: false, binCurrentId: 'bin' });
    navigateToFolder(folderId);
  }
  async function launchShortcut(itemId) {
    closeMenu();
    const chosen = shortcut(itemId);
    if (!chosen) {
      const message = 'The shortcut is no longer in the workspace.';
      setStatus(message);
      return { ok: false, message, reported: true };
    }
    try {
      if (isWebLink(chosen)) {
        await host.openWebLink(chosen.target);
      } else {
        await host.launchShortcut(itemId);
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      return { ok: false, message, reported: true };
    }
  }

  /** Reveals a single shortcut's target in the file manager. */
  async function revealShortcut(itemId) {
    closeMenu();
    try {
      await host.revealShortcut(itemId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Exact copy of the pre-refactor heuristic: a target whose last path
   * segment has no extension is treated as a directory for double-click. */
  function isDirectoryTarget(target) {
    if (!target) return false;
    const normalized = target.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    const basename = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
    return !basename.includes('.');
  }

  /** Owns the folder-versus-shortcut decision for opening an item: a group
   * navigates into it (explorer or Bin), a shortcut launches or opens it. With
   * revealDirectoryTarget, a non-web directory shortcut reveals its target in
   * the file manager instead of launching. */
  function activateItem(itemId, { revealDirectoryTarget = false } = {}) {
    if (group(itemId)) return navigateToFolder(itemId);
    const chosen = shortcut(itemId);
    if (!chosen) return;
    if (
      revealDirectoryTarget
      && !isWebLink(chosen)
      && isDirectoryTarget(chosen.target)
    ) {
      return revealShortcut(itemId);
    }
    return launchShortcut(itemId);
  }

  function directoryOf(target) {
    const normalized = target.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? normalized : normalized.slice(0, lastSlash).toLocaleLowerCase();
  }

  async function revealSelection() {
    const targets = [...store.getSession().selected]
      .map((itemId) => shortcut(itemId))
      .filter((candidate) => candidate && !isWebLink(candidate));
    if (targets.length === 0) return;
    const seenDirectories = new Set();
    for (const target of targets) {
      const directory = directoryOf(target.target);
      if (seenDirectories.has(directory)) continue;
      seenDirectories.add(directory);
      try {
        await host.revealShortcut(target.id);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function activateSelection() {
    const shortcuts = [...store.getSession().selected]
      .map((itemId) => shortcut(itemId))
      .filter(Boolean);
    if (shortcuts.length === 0) return;
    closeMenu();
    await Promise.all(shortcuts.map(async (chosen) => {
      try {
        if (isWebLink(chosen)) {
          await host.openWebLink(chosen.target);
        } else {
          await host.launchShortcut(chosen.id);
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }));
  }

  async function undo() {
    await store.undo();
  }

  async function redo() {
    await store.redo();
  }

  function selectedPasteDestinations() {
    const folders = [...store.getSession().selected]
      .map((itemId) => group(itemId)).filter(Boolean);
    return folders.length > 0 ? folders.map((folder) => folder.id) : [store.getSession().currentId];
  }

  function copyOrCut(mode) {
    if (store.getSession().selected.size === 0) return;

    // Capture right now, at the moment of Ctrl+C/Ctrl+X, both which specific
    // placement each selected shortcut represents and (for a cut) whether it
    // currently shows more than one edge on screen — both decide behavior at
    // paste time and must not drift if selection or graph visibility changes
    // before the user pastes.
    const collapseWhole = new Set();
    const placementIds = new Map();
    const session = store.getSession();

    for (const selectedId of session.selected) {
      if (group(selectedId) || windowLayout(selectedId)) continue;

      const placementId = visiblePlacementIdFor(selectedId);
      if (placementId) placementIds.set(selectedId, placementId);

      if (mode === 'cut' && visibleParentCountFor(selectedId) > 1) {
        collapseWhole.add(selectedId);
      }
    }

    store.setClipboard({
      mode,
      ids: [...session.selected],
      collapseWhole,
      placementIds,
    });
    rememberClipboardAtInternalCopy();

    setStatus('');
    closeMenu();
  }

  function copySelection() {
    return copyOrCut('copy');
  }

  function cutSelection() {
    return copyOrCut('cut');
  }

  async function pasteInto(parentIds) {
    const destinations = (Array.isArray(parentIds) ? parentIds : [parentIds])
      .map(scopedDestination);
    const clipboard = store.getSession().clipboard;
    if (!clipboard || destinations.length === 0 || destinations.includes('bin')) return;
    if (!destinations.every((destinationId) => scopeAllowsDestination(destinationId))) return;
    if (!scopeAllowsSelection(clipboard.ids)) return;
    try {
      const wasCut = clipboard.mode === 'cut';
      let next = store.getSnapshot();
      if (wasCut) {
        // A cut item can only move to one place, so multi-folder selection is
        // ignored here — only the first destination applies.
        const parentId = destinations[0];
        const groupIds = clipboard.ids.filter((selectedId) =>
          group(selectedId) || windowLayout(selectedId));
        const wholeShortcutIds = clipboard.ids.filter((selectedId) => clipboard.collapseWhole.has(selectedId));
        const singlePlacementIds = clipboard.ids
          .filter((selectedId) => !group(selectedId) && !windowLayout(selectedId) && !clipboard.collapseWhole.has(selectedId))
          .map((selectedId) => clipboard.placementIds.get(selectedId) ?? anyActivePlacementId(selectedId))
          .filter(Boolean);
        if (groupIds.length > 0 || singlePlacementIds.length > 0) {
          next = moveSelection(next, [...groupIds, ...singlePlacementIds], parentId);
        }
        for (const shortcutId of wholeShortcutIds) {
          next = collapsePlacements(next, shortcutId, parentId);
        }
      } else {
        const ids = clipboard.ids
          .map((selectedId) => (group(selectedId) || windowLayout(selectedId))
            ? selectedId
            : clipboard.placementIds.get(selectedId) ?? anyActivePlacementId(selectedId))
          .filter(Boolean);
        // Copying always links; pasting into multiple selected folders at once
        // links a new placement into each one.
        for (const parentId of destinations) {
          next = copySelectionModel(next, ids, parentId);
        }
      }
      if (wasCut) store.setClipboard(null);
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function pasteExternalClipboard({ files = [], text = '' } = {}, parentIds) {
    const destinations = (Array.isArray(parentIds) ? parentIds : [parentIds])
      .map(scopedDestination)
      .filter(Boolean);
    if (destinations.length === 0 || destinations.includes('bin')) return false;
    if (!destinations.every((destinationId) => scopeAllowsDestination(destinationId))) return false;

    try {
      if (Array.isArray(files) && files.length > 0) {
        const targets = await host.resolveDroppedTargets(files);
        for (const destination of destinations) await dropResolvedTargets(targets, destination);
        return true;
      }

      const rawText = String(text ?? '').trim();
      if (!rawText) return false;
      const unquoted = rawText.length >= 2
        && ((rawText.startsWith('"') && rawText.endsWith('"')) || (rawText.startsWith("'") && rawText.endsWith("'")))
        ? rawText.slice(1, -1).trim()
        : rawText;
      const stat = await host.fileCapability?.('stat', { path: unquoted }).catch(() => null);
      if (stat?.ok === true && stat.entry?.path) {
        const target = {
          target: stat.entry.path,
          name: stat.entry.name || stat.entry.path,
          kind: stat.entry.kind,
        };
        for (const destination of destinations) await dropResolvedTargets([target], destination);
        return true;
      }

      for (const destination of destinations) await dropUrl(rawText, destination);
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  async function pasteClipboard({ files = [], text = '' } = {}, parentIds) {
    const internal = store.getSession().clipboard;
    const snapshot = await readClipboardSnapshot();
    const sameAsInternalCopy = Boolean(
      internal
      && (internalClipboardFingerprintPending
        || (internalClipboardFingerprint
          && snapshot?.fingerprint === internalClipboardFingerprint)),
    );

    if (sameAsInternalCopy) {
      await pasteInto(parentIds);
      return true;
    }

    if (Array.isArray(files) && files.length > 0) {
      return pasteExternalClipboard({ files, text }, parentIds);
    }

    if (typeof text === 'string' && text.trim()) {
      return pasteExternalClipboard({ files: [], text }, parentIds);
    }

    if (snapshot?.kind === 'files' && Array.isArray(snapshot.targets) && snapshot.targets.length > 0) {
      const destinations = (Array.isArray(parentIds) ? parentIds : [parentIds])
        .map(scopedDestination)
        .filter(Boolean);
      if (!destinations.every((destinationId) => scopeAllowsDestination(destinationId))) return false;
      for (const destination of destinations) await dropResolvedTargets(snapshot.targets, destination);
      return true;
    }

    if (snapshot?.kind === 'text' && typeof snapshot.text === 'string' && snapshot.text.trim()) {
      return pasteExternalClipboard({ text: snapshot.text }, parentIds);
    }

    if (internal) {
      await pasteInto(parentIds);
      return true;
    }
    return false;
  }

  async function moveSelectionToBin() {
    if (store.getSession().selected.size === 0) return;
    const selected = [...store.getSession().selected]
      // Bound project roots anchor scoped views (and the Bin pill counts as a
      // move out of the top level for them): neither binning path may take one.
      .filter((id) => id !== scopeRootId && !(typeof id === 'string' && id.startsWith('group-proxima-')));
    if (selected.length === 0) {
      setStatus('The project folder cannot be moved to the Bin.');
      return;
    }
    if (!scopeAllowsSelection(selected)) return;
    await store.commit(
      binSelection(store.getSnapshot(), resolveBinTargets(selected)),
    );
  }

  function resetGraphPositions() {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    // Both maps: releasing the pin while keeping the remembered position would
    // leave the item exactly where it was, which is not a reset.
    store.replace(removeGraphRestPositions(
      removeGraphPositions(store.getSnapshot(), ctxId, [...session.selected]),
      ctxId,
      [...session.selected],
    ));
    for (const id of session.selected) {
      const node = graph._getNode(id);
      if (node) {
        node.fx = null;
        node.fy = null;
        node.positioned = false;
        node.vx = 0;
        node.vy = 0;
      }
    }
    graph.reheat(0.3);
    closeMenu();
    saveWorkspaceView();
  }

  /** Drops a dragged selection onto the Bin pill: bins every resolved
   * placement and clears their graph positions. Ancestors of the current
   * folder are part of the path here — they can never be deleted. */
  async function dragDropToBin({ itemIds }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    const deletable = itemIds
      .filter((id) => id !== scopeRootId && !(typeof id === 'string' && id.startsWith('group-proxima-')))
      .filter((id) => !isAncestorItem(id));
    if (!scopeAllowsSelection(deletable)) return;
    if (deletable.length === 0) {
      const blockedRoot = itemIds.some((id) => id === scopeRootId
        || (typeof id === 'string' && id.startsWith('group-proxima-')));
      setStatus(blockedRoot
        ? 'The project folder cannot be moved to the Bin.'
        : 'The path to this folder cannot be deleted.');
      return;
    }
    try {
      const next = removeGraphRestPositions(
        removeGraphPositions(
          binSelection(store.getSnapshot(), resolveBinTargets(deletable)),
          ctxId,
          deletable,
        ),
        ctxId,
        deletable,
      );
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Drops a dragged selection into a folder: moves groups and single
   * placements, collapses whole linked shortcuts, and clears positions.
   * An ancestor cannot be moved either — dropping it into another folder
   * would restructure the real tree under the current view. */
  async function dragDropToFolder({ itemIds, placementIds, folderId }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    const destination = scopedDestination(folderId);
    if (!scopeAllowsSelection(itemIds) || !scopeAllowsDestination(destination)) return;
    const movable = itemIds.filter((draggedId) => !isAncestorItem(draggedId));
    if (movable.length === 0) {
      setStatus('The path to this folder cannot be moved into another folder.');
      return;
    }
    try {
      const groupIds = movable.filter((draggedId) =>
        group(draggedId) || windowLayout(draggedId));
      const wholeShortcutIds = movable.filter((draggedId) =>
        !group(draggedId) && !windowLayout(draggedId) && visibleParentCountFor(draggedId) > 1);
      const singlePlacementIds = movable
        .filter((draggedId) => !group(draggedId) && !windowLayout(draggedId) && visibleParentCountFor(draggedId) <= 1)
        .map((shortcutId) => placementIds.get(shortcutId) ?? anyActivePlacementId(shortcutId))
        .filter(Boolean);
      let next = store.getSnapshot();
      if (groupIds.length > 0 || singlePlacementIds.length > 0) {
        next = moveSelection(next, [...groupIds, ...singlePlacementIds], destination);
      }
      for (const shortcutId of wholeShortcutIds) {
        next = collapsePlacements(next, shortcutId, destination);
      }
      await store.commit(removeGraphRestPositions(removeGraphPositions(next, ctxId, movable), ctxId, movable));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Pins a dragged selection to its current graph coordinates. */
  function pinDraggedNodes({ positions }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    store.replace(setGraphPositions(store.getSnapshot(), ctxId, positions));
    saveWorkspaceView();
  }

  /** Releases a dragged selection, clearing its saved graph positions. */
  function releaseDraggedNodes({ itemIds }) {
    const session = store.getSession();
    const ctxId = graphContextId(session.currentId, session.binMode);
    store.replace(removeGraphPositions(store.getSnapshot(), ctxId, itemIds));
    saveWorkspaceView();
  }

  function nameForDroppedUrl(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./i, '');
      return hostname || url;
    } catch {
      return url;
    }
  }

  /** Drops a URL into a destination: resolves the web icon, creates the web
   * link, and commits. Reports errors through setStatus. */
  async function dropUrl(url, destination) {
    const normalizedDestination = scopedDestination(destination);
    if (!scopeAllowsDestination(normalizedDestination)) return;
    try {
      let name = nameForDroppedUrl(url);
      let icon = null;
      try {
        const resolved = await host.resolveWebIcon(url);
        if (resolved?.title) name = resolved.title;
        if (resolved?.icon) icon = resolved.icon;
      } catch {
        // Fall back to the hostname-derived name/no icon — the link is
        // still worth creating even if the page couldn't be reached.
      }
      const next = createWebLink(store.getSnapshot(), {
        name,
        target: url,
        icon,
        parentId: normalizedDestination,
      });
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Drops files into a destination: resolves targets, creates shortcuts,
   * and commits — or reports that they already exist. */
  async function dropFiles(files, destination) {
    const normalizedDestination = scopedDestination(destination);
    if (!scopeAllowsDestination(normalizedDestination)) return;
    try {
      const targets = await host.resolveDroppedTargets(files);
      await dropResolvedTargets(targets, normalizedDestination);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  /** Same creation path as an OS file drop, but for paths already resolved by
   * the inline machine explorer / Everything search. */
  async function dropResolvedTargets(targets, destination) {
    const normalizedDestination = scopedDestination(destination);
    if (!scopeAllowsDestination(normalizedDestination)) return;
    try {
      const before = store.getSnapshot();
      const next = createDroppedShortcuts(before, targets, normalizedDestination);
      if (next.shortcuts.length === before.shortcuts.length) {
        setStatus('Those shortcuts already exist here.');
        return;
      }
      await store.commit(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    selectItem,
    clearSelection,
    selectAllVisible,
    groupSelectionIntoSet,
    selectSets,
    clearSetSelection,
    renameSet,
    deleteSelectedSets,
    shareSelectionWithSets,
    beginMarqueeSelection,
    updateMarqueeSelection,
    finishMarqueeSelection,
    activateItem,
    goToWorkspaceFolder,
    revealSelection,
    activateSelection,
    copySelection,
    cutSelection,
    pasteInto,
    pasteExternalClipboard,
    pasteClipboard,
    moveSelectionToBin,
    resetGraphPositions,
    dragDropToBin,
    dragDropToFolder,
    pinDraggedNodes,
    releaseDraggedNodes,
    dropUrl,
    dropFiles,
    dropResolvedTargets,
    selectedPasteDestinations,
    undo,
    redo,
  };
}
