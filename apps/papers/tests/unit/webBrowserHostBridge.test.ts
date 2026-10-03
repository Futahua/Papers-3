import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseWindow, WebContentsView } from 'electron';
import { createWebBrowserHostBridge } from '../../src/main/backpacks/webBrowserHostBridge';

type FakeSession = {
  setPermissionRequestHandler: ReturnType<typeof vi.fn>;
  setPermissionCheckHandler: ReturnType<typeof vi.fn>;
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
        },
        on: vi.fn(),
        once: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        loadURL: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
        setZoomFactor: vi.fn(),
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
