import { BaseWindow, WebContentsView } from 'electron';

import { BackpackProjectSurfaceCollection } from '../backpacks/backpackProjectSurfaceCollection';
import {
  OPAQUE_SURFACE_COLOR,
  TRANSPARENT_CHILD_SURFACE_COLOR,
  TRANSPARENT_SURFACE_COLOR,
} from '../windowSurface';
import type { WindowBounds } from '../windowBounds';

const TITLE_BAR_HEIGHT = 40;

export interface PapersWindowFactoryOptions {
  bounds?: WindowBounds;
  appIcon?: string;
  transparent: boolean;
  currentTransparent: () => boolean;
  hostPreloadPath: string;
  projectPreloadPath: string;
  onProjectSurfaceClosed?: (windowId: number, surfaceId: string, projectId: string) => void;
  onProjectConsoleMessage?: (windowId: number, surfaceId: string, senderId: number, level: number, message: string) => void;
  onProjectLifecycleEvent?: (windowId: number, surfaceId: string, senderId: number, event: 'did-start-loading' | 'dom-ready') => void;
  rendererUrl?: string;
  rendererFile: string;
}

export interface PapersWindowInstance {
  window: BaseWindow;
  hostView: WebContentsView;
  projectSurfaces: BackpackProjectSurfaceCollection;
  loadHostRenderer(): Promise<void>;
}

/** Build one complete Papers window and its genuinely window-owned surfaces. */
export function createPapersWindow(options: PapersWindowFactoryOptions): PapersWindowInstance {
  const window = new BaseWindow({
    ...(options.bounds ?? { width: 1360, height: 860 }),
    minWidth: 900,
    minHeight: 600,
    title: 'Papers',
    frame: !options.transparent,
    transparent: options.transparent,
    backgroundColor: options.transparent ? TRANSPARENT_SURFACE_COLOR : '#efede7',
    ...(options.appIcon ? { icon: options.appIcon } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#efede7', symbolColor: '#20201e', height: TITLE_BAR_HEIGHT },
  });

  const hostView = new WebContentsView({
    webPreferences: {
      preload: options.hostPreloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.contentView.addChildView(hostView);

  const projectSurfaces = new BackpackProjectSurfaceCollection(
    window,
    options.projectPreloadPath,
    options.transparent,
    (surfaceId, projectId) => options.onProjectSurfaceClosed?.(window.id, surfaceId, projectId),
    undefined,
    (surfaceId, senderId, level, message) => options.onProjectConsoleMessage?.(window.id, surfaceId, senderId, level, message),
    (surfaceId, senderId, event) => options.onProjectLifecycleEvent?.(window.id, surfaceId, senderId, event),
  );

  const applyHostSurface = (): void => {
    hostView.setBackgroundColor(options.currentTransparent() ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR);
  };
  applyHostSurface();
  hostView.webContents.on('did-finish-load', applyHostSurface);

  const fit = (): void => {
    if (window.isDestroyed() || hostView.webContents.isDestroyed()) return;
    const { width, height } = window.getContentBounds();
    hostView.setBounds({ x: 0, y: 0, width, height });
    projectSurfaces.fit();
  };
  fit();
  window.on('resize', fit);

  hostView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  hostView.webContents.on('will-navigate', (event, url) => {
    const allowedPrefix = options.rendererUrl ?? 'file://';
    if (!url.startsWith(allowedPrefix)) event.preventDefault();
  });

  return {
    window,
    hostView,
    projectSurfaces,
    async loadHostRenderer() {
      if (options.rendererUrl) await hostView.webContents.loadURL(options.rendererUrl);
      else await hostView.webContents.loadFile(options.rendererFile);
    },
  };
}
