/** Owns the Bin pill and the Delete-all / Restore-all controls. The bin pill
 * toggles Bin mode (or sends a non-empty selection to the Bin), and the
 * all/selective buttons hand their ids to the confirmation dialog. Reads and
 * writes Bin session state through the injected accessors so it never touches
 * shared state directly. */
export function createBinControls({
  elements,
  getState,
  getBinMode,
  setBinMode,
  getSelectedIds,
  clearSelection,
  resetDrillDown,
  binnedItems,
  moveToBin,
  confirmDialog,
  closeMenu,
  render,
  saveWorkspaceView,
}) {
  let abortController = null;

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;

    elements.binButton.addEventListener('click', () => {
      if (!getBinMode() && getSelectedIds().length > 0) {
        moveToBin();
        return;
      }
      const nextBinMode = !getBinMode();
      setBinMode(nextBinMode);
      if (!nextBinMode) resetDrillDown();
      clearSelection();
      closeMenu();
      render();
      saveWorkspaceView();
    }, { signal });

    elements.deleteAllBin.addEventListener('click', () => {
      const selectedIds = getSelectedIds();
      if (selectedIds.length > 0) {
        confirmDialog.askPermanentDelete(selectedIds, false);
        return;
      }
      confirmDialog.askPermanentDelete(
        binnedItems(getState()).map((candidate) => candidate.id),
        true,
      );
    }, { signal });

    elements.restoreAllBin.addEventListener('click', () => {
      const selectedIds = getSelectedIds();
      if (selectedIds.length > 0) {
        confirmDialog.askRestoreConfirm(selectedIds, false);
        return;
      }
      confirmDialog.askRestoreConfirm(
        binnedItems(getState()).map((candidate) => candidate.id),
        true,
      );
    }, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
  }

  return { mount, destroy };
}
