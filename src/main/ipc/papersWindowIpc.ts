import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';

export interface PapersWindowIpcDependencies {
  ipcMain: Pick<IpcMain, 'handle'>;
  isHostSender: (sender: WebContents) => boolean;
  createAdditionalWindow: () => Promise<{ window: { id: number } }>;
}

/** Register the narrow host-only boundary for creating a secondary window. */
export function registerPapersWindowIpc(dependencies: PapersWindowIpcDependencies): void {
  dependencies.ipcMain.handle('host:window:new', async (event: IpcMainInvokeEvent) => {
    if (!dependencies.isHostSender(event.sender)) {
      throw new Error('window creation called from non-host sender');
    }
    const instance = await dependencies.createAdditionalWindow();
    return { windowId: instance.window.id };
  });
}
