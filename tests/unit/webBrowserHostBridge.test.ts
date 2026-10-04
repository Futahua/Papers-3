import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BaseWindow, WebContentsView } from 'electron';
import { createWebBrowserHostBridge } from '../../src/main/backpacks/webBrowserHostBridge';

type FakeSession = {
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
};

const harness = vi.hoisted(() => ({
  window: {
    destroyed: false,
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  },
  views: [] as FakeView[],
}));

vi.mock('electron', () => ({
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
  } as unknown as typeof BaseWindow,
  WebContentsView: class {
    webContents: FakeWebContents;
    setBounds = vi.fn();
    constructor() {
      const webContents: FakeWebContents = {
        destroyed: false,
        session: {
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
  it('enables normal browser downloads into the user Downloads folder', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });
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

    const foregroundOpen = handler({
      url: 'https://example.com/foreground',
      disposition: 'foreground-tab',
    });
    expect(foregroundOpen.action).toBe('allow');
    expect(typeof foregroundOpen.createWindow).toBe('function');
    foregroundOpen.createWindow({});
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
