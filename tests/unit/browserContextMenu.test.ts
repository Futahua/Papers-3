import { describe, expect, it, vi } from 'vitest';
import type { ContextMenuParams, WebContents } from 'electron';
import { browserContextItems, showBrowserTabMenu } from '../../src/main/backpacks/browserContextMenu';
const menu = vi.hoisted(() => ({ writeText: vi.fn(), template: [] as any[], popup: vi.fn() }));
vi.mock('electron', () => ({ clipboard: { writeText: menu.writeText }, Menu: {
  buildFromTemplate: (template: any[]) => { menu.template = template; return { popup: menu.popup }; },
} }));
const params = (extra: object) => ({ x: 11, y: 22, linkURL: '', srcURL: '', editFlags: {}, ...extra }) as ContextMenuParams;
describe('native browser menu', () => {
  it('searches selected text in a new tab with encoded query',()=>{
    const open=vi.fn();
    const items=browserContextItems(params({selectionText:' Ary Minh & friends '}),{} as WebContents,open);
    (items.find(item=>item.label==='Search Google in new tab')?.click as Function)();
    expect(open).toHaveBeenCalledWith('https://www.google.com/search?q=Ary%20Minh%20%26%20friends');
  });
  it('opens a linked image in distinct tabs and uses Chromium for save/copy', () => {
    const contents = { downloadURL: vi.fn(), copyImageAt: vi.fn() };
    const open = vi.fn();
    const items = browserContextItems(params({ linkURL: 'https://example.com/link', srcURL: 'https://example.com/image.png', mediaType: 'image', hasImageContents: true }), contents as unknown as WebContents, open);
    const click = (label: string) => (items.find((item) => item.label === label)?.click as Function)();
    click('Open link in new tab'); click('Open image in new tab');
    expect(open.mock.calls).toEqual([['https://example.com/link'], ['https://example.com/image.png']]);
    click('Save image as…'); expect(contents.downloadURL).toHaveBeenCalledWith('https://example.com/image.png');
    click('Copy image'); expect(contents.copyImageAt).toHaveBeenCalledWith(11, 22);
    click('Copy image address'); expect(menu.writeText).toHaveBeenCalledWith('https://example.com/image.png');
  });
  it('does not open executable or local-file links', () => {
    for (const linkURL of ['javascript:alert(1)', 'file:///private']) {
      expect(browserContextItems(params({ linkURL }), {} as WebContents, vi.fn())).toEqual([]);
    }
  });
  it('returns the tab-close intent after the native menu dismisses', async () => {
    menu.popup.mockImplementationOnce(({ callback }) => { menu.template[1].click(); callback(); });
    expect(await showBrowserTabMenu({} as any, true)).toBe('close-others');
    expect(menu.template.map((item) => item.label)).toEqual(['Close this tab', 'Close all other tabs']);
  });
  it('disables close-others for a lone tab and returns no intent on dismiss', async () => {
    menu.popup.mockImplementationOnce(({ callback }) => callback());
    expect(await showBrowserTabMenu({} as any, false)).toBeNull();
    expect(menu.template[1].enabled).toBe(false);
  });
});
