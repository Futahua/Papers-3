/**
 * Quick Run — the surface: the layer, the line, the chips, the flat result list and its two sentences.
 *
 * The module owns the elements the page declares (#quick-run-layer, -input, -chips, -results, and the two
 * lines -cap and -notice) and paints them from a session. It draws nothing the contract has not decided:
 * section 1.2's row content (icon kind, primary name, faint trailing breadcrumb, one flat list) and section
 * 1.4's chips come from quick-run-presentation.js as data, and this module only turns that data into nodes.
 *
 * Four rules it does not invent:
 *
 * - **The input is the reader's while they are typing.** The value is set from the session when the
 *   session's query is empty (opening and closing), and never while a query is live — a repaint that
 *   overwrote what someone was typing would be the surface fighting the person using it.
 * - **Keys are stable and semantic**, so a later acceptance test can name a row without depending on
 *   order: data-quick-run-key carries the row's resultKey, data-quick-run-highlighted marks the one row
 *   the session highlighted, data-quick-run-chip marks an active chip, and data-quick-run-cap is `true`
 *   exactly while the cap line is on screen.
 * - **The highlight travels with the scroll.** Section 6.3 leaves the list to scroll normally, and the
 *   other half of that sentence is that the selection must not be left behind: the wheel moves the
 *   highlight by the rows it scrolled — accumulating the device's deltas, in whatever unit it reports them,
 *   until a whole row of travel has arrived — and a highlight *moved* by the keyboard, the wheel or a
 *   refresh is brought back into view. Typing is deliberately not in that set: a new query is a new list and
 *   starts at its own top, where its first row already is, and touching the scroll box on every keystroke
 *   forces the layout the paint cap exists to keep out of the keystroke (measured: forcing it there took the
 *   integrated harness from p95 4.3 ms to 8.1 ms). The list's own scroll event feeds that same bookkeeping,
 *   so a dragged scrollbar counts as the reader having scrolled.
 * - **Fractional wheel travel belongs to one baseline.** A row moves on the *sum* of the travel a gesture has
 *   delivered, which means something has to hold the remainder between events — and something has to throw it
 *   away when the list, the highlight or the scroll position is replaced by anything other than the wheel.
 *   Every such operation does: typing, arrows, Tab, a refresh, opening and closing. The awkward case is a
 *   manual scroll (a dragged scrollbar, a touch scroll), because the wheel's own scrolling arrives as scroll
 *   events too — and, measured in the host, a *single* 20 px wheel produces five of them, so counting scroll
 *   events against wheel events does not work. A press on the list is the signal that distinguishes them: the
 *   wheel has no pointer, and a press marks the scroll it causes even when it is released before that scroll
 *   arrives (a track click, measured at 2 ms of press followed by its scroll).
 * - **Nothing is drawn for a state that has nothing to say.** An empty query shows no home screen, an
 *   uncapped list shows no cap line, and a query that matches draws the no-matches line rather than a
 *   blank layer that reads like a stall.
 *
 * Shift+Enter is not handled here: the gesture was cut with its plan (see quick-run-activation.js).
 */
import { quickRunCapNotice, quickRunChipViews, quickRunEmptyNotice, quickRunRowViews } from './quick-run-presentation.js';
import {
  MAX_QUICK_RUN_HEIGHT,
  MAX_QUICK_RUN_WIDTH,
  MIN_QUICK_RUN_HEIGHT,
  MIN_QUICK_RUN_WIDTH,
  normalizeQuickRunCardSize,
} from '../../workspace-model-20260730b.js';
import {
  closeQuickRunSession,
  closedQuickRunSession,
  openQuickRunSession,
  quickRunSessionAfterArrow,
  quickRunSessionAfterScroll,
  quickRunSessionAfterTab,
  quickRunSessionRefreshed,
  quickRunSessionWithQuery,
} from './quick-run-session.js';

const ROW_CLASS = 'quick-run-result';
const CHIP_CLASS = 'quick-run-chip';

/**
 * How many pixels one row of the list is worth when a wheel delta is translated into rows.
 *
 * The painted row's own height is preferred when it can be measured (`offsetHeight`), and this is the
 * fallback for a caller without layout — and the number quick-run.css's row `min-height` is written to, so
 * the fallback and the stylesheet agree.
 */
export const QUICK_RUN_WHEEL_ROW_HEIGHT_PX = 24;

function cardSizeValue(value) {
  return normalizeQuickRunCardSize(value);
}

function setLayerCardSize(layer, size) {
  const normalized = cardSizeValue(size);
  if (!normalized || !layer?.style) return null;
  layer.style.width = `${normalized.width}px`;
  layer.style.height = `${normalized.height}px`;
  if (layer.dataset) layer.dataset.quickRunSized = 'true';
  return normalized;
}

/**
 * The item's own artwork when it is something this list may paint, or null to fall back to the kind glyph.
 *
 * The state persists an icon as a data URI (the same string the canvas paints), so that is what is accepted:
 * anything else - a missing value, an empty string, a path, a remote URL, a number, a `data:` payload that is
 * not an image - is not an icon this row can show, and it degrades to the glyph rather than becoming a
 * broken-image frame. The value is never decoded, re-encoded or rewritten; it is checked and passed on.
 */
function usableIconSource(value) {
  if (typeof value !== 'string') return null;
  if (!/^data:image\//i.test(value.trim())) return null;
  return value;
}

/** The kind glyph: the fallback for every row whose item has no artwork of its own. */
function iconGlyphNode(document, iconKind) {
  const glyph = document.createElement('span');
  glyph.className = 'quick-run-icon quick-run-icon-' + iconKind;
  return glyph;
}

function hydratedIconNode(document, view) {
  const imageWithFallback = (attribute, value) => {
    const image = document.createElement('img');
    image.className = 'quick-run-icon-art';
    image.alt = '';
    image.hidden = true;
    image.dataset[attribute] = value;
    image.addEventListener?.('error', () => {
      image.hidden = true;
      image.nextElementSibling?.removeAttribute?.('hidden');
    }, { once: true });
    return image;
  };
  if (view.webIconTarget) {
    return imageWithFallback('webIcon', view.webIconTarget);
  }
  if (view.defaultIconId) {
    return imageWithFallback('defaultIcon', view.defaultIconId);
  }
  return null;
}

function rowNode(document, view, onRowClick, clearHover, hydrateIcons) {
  const item = document.createElement('li');
  item.className = ROW_CLASS + (view.highlighted ? ' highlighted' : '');
  item.dataset.quickRunKey = view.key;
  item.dataset.quickRunHighlighted = view.highlighted ? 'true' : 'false';
  item.dataset.quickRunHovered = 'false';
  item.addEventListener('mouseover', () => {
    if (typeof clearHover === 'function') clearHover();
    item.dataset.quickRunHovered = 'true';
  });
  const icon = document.createElement('span');
  const source = usableIconSource(view.icon);
  if (source === null) {
    icon.className = 'quick-run-icon quick-run-icon-' + view.iconKind;
    if (hydrateIcons) {
      const image = hydratedIconNode(document, view);
      if (image) {
        const fallback = document.createElement('span');
        fallback.className = 'quick-run-icon-fallback';
        fallback.setAttribute?.('aria-hidden', 'true');
        icon.append(image, fallback);
      }
    }
  } else {
    // One fixed box, the artwork contained in it. The img is created and given its source, and nothing waits
    // for it: the list is not blocked and not reordered by a picture arriving.
    icon.className = 'quick-run-icon quick-run-icon-image';
    const art = document.createElement('img');
    art.className = 'quick-run-icon-art';
    art.alt = '';
    // A data URI can still fail to decode (truncated base64, an unsupported codec). That must not leave a
    // broken-image frame, so the glyph replaces it silently; nothing else about the row changes.
    art.addEventListener?.('error', () => {
      const glyph = iconGlyphNode(document, view.iconKind);
      icon.className = glyph.className;
      icon.replaceChildren?.();
    });
    art.src = source;
    icon.append(art);
  }
  const primary = document.createElement('span');
  primary.className = 'quick-run-name';
  primary.textContent = view.primary;
  const breadcrumb = document.createElement('span');
  breadcrumb.className = 'quick-run-breadcrumb';
  breadcrumb.textContent = view.breadcrumb;
  item.append(icon, primary, breadcrumb);
  // One activation path for both entry points: a click reports the same key a keyboard activation would.
  if (typeof onRowClick === 'function') item.addEventListener('click', () => onRowClick(view.key));
  return item;
}

function chipNode(document, view) {
  const chip = document.createElement('li');
  chip.className = CHIP_CLASS + (view.active ? ' active' : '');
  chip.dataset.quickRunChip = view.label;
  chip.textContent = view.label;
  return chip;
}

/** Bring the highlighted row into view, minimally. A caller without layout (a mock) simply reports nothing. */
function revealHighlightedRow(elements) {
  for (const row of elements.results?.children ?? []) {
    if (row?.dataset?.quickRunHighlighted !== 'true') continue;
    row.scrollIntoView?.({ block: 'nearest' });
    return;
  }
}

/**
 * Paint a session into the elements. Returns the number of rows drawn, for a caller that cares.
 *
 * The cap line is painted from `quickRunCapNotice(session)` and the no-matches line from
 * `quickRunEmptyNotice(session)`: both sentences come from the presentation layer as data, and the surface
 * only decides that `null` means hidden and empty. They are separate elements because they say different
 * things — the cap line is about the list being longer than what is shown, the no-matches line is about
 * there being no list at all — and each appears only while it is true.
 *
 * The list's own scroll position is handled by `keepScroll`, `resetScroll` and `reveal`. A repaint that
 * follows a *movement* inside the list (arrow, Tab, a refreshed snapshot) keeps where the reader was and
 * brings the moved highlight into view. A repaint that follows typing resets the new list to its own top, so
 * the row the highlight moved to is the first thing on screen. The wheel path keeps the reader's position
 * but does *not* reveal: the browser's own scroll moves the viewport by exactly the travel the highlight
 * moves by, so they stay in step without help — and, more importantly, a reveal of our own would emit a
 * scroll event that could not be told from a manual drag (see the mount's scroll bookkeeping).
 *
 * Neither is done unless it is needed: reading or writing a scroll box forces style-and-layout, and the
 * keystroke path is the one the integrated harness measures, so the mount only asks for the reset once the
 * reader has actually scrolled.
 */
export function paintQuickRunSurface({
  document, elements, session, onRowClick, keepScroll = false, resetScroll = false, reveal = false,
  loadFailure = null, hydrateIcons = false,
}) {
  elements.layer.hidden = !session.open;
  if (elements.notice) {
    const empty = quickRunEmptyNotice(session, { loadFailure });
    elements.notice.textContent = empty ? empty.text : '';
    elements.notice.hidden = !empty;
  }
  if (elements.cap) {
    const cap = quickRunCapNotice(session);
    elements.cap.textContent = cap ? cap.text : '';
    elements.cap.dataset.quickRunCap = cap ? 'true' : 'false';
    elements.cap.hidden = !cap;
  }
  if (!session.open) {
    elements.input.value = '';
    elements.chips.replaceChildren();
    elements.results.replaceChildren();
    return 0;
  }
  // Only an empty query may overwrite the field: that is opening (and a cleared line), not typing.
  if (session.query === '') elements.input.value = '';
  const chips = quickRunChipViews(session).map((view) => chipNode(document, view));
  elements.chips.replaceChildren(...chips);
  const rows = quickRunRowViews(session).map((view) => rowNode(document, view, onRowClick, clearHover, hydrateIcons));
  // Hover is a marker of its own, never the keyboard highlight (sections 6.3 and 6.4): moving the pointer
  // may show where the pointer is, and Enter still runs whatever the keyboard highlighted.
  function clearHover() {
    for (const row of elements.results.children ?? []) row.dataset.quickRunHovered = 'false';
  }
  // Touching the scroll box forces style-and-layout, so it happens only on the two paths that need it, and
  // never on an ordinary keystroke: `keepScroll || resetScroll` short-circuits before the scrollTop read.
  const touchesScroll = keepScroll || resetScroll;
  const canScroll = touchesScroll && typeof elements.results.scrollTop === 'number';
  const scrollTop = canScroll && keepScroll ? elements.results.scrollTop : 0;
  elements.results.replaceChildren(...rows);
  if (canScroll) elements.results.scrollTop = scrollTop;
  if (reveal) revealHighlightedRow(elements);
  return rows.length;
}

/**
 * How long after a wheel event the list's own scrolling is still attributed to that wheel.
 *
 * This exists because the wheel's scrolling is animated: measured in the host, one 20 px wheel event
 * produced FIVE scroll events (scroll positions 1, 6, 12, 17, 20), so pairing one credit per wheel event with
 * one scroll event read the extra four as manual drags and threw away the fractional travel the accumulation
 * depends on. A window covers however many scroll events the animation produces. It is a timestamp
 * comparison rather than a timer: nothing here schedules work.
 *
 * The cost of the window is that a manual scroll begun within it is attributed to the wheel once, which
 * keeps at most one sub-row of travel. Everything else that establishes a baseline - typing, arrows, Tab, a
 * refresh, opening and closing - discards the remainder exactly, with no window involved.
 */
export const QUICK_RUN_WHEEL_SCROLL_WINDOW_MS = 400;

/**
 * The two lengths a wheel delta is measured against: how tall a painted row is, and how much of the list
 * the reader can see at once.
 *
 * The painted row's own height is preferred when it can be measured (`offsetHeight`), and the exported
 * fallback is what quick-run.css's row `min-height` is written to, so the two agree. A caller without
 * layout (a test mock) gets the fallbacks.
 */
function wheelMetrics(elements) {
  const measuredRow = Number(elements.results?.children?.[0]?.offsetHeight);
  const rowHeight = Number.isFinite(measuredRow) && measuredRow > 0 ? measuredRow : QUICK_RUN_WHEEL_ROW_HEIGHT_PX;
  const measuredViewport = Number(elements.results?.clientHeight);
  const viewportHeight = Number.isFinite(measuredViewport) && measuredViewport > 0 ? measuredViewport : rowHeight;
  return { rowHeight, viewportHeight };
}

/**
 * One wheel event's travel in pixels, whatever unit the device reported.
 *
 * `deltaMode` is the part that is easy to miss: 0 is pixels, 1 is lines and 2 is pages. A device that
 * reports lines would otherwise be read as a handful of pixels and a device that reports pages as a whole
 * screenful of them. A line in a list of rows is one row, and a page is what the list can show at once.
 */
function wheelPixels(event, { rowHeight, viewportHeight }) {
  const delta = Number(event?.deltaY);
  if (!Number.isFinite(delta) || delta === 0) return 0;
  const mode = Number(event?.deltaMode ?? 0);
  if (mode === 1) return delta * rowHeight;
  if (mode === 2) return delta * viewportHeight;
  return delta;
}

/**
 * Mount Quick Run on the five elements and return the handles the entry file needs.
 *
 * This is the whole wiring, kept out of the composition root on purpose: the entry file passes the
 * elements and a way to read the workspace state, then gives open to the keyboard controller as its
 * openQuickRun callback. Everything else — the input listener, the arrow keys, the wheel, Tab and Escape —
 * lives here, where a test can drive it with element mocks instead of by launching the app.
 */
export function mountQuickRun(input) {
  const {
    document, elements, getState, onActivate, onReveal, onCopyPath, onOpen, onClose,
    universeNote = null, commandSurface = false, now = () => Date.now(), onPaint = null,
    getCardSize = null, onCardSizeChanged = null,
  } = input ?? {};
  if (!document || !elements || typeof getState !== 'function') {
    throw new TypeError('mountQuickRun needs a document, the four elements and a getState function');
  }
  let session = closedQuickRunSession();
  // Whether this session's list has actually been scrolled by a movement. Tracked here rather than read
  // back from the element, because reading it is a layout flush and a keystroke must not pay for one: with
  // this flag, an ordinary typed character touches the scroll box not at all, and the reset happens only
  // when there is something to reset.
  let listScrolled = false;
  // Wheel travel that has not yet added up to a whole row (see the wheel handler below). It belongs to the
  // baseline it was measured against - a particular list, highlight and scroll position - so every non-wheel
  // operation that establishes a new one discards it. Kept across a wheel's own scrolling, which is the
  // whole point of accumulating: a touchpad gesture arrives as a stream of small deltas and their sum is
  // what moves a row.
  let wheelRemainderPx = 0;
  // When the wheel last ran, so the scrolling it causes can be told from a manual drag or touch scroll. The
  // wheel's scrolling is animated and arrives as several scroll events; a window covers all of them.
  let lastWheelAt = Number.NEGATIVE_INFINITY;
  // Whether a press on the list is currently under way: a scrollbar drag or a touch scroll, as opposed to the
  // wheel, which has no pointer. Set by the listeners below.
  let manualScrollUnderway = false;
  // Whether a press has ended but the scroll it caused has not arrived yet. Both flags exist because the
  // press and its scroll are not simultaneous: measured in the host, a track click's press and release span
  // two milliseconds and the scroll it causes lands AFTER the release. A press therefore marks the next
  // scroll as manual whether or not it is still down when that scroll arrives.
  let manualScrollPending = false;
  // Section 6.4: one execution implementation, reached from the keyboard and the pointer alike.
  // Where focus was before this surface took it. Type-to-run opens the palette from a keystroke aimed at
  // the canvas, so the palette is the only thing between the reader and where they were; Escape has to give
  // that place back. Recorded on open and used on close, and never used to pull focus away from an action
  // that has already moved it somewhere the reader asked for.
  let previousFocus = null;
  const resizeHandle = document.createElement('button');
  resizeHandle.type = 'button';
  resizeHandle.className = 'quick-run-resize-handle';
  resizeHandle.title = 'Resize Quick Run';
  resizeHandle.setAttribute?.('aria-label', 'Resize Quick Run');
  resizeHandle.tabIndex = -1;
  elements.layer.append?.(resizeHandle);
  let resizeStart = null;
  let resizePointerId = null;
  let resizeListenersAttached = false;
  const readLayerSize = () => {
    const rect = elements.layer.getBoundingClientRect?.();
    const width = Number(rect?.width) || Number(elements.layer.offsetWidth) || 680;
    const height = Number(rect?.height) || Number(elements.layer.offsetHeight) || 320;
    return { width, height };
  };
  const applySavedCardSize = () => {
    if (commandSurface) return;
    const saved = typeof getCardSize === 'function' ? getCardSize() : null;
    if (saved) setLayerCardSize(elements.layer, saved);
  };
  const resizeBounds = () => {
    const viewportWidth = Number(document.documentElement?.clientWidth) || MAX_QUICK_RUN_WIDTH;
    const viewportHeight = Number(document.documentElement?.clientHeight) || MAX_QUICK_RUN_HEIGHT;
    return {
      width: Math.min(MAX_QUICK_RUN_WIDTH, Math.max(MIN_QUICK_RUN_WIDTH, viewportWidth - 24)),
      height: Math.min(MAX_QUICK_RUN_HEIGHT, Math.max(MIN_QUICK_RUN_HEIGHT, viewportHeight - 32)),
    };
  };
  const removeResizeListeners = () => {
    if (!resizeListenersAttached) return;
    document.removeEventListener?.('pointermove', handleResizeMove);
    document.removeEventListener?.('pointerup', finishResize);
    document.removeEventListener?.('pointercancel', finishResize);
    resizeListenersAttached = false;
  };
  const matchesResizePointer = (event) => (
    resizePointerId === null || event?.pointerId === undefined || event.pointerId === resizePointerId
  );
  const finishResize = (event = null) => {
    if (!resizeStart) return;
    if (event && !matchesResizePointer(event)) return;
    const size = cardSizeValue({
      width: Number.parseFloat(elements.layer.style?.width) || resizeStart.width,
      height: Number.parseFloat(elements.layer.style?.height) || resizeStart.height,
    });
    resizeStart = null;
    resizePointerId = null;
    removeResizeListeners();
    if (!size) return;
    setLayerCardSize(elements.layer, size);
    try {
      const result = onCardSizeChanged?.(size);
      if (result?.catch) result.catch(() => {});
    } catch {
      // A persistence failure is reported by the owning save callback; the card remains usable.
    }
  };
  const handleResizeMove = (event) => {
    if (!resizeStart || commandSurface || !matchesResizePointer(event)) return;
    const bounds = resizeBounds();
    const width = Math.min(bounds.width, Math.max(MIN_QUICK_RUN_WIDTH, resizeStart.width + Number(event.clientX || 0) - resizeStart.pointerX));
    const height = Math.min(bounds.height, Math.max(MIN_QUICK_RUN_HEIGHT, resizeStart.height + Number(event.clientY || 0) - resizeStart.pointerY));
    // Mark the card as sized as soon as the drag starts so the result list can use the newly available
    // height while the pointer is still moving, rather than waiting for a pointerup on the tiny grip.
    setLayerCardSize(elements.layer, { width: Math.round(width), height: Math.round(height) });
  };
  resizeHandle.addEventListener?.('pointerdown', (event) => {
    if (commandSurface) return;
    const start = readLayerSize();
    resizeStart = { ...start, pointerX: Number(event.clientX) || 0, pointerY: Number(event.clientY) || 0 };
    resizePointerId = event.pointerId ?? null;
    setLayerCardSize(elements.layer, start);
    document.addEventListener?.('pointermove', handleResizeMove);
    document.addEventListener?.('pointerup', finishResize);
    document.addEventListener?.('pointercancel', finishResize);
    resizeListenersAttached = true;
    resizeHandle.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
  // Pointer capture remains an optimization, but document-level tracking is the correctness path: once the
  // pointer leaves the 18px grip, Chromium/Electron may retarget the move/up events away from the button.
  const activate = (key) => { if (key && typeof onActivate === 'function') onActivate(key); };
  const highlighted = () => (typeof session.highlightKey === 'string' ? session.highlightKey : null);
  /** A new selection, list or scroll baseline, established by something other than the wheel. */
  const newBaseline = () => {
    wheelRemainderPx = 0;
    lastWheelAt = Number.NEGATIVE_INFINITY;
    manualScrollUnderway = false;
    manualScrollPending = false;
  };
  const paint = (options = {}) => {
    const keepScroll = options.keepScroll === true;
    const reveal = options.reveal === true;
    const resetScroll = !keepScroll && listScrolled;
    const drawn = paintQuickRunSurface({
      document,
      elements,
      session,
      onRowClick: activate,
      keepScroll,
      resetScroll,
      reveal,
      // Why the universe is empty, when the loader knows. The launcher overlay has no canvas behind it, so
      // this is the only place the difference between "your project is empty" and "I could not read your
      // project" can be shown - and flattening those two is what hid the creator's failure.
      loadFailure: typeof universeNote === 'function' ? universeNote() : null,
      hydrateIcons: typeof onPaint === 'function',
    });
    if (typeof onPaint === 'function') {
      try {
        onPaint(elements.layer);
      } catch {
        // Icon hydration is best effort; the fixed fallback slot remains usable.
      }
    }
    if (keepScroll) listScrolled = true;
    else if (resetScroll) listScrolled = false;
    return drawn;
  };

  elements.input.addEventListener('input', () => {
    // A new query is a new list: any part of a wheel gesture still owed to the old one is dropped, and the
    // painted list starts at its own top.
    newBaseline();
    session = quickRunSessionWithQuery(session, elements.input.value);
    paint();
  });

  // The list is natively scrollable, so a dragged scrollbar or a touch scroll moves it without any repaint
  // of ours. Two things have to come from the element's own scroll event: the dirty flag, or typing after
  // such a scroll would leave the newly highlighted row above the viewport; and the distinction between that
  // manual scroll and the wheel's own, because the wheel's scrolling must not discard the fractional travel
  // this file accumulates.
  elements.results.addEventListener?.('scroll', () => {
    listScrolled = true;
    if (manualScrollUnderway || manualScrollPending) {
      manualScrollPending = false;
      wheelRemainderPx = 0;
      return;
    }
    if (now() - lastWheelAt < QUICK_RUN_WHEEL_SCROLL_WINDOW_MS) return;
    wheelRemainderPx = 0;
  });

  // A drag on the scrollbar, or a touch scroll, begins with a press on the list: measured in the host, a real
  // scrollbar drag delivers pointerdown with the list itself as the target. That press is the exact signal,
  // and it is what makes a drag distinguishable from the wheel's own animated scrolling even when it starts
  // while that animation is still running - which the recency window alone cannot do. The wheel has no
  // pointer at all, so it never arms this; and the wheel clears both flags, so a missed pointerup heals
  // itself and cannot leave the remainder permanently discarded.
  elements.results.addEventListener?.('pointerdown', () => {
    manualScrollUnderway = true;
    manualScrollPending = true;
  });
  elements.results.addEventListener?.('pointerup', () => { manualScrollUnderway = false; });
  elements.results.addEventListener?.('pointercancel', () => { manualScrollUnderway = false; });

  elements.layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      // In the launcher overlay, Escape belongs to the HOST: it dismisses the window from the window's own
      // input handler, so dismissal works even while this page is still loading. Closing the surface here
      // instead would empty a window the host still has up - an always-on-top box with nothing in it - so the
      // key is not claimed at all and is left to travel on. This is the one behavioural divergence the
      // overlay forces, and it is deliberate.
      if (commandSurface) return;
      if (event.preventDefault) event.preventDefault();
      // Through the surface's own close, never a second copy of it: the session, the painted list and the
      // return of focus to wherever the reader was are one operation, and this handler is the one Escape
      // actually takes (the controller ignores every other key while the palette is up).
      surface.close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.preventDefault) event.preventDefault();
      // A new row is a new baseline: travel still owed to the wheel belonged to the row the reader just left.
      newBaseline();
      session = quickRunSessionAfterArrow(session, event.key === 'ArrowDown' ? 1 : -1);
      paint({ keepScroll: true, reveal: true });
      return;
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      // Section 1.6: Ctrl+Enter reveals the occurrence inside the workspace. The mount does not know what
      // revealing means; it hands the key to the caller, which is where section 1.6's boundary lives. With
      // no row highlighted there is no occurrence to reveal, and the key is left alone rather than being
      // handed over as a target that never existed.
      if (event.preventDefault) event.preventDefault();
      const key = highlighted();
      if (key && typeof onReveal === 'function') onReveal(key);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key?.toLowerCase() === 'c') {
      const key = highlighted();
      const handled = key && typeof onCopyPath === 'function' ? onCopyPath(key) : false;
      if (handled && event.preventDefault) event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      // Only the unmodified key is the default action. Shift+Enter used to mean "add to the active layout"
      // and was cut (see quick-run-activation.js); leaving it to fall through here would turn a cut gesture
      // into a silent second Enter, so a modified Enter no longer claimed by anything is deliberately inert.
      if (event.preventDefault) event.preventDefault();
      activate(highlighted());
      return;
    }
    if (event.key === 'Tab') {
      if (event.preventDefault) event.preventDefault();
      // The AUTHOR ruling of 2026-09-12: Tab steps through the chips on offer, never onto a type the
      // current query has emptied. A filter change is a new list and a new highlight, so it is a new baseline.
      newBaseline();
      session = quickRunSessionAfterTab(session, event.shiftKey ? -1 : 1);
      paint({ keepScroll: true, reveal: true });
    }
  });

  // Section 6.3, both halves: the list scrolls normally — this handler never calls preventDefault — and the
  // highlight moves with it, so the row Enter would run is the row the reader is looking at.
  //
  // Travel is accumulated rather than rounded per event. A precision touchpad reports a stream of sub-row
  // deltas, and treating every non-zero one as a whole row ran the selection ahead of the list by however
  // many events the gesture happened to produce; a row moves only once a row's worth of travel has arrived,
  // and the remainder is kept for the next event.
  elements.layer.addEventListener('wheel', (event) => {
    if (!session.open || session.rows.length === 0) return;
    const metrics = wheelMetrics(elements);
    const pixels = wheelPixels(event, metrics);
    if (pixels === 0) return;
    // A wheel is not a drag: it clears the press flags, so a pointerup that never arrived cannot leave the
    // remainder permanently discarded, and a press that caused no scroll cannot mark the wheel's own.
    manualScrollUnderway = false;
    manualScrollPending = false;
    lastWheelAt = now();
    wheelRemainderPx += pixels;
    const rows = Math.trunc(wheelRemainderPx / metrics.rowHeight);
    if (rows === 0) return;
    wheelRemainderPx -= rows * metrics.rowHeight;
    session = quickRunSessionAfterScroll(session, rows);
    // No reveal here: the browser's own scroll moves the viewport by exactly the travel the highlight moves
    // by, so the two stay in step on their own, and a reveal of ours would emit a scroll event that the
    // bookkeeping above could not tell from a manual drag.
    paint({ keepScroll: true });
  });

  paint();

  const surface = {
    /**
     * The keyboard controller's openQuickRun callback: open on the current state and show the line.
     *
     * With a seed (type-to-run), the character that opened the palette is put into the line here, as the
     * query and as the field's text, and nowhere else: the caller prevents the browser's own insertion for
     * exactly this reason, so the character cannot arrive twice - once by the default action and once by
     * this call. `paint()` never overwrites a non-empty query, so the seeded text survives the paint, and
     * the caret is left after it so the next letter continues the word rather than replacing it.
     */
    open(seed) {
      const seeded = typeof seed === 'string' && seed !== '' ? seed : '';
      listScrolled = false;
      newBaseline();
      previousFocus = document.activeElement ?? null;
      // Told before focus moves, so a modal underneath can freeze before anything about it changes.
      onOpen?.();
      applySavedCardSize();
      session = openQuickRunSession(getState());
      if (seeded !== '') {
        session = quickRunSessionWithQuery(session, seeded);
        elements.input.value = seeded;
      }
      paint();
      // One empty *focused* line: the section says the reader types immediately, so the field takes
      // focus on open. Guarded because a caller may mount without a focusable input.
      elements.input.focus?.();
      if (seeded !== '') {
        // UTF-16 units, which is what a selection range counts in - a seed outside the BMP is two of them.
        const caret = seeded.length;
        try {
          elements.input.setSelectionRange?.(caret, caret);
        } catch {
          // A field that cannot hold a selection (a mock, or a detached input) still has its text.
        }
      }
      return true;
    },
    close() {
      // Read before painting: hiding the layer takes focus off it, so afterwards the answer would always
      // be no. Only a close that still owns focus gives it back; an action that navigated to a folder or
      // launched something has already put focus where the reader asked to be, and taking it back would
      // undo the thing they just did.
      const ownsFocus = elements.layer.contains?.(document.activeElement) === true;
      listScrolled = false;
      newBaseline();
      session = closeQuickRunSession();
      paint();
      const target = previousFocus;
      previousFocus = null;
      // Not in the overlay: the host is handing focus back to the application the creator came from while an
      // action runs, and a page that focused its own body on the way out would fight it. Nothing else about
      // closing changes.
      if (!commandSurface && ownsFocus && target && typeof target.focus === 'function' && target.isConnected !== false) {
        target.focus();
      }
      // And unfrozen after focus is back, so the next deliberate action persists normally.
      onClose?.();
    },
    /**
     * The invoked event, as the host means it: put the reader on an empty, focused line.
     *
     * Not "open" - the marker already opened it - and not "append", which is what typing into a line that
     * already holds a query would do. Idempotent, because the creator may press the chord twice.
     */
    focusEmptyLine() {
      listScrolled = false;
      newBaseline();
      if (!session.open) {
        session = openQuickRunSession(getState());
      } else {
        session = quickRunSessionWithQuery(session, '');
      }
      elements.input.value = '';
      paint();
      elements.input.focus?.();
      return true;
    },
    appendText(text) {
      if (!session.open || typeof text !== 'string' || [...text].length !== 1
        || new TextEncoder().encode(text).length > 8) return false;
      const next = `${session.query}${text}`;
      if (new TextEncoder().encode(next).length > 512) return false;
      newBaseline();
      session = quickRunSessionWithQuery(session, next);
      elements.input.value = next;
      paint();
      elements.input.focus?.();
      try { elements.input.setSelectionRange?.(next.length, next.length); } catch { /* non-text test doubles */ }
      return true;
    },
    /**
     * Rebuild the snapshot from the current state, keeping the query and the filter (section 5).
     *
     * The caller uses this after an action found its target gone: without it the dead row stays on screen
     * and the reader can only hit it again, which is how a stale index turns into a loop. A rebuilt list with
     * a re-chosen highlight is a new baseline, so fractional wheel travel does not survive it.
     */
    refresh() {
      if (!session.open) return session;
      newBaseline();
      session = quickRunSessionRefreshed(session, getState());
      paint({ keepScroll: true, reveal: true });
      return session;
    },
    /**
     * The chord, as a toggle: open the palette, or dismiss one that is already open.
     *
     * The creator's report is why this exists - the chord did nothing at all while an input had focus, so the
     * palette could be opened but never dismissed with the key that opened it. It reports whether it *opened*;
     * a caller reading the answer is not told "opened" by a keypress that closed it.
     */
    toggle() {
      if (session.open) {
        surface.close();
        return false;
      }
      return surface.open();
    },
    session: () => session,
  };
  return surface;
}
