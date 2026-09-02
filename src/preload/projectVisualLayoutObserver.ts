import { reportProjectLayoutEpoch, reportProjectLayoutSignal, type ProjectVisualDiagnosticIpc } from './projectVisualDiagnostics';

const REQUIRED_UNCHANGED_FRAMES = 3;
const MAX_STABILITY_FRAMES = 12;

interface LayoutObserverEnvironment {
  document: Document;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  ResizeObserver?: typeof ResizeObserver;
  MutationObserver?: typeof MutationObserver;
  onLayoutEpoch?: (epoch: number) => void;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

function geometrySnapshot(document: Document): string | null {
  const body = document.body;
  const root = document.documentElement;
  if (!body || !root) return null;
  const rootRect = root.getBoundingClientRect();
  const bodyRect = body.getBoundingClientRect();
  return [
    rounded(rootRect.x), rounded(rootRect.y), rounded(rootRect.width), rounded(rootRect.height),
    rounded(bodyRect.x), rounded(bodyRect.y), rounded(bodyRect.width), rounded(bodyRect.height),
    root.scrollWidth, root.scrollHeight, body.scrollWidth, body.scrollHeight,
  ].join('|');
}

/** Observe the project document's rendered geometry for one bounded stability
 * window. All state and observers stay in the Papers-owned preload world;
 * page code receives no layout-success method it could call directly. */
export function installProjectVisualLayoutObserver(
  ipc: ProjectVisualDiagnosticIpc,
  environment: LayoutObserverEnvironment,
): void {
  const { document, requestAnimationFrame } = environment;
  if (!environment.MutationObserver) return;

  let frameScheduled = false;
  let frameCount = 0;
  let unchangedFrames = 0;
  let previousGeometry: string | null = null;
  let attemptActive = false;
  let layoutEpoch = 0;

  const scheduleFrame = (): void => {
    if (frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(() => {
      frameScheduled = false;
      const geometry = geometrySnapshot(document);
      frameCount += 1;
      if (!geometry) {
        unchangedFrames = 0;
        previousGeometry = null;
        if (frameCount >= MAX_STABILITY_FRAMES) {
          reportProjectLayoutSignal(ipc, 'render-failed', 'layout-stability-timeout');
          attemptActive = false;
          return;
        }
        scheduleFrame();
        return;
      }
      unchangedFrames = geometry === previousGeometry ? unchangedFrames + 1 : 1;
      previousGeometry = geometry;
      if (unchangedFrames >= REQUIRED_UNCHANGED_FRAMES) {
        reportProjectLayoutSignal(ipc, 'layout-stable', undefined, layoutEpoch);
        attemptActive = false;
        return;
      }
      if (frameCount >= MAX_STABILITY_FRAMES) {
        reportProjectLayoutSignal(ipc, 'render-failed', 'layout-stability-timeout');
        attemptActive = false;
        return;
      }
      scheduleFrame();
    });
  };

  const beginEpoch = (): void => {
    layoutEpoch += 1;
    reportProjectLayoutEpoch(ipc, layoutEpoch);
    environment.onLayoutEpoch?.(layoutEpoch);
    if (!geometrySnapshot(document)) {
      attemptActive = false;
      return;
    }
    if (!attemptActive) {
      frameCount = 0;
      attemptActive = true;
    }
    unchangedFrames = 0;
    previousGeometry = null;
    scheduleFrame();
  };

  const resizeObserver = environment.ResizeObserver
    ? new environment.ResizeObserver(() => beginEpoch())
    : null;
  const syncResizeTargets = (): void => {
    const root = document.documentElement;
    if (root) resizeObserver?.observe(root);
    if (document.body) resizeObserver?.observe(document.body);
  };
  syncResizeTargets();

  const mutationObserver = new environment.MutationObserver(() => {
    syncResizeTargets();
    beginEpoch();
  });
  mutationObserver.observe(document, { attributes: true, childList: true, subtree: true });

  const fonts = document.fonts;
  if (fonts) void fonts.ready.then(() => beginEpoch());
  beginEpoch();
}
