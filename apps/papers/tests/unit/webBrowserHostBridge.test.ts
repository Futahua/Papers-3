import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseWindow, WebContentsView } from 'electron';
import {
  browserPermissionAllowed,
  createWebBrowserHostBridge,
} from '../../src/main/backpacks/webBrowserHostBridge';

type FakeSession = {
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  setCertificateVerifyProc: ReturnType<typeof vi.fn>;
  clearStorageData: ReturnType<typeof vi.fn>;
  clearCache: ReturnType<typeof vi.fn>;
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
  isFocused: () => boolean;
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
          on: vi.fn(),
          setCertificateVerifyProc: vi.fn(),
          clearStorageData: vi.fn().mockResolvedValue(undefined),
          clearCache: vi.fn().mockResolvedValue(undefined),
        },
        on: vi.fn(),
        once: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        setZoomFactor: vi.fn(),
        setBackgroundThrottling: vi.fn(),
        isFocused: () => true,
        isDestroyed() {
          return webContents.destroyed;
        },
      };
      this.webContents = webContents;
      harness.views.push(this);
    }
  } as unknown as typeof WebContentsView,
  session: {
    fromPartition: vi.fn(() => ({
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
      setCertificateVerifyProc: vi.fn(),
      clearStorageData: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined),
    })),
  },
  webContents: { fromId: vi.fn(() => null) },
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

describe('inline browser account compatibility', () => {
  it('allows storage access without granting device/media permissions', () => {
    expect(browserPermissionAllowed('storage-access')).toBe(true);
    expect(browserPermissionAllowed('clipboard-sanitized-write', 'https://example.com', true)).toBe(true);
    expect(browserPermissionAllowed('clipboard-read', 'http://localhost:3000/', true)).toBe(true);
    expect(browserPermissionAllowed('clipboard-read', 'https://example.com', true)).toBe(false);
    expect(browserPermissionAllowed('media')).toBe(false);
    expect(browserPermissionAllowed('geolocation')).toBe(false);
    expect(browserPermissionAllowed('notifications')).toBe(false);
  });

  it('wires the persistent browser session to the same narrow storage-access rule', async () => {
    const window = new BaseWindow();
    const bridge = createWebBrowserHostBridge({ resolveWindow: () => window });
    await bridge.open(context, url, rect);

    const browserSession = harness.views[0]!.webContents.session;
    expect(browserSession.setPermissionRequestHandler).toHaveBeenCalledOnce();
    expect(browserSession.setPermissionCheckHandler).toHaveBeenCalledOnce();

    const requestHandler = browserSession.setPermissionRequestHandler.mock.calls[0]![0];
    const checkHandler = browserSession.setPermissionCheckHandler.mock.calls[0]![0];
    const storageReply = vi.fn();
    const mediaReply = vi.fn();
    requestHandler(harness.views[0]!.webContents, 'storage-access', storageReply, {});
    requestHandler(harness.views[0]!.webContents, 'media', mediaReply, {});
    expect(storageReply).toHaveBeenCalledWith(true);
    expect(mediaReply).toHaveBeenCalledWith(false);
    expect(checkHandler(harness.views[0]!.webContents, 'storage-access', 'https://x.com', {})).toBe(true);
    expect(checkHandler(harness.views[0]!.webContents, 'media', 'https://x.com', {})).toBe(false);
  });

  it('uses ads-only blocking and keeps live browser tabs unthrottled', () => {
    const source = readFileSync(
      new URL('../../src/main/backpacks/webBrowserHostBridge.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('ElectronBlocker.fromPrebuiltAdsOnly(fetch)');
    expect(source).not.toContain('ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)');
    expect(source).toContain("'@@||chatgpt.com^$document'");
    expect(source).toContain("'@@||accounts.google.com^$document'");
    expect(source).toContain('loaded.updateFromDiff({ added: AUTH_DOCUMENT_ALLOWLIST })');
    expect(source).toContain('contents.setBackgroundThrottling(false)');
    expect(source).toContain('configureGuestRuntime(webContentsId)');
  });
});
