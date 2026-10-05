import { clipboard, Menu, type BaseWindow, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron';

export function browserContextItems(
  params: ContextMenuParams,
  contents: WebContents,
  openTab: (url: string) => void,
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];
  const navigable = (url: string): boolean => {
    try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
  };
  if (params.linkURL && navigable(params.linkURL)) {
    items.push(
      { label: 'Open link in new tab', click: () => openTab(params.linkURL) },
      { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
    );
  }
  if (params.mediaType === 'image' && params.srcURL) {
    if (items.length) items.push({ type: 'separator' });
    if (navigable(params.srcURL)) items.push({ label: 'Open image in new tab', click: () => openTab(params.srcURL) });
    items.push(
      { label: 'Save image as…', click: () => contents.downloadURL(params.srcURL) },
      { label: 'Copy image', enabled: params.hasImageContents, click: () => contents.copyImageAt(params.x, params.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
    );
  }
  if (params.isEditable) {
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: 'Cut', enabled: params.editFlags.canCut, click: () => contents.cut() },
      { label: 'Copy', enabled: params.editFlags.canCopy, click: () => contents.copy() },
      { label: 'Paste', enabled: params.editFlags.canPaste, click: () => contents.paste() },
      { label: 'Select all', click: () => contents.selectAll() },
    );
  } else if (params.selectionText) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'Copy', click: () => contents.copy() });
  }
  if (params.selectionText?.trim()) {
    items.push({ label: 'Search Google in new tab', click: () => openTab('https://www.google.com/search?q=' + encodeURIComponent(params.selectionText.trim())) });
  }
  return items;
}

export function showBrowserContextMenu(params: ContextMenuParams, contents: WebContents, window: BaseWindow, openTab: (url: string) => void): void {
  const items = browserContextItems(params, contents, openTab);
  if (items.length) Menu.buildFromTemplate(items).popup({ window, frame: params.frame ?? undefined });
}

export function showBrowserTabMenu(window: BaseWindow, hasOthers: boolean): Promise<'close' | 'close-others' | null> {
  return new Promise((resolve) => {
    let action: 'close' | 'close-others' | null = null;
    Menu.buildFromTemplate([
      { label: 'Close this tab', click: () => { action = 'close'; } },
      { label: 'Close all other tabs', enabled: hasOthers, click: () => { action = 'close-others'; } },
    ]).popup({ window, callback: () => resolve(action) });
  });
}
