import { randomUUID } from 'node:crypto';
import { attachBrowserDiagnostics, createBrowserDiagnosticLog } from './browserDiagnostics';
import {
  app,
  BaseWindow,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
  shell,
  WebContentsView,
  type Display,
  type NativeImage,
  type NavigationEntry,
  type Session,
  type WebContents,
} from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

import type { PreviewHostContext, PreviewRect } from './windowsPreviewHandlerBridge';
import { resolveWebLinkIcon, resolveWebLinkIconCandidate } from './backpackProjectSiteIcon';
import { AtomicJsonStore } from '../persistence/atomicStore';
import { showBrowserContextMenu, showBrowserTabMenu } from './browserContextMenu';
import { createBrowserVideoFullscreen } from './browserVideoFullscreen';
import { browserViewBounds, createBrowserPresentationGate } from './browserPresentationGate';

type FaviconFetch = NonNullable<Parameters<typeof resolveWebLinkIconCandidate>[1]>;

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
  faviconUrl: string;
  zoomFactor: number;
  lastActiveAt: number;
  history: { entries: NavigationEntry[]; index: number } | null;
  crashed: boolean;
  reservePlainTab: boolean;
}

export interface BrowserTabState {
  tabId: string;
  url: string;
  title: string;
  faviconUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  live: boolean;
  crashed: boolean;
}

export interface BrowserOpenRequest {
  tabId: string;
  url: string;
  activate: boolean;
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
  openTab(context: PreviewHostContext, tabId: string, url: string, localRect: PreviewRect, activate?: boolean, reservePlainTab?: boolean): Promise<BrowserTabResult>;
  activateTab(context: PreviewHostContext, tabId: string, localRect: PreviewRect): Promise<BrowserTabResult>;
  navigateTab(ownerKey: string, tabId: string, url: string): Promise<BrowserTabResult>;
  commandTab(ownerKey: string, tabId: string, command: 'back' | 'forward' | 'reload'): BrowserTabResult;
  moveTab(ownerKey: string, tabId: string, localRect: PreviewRect): boolean;
  closeTab(ownerKey: string, tabId: string): boolean;
  showTabMenu(ownerKey: string, tabId: string, hasOthers: boolean): Promise<'close' | 'close-others' | null>;
  setTabsVisible(ownerKey: string, visible: boolean): void;
  getTab(ownerKey: string, tabId: string): BrowserTabState | null;
  resolveFavicon(url: string): Promise<string | null>;
  takeOpenRequests(ownerKey: string): BrowserOpenRequest[];
  getDownloads(): Promise<BrowserDownloadState[]>;
  showDownloadsBubble(ownerKey: string, localRect: PreviewRect): Promise<boolean>;
  hideDownloadsBubble(ownerKey: string, immediate?: boolean): void;
  getAdblockState(): BrowserAdblockState;
  setAdblockEnabled(enabled: boolean): Promise<BrowserAdblockState>;
  captureLensScreenUrl?(): Promise<{ ok: boolean; url?: string; cancelled?: boolean; error?: string }>;
  captureLensRegion(ownerKey: string, sourceTabId: string, targetTabId: string): Promise<BrowserLensResult>;
  setOwnerSurfaceBounds(ownerKey: string, bounds: PreviewRect): void;
  setOwnerVisible(ownerKey: string, visible: boolean): void;
  closeOwner(ownerKey: string): void;
  raiseWindow(windowId: number): void;
  dispose(): void;
}

const BROWSER_PARTITION = 'persist:papers-web-browser';
const MAX_PENDING_OPEN_REQUESTS = 32;
const MAX_RECENT_DOWNLOADS = 50;
const hardenedBrowserSessions = new WeakSet<Session>();

interface BrowserDownloadHistoryFile {
  schemaVersion: 1;
  downloads: BrowserDownloadState[];
}

interface BrowserDownloadBubble {
  ownerKey: string;
  window: BaseWindow;
  view: WebContentsView;
  channel: string;
  localRect: PreviewRect;
  presented: boolean;
  hideTimer: ReturnType<typeof setTimeout> | null;
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
    (permission === 'storage-access' || permission === 'top-level-storage-access' || permission === 'fullscreen')
    && Boolean(origin && safeWebUrl(origin));
  const allowClipboardWrite = (contents: WebContents | null, permission: string, origin: string | undefined): boolean =>
    permission === 'clipboard-sanitized-write'
    && Boolean(origin && safeWebUrl(origin))
    && Boolean(contents && !contents.isDestroyed() && contents.isFocused());
  browserSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(allowStorageAccess(permission, details.requestingUrl)
      || allowClipboardWrite(_webContents, permission, details.requestingUrl));
  });
  browserSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    allowStorageAccess(permission, requestingOrigin)
      || allowClipboardWrite(_webContents, permission, requestingOrigin));
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

function safeFaviconDataUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256_000) return null;
  return /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon);base64,/i.test(value)
    ? value
    : null;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

function downloadBubbleHtml(channel: string, initialDownloads: BrowserDownloadState[]): string {
  const channelJson = JSON.stringify(channel);
  const downloadsJson = JSON.stringify(initialDownloads);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#e9e9e9;font:12px system-ui,sans-serif}
body{box-sizing:border-box;padding:6px}
#bubble{height:100%;box-sizing:border-box;overflow:auto;background:#24231f;border:1px solid #514f47;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.42);animation:in .13s ease-out}
@keyframes in{from{opacity:0;transform:translateY(-5px) scale(.985)}to{opacity:1;transform:none}}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto 26px;align-items:center;gap:7px;min-height:38px;padding:0 5px;border-bottom:1px solid rgba(255,255,255,.07)}
.row:last-child{border-bottom:0}.row[draggable=true]{cursor:grab}.row.dragging{opacity:.62;cursor:grabbing}
.name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;border:0;color:inherit;text-align:left;padding:6px 2px;cursor:pointer}
.name:disabled{color:#8d8b83;cursor:default}.state{font-size:10px;color:#aaa79e}.reveal{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:#bdbab1;cursor:pointer}.reveal:hover{background:#35332e;color:#fff}
.empty{padding:12px;color:#aaa79e;font-size:11px}
</style></head><body><div id="bubble"></div><script>
const {ipcRenderer}=require('electron'); const channel=${channelJson}; const root=document.getElementById('bubble');
function render(items){root.replaceChildren();if(!items.length){const e=document.createElement('div');e.className='empty';e.textContent='No recent downloads';root.append(e);return}
for(const item of items.slice(0,8)){const row=document.createElement('div');row.className='row';const draggable=item.state==='completed'&&/^(?:[A-Za-z]:[\\\\/]|\\\\\\\\)/.test(item.path||'');row.draggable=draggable;
if(draggable){row.addEventListener('dragstart',e=>{row.classList.add('dragging');e.preventDefault();ipcRenderer.send(channel,{kind:'drag',path:item.path})});row.addEventListener('dragend',()=>row.classList.remove('dragging'))}
const name=document.createElement('button');name.className='name';name.textContent=item.filename||'Download';name.title=item.path||item.url||'';name.disabled=item.state!=='completed'||!item.path;name.onclick=()=>ipcRenderer.send(channel,{kind:'open',path:item.path});
const state=document.createElement('span');state.className='state';if(item.state==='progressing'&&Number(item.totalBytes)>0)state.textContent=Math.min(100,Math.round(Number(item.receivedBytes)/Number(item.totalBytes)*100))+'%';else state.textContent=item.state||'';
const reveal=document.createElement('button');reveal.className='reveal';reveal.textContent='⌕';reveal.title='Show in folder';reveal.disabled=!item.path;reveal.onclick=()=>ipcRenderer.send(channel,{kind:'reveal',path:item.path});
row.append(name,state,reveal);root.append(row)}}
window.__papersSetDownloads=render;render(${downloadsJson});
document.body.addEventListener('mouseenter',()=>ipcRenderer.send(channel,{kind:'hold'}));
document.body.addEventListener('mouseleave',()=>ipcRenderer.send(channel,{kind:'release'}));
</script></body></html>`;
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
  nativeDrag?: (window: BaseWindow | null, start: () => void) => Promise<void>;
  onReservedTab?: (ownerKey: string) => void;
  downloadHistoryFile?: string;
  diagnosticLogFile?: string;
  downloadRecoveryDir?: string;
  resolveFavicon?: (pageUrl: string) => Promise<string | null>;
  resolveFaviconCandidate?: (faviconUrl: string, fetchImpl?: FaviconFetch) => Promise<string | null>;
}): WebBrowserHostBridge {
  const sessions = new Map<string, LiveWebBrowser>();
  const diagnosticLog = input.diagnosticLogFile ? createBrowserDiagnosticLog(input.diagnosticLogFile) : null;
  const owners = new Map<string, string>();
  const tabs = new Map<string, DurableBrowserTab>();
  const ownerTabs = new Map<string, Set<string>>();
  const activeTabs = new Map<string, string>();
  const presentation = createBrowserPresentationGate();
  const openRequests = new Map<string, BrowserOpenRequest[]>();
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
  const resolvePageFavicon = input.resolveFavicon ?? (async (pageUrl: string) => {
    const resolved = await resolveWebLinkIcon(pageUrl);
    return resolved.icon;
  });
  const resolveFaviconData = async (pageUrl: string): Promise<string | null> => {
    // Media and attachment pages can have no icon declarations (or no HTML).
    // Resolve their site's homepage rather than repeatedly scraping that endpoint.
    const icon = safeFaviconDataUrl(await resolvePageFavicon(pageUrl).catch(() => null));
    if (icon) return icon;
    const homepage = new URL('/', pageUrl).toString();
    if (homepage === pageUrl) return null;
    return safeFaviconDataUrl(await resolvePageFavicon(homepage).catch(() => null));
  };
  const resolveFaviconCandidateData = input.resolveFaviconCandidate ?? resolveWebLinkIconCandidate;
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
  const downloadBubbles = new Map<string, BrowserDownloadBubble>();
  const adblockSessions = new Set<Session>();
  let adblockDesired = false;
  let adblockStatus: BrowserAdblockState['status'] = 'loading';
  let adblockError: string | undefined;
  let blocker: ElectronBlocker | null = null;
  let blockerPromise: Promise<ElectronBlocker> | null = null;
  const tabKey = (ownerKey: string, tabId: string): string => ownerKey + '\n' + tabId;
  const queueOpenRequest = (ownerKey: string, tabId: string, url: string, activate: boolean): void => {
    const queue = openRequests.get(ownerKey) ?? [];
    queue.push({ tabId, url, activate });
    if (queue.length > MAX_PENDING_OPEN_REQUESTS) queue.splice(0, queue.length - MAX_PENDING_OPEN_REQUESTS);
    openRequests.set(ownerKey, queue);
  };

  const cleanupDownloadBubble = (ownerKey: string): void => {
    const bubble = downloadBubbles.get(ownerKey);
    if (!bubble) return;
    downloadBubbles.delete(ownerKey);
    if (bubble.hideTimer) clearTimeout(bubble.hideTimer);
    ipcMain.removeAllListeners(bubble.channel);
    if (bubble.presented && !bubble.window.isDestroyed()) {
      try { bubble.window.contentView.removeChildView(bubble.view); } catch { /* best effort */ }
    }
    if (!bubble.view.webContents.isDestroyed()) {
      try { bubble.view.webContents.close(); } catch { /* best effort */ }
    }
  };

  const hideDownloadBubble = (ownerKey: string, immediate = false): void => {
    const bubble = downloadBubbles.get(ownerKey);
    if (!bubble) return;
    if (bubble.hideTimer) clearTimeout(bubble.hideTimer);
    const hide = () => {
      bubble.hideTimer = null;
      if (bubble.presented && !bubble.window.isDestroyed()) {
        try { bubble.window.contentView.removeChildView(bubble.view); } catch { /* best effort */ }
        bubble.presented = false;
      }
    };
    if (immediate) hide();
    else bubble.hideTimer = setTimeout(hide, 220);
  };

  const updateDownloadBubble = (ownerKey: string): void => {
    const bubble = downloadBubbles.get(ownerKey);
    if (!bubble || bubble.view.webContents.isDestroyed()) return;
    const snapshot = downloads.map((entry) => ({ ...entry })).slice(0, 8);
    void bubble.view.webContents.executeJavaScript(
      `window.__papersSetDownloads?.(${JSON.stringify(snapshot)})`,
    ).catch(() => {});
  };

  const updateAllDownloadBubbles = (): void => {
    for (const ownerKey of downloadBubbles.keys()) updateDownloadBubble(ownerKey);
  };

  const showDownloadBubble = async (ownerKey: string, localRect: PreviewRect): Promise<boolean> => {
    if (!validRect(localRect)) return false;
    const activeId = activeTabs.get(ownerKey);
    const tab = activeId ? tabs.get(tabKey(ownerKey, activeId)) : undefined;
    if (!tab || tab.window.isDestroyed()) return false;
    let bubble = downloadBubbles.get(ownerKey);
    if (!bubble || bubble.view.webContents.isDestroyed() || bubble.window !== tab.window) {
      if (bubble) cleanupDownloadBubble(ownerKey);
      const channel = `papers:browser-download-bubble:${randomUUID()}`;
      const view = new WebContentsView({
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
          webSecurity: true,
        },
      });
      view.setBackgroundColor('#00000000');
      bubble = {
        ownerKey,
        window: tab.window,
        view,
        channel,
        localRect: { ...localRect },
        presented: false,
        hideTimer: null,
      };
      downloadBubbles.set(ownerKey, bubble);
      ipcMain.on(channel, (event, payload: unknown) => {
        if (event.sender.id !== view.webContents.id || !payload || typeof payload !== 'object') return;
        const value = payload as { kind?: unknown; path?: unknown };
        if (value.kind === 'hold') {
          if (bubble?.hideTimer) clearTimeout(bubble.hideTimer);
          if (bubble) bubble.hideTimer = null;
          return;
        }
        if (value.kind === 'release') {
          hideDownloadBubble(ownerKey);
          return;
        }
        const path = typeof value.path === 'string' ? value.path : '';
        const record = downloads.find((entry) => entry.path === path);
        if (!record || !path) return;
        if (value.kind === 'open' && record.state === 'completed') {
          void shell.openPath(path);
          return;
        }
        if (value.kind === 'reveal') {
          shell.showItemInFolder(path);
          return;
        }
        if (value.kind === 'drag' && record.state === 'completed') {
          void app.getFileIcon(path, { size: 'small' }).then((icon) => {
            if (!view.webContents.isDestroyed()) {
              const start = () => view.webContents.startDrag({ file: path, icon });
              return input.nativeDrag ? input.nativeDrag(input.resolveWindow(ownerKey), start) : start();
            }
          }).catch(() => {});
        }
      });
      view.webContents.on('will-navigate', (event) => event.preventDefault());
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const html = downloadBubbleHtml(channel, downloads.map((entry) => ({ ...entry })).slice(0, 8));
      await view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    } else {
      if (bubble.hideTimer) clearTimeout(bubble.hideTimer);
      bubble.hideTimer = null;
      updateDownloadBubble(ownerKey);
    }
    if (!bubble.presented) {
      bubble.window.contentView.addChildView(bubble.view);
      bubble.presented = true;
    }
    bubble.localRect = { ...localRect };
    bubble.view.setBounds(absoluteRect(tab.surfaceBounds, localRect));
    return true;
  };

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
        updateAllDownloadBubbles();
      });
      const sync = (state: BrowserDownloadState['state'] = record.state) => {
        record.filename = item.getFilename();
        record.path = item.getSavePath();
        record.url = item.getURL();
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.state = state;
        void downloadHistoryReady.then(() => {
          persistDownloads();
          updateAllDownloadBubbles();
        });
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
      faviconUrl: tab.faviconUrl,
      canGoBack: Boolean(contents && !contents.isDestroyed() && contents.navigationHistory.canGoBack()),
      canGoForward: Boolean(contents && !contents.isDestroyed() && contents.navigationHistory.canGoForward()),
      live: Boolean(contents && !contents.isDestroyed()),
      crashed: tab.crashed,
    };
  };

  const fullscreenTabs = new WeakMap<DurableBrowserTab, ReturnType<typeof createBrowserVideoFullscreen>>();
  const detachTab = (tab: DurableBrowserTab): void => {
    fullscreenTabs.get(tab)?.exit();
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
    if (fullscreenTabs.get(tab)?.isActive()) return;
    if (!tab.view || tab.window.isDestroyed() || tab.view.webContents.isDestroyed()) return;
    tab.view.setBounds(browserViewBounds(tab.surfaceBounds, tab.localRect));
  };

  const wireTabView = (tab: DurableBrowserTab, view: WebContentsView): void => {
    const contents = view.webContents;
    contents.on('before-input-event', (event, key) => {
      if (!tab.reservePlainTab || key.type !== 'keyDown' || key.key !== 'Tab'
        || key.shift || key.control || key.alt || key.meta || key.isAutoRepeat) return;
      event.preventDefault();
      input.onReservedTab?.(tab.ownerKey);
    });
    fullscreenTabs.set(tab, createBrowserVideoFullscreen(view, tab.window, () => {
      if (tab.view !== view || tab.window.isDestroyed() || contents.isDestroyed()) return;
      if (tab.presented && activeTabs.get(tab.ownerKey) === tab.tabId) {
        tab.window.contentView.addChildView(view);
        placeTab(tab);
        contents.focus();
      }
    }));
    contents.on('context-menu', (_event, params) => {
      showBrowserContextMenu(params, contents, tab.window, (url) => {
        const safe = safeWebUrl(url);
        if (!safe) return;
        const tabId = randomUUID();
        const child: DurableBrowserTab = {
          ...tab, tabId, view: null, presented: false, url: safe, title: '',
          faviconUrl: '', history: null, crashed: false, lastActiveAt: Date.now(),
          reservePlainTab: tab.reservePlainTab,
          localRect: { ...tab.localRect }, surfaceBounds: { ...tab.surfaceBounds },
        };
        tabs.set(tabKey(tab.ownerKey, tabId), child);
        const ids = ownerTabs.get(tab.ownerKey) ?? new Set<string>();
        ids.add(tabId);
        ownerTabs.set(tab.ownerKey, ids);
        void ensureTabView(child).then(() => {
          if (tabs.get(tabKey(tab.ownerKey, tabId)) === child) queueOpenRequest(tab.ownerKey, tabId, safe, false);
        }).catch(() => cleanupTab(child));
      });
    });
    let liveFaviconRequest = 0;
    let requestedFaviconPage = '';
    const refreshFallbackFavicon = (): void => {
      const pageUrl = tab.url;
      if (!pageUrl || tab.faviconUrl || requestedFaviconPage === pageUrl) return;
      requestedFaviconPage = pageUrl;
      void resolveFaviconData(pageUrl).then((icon) => {
        if (tab.view !== view || tab.url !== pageUrl || tab.faviconUrl) return;
        const safe = safeFaviconDataUrl(icon);
        tab.faviconUrl = safe ?? '';
        if (!safe && requestedFaviconPage === pageUrl) requestedFaviconPage = '';
      }).catch(() => {
        if (tab.view === view && tab.url === pageUrl && requestedFaviconPage === pageUrl) requestedFaviconPage = '';
      });
    };
    const refreshLiveFavicon = (_event: unknown, favicons: string[]): void => {
      const pageUrl = tab.url;
      const candidates = Array.isArray(favicons)
        ? favicons.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, 16)
        : [];
      if (!pageUrl || candidates.length === 0) return;
      const request = ++liveFaviconRequest;
      void (async () => {
        for (const candidate of candidates) {
          const embedded = safeFaviconDataUrl(candidate);
          if (embedded) return embedded;
          if (!safeWebUrl(candidate)) continue;
          const sessionFetch = contents.session.fetch.bind(contents.session) as FaviconFetch;
          const resolved = safeFaviconDataUrl(await resolveFaviconCandidateData(candidate, sessionFetch));
          if (resolved) return resolved;
        }
        return null;
      })().then((icon) => {
        if (!icon || request !== liveFaviconRequest || tab.view !== view || tab.url !== pageUrl) return;
        tab.faviconUrl = icon;
        requestedFaviconPage = pageUrl;
      }).catch(() => undefined);
    };
    hardenBrowserSession(contents.session);
    if (diagnosticLog) attachBrowserDiagnostics(contents, tab.tabId, diagnosticLog);
    enableBrowserDownloads(contents.session);
    void syncAdblockSession(contents.session);
    // Browser tabs are real long-lived web apps, not previews. Throttling or
    // silently discarding a covered tab can stall/kill streaming responses,
    // auth flows, service workers, and in-memory application state.
    contents.setBackgroundThrottling(false);
    contents.on('will-navigate', (event, nextUrl) => {
      if (safeWebUrl(nextUrl)) return;
      event.preventDefault();
    });
    contents.on('did-navigate', (_event, nextUrl) => {
      const safe = safeWebUrl(nextUrl);
      if (safe) {
        const oldOrigin = safeWebUrl(tab.url) ? new URL(tab.url).origin : null;
        const nextOrigin = new URL(safe).origin;
        tab.url = safe;
        if (oldOrigin && oldOrigin !== nextOrigin) {
          tab.faviconUrl = '';
          requestedFaviconPage = '';
        }
      }
    });
    contents.on('did-navigate-in-page', (_event, nextUrl) => {
      const safe = safeWebUrl(nextUrl);
      if (safe) tab.url = safe;
    });
    contents.on('page-title-updated', (event, title) => {
      event.preventDefault();
      tab.title = String(title || '').slice(0, 500);
    });
    contents.on('did-finish-load', refreshFallbackFavicon);
    contents.on('page-favicon-updated', refreshLiveFavicon);
    contents.on('render-process-gone', () => { tab.crashed = true; });
    contents.on('zoom-changed', (_event, direction) => {
      const factor = direction === 'in' ? 1.1 : (1 / 1.1);
      tab.zoomFactor = Math.max(0.5, Math.min(2.5, Number((tab.zoomFactor * factor).toFixed(3))));
      contents.setZoomFactor(tab.zoomFactor);
    });
    contents.setWindowOpenHandler(({ url: nextUrl, disposition }) => {
      const safe = safeWebUrl(nextUrl);
      if (!safe) return { action: 'deny' };
      const childTabId = randomUUID();
      const activate = disposition !== 'background-tab';
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          // Electron has already created the child WebContents for ordinary
          // target=_blank/window.open requests and passes it through the
          // runtime `options.webContents` field. WebContentsView must adopt
          // that exact object. Creating an unrelated WebContents here makes
          // guest-window-manager reject the child with "Invalid webContents".
          // For background-tab disposition Electron may defer guest creation;
          // in that case WebContentsView creates its own contents and we load
          // the requested URL manually below, per Electron's documented flow.
          const childView = new WebContentsView(options);
          const childTab: DurableBrowserTab = {
            tabId: childTabId,
            ownerKey: tab.ownerKey,
            window: tab.window,
            view: childView,
            localRect: { ...tab.localRect },
            surfaceBounds: { ...tab.surfaceBounds },
            presented: false,
            url: safe,
            title: '',
            faviconUrl: '',
            zoomFactor: 1,
            lastActiveAt: Date.now(),
            history: null,
            crashed: false,
            reservePlainTab: tab.reservePlainTab,
          };
          tabs.set(tabKey(tab.ownerKey, childTabId), childTab);
          const ids = ownerTabs.get(tab.ownerKey) ?? new Set<string>();
          ids.add(childTabId);
          ownerTabs.set(tab.ownerKey, ids);
          wireTabView(childTab, childView);
          if (disposition === 'background-tab') {
            void childView.webContents.loadURL(safe).catch(() => {});
          }
          queueOpenRequest(tab.ownerKey, childTabId, safe, activate);
          return childView.webContents;
        },
      };
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
    if (!presentation.allows(tab.ownerKey)
      || tabs.get(tabKey(tab.ownerKey, tab.tabId)) !== tab
      || activeTabs.get(tab.ownerKey) !== tab.tabId) return;
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
    if (tab.presented && presentation.allows(tab.ownerKey) && activeTabs.get(tab.ownerKey) === tab.tabId) tab.view?.webContents.focus();
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

    async openTab(context, tabId, rawUrl, localRect, activate = true, reservePlainTab = false) {
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
        faviconUrl: '',
        zoomFactor: 1,
        lastActiveAt: Date.now(),
        history: null,
        crashed: false,
        reservePlainTab,
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
      tab.reservePlainTab = reservePlainTab;
      if (tab.url !== url) {
        tab.url = url;
        tab.history = null;
        if (tab.view && !tab.view.webContents.isDestroyed()) void tab.view.webContents.loadURL(url).catch(() => {});
      }

      try {
        if (activate) {
          await activateDurableTab(tab);
        } else {
          tab.lastActiveAt = Date.now();
          await ensureTabView(tab);
        }
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

    async showTabMenu(ownerKey, tabId, hasOthers) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      const window = tab?.window ?? input.resolveWindow(ownerKey);
      if (!window || window.isDestroyed()) return null;
      return showBrowserTabMenu(window, hasOthers);
    },

    setTabsVisible(ownerKey, visible) {
      presentation.setPane(ownerKey, visible);
      setOwnerTabsVisible(ownerKey, visible);
    },

    getTab(ownerKey, tabId) {
      const tab = tabs.get(tabKey(ownerKey, tabId));
      if (!tab || tab.ownerKey !== ownerKey) return null;
      return tabState(tab);
    },

    async resolveFavicon(rawUrl) {
      const url = safeWebUrl(rawUrl);
      if (!url) return null;
      try {
        return safeFaviconDataUrl(await resolveFaviconData(url));
      } catch {
        return null;
      }
    },

    takeOpenRequests(ownerKey) {
      const queued = openRequests.get(ownerKey) ?? [];
      openRequests.delete(ownerKey);
      return queued.map((request) => ({ ...request }));
    },

    async getDownloads() {
      await downloadHistoryReady;
      return downloads.map((download) => ({ ...download }));
    },

    async showDownloadsBubble(ownerKey, localRect) {
      await downloadHistoryReady;
      return showDownloadBubble(ownerKey, localRect);
    },

    hideDownloadsBubble(ownerKey, immediate = false) {
      hideDownloadBubble(ownerKey, immediate);
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

    async captureLensScreenUrl() {
      let upload: BrowserWindow | null = null;
      try {
        const selection = await pickLensRegion();
        if (!selection) return { ok: false, cancelled: true };
        const crop = cropLensSelection(selection.capture, selection.rect);
        upload = new BrowserWindow({ show: false, webPreferences: { partition: BROWSER_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
        const url = await submitLensCrop(upload.webContents, crop);
        return { ok: true, url };
      } catch (error) { return { ok: false, error: boundedError(error) }; }
      finally { if (upload && !upload.isDestroyed()) upload.destroy(); }
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
          faviconUrl: '',
          zoomFactor: 1,
          lastActiveAt: Date.now(),
          history: null,
          crashed: false,
          reservePlainTab: sourceTab.reservePlainTab,
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
      const bubble = downloadBubbles.get(ownerKey);
      if (bubble?.presented && !bubble.view.webContents.isDestroyed()) {
        bubble.view.setBounds(absoluteRect(bounds, bubble.localRect));
      }
    },

    setOwnerVisible(ownerKey, visible) {
      presentation.setOwner(ownerKey, visible);
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
      if (!visible) hideDownloadBubble(ownerKey, true);
      setOwnerTabsVisible(ownerKey, visible);
    },

    closeOwner(ownerKey) {
      presentation.forget(ownerKey);
      openRequests.delete(ownerKey);
      cleanupDownloadBubble(ownerKey);
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
      for (const bubble of downloadBubbles.values()) {
        if (bubble.window.id !== windowId || !bubble.presented
          || bubble.window.isDestroyed() || bubble.view.webContents.isDestroyed()) continue;
        bubble.window.contentView.addChildView(bubble.view);
      }
    },

    dispose() {
      for (const ownerKey of [...downloadBubbles.keys()]) cleanupDownloadBubble(ownerKey);
      for (const session of [...sessions.values()]) cleanupSession(session);
      for (const tab of [...tabs.values()]) cleanupTab(tab);
    },
  };
}
