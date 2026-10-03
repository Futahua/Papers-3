import * as path from 'node:path';

import { app, protocol, shell, type BaseWindow } from 'electron';

import { createEverythingSearchBridge, resolveEverythingSearchBridgePaths } from './everythingSearchBridge';
import { createFileCapabilityService, resolveDirectoryOpusRtPath, resolveLibreOfficePath } from './fileCapabilityService';
import {
  FILE_PREVIEW_SCHEME,
  createFilePreviewProtocolHandler,
  createFilePreviewResourceRegistry,
} from './filePreviewResources';
import { createPdfPreviewHostBridge } from './pdfPreviewHostBridge';
import { createHtmlPreviewHostBridge } from './htmlPreviewHostBridge';
import { createWebBrowserHostBridge } from './webBrowserHostBridge';
import { createRevitPreviewBridge, resolveRevitPreviewBridgeSourcePath } from './revitPreviewBridge';
import { createShellThumbnailBridge, resolveShellThumbnailSourcePath } from './shellThumbnailBridge';
import { createCalibrePreviewBridge } from './calibrePreviewBridge';
import { createAutoCadPreviewBridge } from './autoCadPreviewBridge';
import { createMlightCadPreviewBridge } from './mlightCadPreviewBridge';
import { createPowerPointPreviewBridge } from './powerPointPreviewBridge';
import {
  createWindowsPreviewHandlerBridge,
  resolveWindowsPreviewHostSourcePath,
} from './windowsPreviewHandlerBridge';
import { createPreviewOwnerGroup } from './previewOwnerGroup';

export interface FileCapabilityRuntimeOptions {
  rootPath: string;
  resolveWindow: (ownerKey: string) => BaseWindow | null;
}

/**
 * Owns Papers' concrete file/preview engine bootstrap.
 *
 * The main composition root consumes two contracts only:
 * - fileCapability: user-facing file/preview operations;
 * - previewOwners: owner-surface presentation lifecycle.
 *
 * Which preview engines implement those contracts stays local to this runtime.
 */
export function createFileCapabilityRuntime({
  rootPath,
  resolveWindow,
}: FileCapabilityRuntimeOptions) {
  const previewResources = createFilePreviewResourceRegistry();
  protocol.handle(FILE_PREVIEW_SCHEME, createFilePreviewProtocolHandler(previewResources));

  const bridgePaths = {
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  };
  const cacheDirectory = path.join(rootPath, 'native', 'file-capability');

  const everythingPaths = resolveEverythingSearchBridgePaths(bridgePaths);
  const everythingSearch = createEverythingSearchBridge({
    cacheDirectory,
    sourcePath: everythingPaths.sourcePath,
    dllPath: everythingPaths.dllPath,
  });
  const revitPreview = createRevitPreviewBridge({
    cacheDirectory,
    sourcePath: resolveRevitPreviewBridgeSourcePath(bridgePaths),
  });
  const shellThumbnail = createShellThumbnailBridge({
    cacheDirectory,
    sourcePath: resolveShellThumbnailSourcePath(bridgePaths),
  });
  const calibrePreview = createCalibrePreviewBridge({ cacheDirectory });
  const autoCadPreview = createAutoCadPreviewBridge({ cacheDirectory });
  const mlightCadPreview = createMlightCadPreviewBridge({ cacheDirectory });
  const powerPointPreview = createPowerPointPreviewBridge({ cacheDirectory });
  const windowsPreview = createWindowsPreviewHandlerBridge({
    cacheDirectory,
    sourcePath: resolveWindowsPreviewHostSourcePath(bridgePaths),
  });
  const pdfPreview = createPdfPreviewHostBridge({
    resolveWindow,
    stateDirectory: path.join(rootPath, 'preview-state', 'pdf'),
  });
  const htmlPreview = createHtmlPreviewHostBridge({ resolveWindow });
  const webBrowser = createWebBrowserHostBridge({ resolveWindow });

  const previewOwners = createPreviewOwnerGroup([
    windowsPreview,
    pdfPreview,
    htmlPreview,
    webBrowser,
  ]);

  const fileCapability = createFileCapabilityService({
    cacheDirectory,
    everythingSearch,
    previewResources,
    pdfPreview,
    revitPreview,
    shellThumbnail,
    calibrePreview,
    autoCadPreview,
    mlightCadPreview,
    htmlPreview,
    webBrowser,
    powerPointPreview,
    windowsPreview,
    dopusrtPath: resolveDirectoryOpusRtPath(),
    libreOfficePath: resolveLibreOfficePath(),
    openPath: (target) => shell.openPath(target),
    revealPath: (target) => shell.showItemInFolder(target),
    fileIcon: async (target) => {
      const icon = await app.getFileIcon(target, { size: 'small' });
      return icon.isEmpty() ? null : icon.toDataURL();
    },
  });

  return {
    fileCapability,
    previewOwners,
    dispose(): void {
      void previewResources.dispose();
      windowsPreview?.dispose();
      pdfPreview.dispose();
      htmlPreview.dispose();
      webBrowser.dispose();
    },
  };
}

export type FileCapabilityRuntime = ReturnType<typeof createFileCapabilityRuntime>;
