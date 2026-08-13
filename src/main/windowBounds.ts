/**
 * Saved-window-size preset.
 *
 * The creator can capture the current Papers rectangle and have every later
 * launch reopen at it — including a rectangle deliberately dragged across
 * several monitors, whose coordinates legitimately fall outside any single
 * display and are often negative.
 *
 * That is exactly why the saved rectangle cannot be trusted verbatim on the
 * next launch: displays get disconnected and rearranged, and a rectangle
 * restored onto a layout that no longer exists puts Papers off-screen with no
 * way to drag it back. Everything here is pure so the recovery rules can be
 * tested without an Electron display.
 */

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A display's usable area, matching Electron's Display.workArea. */
export interface DisplayArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 600;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates a persisted rectangle. Returns null for anything malformed so a
 * hand-edited or partially-written settings file falls back to the default
 * size rather than throwing during startup.
 */
export function normalizeWindowBounds(value: unknown): WindowBounds | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const { x, y, width, height } = candidate;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  // A zero or negative extent is never a real window; negative x/y are fine
  // (a monitor left of or above the primary display has negative origins).
  if (width < 1 || height < 1) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(width, MIN_WINDOW_WIDTH)),
    height: Math.round(Math.max(height, MIN_WINDOW_HEIGHT)),
  };
}

function overlapArea(bounds: WindowBounds, area: DisplayArea): number {
  const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0;
  return overlapWidth * overlapHeight;
}

/**
 * The total desktop rectangle spanned by every display. A window dragged
 * across three monitors is only "still valid" relative to this union, not to
 * any one display.
 */
export function desktopEnvelope(displays: readonly DisplayArea[]): DisplayArea | null {
  if (displays.length === 0) return null;
  const left = Math.min(...displays.map((d) => d.x));
  const top = Math.min(...displays.map((d) => d.y));
  const right = Math.max(...displays.map((d) => d.x + d.width));
  const bottom = Math.max(...displays.map((d) => d.y + d.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Resolves a saved rectangle against the displays actually attached now.
 *
 * A multi-monitor rectangle is preserved as-is as long as a usable part of it
 * still lands on some display — that is the whole point of the preset, so it
 * must survive spanning gaps and unequal monitor heights. Only when the
 * rectangle has drifted essentially out of view (a monitor was unplugged) is
 * it clamped back onto the display it best matches.
 *
 * Returns null when there is nothing sensible to restore, letting the caller
 * fall back to its built-in default size.
 */
export function resolveWindowBounds(
  saved: unknown,
  displays: readonly DisplayArea[],
): WindowBounds | null {
  const bounds = normalizeWindowBounds(saved);
  if (!bounds || displays.length === 0) return null;

  // Enough of the window is on-screen to grab and move: keep the creator's
  // exact rectangle, spanning however many monitors it spans.
  const visible = displays.reduce((total, area) => total + overlapArea(bounds, area), 0);
  const windowArea = bounds.width * bounds.height;
  if (windowArea > 0 && visible / windowArea >= 0.5) return bounds;

  // Otherwise recover onto the display the rectangle overlaps most, falling
  // back to the first display when it overlaps none at all.
  const target = displays.reduce((best, area) =>
    overlapArea(bounds, area) > overlapArea(bounds, best) ? area : best,
  displays[0] as DisplayArea);

  const width = Math.min(Math.max(bounds.width, MIN_WINDOW_WIDTH), target.width);
  const height = Math.min(Math.max(bounds.height, MIN_WINDOW_HEIGHT), target.height);
  return {
    width,
    height,
    x: Math.round(Math.min(Math.max(bounds.x, target.x), target.x + target.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, target.y), target.y + target.height - height)),
  };
}
