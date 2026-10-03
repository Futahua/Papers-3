import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchPapers, type LaunchedApp } from './helpers';

let launched: LaunchedApp;

beforeAll(async () => {
  launched = await launchPapers(undefined, { fixtures: false });
}, 120_000);

afterAll(async () => {
  await launched?.close();
});

describe('Electron 43 live WebContentsView reparent compatibility', () => {
  it('classifies detach/attach, post-move interaction, and close behavior', async () => {
    const outcome = await launched.app.evaluate(async ({ BaseWindow, WebContentsView }) => {
      const source = new BaseWindow({ show: false, width: 500, height: 400 });
      const target = new BaseWindow({ show: false, width: 500, height: 400 });
      const view = new WebContentsView({ webPreferences: { sandbox: true } });
      const webContents = view.webContents;
      const cleanup = (): void => {
        if (!webContents.isDestroyed()) webContents.close();
        if (!source.isDestroyed()) source.destroy();
        if (!target.isDestroyed()) target.destroy();
      };

      try {
        source.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 500, height: 400 });
        await webContents.loadURL('data:text/html,<script>window.reparentProbe = 1</script><h1>reparent-probe</h1>');
        const webContentsId = webContents.id;
        const before = {
          sourceOwnsView: source.contentView.children.includes(view),
          targetOwnsView: target.contentView.children.includes(view),
          title: await webContents.executeJavaScript('document.querySelector("h1").textContent'),
        };

        source.contentView.removeChildView(view);
        target.contentView.addChildView(view);
        view.setBounds({ x: 0, y: 0, width: 500, height: 400 });
        const after = {
          sourceOwnsView: source.contentView.children.includes(view),
          targetOwnsView: target.contentView.children.includes(view),
          sameWebContents: webContents.id === webContentsId,
          rendererProbe: await webContents.executeJavaScript('window.reparentProbe += 1; window.reparentProbe'),
          url: webContents.getURL(),
        };

        // The source must be safe to close after it no longer owns the view;
        // the target must then clean up the reparented view without a native
        // destroyed-object exception.
        source.destroy();
        const sourceClosed = source.isDestroyed();
        target.destroy();
        const viewSurvivesTargetClose = !webContents.isDestroyed();
        // Electron does not automatically destroy a WCV merely because its
        // last BaseWindow was destroyed. An owner must close it explicitly.
        const viewDestroyedAfterExplicitClose = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(webContents.isDestroyed()), 2_000);
          webContents.once('destroyed', () => {
            clearTimeout(timer);
            resolve(true);
          });
          webContents.close();
          if (webContents.isDestroyed()) {
            clearTimeout(timer);
            resolve(true);
          }
        });
        return {
          electronVersion: process.versions.electron,
          status: 'compatible' as const,
          before,
          after,
          sourceClosed,
          targetClosed: target.isDestroyed(),
          viewSurvivesTargetClose,
          viewDestroyedAfterExplicitClose,
        };
      } catch (error) {
        return {
          electronVersion: process.versions.electron,
          status: 'incompatible' as const,
          reason: error instanceof Error ? error.message : String(error),
        };
      } finally {
        cleanup();
      }
    });

    expect(outcome.electronVersion).toBe('43.1.1');
    expect(['compatible', 'incompatible']).toContain(outcome.status);
    if (outcome.status === 'compatible') {
      expect(outcome.before).toMatchObject({ sourceOwnsView: true, targetOwnsView: false, title: 'reparent-probe' });
      expect(outcome.after).toMatchObject({
        sourceOwnsView: false,
        targetOwnsView: true,
        sameWebContents: true,
        rendererProbe: 2,
        url: expect.stringContaining('data:text/html'),
      });
      expect(outcome).toMatchObject({
        sourceClosed: true,
        targetClosed: true,
        viewSurvivesTargetClose: true,
        viewDestroyedAfterExplicitClose: true,
      });
    }
  });
});
