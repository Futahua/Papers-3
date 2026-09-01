/**
 * Papers updating itself.
 *
 * Papers runs on two machines the creator owns. Updating used to mean building
 * on one machine and hand-copying a folder to the other, and nothing in the
 * product knew a newer version existed. Now a packaged Papers asks GitHub on
 * launch, downloads a newer release in the background, and installs it when the
 * creator says so.
 *
 * Deliberate choices:
 *
 *   - **Never install without being asked.** `autoInstallOnAppQuit` is off, so
 *     closing Papers never silently swaps the application underneath a running
 *     Hermes. The creator decides when the restart happens.
 *   - **Never interrupt.** A failed or unavailable check is not an error the
 *     creator needs to see; Papers simply stays on the version it has. Only a
 *     genuine, downloaded, ready-to-install update surfaces in the interface.
 *   - **Packaged builds only.** A development run has no version to compare and
 *     no installer to hand off to, so the whole mechanism stays asleep.
 *
 * The repository is public, so the update feed is read anonymously and no token
 * is shipped inside the application.
 */
import { app, type WebContents } from 'electron';
import type { AppUpdater, UpdateInfo } from 'electron-updater';

export type UpdateStage = 'idle' | 'checking' | 'downloading' | 'ready' | 'unavailable';

export interface UpdateState {
  stage: UpdateStage;
  /** Version offered by the release feed, once one is known. */
  version?: string;
  /** Download progress 0-100, while downloading. */
  percent?: number;
  /** Plain-language note for the creator; never a raw stack trace. */
  detail?: string;
}

/** How long after launch to look, so startup is never delayed by the network. */
const FIRST_CHECK_DELAY_MS = 8_000;

/**
 * `electron-updater` is CommonJS. Under this project's ESM build a dynamic
 * import puts its exports on `.default`, so reading `autoUpdater` off the module
 * namespace directly yields `undefined` and every call fails with an error that
 * looks nothing like an update problem. Normalise both shapes here once.
 */
async function loadAutoUpdater(): Promise<AppUpdater> {
  const mod = (await import('electron-updater')) as unknown as {
    autoUpdater?: AppUpdater;
    default?: { autoUpdater?: AppUpdater };
  };
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!updater) throw new Error('electron-updater did not provide an autoUpdater.');
  return updater;
}

export class PapersUpdater {
  private state: UpdateState = { stage: 'idle' };
  private started = false;

  /**
   * Updater state is application-level: one updater, one answer, and every
   * Papers window shows the same thing. So this object knows nothing about
   * windows -- it reports a change and the composition root decides who hears
   * it. `current` still covers a renderer that connects after an event fired.
   */
  constructor(private readonly onStateChanged: (next: UpdateState) => void = () => {}) {}

  /** Latest known state, for a renderer that connects after an event fired. */
  get current(): UpdateState {
    return this.state;
  }

  private setState(next: UpdateState): void {
    this.state = next;
    this.onStateChanged(next);
  }

  /**
   * Begin checking. Safe to call unconditionally: it returns immediately for a
   * development run, where there is no packaged application to replace.
   */
  start(): void {
    if (this.started || !app.isPackaged) return;
    this.started = true;

    void (async () => {
      // Imported lazily so a development run never loads the updater at all.
      const autoUpdater = await loadAutoUpdater();

      // The creator chooses when to restart; Papers manages a live Hermes and
      // must not be replaced underneath it without warning.
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = false;

      autoUpdater.on('checking-for-update', () => this.setState({ stage: 'checking' }));

      autoUpdater.on('update-not-available', () => this.setState({ stage: 'unavailable' }));

      autoUpdater.on('update-available', (info: UpdateInfo) =>
        this.setState({ stage: 'downloading', version: info.version, percent: 0 }),
      );

      autoUpdater.on('download-progress', (progress: { percent: number }) =>
        this.setState({
          stage: 'downloading',
          version: this.state.version,
          percent: Math.round(progress.percent),
        }),
      );

      autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
        this.setState({
          stage: 'ready',
          version: info.version,
          detail: 'Papers will restart to finish updating.',
        }),
      );

      autoUpdater.on('error', (error: Error) => {
        // Offline, rate-limited, or no releases yet. Not worth interrupting the
        // creator over — Papers keeps working as it is — but the reason is kept
        // so "Check for updates" can explain itself when asked directly.
        this.setState({ stage: 'unavailable', detail: error.message });
      });

      setTimeout(() => {
        void autoUpdater.checkForUpdates().catch(() => this.setState({ stage: 'unavailable' }));
      }, FIRST_CHECK_DELAY_MS);
    })().catch(() => this.setState({ stage: 'unavailable' }));
  }

  /** Check now, in response to the creator asking rather than a timer. */
  async checkNow(): Promise<UpdateState> {
    if (!app.isPackaged) {
      return { stage: 'unavailable', detail: 'Updating applies to an installed Papers.' };
    }
    this.start();
    try {
      const autoUpdater = await loadAutoUpdater();
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.setState({
        stage: 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return this.state;
  }

  /**
   * Restart into the downloaded version. Only meaningful once the state is
   * `ready`; calling it earlier does nothing rather than restarting for no gain.
   */
  async installNow(): Promise<void> {
    if (this.state.stage !== 'ready') return;
    const autoUpdater = await loadAutoUpdater();
    // isSilent=false shows the installer, isForceRunAfter=true reopens Papers.
    autoUpdater.quitAndInstall(false, true);
  }
}
