const SVG_NS = 'http://www.w3.org/2000/svg';

const EFFECTS = Object.freeze([
  Object.freeze({ name: 'ripple', duration: 1300 }),
  Object.freeze({ name: 'wash', duration: 1700 }),
]);

function chooseEffect(random = Math.random) {
  const value = Number(random());
  const index = Number.isFinite(value)
    ? Math.max(0, Math.min(EFFECTS.length - 1, Math.floor(value * EFFECTS.length)))
    : 0;
  return EFFECTS[index];
}

function stopAnimation(animation) {
  animation?.cancel?.();
  animation?.pause?.();
}

function removeNode(node) {
  stopAnimation(node?.animation);
  node?.element?.remove();
}

function restoreRegion(region) {
  if (!region?.path) return;
  if (region.originalFillOpacity == null) region.path.removeAttribute('fill-opacity');
  else region.path.setAttribute('fill-opacity', region.originalFillOpacity);
}

function removeEntry(entry) {
  if (!entry) return;
  restoreRegion(entry.region);
  for (const node of entry.nodes ?? []) removeNode(node);
  stopAnimation(entry.animation);
  entry.gradient?.remove();
  entry.overlay?.remove();
}

function bboxFromPath(region) {
  try {
    return region.path.getBBox();
  } catch {
    return { x: region.center?.x ?? 0, y: region.center?.y ?? 0, width: 80, height: 80 };
  }
}

function rippleRadiusFromRegion(region) {
  const box = bboxFromPath(region);
  const width = Number.isFinite(box.width) && box.width > 0 ? box.width : 80;
  const height = Number.isFinite(box.height) && box.height > 0 ? box.height : 80;
  return Math.max(8, Math.min(width, height) * 0.45);
}

export function createSetEffectsController({ document, animate, random = Math.random }) {
  const active = new Map();
  let layer = null;
  let defs = null;
  let previousSelection = new Set();
  let gradientCounter = 0;

  function ensureDefs() {
    if (!defs) {
      defs = document.createElementNS(SVG_NS, 'defs');
      layer.append(defs);
    }
    return defs;
  }

  function clear() {
    for (const effect of active.values()) {
      for (const entry of effect.entries.values()) removeEntry(entry);
    }
    active.clear();
    previousSelection = new Set();
    if (defs && !(defs.children?.length ?? defs.childNodes?.length)) {
      defs.remove();
      defs = null;
    }
  }

  function startEntry(spec, region, color) {
    const path = region.path;
    const originalFillOpacity = path.getAttribute('fill-opacity') || null;
    if (spec.name === 'ripple') {
      const nodes = [];
      const center = region.center ?? { x: 0, y: 0 };
      const maxRadius = rippleRadiusFromRegion(region);
      for (const delay of [0, 260]) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('class', 'graph-set-interior-ripple');
        circle.setAttribute('cx', center.x);
        circle.setAttribute('cy', center.y);
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', color ?? 'currentColor');
        circle.setAttribute('fill-opacity', '0.42');
        circle.setAttribute('pointer-events', 'none');
        layer.append(circle);
        nodes.push({ element: circle, animation: animate(circle, {
          r: [3, maxRadius],
          opacity: [0.65, 0],
          delay,
          duration: spec.duration,
          ease: 'outQuad',
          loop: true,
        }) });
      }
      return { region: { path, originalFillOpacity }, nodes };
    }

    const box = bboxFromPath(region);
    const overlay = document.createElementNS(SVG_NS, 'path');
    overlay.setAttribute('class', 'graph-set-interior-wash');
    overlay.setAttribute('d', path.getAttribute('d') ?? '');
    overlay.setAttribute('fill', `url(#graph-set-wash-${gradientCounter})`);
    overlay.setAttribute('fill-opacity', '0.42');
    overlay.setAttribute('pointer-events', 'none');
    const gradient = document.createElementNS(SVG_NS, 'linearGradient');
    const gradientId = `graph-set-wash-${gradientCounter++}`;
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    gradient.setAttribute('x1', box.x);
    gradient.setAttribute('x2', box.x + box.width);
    gradient.setAttribute('y1', box.y);
    gradient.setAttribute('y2', box.y);
    for (const opacity of [0, 0.75, 0]) {
      const stop = document.createElementNS(SVG_NS, 'stop');
      stop.setAttribute('offset', opacity === 0 ? (gradient.childNodes?.length ? '100%' : '0%') : '50%');
      stop.setAttribute('stop-color', color ?? 'currentColor');
      stop.setAttribute('stop-opacity', opacity);
      gradient.append(stop);
    }
    ensureDefs().append(gradient);
    layer.append(overlay);
    const animation = animate(gradient, {
      gradientTransform: [`translate(${-box.width} 0)`, `translate(${box.width} 0)`],
      duration: spec.duration,
      ease: 'inOutSine',
      loop: true,
    });
    return { region: { path, originalFillOpacity }, nodes: [], overlay, gradient, animation };
  }

  function sync({ selectedSetIds, regions, colorFor, effectsLayer }) {
    layer = effectsLayer ?? layer;
    if (!layer) return;
    const selected = new Set(selectedSetIds ?? []);
    const regionList = [...(regions?.values?.() ?? regions ?? [])];
    const owners = new Map();
    // A shared region has one deterministic owner: the lexicographically smallest
    // selected parent set id. With one selected parent, that parent owns the region.
    for (const region of regionList) {
      const owner = region.setIds.filter((id) => selected.has(id)).sort()[0];
      if (owner) owners.set(region.id, owner);
    }

    for (const [setId, effect] of active) {
      if (!selected.has(setId)) {
        for (const entry of effect.entries.values()) removeEntry(entry);
        active.delete(setId);
        continue;
      }
      for (const [regionId, entry] of effect.entries) {
        const region = regionList.find((candidate) => candidate.id === regionId);
        if (!region || owners.get(regionId) !== setId) {
          removeEntry(entry);
          effect.entries.delete(regionId);
        }
      }
    }

    for (const setId of selected) {
      let effect = active.get(setId);
      if (!effect || !previousSelection.has(setId)) {
        if (effect) {
          for (const entry of effect.entries.values()) removeEntry(entry);
        }
        effect = { name: chooseEffect(random).name, entries: new Map() };
        active.set(setId, effect);
      }
      const spec = EFFECTS.find((candidate) => candidate.name === effect.name) ?? EFFECTS[0];
      for (const region of regionList) {
        if (owners.get(region.id) !== setId) continue;
        const color = colorFor?.(region.id) ?? colorFor?.(setId);
        const existing = effect.entries.get(region.id);
        if (!existing) {
          effect.entries.set(region.id, startEntry(spec, region, color));
        } else if (spec.name === 'wash') {
          existing.overlay?.setAttribute('d', region.path.getAttribute('d') ?? '');
        }
      }
    }
    previousSelection = selected;
  }

  return {
    sync,
    clear,
    get activeCount() { return active.size; },
    get nodeCount() {
      return [...active.values()].reduce((count, effect) => count + effect.entries.size, 0);
    },
    get activeEffects() { return new Map(active); },
  };
}

export { EFFECTS, chooseEffect, rippleRadiusFromRegion };
