import { randomUUID } from 'node:crypto';
import { app, BaseWindow, WebContentsView, type NavigationEntry, type Session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

import type { PreviewHostContext, PreviewRect } from './windowsPreviewHandlerBridge';

interface LiveWebBrowser {
  id: string;
  ownerKey: string;
  window: BaseWindow;
  view: WebContentsView;
  localRect: PreviewRect;
  surfaceBounds: PreviewRect;
  presented: boolean;
  sourceUrl: string;
  zoomFactor: number;
}

interface DurableBrowserTab {
  tabId: string;
  ownerKey: string;
  window: BaseWindow;
  view: WebContentsView | null;
  localRect: PreviewRect;
  surfaceBounds: PreviewRect;
  presented: boolean;
  url: string;
  title: string;
  zoomFactor: number;
  lastActiveAt: number;
  history: { entries: NavigationEntry[]; index: number } | null;
  crashed: boolean;
}

export interface BrowserTabState {
  tabId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  live: boolean;
  crashed: boolean;
}

export interface BrowserDownloadState {
  id: string;
  filename: string;
  path: string;
  url: string;
  receivedBytes: number;
  totalBytes: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: number;
}

export interface BrowserAdblockState {
  enabled: boolean;
  status: 'loading' | 'enabled' | 'disabled' | 'failed';
  error?: string;
}

type BrowserTabResult = { ok: true; tab: BrowserTabState } | { ok: false; error?: string };

export interface WebBrowserHostBridge {
  open(
    context: PreviewHostContext,
    url: string,
    localRect: PreviewRect,
  ): Promise<{ ok: true; sessionId: string; url: string } | { ok: false; error?: string }>;
  move(ownerKey: string, sessionId: string, localRect: PreviewRect): boolean;
  close(ownerKey: string, sessionId: string): boolean;
  openTab(context: PreviewHostContext, tabId: string, url: string, localRect: PreviewRect): Promise<BrowserTabResult>;
  activateTab(context: PreviewHostContext, tabId: string, localRect: PreviewRect): Promise<BrowserTabResult>;
  navigateTab(ownerKey: string, tabId: string, url: string): Promise<BrowserTabResult>;
  commandTab(ownerKey: string, tabId: string, command: 'back' | 'forward' | 'reload'): BrowserTabResult;
  moveTab(ownerKey: string, tabId: string, localRect: PreviewRect): boolean;
  closeTab(ownerKey: string, tabId: string): boolean;
  setTabsVisible(ownerKey: string, visible: boolean): void;
  getTab(ownerKey: string, tabId: string): BrowserTabState | null;
  getDownloads(): BrowserDownloadState[];
  getAdblockState(): BrowserAdblockState;
  setAdblockEnabled(enabled: boolean): Promise<BrowserAdblockState>;
  setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewRect): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  closeOwner(ownerKey: string): void;
  raiseWindow(windowId: number): void;
  dispose(): void;
}

const BROWSER_PARTITION = 'persist:papers-web-browser';
const MAX_LIVE_TABS_PER_OWNER = 3;
const MAX_RECENT_DOWNLOADS = 50;
const hardenedBrowserSessions = new WeakSet<Session>();

/**
 * Browser sites use the Storage Access API to regain first-party cookie/storage
 * access across login/account boundaries. Denying it unconditionally breaks
 * legitimate sign-in flows (X was the concrete regression that exposed this).
 *
 * Keep the browser narrow: this does NOT grant camera/mic/geolocation/device
 * permissions. It only allows Chromium's storage-access capability inside the
 * dedicated persistent browser partition.
 */
export function browserPermissionAllowed(permission: string): boolean {
  return permission === 'storage-access';
}

function hardenBrowserSession(browserSession: Session): void {
  if (hardenedBrowserSessions.has(browserSession)) return;
  hardenedBrowserSessions.add(browserSession);
  browserSession.setPermissionRequestHandler((_webContents, permission, callback) => (
    callback(browserPermissionAllowed(permission))
  ));
  browserSession.setPermissionCheckHandler((_webContents, permission) => (
    browserPermissionAllowed(permission)
  ));
  browserSession.setCertificateVerifyProc((request, callback) => {
    const hostname = request.hostname.toLocaleLowerCase().replace(/^\[|\]$/g, '');
    const loopback = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
    const authorityOnly = request.errorCode === -202
      || request.verificationResult === 'net::ERR_CERT_AUTHORITY_INVALID'
      || request.verificationResult === 'CERT_AUTHORITY_INVALID';
    callback(loopback && authorityOnly ? 0 : -3);
  });
}

function validRect(rect: PreviewRect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0
    && Math.abs(rect.x) <= 100_000
    && Math.abs(rect.y) <= 100_000
    && rect.width <= 100_000
    && rect.height <= 100_000;
}

function absoluteRect(surface: PreviewRect, local: PreviewRect): PreviewRect {
  return {
    x: Math.round(surface.x + local.x),
    y: Math.round(surface.y + local.y),
    width: Math.round(local.width),
    height: Math.round(local.height),
  };
}

function safeWebUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

export function createWebBrowserHostBridge(input: {
  resolveWindow(ownerKey: string): BaseWindow | null;
}): WebBrowserHostBridge {
  const sessions = new Map<string, LiveWebBrowser>();
  const owners = new Map<string, string>();
  const tabs = new Map<string, DurableBrowserTab>();
  const ownerTabs = new Map<string, Set<string>>();
  const activeTabs = new Map<string, string>();
  const downloads: BrowserDownloadState[] = [];
  const downloadSessions = new WeakSet<Session>();
  const adblockSessions = new Set<Session>();
  let adblockDesired = true;
  let adblockStatus: BrowserAdblockState['status'] = 'loading';
  let adblockError: string | undefined;
  let blocker: ElectronBlocker | null = null;
  let blockerPromise: Promise<ElectronBlocker> | null = null;
  const tabKey = (ownerKey: string, tabId: string): string => ownerKey + '\n' + tabId;

  const enableBrowserDownloads = (browserSession: Session): void => {
    if (downloadSessions.has(browserSession)) return;
    downloadSessions.add(browserSession);
    try { browserSession.setDownloadPath(app.getPath('downloads')); } catch { /* use Electron default */ }
    browserSession.on('will-download', (_event, item) => {
      const record: BrowserDownloadState = {
        id: randomUUID(),
        filename: item.getFilename(),
        path: item.getSavePath(),
        url: item.getURL(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        state: 'progressing',
        startedAt: Date.now(),
      };
      downloads.unshift(record);
      if (downloads.length > MAX_RECENT_DOWNLOADS) downloads.length = MAX_RECENT_DOWNLOADS;
      const sync = (state: BrowserDownloadState['state'] = record.state) => {
        record.filename = item.getFilename();
        record.path = item.getSavePath();
        record.url = item.getURL();
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.state = state;
      };
      item.on('updated', (_itemEvent, state) => {
        if (state === 'progressing' || state === 'interrupted') sync(state);
      });
      item.once('done', (_itemEvent, state) => sync(state));
    });
  };

  const loadBlocker = (): Promise<ElectronBlocker> => {
    if (blocker) return Promise.resolve(blocker);
    if (!blockerPromise) {
      // Tracking-list blocking broke real account authentication (X was the
      // observed case). Keep the useful ad blocker without treating identity,
      // SSO and account telemetry endpoints as trackers to be destroyed.
      blockerPromise = ElectronBlocker.fromPrebuiltAdsOnly(fetch)
        .then((loaded) => {
          blocker = loaded;
          return loaded;
        })
        .catch((error) => {
          blockerPromise = null;
          throw error;
        });
    }
    return blockerPromise;
  };

  const syncAdblockSession = async (browserSession: Session): Promise<void> => {
    adblockSessions.add(browserSession);
    if (!adblockDesired) {
      if (blocker?.isBlockingEnabled(browserSession)) blocker.disableBlockingInSession(browserSession);
      adblockStatus = 'disabled';
      return;
    }
    adblockStatus = 'loading';
    adblockError = undefined;
    try {
      const loaded = await loadBlocker();
      if (!adblockDesired) {
        adblockStatus = 'disabled';
        return;
      }
      if (!loaded.isBlockingEnabled(browserSession)) loaded.enableBlockingInSession(browserSession);
      adblockStatus = 'enabled';
    } catch (error) {
      adblockStatus = 'failed';
      adblockError = boundedError(error);
    }
  };

  const adblockState = (): BrowserAdblockState => ({
    enabled: adblockDesired,
    status: adblockStatus,
    ...(adblockError ? { error: adblockError } : {}),
  });

  const forget = (session: LiveWebBrowser): void => {
    if (sessions.get(session.id) === session) sessions.delete(session.id);
    if (owners.get(session.ownerKey) === session.id) owners.delete(session.ownerKey);
  };

  const cleanupSession = (session: LiveWebBrowser): void => {
    forget(session);
    if (session.presented && !session.window.isDestroyed()) {
      try { session.window.contentView.removeChildView(session.view); } catch { /* best effort */ }
    }
    session.presented = false;
    if (!session.view.webContents.isDestroyed()) {
      try { session.view.webContents.close(); } catch { /* best effort */ }
    }
  };

  const place = (session: LiveWebBrowser): void => {
    if (session.window.isDestroyed() || session.view.webContents.isDestroyed()) return;
    session.view.setBounds(absoluteRect(session.surfaceBounds, session.localRect));
  };

  // A browser view may be physically reused across repeated opens, but the
  // caller's sessionId is a lease, not the lifetime identity of that view.
  // Rotate the lease on every reuse so an async close from an older render
  // cannot tear down the browser now owned by a newer render.
  const renewLease = (session: LiveWebBrowser): void => {
    const previousId = session.id;
    if (sessions.get(previousId) === session) sessions.delete(previousId);
    session.id = randomUUID();
    sessions.set(session.id, session);
    owners.set(session.ownerKey, session.id);
  };
  const closeOwner = (ownerKey: string): void => {
    const id = owners.get(ownerKey);
    const session = id ? sessions.get(id) : undefined;
    if (session) cleanupSession(session);
  };

  const tabState = (tab: DurableBrowserTab): BrowserTabState => {
    const contents = tab.view?.webContents;
    return {
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      canGoBack: Boolean(contents && !contents.isDestroyed() && contents.navigationHistory.canGoBack()),
      canGoForward: Boolean(contents && !contents.isDestroyed() && contents.navigationHistory.canGoForward()),
      live: Boolean(contents && !contents.isDestroyed()),
      crashed: tab.crashed,
    };
  };

  const detachTab = (tab: DurableBrowserTab): void => {
    if (!tab.view || !tab.presented || tab.window.isDestroyed()) return;
    try { tab.window.contentView.removeChildView(tab.view); } catch { /* best effort */ }
    tab.presented = false;
  };

  const snapshotTabHistory = (tab: DurableBrowserTab): void => {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    try {
      const entries = contents.navigationHistory.getAllEntries();
      if (entries.length > 0) tab.history = { entries, index: contents.navigationHistory.getActiveIndex() };
    } catch { /* best effort */ }
  };

  const hibernateTab = (tab: DurableBrowserTab): void => {
    if (!tab.view) return;
    snapshotTabHistory(tab);
    detachTab(tab);
    const contents = tab.view.webContents;
    tab.view = null;
    if (!contents.isDestroyed()) {
      try { contents.close(); } catch { /* best effort */ }
    }
  };

  const placeTab = (tab: DurableBrowserTab): void => {
    if (!tab.view || tab.window.isDestroyed() || tab.view.webContents.isDestroyed()) return;
    tab.view.setBounds(absoluteRect(tab.surfaceBounds, tab.localRect));
  };

  const enforceLiveLimit = (ownerKey: string, keepTabId: string): void => {
    const live = [...(ownerTabs.get(ownerKey) ?? [])]
      .map((id) => tabs.get(tabKey(ownerKey, id)))
      .filter((tab): tab is DurableBrowserTab => Boolean(tab?.view && !tab.view.webContents.isDestroyed()));
    const candidates = live
      .filter((tab) => tab.tabId !== keepTabId)
      .sort((left, right) => left.lastActiveAt - right.lastActiveAt);
    while (live.length > MAX_LIVE_TABS_PER_OWNER && candidates.length > 0) {
      const victim = candidates.shift();
      if (!victim) break;
      hibernateTab(victim);
      live.splice(live.indexOf(victim), 1);
    }
  };

  const wireTabView = (tab: DurableBrowserTab, view: WebContentsView): void => {
    const contents = view.webContents;
    hardenBrowserSession(contents.session);
    enableBrowserDownloads(contents.session);
    void syncAdblockSession(contents.session);
    // A visible browser may be temporarily occluded by Papers UI such as the
    // Lens crop overlay. Chromium's background throttling stalls timers/network
    // work in that case; ChatGPT streaming was the concrete regression. The
    // live-tab cap already bounds renderer cost, so live browser tabs stay
    // unthrottled and hibernation remains the memory-control mechanism.
    contents.setBackgroundThrottling(false);
    contents.on('will-navigate', (event, nextUrl) => {
      if (safeWebUrl(nextUrl)) return;
      event.preventDefault();
    });
    contents.on('did-navigate', (_event, nextUrl) => {
      const safe = safeWebUrl(nextUrl);
      if (safe) tab.url = safe;
    });
    contents.on('did-navigate-in-page', (_event, nextUrl) => {
      const safe = safeWebUrl(nextUrl);
      if (safe) tab.url = safe;
    });
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      tab.title = String(title || '').slice(0, 500);
    });
    contents.on('render-process-gone', () => { tab.crashed = true; });
    contents.on('zoom-changed', (_event, direction) => {
      const factor = direction === 'in' ? 1.1 : (1 / 1.1);
      tab.zoomFactor = Math.max(0.5, Math.min(2.5, Number((tab.zoomFactor * factor).toFixed(3))));
      contents.setZoomFactor(tab.zoomFactor);
    });
    contents.setWindowOpenHandler(({ url: nextUrl }) => {
      const safe = safeWebUrl(nextUrl);
      if (safe) void contents.loadURL(safe).catch(() => {});
      return { action: 'deny' };
    });
    contents.once('destroyed', () => {
      if (tab.view === view) tab.view = null;
    });
  };

  const ensureTabView = async (tab: DurableBrowserTab): Promise<void> => {
    if (tab.view && !tab.view.webContents.isDestroyed()) return;
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        partition: BROWSER_PARTITION,
      },
    });
    tab.view = view;
    tab.crashed = false;
    wireTabView(tab, view);
    if (tab.history?.entries?.length) {
      void view.webContents.navigationHistory.restore({ entries: tab.history.entries, index: tab.history.index })
        .catch(() => view.webContents.loadURL(tab.url).catch(() => {}));
      return;
    }
    void view.webContents.loadURL(tab.url).catch(() => {});
  };

  const presentTab = async (tab: DurableBrowserTab): Promise<void> => {
    await ensureTabView(tab);
    if (!tab.view || tab.window.isDestroyed() || tab.view.webContents.isDestroyed()) return;
    if (!tab.presented) {
      tab.window.contentView.addChildView(tab.view);
      tab.presented = true;
    }
    placeTab(tab);
  };

  const activateDurableTab = async (tab: DurableBrowserTab): Promise<void> => {
    const previousId = activeTabs.get(tab.ownerKey);
    if (previousId && previousId !== tab.tabId) {
      const previous = tabs.get(tabKey(tab.ownerKey, previousId));
      if (previous) detachTab(previous);
    }
    tab.lastActiveAt = Date.now();
    activeTabs.set(tab.ownerKey, tab.tabId);
    await presentTab(tab);
    enforceLiveLimit(tab.ownerKey, tab.tabId);
  };

  const cleanupTab = (tab: DurableBrowserTab): void => {
    hibernateTab(tab);
    tabs.delete(tabKey(tab.ownerKey, tab.tabId));
    const ids = ownerTabs.get(tab.ownerKey);
    ids?.delete(tab.tabId);
    if (ids && ids.size === 0) ownerTabs.delete(tab.ownerKey);
    if (activeTabs.get(tab.ownerKey) === tab.tabId) activeTabs.delete(tab.ownerKey);
  };

  const closeOwnerTabs = (ownerKey: string): void => {
    for (const tabId of [...(ownerTabs.get(ownerKey) ?? [])]) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      if (tab) cleanupTab(tab);
    }
  };

  const setOwnerTabsVisible = (ownerKey: string, visible: boolean): void => {
    const activeId = activeTabs.get(ownerKey);
    const active = activeId ? tabs.get(tabKey(ownerKey, activeId)) : undefined;
    if (!active) return;
    if (visible) void presentTab(active).catch(() => {});
    else detachTab(active);
  };

  return {
    async open(context, rawUrl, localRect) {
      const url = safeWebUrl(rawUrl);
      if (!url) return { ok: false, error: 'Only http and https links can open in the link viewer.' };
      if (!validRect(context.surfaceBounds) || !validRect(localRect)) {
        return { ok: false, error: 'Invalid link-viewer geometry.' };
      }

      const existingId = owners.get(context.ownerKey);
      const existing = existingId ? sessions.get(existingId) : undefined;
      if (existing && !existing.window.isDestroyed() && !existing.view.webContents.isDestroyed()) {
        existing.localRect = { ...localRect };
        existing.surfaceBounds = { ...context.surfaceBounds };
        if (!existing.presented) {
          existing.window.contentView.addChildView(existing.view);
          existing.presented = true;
        }
        place(existing);
        renewLease(existing);
        if (existing.sourceUrl === url) {
          return { ok: true, sessionId: existing.id, url };
        }
        try {
          await existing.view.webContents.loadURL(url);
          existing.sourceUrl = url;
          return { ok: true, sessionId: existing.id, url };
        } catch (error) {
          cleanupSession(existing);
          return { ok: false, error: boundedError(error) };
        }
      }

      closeOwner(context.ownerKey);
      const window = input.resolveWindow(context.ownerKey);
      if (!window || window.isDestroyed()) {
        return { ok: false, error: 'The owning Papers window is unavailable.' };
      }

      const view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          partition: BROWSER_PARTITION,
        },
      });
      const contents = view.webContents;
      hardenBrowserSession(contents.session);
      enableBrowserDownloads(contents.session);
      void syncAdblockSession(contents.session);
      contents.on('will-navigate', (event, nextUrl) => {
        if (safeWebUrl(nextUrl)) return;
        event.preventDefault();
      });
      contents.setWindowOpenHandler(({ url: nextUrl }) => {
        const safe = safeWebUrl(nextUrl);
        if (safe) void contents.loadURL(safe).catch(() => {});
        return { action: 'deny' };
      });

      const session: LiveWebBrowser = {
        id: randomUUID(),
        ownerKey: context.ownerKey,
        window,
        view,
        localRect: { ...localRect },
        surfaceBounds: { ...context.surfaceBounds },
        presented: false,
        sourceUrl: url,
        zoomFactor: 1,
      };
      contents.on('zoom-changed', (_event, direction) => {
        const factor = direction === 'in' ? 1.1 : (1 / 1.1);
        session.zoomFactor = Math.max(0.5, Math.min(2.5, Number((session.zoomFactor * factor).toFixed(3))));
        contents.setZoomFactor(session.zoomFactor);
      });
      sessions.set(session.id, session);
      owners.set(session.ownerKey, session.id);
      contents.once('destroyed', () => {
        if (sessions.get(session.id) === session) forget(session);
      });

      try {
        window.contentView.addChildView(view);
        session.presented = true;
        place(session);
        await contents.loadURL(url);
        return { ok: true, sessionId: session.id, url };
      } catch (error) {
        cleanupSession(session);
        return { ok: false, error: boundedError(error) };
      }
    },

    move(ownerKey, sessionId, localRect) {
      const session = sessions.get(sessionId);
      if (!session || session.ownerKey !== ownerKey || !validRect(localRect)) return false;
      session.localRect = { ...localRect };
      place(session);
      return true;
    },

    close(ownerKey, sessionId) {
      const session = sessions.get(sessionId);
      if (!session || session.ownerKey !== ownerKey) return false;
      cleanupSession(session);
      return true;
    },

    async openTab(context, tabId, rawUrl, localRect) {
      const url = safeWebUrl(rawUrl);
      if (!url) return { ok: false, error: 'Only http and https links can open in the browser.' };
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(tabId)) return { ok: false, error: 'Invalid browser tab id.' };
      if (!validRect(context.surfaceBounds) || !validRect(localRect)) return { ok: false, error: 'Invalid browser geometry.' };
      const existing = tabs.get(tabKey(context.ownerKey, tabId));
      const window = input.resolveWindow(context.ownerKey);
      if (!window || window.isDestroyed()) return { ok: false, error: 'The owning Papers window is unavailable.' };

      const tab = existing ?? {
        tabId,
        ownerKey: context.ownerKey,
        window,
        view: null,
        localRect: { ...localRect },
        surfaceBounds: { ...context.surfaceBounds },
        presented: false,
        url,
        title: '',
        zoomFactor: 1,
        lastActiveAt: Date.now(),
        history: null,
        crashed: false,
      };

      if (!existing) {
        tabs.set(tabKey(context.ownerKey, tabId), tab);
        const ids = ownerTabs.get(context.ownerKey) ?? new Set<string>();
        ids.add(tabId);
        ownerTabs.set(context.ownerKey, ids);
      }

      tab.window = window;
      tab.localRect = { ...localRect };
      tab.surfaceBounds = { ...context.surfaceBounds };
      if (tab.url !== url) {
        tab.url = url;
        tab.history = null;
        if (tab.view && !tab.view.webContents.isDestroyed()) void tab.view.webContents.loadURL(url).catch(() => {});
      }

      try {
        await activateDurableTab(tab);
        return { ok: true, tab: tabState(tab) };
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },

    async activateTab(context, tabId, localRect) {
      const tab = tabs.get(tabKey(context.ownerKey, tabId));
      if (!tab || tab.ownerKey !== context.ownerKey || !validRect(context.surfaceBounds) || !validRect(localRect)) {
        return { ok: false, error: 'Browser tab is unavailable.' };
      }
      tab.surfaceBounds = { ...context.surfaceBounds };
      tab.localRect = { ...localRect };
      try {
        await activateDurableTab(tab);
        return { ok: true, tab: tabState(tab) };
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },

    async navigateTab(ownerKey, tabId, rawUrl) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      const url = safeWebUrl(rawUrl);
      if (!tab || tab.ownerKey !== ownerKey || !url) return { ok: false, error: 'Browser navigation is unavailable.' };
      try {
        tab.history = null;
        tab.url = url;
        await ensureTabView(tab);
        if (!tab.view) return { ok: false, error: 'Browser tab is unavailable.' };
        void tab.view.webContents.loadURL(url).catch(() => {});
        tab.lastActiveAt = Date.now();
        return { ok: true, tab: tabState(tab) };
      } catch (error) {
        return { ok: false, error: boundedError(error) };
      }
    },

    commandTab(ownerKey, tabId, command) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      const contents = tab?.view?.webContents;
      if (!tab || tab.ownerKey !== ownerKey || !contents || contents.isDestroyed()) {
        return { ok: false, error: 'Browser tab is not live.' };
      }
      if (command === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      else if (command === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      else if (command === 'reload') contents.reload();
      tab.lastActiveAt = Date.now();
      return { ok: true, tab: tabState(tab) };
    },

    moveTab(ownerKey, tabId, localRect) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      if (!tab || tab.ownerKey !== ownerKey || !validRect(localRect)) return false;
      tab.localRect = { ...localRect };
      placeTab(tab);
      return true;
    },

    closeTab(ownerKey, tabId) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      if (!tab || tab.ownerKey !== ownerKey) return false;
      cleanupTab(tab);
      return true;
    },

    setTabsVisible(ownerKey, visible) {
      setOwnerTabsVisible(ownerKey, visible);
    },

    getTab(ownerKey, tabId) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      if (!tab || tab.ownerKey !== ownerKey) return null;
      return tabState(tab);
    },

    getDownloads() {
      return downloads.map((download) => ({ ...download }));
    },

    getAdblockState() {
      return adblockState();
    },

    async setAdblockEnabled(enabled) {
      adblockDesired = enabled;
      adblockError = undefined;
      if (!enabled) {
        for (const browserSession of adblockSessions) {
          if (blocker?.isBlockingEnabled(browserSession)) blocker.disableBlockingInSession(browserSession);
        }
        adblockStatus = 'disabled';
        return adblockState();
      }
      await Promise.all([...adblockSessions].map((browserSession) => syncAdblockSession(browserSession)));
      return adblockState();
    },

    setOwnerSurfaceBounds(ownerKey, bounds) {
      if (!validRect(bounds)) return;
      const id = owners.get(ownerKey);
      const session = id ? sessions.get(id) : undefined;
      if (session) {
        session.surfaceBounds = { ...bounds };
        place(session);
      }
      for (const tabId of ownerTabs.get(ownerKey) ?? []) {
        const tab = tabs.get(tabKey(ownerKey, tabId));
        if (!tab) continue;
        tab.surfaceBounds = { ...bounds };
        placeTab(tab);
      }
    },

    setOwnerVisible(ownerKey, visible) {
      const id = owners.get(ownerKey);
      const session = id ? sessions.get(id) : undefined;
      if (session && !session.window.isDestroyed() && !session.view.webContents.isDestroyed()) {
        if (visible) {
          if (!session.presented) {
            session.window.contentView.addChildView(session.view);
            session.presented = true;
          }
          place(session);
        } else if (session.presented) {
          session.window.contentView.removeChildView(session.view);
          session.presented = false;
        }
      }
      setOwnerTabsVisible(ownerKey, visible);
    },

    closeOwner(ownerKey) {
      closeOwner(ownerKey);
      closeOwnerTabs(ownerKey);
    },

    raiseWindow(windowId) {
      for (const session of sessions.values()) {
        if (session.window.id !== windowId || !session.presented
          || session.window.isDestroyed() || session.view.webContents.isDestroyed()) continue;
        session.window.contentView.addChildView(session.view);
        place(session);
      }
      for (const tab of tabs.values()) {
        if (tab.window.id !== windowId || !tab.presented || !tab.view
          || tab.window.isDestroyed() || tab.view.webContents.isDestroyed()) continue;
        tab.window.contentView.addChildView(tab.view);
        placeTab(tab);
      }
    },

    dispose() {
      for (const session of [...sessions.values()]) cleanupSession(session);
      for (const tab of [...tabs.values()]) cleanupTab(tab);
    },
  };
}