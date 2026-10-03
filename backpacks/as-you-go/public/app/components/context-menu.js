/** Owns the right-click context menu: building its buttons, opening and
 * closing it, and dispatching clicks to the injected onAction handler. Menu
 * content depends on the current selection, Bin mode, and clipboard, all of
 * which arrive through getters so the component never reads shared state
 * directly. */
export function createContextMenu({
  elements,
  window,
  getCurrentId,
  getBinMode,
  getClipboard,
  getSelectedItems,
  getSelectedSets = () => [],
  isWebLink,
  onAction,
}) {
  let abortController = null;

  function menuButton(action, label, danger = false, disabled = false) {
    return `<button type="button" role="menuitem" data-action="${action}" class="${danger ? 'danger-text' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`;
  }

  function closeMenu() {
    elements.menu.hidden = true;
    elements.menu.innerHTML = '';
  }

  function openMenu(x, y, kind = 'selection', parentId = getCurrentId()) {
    let content = '';
    const clipboard = getClipboard();
    const binMode = getBinMode();
    const selected = getSelectedItems();
    const selectedSets = getSelectedSets();
    if (kind === 'member') {
      // 040: member-icon context menu — `Remove from this layout` routes through
      // the scoped data-only writer with the clicked layout/member identity.
      // The target (layoutId/memberId) is carried on the menu element dataset.
      content = [
        menuButton('remove-from-layout', 'Remove from this layout', true),
      ].join('');
      elements.menu.dataset.parent = parentId;
    } else if (kind === 'blank') {
      content = [
        menuButton('new-folder', 'New folder'),
        menuButton('new-shortcut', 'Add shortcut'),
        menuButton('new-window-layout', 'New window layout'),
        menuButton('new-web-link', 'Add web link'),
        clipboard ? '<hr />' : '',
        clipboard ? menuButton('paste', clipboard.mode === 'cut' ? 'Paste moved items' : 'Paste copied items') : '',
      ].join('');
      elements.menu.dataset.parent = parentId;
    } else if (binMode) {
      content = [
        menuButton('restore', 'Restore'),
        menuButton('delete-forever', 'Delete permanently', true),
      ].join('');
    } else {
      if (selectedSets.length > 0) {
        content = [
          selectedSets.length === 1 ? menuButton('rename-set', 'Rename set') : '',
          menuButton('delete-sets', selectedSets.length > 1 ? 'Delete sets' : 'Delete set', true),
        ].join('');
      } else {
      const chosen = selected.filter(Boolean);
      const only = chosen.length === 1 ? chosen[0] : null;
      content = [
        only ? menuButton('open', only.target ? 'Open' : 'Open folder') : '',
        only && !only.target ? menuButton('open-new-tab', 'Open folder in new Papers tab') : '',
        only?.target ? menuButton('edit', isWebLink(only) ? 'Edit web link' : 'Edit shortcut') : '',
        only && !only.target ? menuButton('rename', 'Edit folder') : '',
        only ? '<hr />' : '',
        menuButton('copy', chosen.length > 1 ? 'Copy items' : 'Copy'),
        menuButton('cut', chosen.length > 1 ? 'Cut items' : 'Cut'),
        menuButton('bin', chosen.length > 1 ? 'Move items to Bin' : 'Move to Bin', true),
        '<hr />',
        menuButton('reset-graph-position', chosen.length > 1 ? 'Follow folders automatically' : 'Follow folder automatically'),
      ].join('');
      }
    }
    elements.menu.innerHTML = content;
    elements.menu.hidden = false;
    const width = 210;
    const height = Math.min(300, elements.menu.scrollHeight);
    elements.menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    elements.menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
    elements.menu.querySelector('button:not([disabled])')?.focus();
  }

  function mount() {
    abortController = new AbortController();
    elements.menu.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button) onAction(button.dataset.action);
    }, { signal: abortController.signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    closeMenu();
  }

  return { closeMenu, openMenu, menuButton, mount, destroy };
}
