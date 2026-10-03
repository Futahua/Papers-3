const TOOLBAR_EDGE_MARGIN = 8;

/** A dragged pill's saved x/y are offsets from whichever edge (left/right,
 * top/bottom) it landed nearest to at drop time, stored as a fraction of
 * the workspace's width/height (0..1). A positive value is a distance from
 * the left/top edge, a negative value is a distance from the right/bottom
 * edge (stored as its negation). This keeps a pill dropped near the right
 * edge, say, still near the right edge after the window is resized, and the
 * percentage-based offsets prevent it from drifting offscreen or overlapping
 * other pills the way a fixed pixel offset would. */
export function toolbarPositionFromRect(rect, workspaceRect) {
  const width = Math.max(1, workspaceRect.width);
  const height = Math.max(1, workspaceRect.height);
  const distanceFromLeft = rect.left - workspaceRect.left;
  const distanceFromRight = workspaceRect.right - rect.right;
  const distanceFromTop = rect.top - workspaceRect.top;
  const distanceFromBottom = workspaceRect.bottom - rect.bottom;
  return {
    x: distanceFromRight < distanceFromLeft ? -distanceFromRight / width : distanceFromLeft / width,
    y: distanceFromBottom < distanceFromTop ? -distanceFromBottom / height : distanceFromTop / height,
  };
}

/** Clamps a saved edge-offset fraction so the pill's full width/height always
 * stays within the workspace, with a small margin. `offset` is a fraction
 * (0..1) of the workspace span, `size` is the pill's own width/height in
 * pixels, and `span` is the workspace's current width/height in pixels. */
function clampToolbarOffset(offset, size, span) {
  const margin = TOOLBAR_EDGE_MARGIN / Math.max(1, span);
  const maxOffset = Math.max(margin, 1 - size / Math.max(1, span) - margin);
  return Math.min(Math.max(offset, margin), maxOffset);
}

/** Owns the floating toolbar pills: restoring their saved positions,
 * clamping them inside the workspace, dragging them, and re-applying
 * positions on window resize. Reads and writes workspace state through the
 * injected getState/setState pair and persists through the injected
 * persist() so it never mutates shared state directly. */
export function createToolbarController({
  window,
  document,
  getState,
  setState,
  setToolbarPosition,
  getToolbarPosition,
  persist,
  setStatus,
}) {
  let drag = null;
  let toolbarResizeTimer = null;
  let abortController = null;

  function toolbarElements() {
    return document.querySelectorAll('.toolbar-float[data-toolbar-key]');
  }

  function applyToolbarPosition(element, key) {
    const saved = getToolbarPosition(getState(), key);
    if (!saved) return;
    const workspace = document.querySelector('.workspace');
    const workspaceRect = workspace?.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const width = elementRect.width || element.offsetWidth;
    const height = elementRect.height || element.offsetHeight;
    const spanX = workspaceRect?.width ?? window.innerWidth;
    const spanY = workspaceRect?.height ?? window.innerHeight;

    // Legacy positions were stored as pixel offsets; convert them to fractions.
    let x = saved.x;
    let y = saved.y;
    if (Math.abs(x) > 1) x = x / Math.max(1, spanX);
    if (Math.abs(y) > 1) y = y / Math.max(1, spanY);

    if (x < 0) {
      element.style.right = `${clampToolbarOffset(-x, width, spanX) * 100}%`;
      element.style.left = 'auto';
    } else {
      element.style.left = `${clampToolbarOffset(x, width, spanX) * 100}%`;
      element.style.right = 'auto';
    }
    // Always position from the top. The pills live inside .navigation, which
    // is height:0, so a percentage `bottom` resolves against nothing and puts
    // the element off-screen above the window — which is how a pill dragged
    // near the bottom edge became unreachable. Converting a bottom-anchored
    // offset to a top offset in pixels keeps it on screen and still respects
    // where it was dropped.
    const topOffset = y < 0
      ? spanY - clampToolbarOffset(-y, height, spanY) * spanY - height
      : clampToolbarOffset(y, height, spanY) * spanY;
    element.style.top = `${Math.max(TOOLBAR_EDGE_MARGIN, Math.min(topOffset, spanY - height - TOOLBAR_EDGE_MARGIN))}px`;
    element.style.bottom = 'auto';
  }

  function restorePositions() {
    toolbarElements().forEach((element) => {
      applyToolbarPosition(element, element.dataset.toolbarKey);
    });
  }

  function logPositions() {
    const positions = getState().view?.toolbarPositions ?? {};
    const keys = Object.keys(positions);
    if (keys.length === 0) {
      console.log('Toolbar positions: (none, using CSS defaults)');
    } else {
      console.log('Toolbar positions:', Object.fromEntries(
        keys.map((key) => [key, positions[key]]),
      ));
    }
  }

  function rollbackActiveDrag() {
    if (!drag) return false;
    const active = drag;
    drag = null;
    if (active.element.hasPointerCapture(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId);
    }
    active.element.classList.remove('toolbar-dragging');
    for (const [property, value] of Object.entries(active.initialStyle)) {
      active.element.style[property] = value;
    }
    return true;
  }

  function setupDragging() {
    toolbarElements().forEach((element) => {
      const signal = abortController.signal;
      element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        // Toolbar actions are ordinary buttons. Only the explicit handle is a
        // drag surface, so pointer jitter over Copy/Bin/Restore/Delete can
        // never turn a click into an accidental move.
        const handle = event.target?.closest?.('[data-toolbar-drag-handle]');
        if (!handle) return;
        if (drag) return;
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        drag = {
          element,
          key: element.dataset.toolbarKey,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          moved: false,
          initialStyle: {
            left: element.style.left ?? '',
            right: element.style.right ?? '',
            top: element.style.top ?? '',
            bottom: element.style.bottom ?? '',
          },
        };
        // Pointer capture is deferred until the drag threshold is actually
        // crossed (below), not taken on every pointerdown — capturing
        // immediately interferes with a plain click's default activation on
        // a nested <button> (the breadcrumb's own navigation buttons), which
        // broke breadcrumb navigation entirely. Matches the same deferred-
        // capture pattern already used for graph node dragging.
      }, { signal });

      element.addEventListener('pointermove', (event) => {
        if (!drag || drag.pointerId !== event.pointerId || drag.element !== element) return;
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
        if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (!drag.moved) {
          drag.moved = true;
          drag.element.classList.add('toolbar-dragging');
          element.setPointerCapture(event.pointerId);
        }
        const workspace = document.querySelector('.workspace');
        const workspaceRect = workspace.getBoundingClientRect();
        const elementRect = drag.element.getBoundingClientRect();
        const width = elementRect.width || drag.element.offsetWidth;
        const height = elementRect.height || drag.element.offsetHeight;
        const maxX = Math.max(TOOLBAR_EDGE_MARGIN, workspaceRect.width - width - TOOLBAR_EDGE_MARGIN);
        const maxY = Math.max(TOOLBAR_EDGE_MARGIN, workspaceRect.height - height - TOOLBAR_EDGE_MARGIN);
        const x = Math.min(Math.max(TOOLBAR_EDGE_MARGIN, event.clientX - workspaceRect.left - drag.offsetX), maxX);
        const y = Math.min(Math.max(TOOLBAR_EDGE_MARGIN, event.clientY - workspaceRect.top - drag.offsetY), maxY);
        drag.element.style.left = `${x}px`;
        drag.element.style.top = `${y}px`;
        drag.element.style.right = 'auto';
        drag.element.style.bottom = 'auto';
      }, { signal });

      const finishDrag = (event, expectedElement = null) => {
        if (!drag || drag.pointerId !== event.pointerId || (expectedElement && drag.element !== expectedElement)) return;
        const active = drag;
        // Clear the shared slot before releasing capture. Browsers may emit
        // lostpointercapture synchronously; it must not reinterpret a
        // successful release as a cancellation/rollback.
        drag = null;
        if (active.element.hasPointerCapture(event.pointerId)) {
          active.element.releasePointerCapture(event.pointerId);
        }
        const { key, moved } = active;
        active.element.classList.remove('toolbar-dragging');
        if (!moved) return;
        const rect = active.element.getBoundingClientRect();
        const workspaceRect = document.querySelector('.workspace').getBoundingClientRect();
        const nextState = setToolbarPosition(
          getState(),
          key,
          toolbarPositionFromRect(rect, workspaceRect),
        );
        setState(nextState);
        void persist(nextState).catch((error) =>
          setStatus(error instanceof Error ? error.message : String(error)));
      };
      const cancelDrag = (event) => {
        if (!drag || drag.pointerId !== event.pointerId || drag.element !== element) return;
        rollbackActiveDrag();
      };
      element.addEventListener('pointerup', (event) => finishDrag(event, element), { signal });
      element.addEventListener('pointercancel', cancelDrag, { signal });
      element.addEventListener('lostpointercapture', cancelDrag, { signal });
      element.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-toolbar-drag-handle]')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, { capture: true, signal });
    });

    // A release can land outside the element before capture is established;
    // window-level cleanup prevents a stranded grabbing state.
    window.addEventListener('pointerup', (event) => finishDrag(event), { signal: abortController.signal, capture: true });
    window.addEventListener('pointercancel', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      rollbackActiveDrag();
    }, { signal: abortController.signal, capture: true });
    window.addEventListener('blur', () => {
      rollbackActiveDrag();
    }, { signal: abortController.signal });
  }

  function handleResize() {
    clearTimeout(toolbarResizeTimer);
    toolbarResizeTimer = setTimeout(restorePositions, 80);
  }

  function mount() {
    abortController = new AbortController();
    restorePositions();
    logPositions();
    setupDragging();
    window.addEventListener('resize', handleResize, { signal: abortController.signal });
  }

  function destroy() {
    rollbackActiveDrag();
    abortController?.abort();
    abortController = null;
    if (toolbarResizeTimer !== null) {
      clearTimeout(toolbarResizeTimer);
      toolbarResizeTimer = null;
    }
  }

  return { mount, restorePositions, destroy };
}
