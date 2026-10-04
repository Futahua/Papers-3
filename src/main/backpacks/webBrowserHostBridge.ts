import { randomUUID } from 'node:crypto';
import {
  app,
  BaseWindow,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  WebContentsView,
  type Display,
  type NativeImage,
  type NavigationEntry,
  type Session,
  type WebContents,
} from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

import type { PreviewHostContext, PreviewRect } from './windowsPreviewHandlerBridge';
import { AtomicJsonStore } from '../persistence/atomicStore';

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
type BrowserLensResult = BrowserTabResult | { ok: false; cancelled: true };

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
  getDownloads(): Promise<BrowserDownloadState[]>;
  getAdblockState(): BrowserAdblockState;
  setAdblockEnabled(enabled: boolean): Promise<BrowserAdblockState>;
  captureLensRegion(ownerKey: string, sourceTabId: string, targetTabId: string): Promise<BrowserLensResult>;
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

interface BrowserDownloadHistoryFile {
  schemaVersion: 1;
  downloads: BrowserDownloadState[];
}

function validDownloadState(value: unknown): value is BrowserDownloadState {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<BrowserDownloadState>;
  return typeof entry.id === 'string'
    && typeof entry.filename === 'string'
    && typeof entry.path === 'string'
    && typeof entry.url === 'string'
    && Number.isFinite(entry.receivedBytes)
    && Number.isFinite(entry.totalBytes)
    && Number.isFinite(entry.startedAt)
    && ['progressing', 'completed', 'cancelled', 'interrupted'].includes(String(entry.state));
}

function validateDownloadHistory(value: unknown): string | null {
  if (!value || typeof value !== 'object') return 'expected object';
  const history = value as Partial<BrowserDownloadHistoryFile>;
  if (history.schemaVersion !== 1) return 'unsupported schemaVersion';
  if (!Array.isArray(history.downloads)) return 'downloads must be an array';
  if (history.downloads.length > MAX_RECENT_DOWNLOADS) return 'too many downloads';
  return history.downloads.every(validDownloadState) ? null : 'invalid download record';
}

function hardenBrowserSession(browserSession: Session): void {
  if (hardenedBrowserSessions.has(browserSession)) return;
  hardenedBrowserSessions.add(browserSession);
  const allowStorageAccess = (permission: string, origin: string | undefined): boolean =>
    (permission === 'storage-access' || permission === 'top-level-storage-access')
    && Boolean(origin && safeWebUrl(origin));
  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(allowStorageAccess(permission, details.requestingUrl));
  });
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    allowStorageAccess(permission, requestingOrigin));
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

interface LensDisplayCapture {
  display: Display;
  image: NativeImage;
}

interface LensSelection {
  displayId: number;
  rect: PreviewRect;
}

interface LensCrop {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

function lensOverlayHtml(channel: string, displayId: number, screenshot: string): string {
  const channelJson = JSON.stringify(channel);
  const displayIdJson = JSON.stringify(displayId);
  const screenshotJson = JSON.stringify(screenshot);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111;cursor:crosshair;user-select:none}
  #shot{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none}
  #shade{position:absolute;inset:0;background:rgba(0,0,0,.34);pointer-events:none}
  #sel{position:absolute;display:none;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 99999px rgba(0,0,0,.34);pointer-events:none}
  #hint{position:absolute;left:50%;top:22px;transform:translateX(-50%);padding:8px 14px;border-radius:18px;background:rgba(20,20,20,.82);color:#fff;font:13px system-ui,sans-serif;pointer-events:none}
</style>
</head>
<body>
  <img id="shot">
  <div id="shade"></div>
  <div id="sel"></div>
  <div id="hint">Drag to search with Lens · Esc to cancel</div>
<script>
  const { ipcRenderer } = require('electron');
  const channel = ${channelJson};
  const displayId = ${displayIdJson};
  const shot = document.getElementById('shot');
  shot.src = ${screenshotJson};
  const shade = document.getElementById('shade');
  const sel = document.getElementById('sel');
  let start = null;
  let current = null;
  const draw = () => {
    if (!start || !current) return;
    const x = Math.min(start.x,current.x), y = Math.min(start.y,current.y);
    const w = Math.abs(current.x-start.x), h = Math.abs(current.y-start.y);
    shade.style.display = 'none';
    sel.style.display = 'block';
    sel.style.left = x+'px'; sel.style.top = y+'px'; sel.style.width = w+'px'; sel.style.height = h+'px';
  };
  addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    start = {x:e.clientX,y:e.clientY}; current = start;
    document.body.setPointerCapture?.(e.pointerId);
    draw();
  });
  addEventListener('pointermove', e => {
    if (!start) return;
    current = {x:e.clientX,y:e.clientY}; draw();
  });
  addEventListener('pointerup', e => {
    if (!start || e.button !== 0) return;
    current = {x:e.clientX,y:e.clientY}; draw();
    const x = Math.min(start.x,current.x), y = Math.min(start.y,current.y);
    const width = Math.abs(current.x-start.x), height = Math.abs(current.y-start.y);
    if (width >= 4 && height >= 4) ipcRenderer.send(channel,{kind:'select',displayId,rect:{x,y,width,height}});
    else { start = null; current = null; shade.style.display = ''; sel.style.display = 'none'; }
  });
  addEventListener('keydown', e => {
    if (e.key === 'Escape') ipcRenderer.send(channel,{kind:'cancel'});
  });
</script>
</body>
</html>`;
}

async function captureLensDisplays(): Promise<LensDisplayCapture[]> {
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return [];
  const thumbnailSize = displays.reduce((largest, display) => ({
    width: Math.max(largest.width, Math.ceil(display.size.width * display.scaleFactor)),
    height: Math.max(largest.height, Math.ceil(display.size.height * display.scaleFactor)),
  }), { width: 1, height: 1 });
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
    fetchWindowIcons: false,
  });
  return displays.flatMap((display) => {
    const source = sources.find((candidate) => candidate.display_id === String(display.id));
    return source && !source.thumbnail.isEmpty() ? [{ display, image: source.thumbnail }] : [];
  });
}

async function pickLensRegion(): Promise<{ capture: LensDisplayCapture; rect: PreviewRect } | null> {
  const captures = await captureLensDisplays();
  if (captures.length === 0) throw new Error('No screen is available for Lens capture.');
  const channel = `papers:lens-region:${randomUUID()}`;
  const overlays: BrowserWindow[] = [];
  let finished = false;
  const closeOverlays = (): void => {
    for (const overlay of overlays) {
      if (!overlay.isDestroyed()) overlay.destroy();
    }
  };
  return await new Promise((resolve, reject) => {
    const finish = (selection: LensSelection | null): void => {
      if (finished) return;
      finished = true;
      ipcMain.removeAllListeners(channel);
      closeOverlays();
      if (!selection) {
        resolve(null);
        return;
      }
      const capture = captures.find((candidate) => candidate.display.id === selection.displayId);
      if (!capture) {
        reject(new Error('The selected display is no longer available.'));
        return;
      }
      resolve({ capture, rect: selection.rect });
    };
    ipcMain.on(channel, (event, payload: unknown) => {
      if (!overlays.some((overlay) => !overlay.isDestroyed() && overlay.webContents.id === event.sender.id)) return;
      if (!payload || typeof payload !== 'object') return;
      const value = payload as { kind?: unknown; displayId?: unknown; rect?: Partial<PreviewRect> };
      if (value.kind === 'cancel') {
        finish(null);
        return;
      }
      if (value.kind !== 'select' || !Number.isSafeInteger(value.displayId)) return;
      const rect = value.rect;
      if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
        || Number(rect.width) < 4 || Number(rect.height) < 4) return;
      finish({
        displayId: Number(value.displayId),
        rect: {
          x: Math.max(0, Number(rect.x)),
          y: Math.max(0, Number(rect.y)),
          width: Number(rect.width),
          height: Number(rect.height),
        },
      });
    });
    try {
      for (const capture of captures) {
        const bounds = capture.display.bounds;
        const overlay = new BrowserWindow({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          frame: false,
          transparent: false,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          show: false,
          backgroundColor: '#111111',
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
            webSecurity: true,
          },
        });
        overlays.push(overlay);
        overlay.setAlwaysOnTop(true, 'screen-saver');
        overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        overlay.webContents.on('will-navigate', (event) => event.preventDefault());
        overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        overlay.once('closed', () => {
          if (!finished && overlays.every((candidate) => candidate.isDestroyed())) finish(null);
        });
        const html = lensOverlayHtml(channel, capture.display.id, capture.image.toDataURL());
        void overlay.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
          .then(() => {
            if (finished || overlay.isDestroyed()) return;
            overlay.show();
            overlay.focus();
          })
          .catch((error) => {
            if (!finished) {
              finished = true;
              ipcMain.removeAllListeners(channel);
              closeOverlays();
              reject(error);
            }
          });
      }
    } catch (error) {
      finished = true;
      ipcMain.removeAllListeners(channel);
      closeOverlays();
      reject(error);
    }
  });
}

function cropLensSelection(capture: LensDisplayCapture, rect: PreviewRect): LensCrop {
  const size = capture.image.getSize();
  const bounds = capture.display.bounds;
  const scaleX = size.width / bounds.width;
  const scaleY = size.height / bounds.height;
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x * scaleX)));
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y * scaleY)));
  const width = Math.max(1, Math.min(size.width - x, Math.round(rect.width * scaleX)));
  const height = Math.max(1, Math.min(size.height - y, Math.round(rect.height * scaleY)));
  const cropped = capture.image.crop({ x, y, width, height });
  const croppedSize = cropped.getSize();
  const longest = Math.max(croppedSize.width, croppedSize.height);
  const resizeScale = longest > 1000 ? 1000 / longest : 1;
  const processed = resizeScale < 1
    ? cropped.resize({
      width: Math.max(1, Math.round(croppedSize.width * resizeScale)),
      height: Math.max(1, Math.round(croppedSize.height * resizeScale)),
      quality: 'good',
    })
    : cropped;
  const processedSize = processed.getSize();
  return {
    jpeg: new Uint8Array(processed.toJPEG(40)),
    width: processedSize.width,
    height: processedSize.height,
  };
}

async function submitLensCrop(contents: WebContents, crop: LensCrop): Promise<string> {
  const jpegBase64 = Buffer.from(crop.jpeg).toString('base64');
  const action = new URL('https://lens.google.com/v3/upload');
  action.searchParams.set('ep', 'cntpubb');
  action.searchParams.set('hl', app.getLocale() || 'en');
  action.searchParams.set('st', Date.now().toString());
  action.searchParams.set('cd', '');
  action.searchParams.set('re', 'df');
  action.searchParams.set('s', '4');
  action.searchParams.set('vph', String(crop.height));
  action.searchParams.set('vpw', String(crop.width));
  await contents.loadURL('https://www.google.com/');
  let cancelNavigationWait = (): void => {};
  const navigation = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Google Lens did not finish loading the screen crop.'));
    }, 20_000);
    const onNavigate = (_event: unknown, nextUrl: string): void => {
      const safe = safeWebUrl(nextUrl);
      if (!safe) return;
      const parsed = new URL(safe);
      const googleHost = parsed.hostname === 'google.com'
        || parsed.hostname.endsWith('.google.com');
      if (!googleHost) return;
      if (parsed.hostname === 'www.google.com' && parsed.pathname === '/' && !parsed.search) return;
      cleanup();
      resolve(safe);
    };
    const onDestroyed = (): void => {
      cleanup();
      reject(new Error('The Lens result tab closed before the upload finished.'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      contents.removeListener('did-navigate', onNavigate);
      contents.removeListener('destroyed', onDestroyed);
    };
    cancelNavigationWait = cleanup;
    contents.on('did-navigate', onNavigate);
    contents.once('destroyed', onDestroyed);
  });
  try {
    await contents.executeJavaScript(`(() => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(jpegBase64)}), c => c.charCodeAt(0));
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = ${JSON.stringify(action.toString())};
      form.enctype = 'multipart/form-data';
      const file = document.createElement('input');
      file.type = 'file';
      file.name = 'encoded_image';
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'screen-crop.jpg', { type: 'image/jpeg' }));
      file.files = transfer.files;
      form.appendChild(file);
      const dimensions = document.createElement('input');
      dimensions.type = 'hidden';
      dimensions.name = 'processed_image_dimensions';
      dimensions.value = ${JSON.stringify(`${crop.width},${crop.height}`)};
      form.appendChild(dimensions);
      document.body.appendChild(form);
      form.submit();
    })()`);
    return await navigation;
  } catch (error) {
    cancelNavigationWait();
    throw error;
  }
}

export function createWebBrowserHostBridge(input: {
  resolveWindow(ownerKey: string): BaseWindow | null;
  downloadHistoryFile?: string;
  downloadRecoveryDir?: string;
}): WebBrowserHostBridge {
  const sessions = new Map<string, LiveWebBrowser>();
  const owners = new Map<string, string>();
  const tabs = new Map<string, DurableBrowserTab>();
  const ownerTabs = new Map<string, Set<string>>();
  const activeTabs = new Map<string, string>();
  const downloads: BrowserDownloadState[] = [];
  const downloadStore = input.downloadHistoryFile && input.downloadRecoveryDir
    ? new AtomicJsonStore(input.downloadHistoryFile, {
      recoveryDir: input.downloadRecoveryDir,
      validate: validateDownloadHistory,
    })
    : null;
  const downloadHistoryReady = downloadStore
    ? downloadStore.load<BrowserDownloadHistoryFile>()
      .then((report) => {
        const restored = report.value?.downloads ?? [];
        downloads.splice(0, downloads.length, ...restored.map((entry) => ({
          ...entry,
          state: entry.state === 'progressing' ? 'interrupted' as const : entry.state,
        })).slice(0, MAX_RECENT_DOWNLOADS));
      })
      .catch(() => undefined)
    : Promise.resolve();
  let downloadSaveQueue = Promise.resolve();
  const persistDownloads = (): void => {
    if (!downloadStore) return;
    const snapshot: BrowserDownloadHistoryFile = {
      schemaVersion: 1,
      downloads: downloads.map((entry) => ({ ...entry })).slice(0, MAX_RECENT_DOWNLOADS),
    };
    downloadSaveQueue = downloadSaveQueue
      .catch(() => undefined)
      .then(() => downloadStore.save(snapshot))
      .catch(() => undefined);
  };
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
      void downloadHistoryReady.then(() => {
        downloads.unshift(record);
        if (downloads.length > MAX_RECENT_DOWNLOADS) downloads.length = MAX_RECENT_DOWNLOADS;
        persistDownloads();
      });
      const sync = (state: BrowserDownloadState['state'] = record.state) => {
        record.filename = item.getFilename();
        record.path = item.getSavePath();
        record.url = item.getURL();
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.state = state;
        void downloadHistoryReady.then(() => persistDownloads());
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
    // Browser tabs are real long-lived web apps, not previews. Throttling a
    // covered/background tab can stall streaming responses and auth flows.
    // Memory is bounded separately by MAX_LIVE_TABS_PER_OWNER + hibernation.
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

    async getDownloads() {
      await downloadHistoryReady;
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

    async captureLensRegion(ownerKey, sourceTabId, targetTabId) {
      const sourceTab = tabs.get(tabKey(ownerKey, sourceTabId));
      if (!sourceTab || sourceTab.ownerKey !== ownerKey) return { ok: false, error: 'Browser tab is unavailable.' };
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(targetTabId)) return { ok: false, error: 'Invalid Lens result tab id.' };
      if (tabs.has(tabKey(ownerKey, targetTabId))) return { ok: false, error: 'Lens result tab already exists.' };
      let targetTab: DurableBrowserTab | null = null;
      try {
        const selection = await pickLensRegion();
        if (!selection) return { ok: false, cancelled: true };
        const crop = cropLensSelection(selection.capture, selection.rect);
        targetTab = {
          tabId: targetTabId,
          ownerKey,
          window: sourceTab.window,
          view: null,
          localRect: { ...sourceTab.localRect },
          surfaceBounds: { ...sourceTab.surfaceBounds },
          presented: false,
          url: 'https://www.google.com/',
          title: 'Google Lens',
          zoomFactor: 1,
          lastActiveAt: Date.now(),
          history: null,
          crashed: false,
        };
        tabs.set(tabKey(ownerKey, targetTabId), targetTab);
        const ids = ownerTabs.get(ownerKey) ?? new Set<string>();
        ids.add(targetTabId);
        ownerTabs.set(ownerKey, ids);
        await ensureTabView(targetTab);
        if (!targetTab.view || targetTab.view.webContents.isDestroyed()) throw new Error('Lens result tab is unavailable.');
        const resultUrl = await submitLensCrop(targetTab.view.webContents, crop);
        targetTab.url = resultUrl;
        targetTab.history = null;
        targetTab.lastActiveAt = Date.now();
        await activateDurableTab(targetTab);
        return { ok: true, tab: tabState(targetTab) };
      } catch (error) {
        if (targetTab) cleanupTab(targetTab);
        return { ok: false, error: boundedError(error) };
      }
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