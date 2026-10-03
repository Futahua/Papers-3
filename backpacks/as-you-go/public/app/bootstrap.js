/** Orchestrates workspace startup. Behavior-only components (context menu,
 * editor, confirmation dialog, Bin controls, keyboard, drop, and pointer
 * controllers) mount synchronously so their listeners are attached
 * regardless of whether host state loading succeeds — the rendered fallback
 * interface stays interactive even when loading fails. The toolbar mounts
 * only after state is restored, since it immediately re-applies saved
 * positions. */
export function bootstrapWorkspace({
  loadState,
  setState,
  restoreWorkspaceView,
  setStatus,
  render,
  toolbar,
  confirmDialog,
  menu,
  editorDialog,
  binControls,
  keyboard,
  drop,
  pointer,
  promptLibrary,
}) {
  confirmDialog.mount();
  menu.mount();
  editorDialog.mount();
  binControls.mount();
  keyboard.mount();
  drop.mount();
  pointer.mount();
  promptLibrary.mount();

  return (async () => {
    try {
      const loaded = await loadState();
      // setState routes to the store's install(), the single normalizing
      // install point — normalizeState is not applied here a second time.
      setState(typeof loaded === 'string' ? JSON.parse(loaded) : loaded);
      restoreWorkspaceView();
      toolbar.mount();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    render();
  })();
}
