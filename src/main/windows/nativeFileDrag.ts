import type { HoverInputBridge } from './hoverInputBridge';

interface DragWindow {
  isDestroyed(): boolean;
  getNativeWindowHandle(): Buffer;
  showInactive(): void;
}

/** Wraps the existing synchronous native drag. The existing input helper owns
 * Shift observation; the existing foreground bridge owns destination activation. */
export async function runNativeFileDrag(input: {
  window: DragWindow | null;
  tracker: Pick<HoverInputBridge, 'beginNativeDrag' | 'endNativeDrag'> | null;
  start: () => void;
  activateDestination: (handle: number) => Promise<boolean>;
  onError: (error: unknown) => void;
}): Promise<void> {
  const { window, tracker } = input;
  let id: number | null = null;
  if (window && !window.isDestroyed() && tracker) {
    try { id = await tracker.beginNativeDrag(window.getNativeWindowHandle()); }
    catch (error) { input.onError(error); }
  }
  let failed = false;
  try { input.start(); }
  catch (error) { failed = true; throw error; }
  finally {
    if (id !== null && tracker) {
      try {
        const result = await tracker.endNativeDrag(id);
        if (result.revealed && window && !window.isDestroyed()) window.showInactive();
        if (!failed && result.revealed && result.destinationHandle !== null) {
          if (!await input.activateDestination(result.destinationHandle)) input.onError(new Error('drag destination could not be brought forward'));
        }
      } catch (error) {
        // A disconnected native helper must never leave its source hidden.
        if (window && !window.isDestroyed()) window.showInactive();
        input.onError(error);
      }
    }
  }
}
