/** Prompt-tree context menu. Owns its DOM, positioning, keyboard navigation
 * and dismissal, and emits plain action intents. It never mutates workspace
 * state and never calls the host. */
export function createPromptTreeContextMenu({ document, menu }) {
  let abortController = null;
  let items = [];
  let onAction = null;
  let activeIndex = 0;

  function open({ x, y, items: menuItems, onAction: handler }) {
    items = menuItems;
    onAction = handler;
    activeIndex = 0;
    render();
    menu.style.setProperty('left', `${x}px`);
    menu.style.setProperty('top', `${y}px`);
    menu.hidden = false;
    focusItem(0);
  }

  function close() {
    onAction = null;
    items = [];
    menu.hidden = true;
    menu.textContent = '';
  }

  function render() {
    menu.textContent = '';
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = item.label;
      button.dataset.menuIndex = String(items.indexOf(item));
      button.addEventListener('click', () => {
        const handler = onAction;
        const action = item.id;
        close();
        if (handler) handler(action);
      });
      menu.append(button);
    }
  }

  function focusItem(index) {
    const buttons = menu.querySelectorAll('[role="menuitem"]');
    buttons[index]?.focus?.();
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      focusItem(activeIndex);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      focusItem(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const handler = onAction;
      const item = items[activeIndex];
      close();
      if (handler) handler(item.id);
    }
  }

  function onDocumentClick(event) {
    if (!menu.contains(event.target)) close();
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    menu.addEventListener('keydown', onKeyDown, { signal });
    document.addEventListener('click', onDocumentClick, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    close();
  }

  return {
    mount,
    destroy,
    open,
    close,
    get isOpen() { return !menu.hidden; },
  };
}
