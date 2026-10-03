/** Owns the shared grid pointer gesture that coordinates graph-node dragging
 * and marquee selection. Keeps capture/release, threshold, zoom transforms,
 * temporary node x/y/fx/fy updates, hover/drag CSS, hit testing, shift
 * pinning, pointer-cancel rollback, and blank/graph click suppression. All
 * persistent outcomes (Bin/folder drop, pin/release of positions, selection
 * updates, saving) delegate to commands — never passing the raw event. */
export function createPointerController({
  window,
  document,
  elements,
  store,
  commands,
  graph,
  marquee,
  zoomTransform,
  group,
  visiblePlacementIdFor,
  closeMenu,
  nativeDragPaths = () => [],
  startNativeDrag = () => Promise.resolve(),
  onDragTrail = () => {},
  clearDragTrail = () => {},
  setSuppressGraphClick,
  setSuppressBlankClick,
  consumeSuppressGraphClick,
}) {
  let drag = null;
  let shiftKeydown = null;
  let shiftKeyup = null;
  let abortController = null;

  function installShiftListeners() {
    if (shiftKeydown) return;
    shiftKeydown = (event) => {
      if (event.key === 'Shift' && drag && !drag.ancestorOnly) {
        drag.pinOnRelease = true;
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node?.shell) {
            node.shell.classList.remove('will-release');
            node.shell.classList.add('will-pin');
          }
        }
      }
    };
    shiftKeyup = (event) => {
      if (event.key === 'Shift' && drag && !drag.ancestorOnly) {
        drag.pinOnRelease = false;
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node?.shell) {
            node.shell.classList.remove('will-pin');
            node.shell.classList.add('will-release');
          }
        }
      }
    };
    window.addEventListener('keydown', shiftKeydown, { capture: true });
    window.addEventListener('keyup', shiftKeyup, { capture: true });
  }

  function removeShiftListeners() {
    if (shiftKeydown) {
      window.removeEventListener('keydown', shiftKeydown, { capture: true });
      shiftKeydown = null;
    }
    if (shiftKeyup) {
      window.removeEventListener('keyup', shiftKeyup, { capture: true });
      shiftKeyup = null;
    }
  }

  function clearDragVisuals() {
    document.querySelectorAll('.graph-dragging').forEach((el) =>
      el.classList.remove('graph-dragging', 'will-pin', 'will-release'));
    document.querySelectorAll('.graph-drop-target').forEach((el) =>
      el.classList.remove('graph-drop-target'));
    elements.binButton?.classList.remove('graph-bin-drop-target');
  }

  function transformFor(viewport) {
    if (!viewport) return { x: 0, y: 0, k: 1 };
    try {
      return zoomTransform(viewport);
    } catch {
      return { x: 0, y: 0, k: 1 };
    }
  }

  function clientToWorld(clientX, clientY) {
    const viewport = elements.grid.querySelector('.graph-viewport');
    const transform = transformFor(viewport);
    const rect = viewport?.getBoundingClientRect();
    const localX = rect ? clientX - rect.left : clientX;
    const localY = rect ? clientY - rect.top : clientY;
    return {
      x: (localX - transform.x) / transform.k,
      y: (localY - transform.y) / transform.k,
    };
  }

  function onDoubleClick(event) {
    if (consumeSuppressGraphClick()) return;
    const tile = event.target.closest('.icon-item');
    if (!tile) return;
    commands.activateItem(tile.dataset.id, { revealDirectoryTarget: true });
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    const session = store.getSession();

    if (!event.target.closest('[data-expand]') && !event.target.closest('button') && !event.ctrlKey) {
      const tile = event.target.closest('.icon-item');
      const shell = tile?.closest('.graph-node-shell');
      if (shell && event.pointerType !== 'touch' && !tile.classList.contains('bin-origin-ghost')) {
        const itemId = tile.dataset.id;
        if (tile.classList.contains('ancestor-item')) {
          // Assignment 003: an ancestor tile is draggable like any body —
          // it moves under the pointer and floats again on release. It
          // never selects (clicks navigate), never pins (even with
          // Shift), and never persists: pinDraggedNodes would write a
          // position and releaseDraggedNodes would remove the real
          // folder's stored record where the ancestor id collides with
          // one, so neither command is called.
          drag = {
            pointerId: event.pointerId,
            itemIds: [itemId],
            placementIds: new Map(),
            primaryNodeId: itemId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startWorldX: null,
            startWorldY: null,
            initialPositions: new Map(),
            pinOnRelease: false,
            ancestorOnly: true,
            moved: false,
            thresholdPassed: false,
          };
          closeMenu();
          event.preventDefault();
          return;
        }
        if (!session.selected.has(itemId)) {
          commands.selectItem(itemId, { shiftKey: false, ctrlKey: false, visibleItemIds: [] });
        }
        const dragPlacementIds = new Map();
        for (const id of session.selected) {
          if (group(id)) continue;
          const placementId = visiblePlacementIdFor(id);
          if (placementId) dragPlacementIds.set(id, placementId);
        }
        drag = {
          pointerId: event.pointerId,
          itemIds: [...session.selected],
          placementIds: dragPlacementIds,
          primaryNodeId: itemId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startWorldX: null,
          startWorldY: null,
          initialPositions: new Map(),
          pinOnRelease: event.shiftKey,
          moved: false,
          thresholdPassed: false,
        };
        closeMenu();
        event.preventDefault();
        return;
      }
    }

    if (
      event.target.closest('.icon-item')
      || !event.target.closest('[data-blank-parent], [data-icon-grid]')
    ) return;

    closeMenu();
    marquee.start({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      preserveSelection: event.ctrlKey,
    });
    event.preventDefault();
  }

  function restoreInitialDragPositions(activeDrag) {
    for (const id of activeDrag.itemIds) {
      const node = graph._getNode(id);
      const initial = activeDrag.initialPositions.get(id);
      if (!node || !initial) continue;
      node.x = initial.x;
      node.y = initial.y;
      node.fx = initial.fx;
      node.fy = initial.fy;
      node.positioned = initial.fx !== null || initial.fy !== null;
    }
  }

  function onPointerMove(event) {
    if (drag && event.pointerId === drag.pointerId) {
      const session = store.getSession();
      const shiftHeld = event.shiftKey === true;
      if (!drag.ancestorOnly && shiftHeld !== drag.pinOnRelease) {
        drag.pinOnRelease = shiftHeld;
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node?.shell) {
            if (shiftHeld) {
              node.shell.classList.remove('will-release');
              node.shell.classList.add('will-pin');
            } else {
              node.shell.classList.remove('will-pin');
              node.shell.classList.add('will-release');
            }
          }
        }
      }
      if (!drag.thresholdPassed) {
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        drag.thresholdPassed = true;
        drag.moved = true;
        elements.grid.setPointerCapture(event.pointerId);
        installShiftListeners();
        const start = clientToWorld(drag.startClientX, drag.startClientY);
        drag.startWorldX = start.x;
        drag.startWorldY = start.y;
        const pinClass = drag.pinOnRelease ? 'will-pin' : 'will-release';
        for (const id of drag.itemIds) {
          const node = graph._getNode(id);
          if (node) {
            drag.initialPositions.set(id, {
              x: node.x, y: node.y, fx: node.fx, fy: node.fy,
            });
            if (node.shell) {
              node.shell.classList.add('graph-dragging', pinClass);
            }
          }
        }
      }
      if (!drag.moved) return;
      const outsideWindow = event.clientX <= 0
        || event.clientY <= 0
        || event.clientX >= Number(window.innerWidth || Infinity)
        || event.clientY >= Number(window.innerHeight || Infinity);
      if (outsideWindow && !drag.ancestorOnly) {
        const paths = nativeDragPaths(drag.itemIds);
        if (paths.length > 0) {
          if (elements.grid.hasPointerCapture(event.pointerId)) elements.grid.releasePointerCapture(event.pointerId);
          const outgoing = drag;
          restoreInitialDragPositions(outgoing);
          removeShiftListeners();
          clearDragVisuals();
          clearDragTrail();
          setSuppressGraphClick(true);
          drag = null;
          graph.reheat(0.2);
          void startNativeDrag(paths);
          return;
        }
      }
      const world = clientToWorld(event.clientX, event.clientY);
      const deltaX = world.x - drag.startWorldX;
      const deltaY = world.y - drag.startWorldY;
      for (const id of drag.itemIds) {
        const node = graph._getNode(id);
        if (!node) continue;
        const initial = drag.initialPositions.get(id);
        if (!initial) continue;
        node.fx = initial.x + deltaX;
        node.fy = initial.y + deltaY;
        node.x = node.fx;
        node.y = node.fy;
        node.positioned = true;
      }
      graph.reheat(0.12);
      onDragTrail(drag.itemIds);

      if (!session.binMode && elements.binButton) {
        const overBin = elements.binButton.contains(document.elementFromPoint(event.clientX, event.clientY));
        elements.binButton.classList.toggle('graph-bin-drop-target', overBin);
      }
      return;
    }

    if (marquee.isActive(event.pointerId)) {
      marquee.move({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
  }

  function hitTest(event) {
    const session = store.getSession();
    const hitBin = !session.binMode && elements.binButton?.contains(document.elementFromPoint(event.clientX, event.clientY));
    const shells = [...elements.grid.querySelectorAll('.graph-node-shell')];
    let hitFolderId = null;
    if (!hitBin) {
      // Disable the dragged shells so the non-dragged destination folder
      // remains hit-testable under the pointer.
      const draggedShells = shells.filter((shell) =>
        drag.itemIds.includes(shell.dataset.graphNodeId));
      try {
        for (const shell of draggedShells) {
          shell.style.pointerEvents = 'none';
        }
        const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY);
        const hitShell = elementAtPoint?.closest('.graph-node-shell');
        if (hitShell && !drag.itemIds.includes(hitShell.dataset.graphNodeId)) {
          const hitItem = hitShell.querySelector('.icon-item');
          if (hitItem?.dataset.kind === 'group') {
            hitFolderId = hitItem.dataset.id;
          }
        }
      } finally {
        for (const shell of draggedShells) {
          shell.style.pointerEvents = '';
        }
      }
    }
    return { hitBin, hitFolderId };
  }

  function onPointerUp(event) {
    if (drag && event.pointerId === drag.pointerId) {
      if (elements.grid.hasPointerCapture(event.pointerId)) {
        elements.grid.releasePointerCapture(event.pointerId);
      }
      if (drag.moved) {
        if (!drag.ancestorOnly) drag.pinOnRelease = event.shiftKey === true;
        removeShiftListeners();
        clearDragTrail();
        setSuppressGraphClick(true);
        clearDragVisuals();
        const { hitBin, hitFolderId } = hitTest(event);
        const dragCopy = {
          itemIds: [...drag.itemIds],
          placementIds: drag.placementIds,
          pinOnRelease: drag.pinOnRelease,
          ancestorOnly: drag.ancestorOnly,
        };
        drag = null;

        if (hitBin) {
          commands.dragDropToBin({ itemIds: dragCopy.itemIds });
        } else if (hitFolderId) {
          commands.dragDropToFolder({
            itemIds: dragCopy.itemIds,
            placementIds: dragCopy.placementIds,
            folderId: hitFolderId,
          });
        } else if (dragCopy.pinOnRelease) {
          // Before the positions are read, so an item dragged inside a set it
          // does not belong to is pinned where it is put down rather than where
          // it trespassed. The ring cannot stop a drag — a dragged node's
          // position is set outright, so there is nothing for collision to push
          // against — and making it stiff enough to try only made the whole set
          // convulse. Correcting on release costs nothing during the gesture
          // and leaves the settled screen showing the true relationship.
          graph.ejectTrespassers(dragCopy.itemIds);
          const positions = {};
          for (const id of dragCopy.itemIds) {
            const node = graph._getNode(id);
            if (node) positions[id] = { x: node.x, y: node.y };
          }
          commands.pinDraggedNodes({ positions });
          graph._setSimulationDecay();
        } else if (dragCopy.ancestorOnly) {
          // The gesture was ordinary — the ancestor moved under the pointer
          // — but nothing is persisted: ancestors never write a graph
          // position, and releaseDraggedNodes would remove the real
          // folder's stored record where the ancestor id collides with one.
          // The body floats again like any unpinned item.
          graph.ejectTrespassers(dragCopy.itemIds);
          for (const id of dragCopy.itemIds) {
            const node = graph._getNode(id);
            if (node) {
              node.fx = null;
              node.fy = null;
              node.positioned = false;
            }
          }
          graph.reheat(0.25);
        } else {
          graph.ejectTrespassers(dragCopy.itemIds);
          commands.releaseDraggedNodes({ itemIds: dragCopy.itemIds });
          for (const id of dragCopy.itemIds) {
            const node = graph._getNode(id);
            if (node) {
              node.fx = null;
              node.fy = null;
              node.positioned = false;
            }
          }
          graph.reheat(0.25);
        }
        return;
      }
      removeShiftListeners();
      drag = null;
      return;
    }

    if (marquee.isActive(event.pointerId)) {
      setSuppressBlankClick(marquee.finish(event.pointerId));
    }
  }

  function onPointerCancel(event) {
    if (drag && event.pointerId === drag.pointerId) {
      if (elements.grid.hasPointerCapture(event.pointerId)) {
        elements.grid.releasePointerCapture(event.pointerId);
      }
      removeShiftListeners();
      if (drag.moved) {
        restoreInitialDragPositions(drag);
        graph.reheat(0.2);
      }
      clearDragVisuals();
      clearDragTrail();
      removeShiftListeners();
      drag = null;
      return;
    }

    if (marquee.isActive(event.pointerId)) {
      setSuppressBlankClick(marquee.finish(event.pointerId));
    }
  }

  /** Cancels an in-progress drag (used by menu-open and graph destruction). */
  function cancelDrag() {
    if (!drag) return;
    removeShiftListeners();
    clearDragVisuals();
    clearDragTrail();
    drag = null;
  }

  function mount() {
    abortController = new AbortController();
    const signal = abortController.signal;
    elements.grid.addEventListener('pointerdown', onPointerDown, { signal });
    elements.grid.addEventListener('dblclick', onDoubleClick, { signal });
    elements.grid.addEventListener('pointermove', onPointerMove, { signal });
    elements.grid.addEventListener('pointerup', onPointerUp, { signal });
    elements.grid.addEventListener('pointercancel', onPointerCancel, { signal });
  }

  function destroy() {
    abortController?.abort();
    abortController = null;
    cancelDrag();
  }

  // clientToWorld is exported so set hit-testing converts a click exactly the
  // way dragging does. Two conversions that drifted apart would mean clicking a
  // set somewhere other than where its outline is drawn — and while it was
  // missing, the caller's optional chaining turned the absence into an empty
  // hit list, so clicking inside a ring silently did nothing.
  // clientToWorld is exported so set hit-testing converts a click exactly the
  // way dragging does. Two conversions that drifted apart would mean clicking a
  // set somewhere other than where its outline is drawn — and while it was
  // missing, the caller's optional chaining turned the absence into an empty
  // hit list, so clicking inside a ring silently did nothing.
  return { mount, destroy, cancelDrag, clientToWorld };
}
