import { BaseWindow, WebContentsView } from 'electron';

import { BackpackProjectRuntime } from '../backpacks/backpackProjectRuntime';
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
  hostPreloadPath: string;
  projectPreloadPath: string;
  onProjectSurfaceClosed?: (projectId: string) => void;
  rendererUrl?: string;
  rendererFile: string;
}

export interface PapersWindowInstance {
  window: BaseWindow;
  hostView: WebContentsView;
  backpackProjectRuntime: BackpackProjectRuntime;
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

  const runtime = new BackpackProjectRuntime(
    window,
    options.projectPreloadPath,
    options.transparent,
    options.onProjectSurfaceClosed,
  );

  const applyHostSurface = (): void => {
    hostView.setBackgroundColor(options.transparent ? TRANSPARENT_CHILD_SURFACE_COLOR : OPAQUE_SURFACE_COLOR);
  };
  applyHostSurface();
  hostView.webContents.on('did-finish-load', applyHostSurface);

  const fit = (): void => {
    if (window.isDestroyed() || hostView.webContents.isDestroyed()) return;
    const { width, height } = window.getContentBounds();
    hostView.setBounds({ x: 0, y: 0, width, height });
    runtime.fit();
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
    backpackProjectRuntime: runtime,
    async loadHostRenderer() {
      if (options.rendererUrl) await hostView.webContents.loadURL(options.rendererUrl);
      else await hostView.webContents.loadFile(options.rendererFile);
    },
  };
}
