import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BaseWindow, WebContentsView } from 'electron';
import { createWebBrowserHostBridge } from '../../src/main/backpacks/webBrowserHostBridge';

type FakeSession = {
  fetch: ReturnType<typeof vi.fn>;
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  setDownloadPath: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setCertificateVerifyProc: ReturnType<typeof vi.fn>;
};

type FakeWebContents = {
  destroyed: boolean;
  session: FakeSession;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setZoomFactor: ReturnType<typeof vi.fn>;
  setBackgroundThrottling: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  navigationHistory: {
    canGoBack: ReturnType<typeof vi.fn>;
    canGoForward: ReturnType<typeof vi.fn>;
    goBack: ReturnType<typeof vi.fn>;
    goForward: ReturnType<typeof vi.fn>;
    getAllEntries: ReturnType<typeof vi.fn>;
    getActiveIndex: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  isDestroyed: () => boolean;
};

type FakeView = {
  webContents: FakeWebContents;
  setBounds: ReturnType<typeof vi.fn>;
  setBackgroundColor: ReturnType<typeof vi.fn>;
};

const harness = vi.hoisted(() => ({
  window: {
    destroyed: false,
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  },
  views: [] as FakeView[],
  menu: [] as any[],
}));

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (items: any[]) => { harness.menu = items; return { popup: vi.fn((options) => { if (options.callback) { items[0]?.click?.(); options.callback(); } }) }; } },
  ipcMain: {
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('C:\\Users\\test\\Downloads'),
  },
  BaseWindow: class {
    id = 1;
    contentView = {
      addChildView: (view: unknown) => harness.window.addChildView(view),
      removeChildView: (view: unknown) => harness.window.removeChildView(view),
    };
    isDestroyed() {
      return harness.window.destroyed;
    }
    isFullScreen() { return false; }
    setFullScreen = vi.fn();
    getBounds() { return { x: 0, y: 0, width: 900, height: 600 }; }
  } as unknown as typeof BaseWindow,
  WebContentsView: class {
    webContents: FakeWebContents;
    setBounds = vi.fn();
    setBackgroundColor = vi.fn();
    constructor(options?: { webContents?: FakeWebContents }) {
      const webContents: FakeWebContents = options?.webContents ?? {
        destroyed: false,
        session: {
          fetch: vi.fn(),
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setDownloadPath: vi.fn(),
          on: vi.fn(),
          setCertificateVerifyProc: vi.fn(),
        },
        on: vi.fn(),
        once: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(() => { webContents.destroyed = true; }),
        setZoomFactor: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        reload: vi.fn(),
        focus: vi.fn(),
        navigationHistory: {
          canGoBack: vi.fn().mockReturnValue(false),
          canGoForward: vi.fn().mockReturnValue(false),
          goBack: vi.fn(),
          goForward: vi.fn(),
          getAllEntries: vi.fn().mockReturnValue([{ url: 'https://example.com/watch', title: 'Example', pageState: 'state' }]),
          getActiveIndex: vi.fn().mockReturnValue(0),
          restore: vi.fn().mockResolvedValue(undefined),
        },
        isDestroyed() {
          return webContents.destroyed;
        },
      };
      this.webContents = webContents;
      harness.views.push(this);
    }
  } as unknown as typeof WebContentsView,
}));

const ownerKey = '1:surface-a';
const context = {
  ownerKey,
  parentHwnd: '1',
  surfaceBounds: { x: 10, y: 20, width: 700, height: 500 },
};
const rect = { x: 40, y: 80, width: 420, height: 300 };
const url = 'https://example.com/watch';

beforeEach(() => {
  harness.window.destroyed = false;
  harness.window.addChildView.mockClear();
  harness.window.removeChildView.mockClear();
  harness.views.length = 0;
});

describe('web browser preview session leases', () => {
  it('reuses the live Chromium view but rotates the logical lease so a stale close cannot kill it', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });

    const first = await bridge.open(context, url, rect);
    expect(first.ok).toBe(true);
    expect(harness.views).toHaveLength(1);

    const second = await bridge.open(context, url, rect);
    expect(second.ok).toBe(true);
    expect(harness.views).toHaveLength(1);
    expect(harness.views[0]!.webContents.loadURL).toHaveBeenCalledTimes(1);

    const firstSessionId = (first as { sessionId: string }).sessionId;
    const secondSessionId = (second as { sessionId: string }).sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);

    expect(bridge.close(ownerKey, firstSessionId)).toBe(false);
    expect(harness.views[0]!.webContents.close).not.toHaveBeenCalled();

    expect(bridge.move(ownerKey, secondSessionId, rect)).toBe(true);
    expect(bridge.close(ownerKey, secondSessionId)).toBe(true);
    expect(harness.views[0]!.webContents.close).toHaveBeenCalledTimes(1);
  });
});

describe('durable browser tabs', () => {
  it('a delayed open cannot present or focus after its Papers surface is hidden', async () => {
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow(), resolveFavicon: async () => null });
    const pending = bridge.openTab(context, '12121212-1212-4212-8212-121212121212', url, rect);
    bridge.setOwnerVisible(ownerKey, false);
    expect((await pending).ok).toBe(true);
    bridge.setTabsVisible(ownerKey, true);
    await Promise.resolve(); await Promise.resolve();
    expect(harness.window.addChildView).not.toHaveBeenCalled();
    expect(harness.views[0]!.webContents.focus).not.toHaveBeenCalled();
    bridge.setOwnerVisible(ownerKey, true);
    await vi.waitFor(() => expect(harness.window.addChildView).toHaveBeenCalledTimes(1));
  });

  it('showing a Papers surface does not reopen its collapsed browser pane', async () => {
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow(), resolveFavicon: async () => null });
    await bridge.openTab(context, '13131313-1313-4313-8313-131313131313', url, rect);
    bridge.setTabsVisible(ownerKey, false);
    harness.window.addChildView.mockClear();
    bridge.setOwnerVisible(ownerKey, false); bridge.setOwnerVisible(ownerKey, true);
    await Promise.resolve(); await Promise.resolve();
    expect(harness.window.addChildView).not.toHaveBeenCalled();
  });

  it('offers a menu for persisted background tabs before their native view is created', async () => {
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow() });
    expect(await bridge.showTabMenu(ownerKey, '78787878-7878-4787-8787-787878787878', true)).toBe('close');
    expect(harness.menu[1].enabled).toBe(true);
    expect(harness.views).toHaveLength(0);
  });

  it('context-menu links and images become real background tabs in the same owner', async () => {
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow(), resolveFavicon: async () => null });
    const tabId = '78787878-7878-4787-8787-787878787878';
    await bridge.openTab(context, tabId, url, rect);
    const handler = harness.views[0]!.webContents.on.mock.calls.find(([event]) => event === 'context-menu')![1];
    handler(null, { linkURL: 'https://example.com/link', mediaType: 'image', srcURL: 'https://example.com/image.png', hasImageContents: true, editFlags: {}, x: 10, y: 20 });
    harness.menu.find((item) => item.label === 'Open link in new tab').click();
    harness.menu.find((item) => item.label === 'Open image in new tab').click();
    await vi.waitFor(() => expect(harness.views).toHaveLength(3));
    const requests = bridge.takeOpenRequests(ownerKey);
    expect(requests.map((request) => request.url)).toEqual(['https://example.com/link', 'https://example.com/image.png']);
    for (const request of requests) {
      expect(request.activate).toBe(false);
      expect(bridge.getTab(ownerKey, request.tabId)?.live).toBe(true);
      expect(bridge.getTab('other-owner', request.tabId)).toBeNull();
    }
    expect(harness.window.addChildView).toHaveBeenCalledTimes(1);
  });

  it('resolves the site homepage when a media tab has no favicon', async () => {
    const mediaUrl = 'https://www.messenger.com/messenger_media/?attachment_id=123';
    const icon = 'data:image/x-icon;base64,aWNvbg==';
    const resolveFavicon = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(icon);
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow(), resolveFavicon });
    expect(await bridge.resolveFavicon(mediaUrl)).toBe(icon);
    expect(resolveFavicon.mock.calls.map(([value]) => value)).toEqual([mediaUrl, 'https://www.messenger.com/']);
  });

  it('falls back to the homepage after a media-page fetch rejects', async () => {
    const icon = 'data:image/png;base64,aWNvbg==';
    const resolveFavicon = vi.fn().mockRejectedValueOnce(new Error('page unavailable')).mockResolvedValueOnce(icon);
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow(), resolveFavicon });
    expect(await bridge.resolveFavicon('https://example.com/attachment')).toBe(icon);
  });

  it('does not refetch a homepage that has no favicon', async () => {
    const resolveFavicon = vi.fn().mockResolvedValue(null);
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => new BaseWindow(), resolveFavicon });
    expect(await bridge.resolveFavicon('https://example.com/')).toBeNull();
    expect(resolveFavicon).toHaveBeenCalledTimes(1);
  });

  it('enables normal browser downloads into the user Downloads folder', async () => {
    const window = new BaseWindow();
    const fallbackFavicon = 'data:image/png;base64,ZmFsbGJhY2s=';
    const liveFavicon = 'data:image/png;base64,bGl2ZQ==';
    const resolveFavicon = vi.fn().mockResolvedValue(fallbackFavicon);
    const resolveFaviconCandidate = vi.fn().mockResolvedValue(liveFavicon);
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window, resolveFavicon, resolveFaviconCandidate });
    const tabId = '88888888-8888-4888-8888-888888888888';
    await bridge.openTab(context, tabId, url, rect);

    const session = harness.views[0]!.webContents.session;
    expect(session.setDownloadPath).toHaveBeenCalledWith('C:\\Users\\test\\Downloads');
    expect(session.on).toHaveBeenCalledWith('will-download', expect.any(Function));
    expect(harness.views[0]!.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
    const permissionRequest = session.setPermissionRequestHandler.mock.calls[0]![0];
    const permissionCheck = session.setPermissionCheckHandler.mock.calls[0]![0];
    const storageCallback = vi.fn();
    permissionRequest(null, 'storage-access', storageCallback, { requestingUrl: 'https://x.com/' });
    expect(storageCallback).toHaveBeenCalledWith(true);
    const mediaCallback = vi.fn();
    permissionRequest(null, 'media', mediaCallback, { requestingUrl: 'https://x.com/' });
    expect(mediaCallback).toHaveBeenCalledWith(false);
    expect(permissionCheck(null, 'top-level-storage-access', 'https://x.com/')).toBe(true);
    expect(permissionCheck(null, 'media', 'https://x.com/')).toBe(false);
    expect(await bridge.getDownloads()).toEqual([]);
    const didFinishHandler = harness.views[0]!.webContents.on.mock.calls.find(([event]) => event === 'did-finish-load')?.[1];
    expect(typeof didFinishHandler).toBe('function');
    didFinishHandler();
    await vi.waitFor(() => expect(bridge.getTab(ownerKey, tabId)?.faviconUrl).toBe(fallbackFavicon));
    expect(resolveFavicon).toHaveBeenCalledWith(url);

    const faviconHandler = harness.views[0]!.webContents.on.mock.calls.find(([event]) => event === 'page-favicon-updated')?.[1];
    expect(typeof faviconHandler).toBe('function');
    faviconHandler(null, ['https://static.example.test/favicon.ico']);
    await vi.waitFor(() => expect(bridge.getTab(ownerKey, tabId)?.faviconUrl).toBe(liveFavicon));
    expect(resolveFaviconCandidate).toHaveBeenCalledWith(
      'https://static.example.test/favicon.ico',
      expect.any(Function),
    );

    expect(await bridge.showDownloadsBubble(ownerKey, { x: 10, y: 10, width: 240, height: 58 })).toBe(true);
    expect(harness.views.at(-1)!.setBackgroundColor).toHaveBeenCalledWith('#00000000');
  });

  it('persists recent downloads across bridge recreation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'papers-download-history-'));
    const historyFile = join(directory, 'browser-downloads.json');
    const recoveryDir = join(directory, 'recovery');
    try {
      const window = new BaseWindow();
      const first = createWebBrowserHostBridge({
        resolveWindow: () => window,
        downloadHistoryFile: historyFile,
        downloadRecoveryDir: recoveryDir,
      });
      await first.openTab(context, '99999999-9999-4999-8999-999999999999', url, rect);
      const session = harness.views.at(-1)!.webContents.session;
      const willDownload = session.on.mock.calls.find(([event]) => event === 'will-download')?.[1];
      expect(typeof willDownload).toBe('function');
      const done = vi.fn();
      const item = {
        getFilename: () => 'example.pdf',
        getSavePath: () => 'C:\\Users\\test\\Downloads\\example.pdf',
        getURL: () => 'https://example.com/example.pdf',
        getReceivedBytes: () => 1234,
        getTotalBytes: () => 1234,
        on: vi.fn(),
        once: vi.fn((event: string, callback: (event: unknown, state: string) => void) => {
          if (event === 'done') done.mockImplementation(callback);
        }),
      };
      willDownload(null, item);
      done(null, 'completed');

      await vi.waitFor(async () => {
        const persisted = JSON.parse(await readFile(historyFile, 'utf8')) as { downloads?: Array<{ state?: string }> };
        expect(persisted.downloads?.[0]?.state).toBe('completed');
      });

      const second = createWebBrowserHostBridge({
        resolveWindow: () => window,
        downloadHistoryFile: historyFile,
        downloadRecoveryDir: recoveryDir,
      });
      expect(await second.getDownloads()).toEqual([
        expect.objectContaining({
          filename: 'example.pdf',
          path: 'C:\\Users\\test\\Downloads\\example.pdf',
          state: 'completed',
        }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps ordinary browser tabs live instead of silently discarding web-app runtime state', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];

    for (let index = 0; index < ids.length; index += 1) {
      const opened = await bridge.openTab(context, ids[index]!, `https://example.com/${index}`, rect);
      expect(opened.ok).toBe(true);
    }

    expect(harness.views).toHaveLength(4);
    expect(harness.views[0]!.webContents.close).not.toHaveBeenCalled();
    expect(bridge.getTab(ownerKey, ids[0]!)?.live).toBe(true);
    expect(bridge.getTab(ownerKey, ids[3]!)?.live).toBe(true);

    const restored = await bridge.activateTab(context, ids[0]!, rect);
    expect(restored.ok).toBe(true);
    expect(harness.views).toHaveLength(4);
    expect(harness.views[0]!.webContents.navigationHistory.restore).not.toHaveBeenCalled();
  });

  it('supports navigation commands on a live tab', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });
    const tabId = '55555555-5555-4555-8555-555555555555';
    await bridge.openTab(context, tabId, url, rect);
    const contents = harness.views.at(-1)!.webContents;
    contents.navigationHistory.canGoBack.mockReturnValue(true);
    contents.navigationHistory.canGoForward.mockReturnValue(true);

    expect(bridge.commandTab(ownerKey, tabId, 'back').ok).toBe(true);
    expect(contents.navigationHistory.goBack).toHaveBeenCalledTimes(1);
    expect(bridge.commandTab(ownerKey, tabId, 'forward').ok).toBe(true);
    expect(contents.navigationHistory.goForward).toHaveBeenCalledTimes(1);
    expect(bridge.commandTab(ownerKey, tabId, 'reload').ok).toBe(true);
    expect(contents.reload).toHaveBeenCalledTimes(1);
  });

  it('creates a real managed child WebContents for target-blank and middle-click navigation', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });
    const sourceId = '56565656-5656-4565-8565-565656565656';
    const source = await bridge.openTab(context, sourceId, 'https://chatgpt.com/c/source', rect);
    expect(source.ok).toBe(true);
    const sourceContents = harness.views.at(-1)!.webContents;
    const handler = sourceContents.setWindowOpenHandler.mock.calls.at(-1)?.[0];
    expect(typeof handler).toBe('function');

    const backgroundOpen = handler({
      url: 'https://chatgpt.com/c/background',
      disposition: 'background-tab',
    });
    expect(backgroundOpen.action).toBe('allow');
    expect(typeof backgroundOpen.createWindow).toBe('function');
    backgroundOpen.createWindow({});
    const backgroundContents = harness.views.at(-1)!.webContents;
    expect(backgroundContents.loadURL).toHaveBeenCalledWith('https://chatgpt.com/c/background');

    const foregroundOpen = handler({
      url: 'https://example.com/foreground',
      disposition: 'foreground-tab',
    });
    expect(foregroundOpen.action).toBe('allow');
    expect(typeof foregroundOpen.createWindow).toBe('function');
    const guestView = new WebContentsView();
    const foregroundGuest = guestView.webContents;
    harness.views.pop();
    const returnedForegroundContents = foregroundOpen.createWindow({
      webContents: foregroundGuest,
    } as never);
    expect(returnedForegroundContents).toBe(foregroundGuest);
    expect(sourceContents.loadURL).toHaveBeenCalledTimes(1);

    const requests = bridge.takeOpenRequests(ownerKey);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(expect.objectContaining({
      url: 'https://chatgpt.com/c/background',
      activate: false,
      tabId: expect.any(String),
    }));
    expect(requests[1]).toEqual(expect.objectContaining({
      url: 'https://example.com/foreground',
      activate: true,
      tabId: expect.any(String),
    }));
    expect(bridge.getTab(ownerKey, requests[0]!.tabId)?.live).toBe(true);
    expect(bridge.getTab(ownerKey, requests[1]!.tabId)?.live).toBe(true);
    expect(bridge.takeOpenRequests(ownerKey)).toEqual([]);
    expect(bridge.getTab(ownerKey, sourceId)?.live).toBe(true);
  });

  it('scopes the same persisted tab id independently per owning surface', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });
    const tabId = '77777777-7777-4777-8777-777777777777';
    const otherOwner = {
      ...context,
      ownerKey: '1:surface-b',
    };

    const first = await bridge.openTab(context, tabId, 'https://example.com/a', rect);
    const second = await bridge.openTab(otherOwner, tabId, 'https://example.com/b', rect);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(harness.views).toHaveLength(2);
    expect(bridge.getTab(context.ownerKey, tabId)?.url).toBe('https://example.com/a');
    expect(bridge.getTab(otherOwner.ownerKey, tabId)?.url).toBe('https://example.com/b');
  });
});
