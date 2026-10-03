/** Pure decorative vector lettering for named set borders.
 *
 * This module knows nothing about rings, physics, DOM, or state. Its output is
 * a compact list of decorative strokes laid over an already-computed outline;
 * callers must never feed it back into geometry or hit-testing. */

const GLYPHS = Object.freeze({
  A: [[[.1, 1], [.5, 0], [.9, 1]], [[.27, .58], [.73, .58]]],
  B: [[[.12, 1], [.12, 0], [.55, 0], [.78, .14], [.78, .38], [.55, .5], [.12, .5]], [[.55, .5], [.8, .62], [.8, .86], [.55, 1], [.12, 1]]],
  C: [[[.86, .12], [.68, 0], [.3, 0], [.12, .18], [.12, .82], [.3, 1], [.68, 1], [.86, .88]]],
  D: [[[.12, 1], [.12, 0], [.55, 0], [.82, .18], [.82, .82], [.55, 1], [.12, 1]]],
  E: [[[.86, 0], [.12, 0], [.12, 1], [.86, 1]], [[.12, .5], [.68, .5]]],
  F: [[[.86, 0], [.12, 0], [.12, 1]], [[.12, .5], [.68, .5]]],
  G: [[[.86, .12], [.68, 0], [.3, 0], [.12, .18], [.12, .82], [.3, 1], [.68, 1], [.86, .86], [.86, .58], [.55, .58]]],
  H: [[[.12, 0], [.12, 1]], [[.88, 0], [.88, 1]], [[.12, .5], [.88, .5]]],
  I: [[[.12, 0], [.88, 0]], [[.5, 0], [.5, 1]], [[.12, 1], [.88, 1]]],
  J: [[[.12, 0], [.88, 0], [.88, .8], [.7, 1], [.3, 1], [.12, .82]]],
  K: [[[.12, 0], [.12, 1]], [[.88, 0], [.12, .5], [.88, 1]]],
  L: [[[.12, 0], [.12, 1], [.88, 1]]],
  M: [[[.12, 1], [.12, 0], [.5, .55], [.88, 0], [.88, 1]]],
  N: [[[.12, 1], [.12, 0], [.88, 1], [.88, 0]]],
  O: [[[.3, 0], [.7, 0], [.88, .18], [.88, .82], [.7, 1], [.3, 1], [.12, .82], [.12, .18], [.3, 0]]],
  P: [[[.12, 1], [.12, 0], [.58, 0], [.8, .14], [.8, .38], [.58, .52], [.12, .52]]],
  Q: [[[.3, 0], [.7, 0], [.88, .18], [.88, .82], [.7, 1], [.3, 1], [.12, .82], [.12, .18], [.3, 0]], [[.55, .62], [.88, 1]]],
  R: [[[.12, 1], [.12, 0], [.58, 0], [.8, .14], [.8, .38], [.58, .52], [.12, .52]], [[.55, .52], [.88, 1]]],
  S: [[[.86, .12], [.68, 0], [.3, 0], [.12, .16], [.12, .38], [.3, .5], [.68, .5], [.86, .64], [.86, .84], [.68, 1], [.3, 1], [.12, .86]]],
  T: [[[.12, 0], [.88, 0]], [[.5, 0], [.5, 1]]],
  U: [[[.12, 0], [.12, .8], [.3, 1], [.7, 1], [.88, .8], [.88, 0]]],
  V: [[[.12, 0], [.5, 1], [.88, 0]]],
  W: [[[.12, 0], [.3, 1], [.5, .45], [.7, 1], [.88, 0]]],
  X: [[[.12, 0], [.88, 1]], [[.88, 0], [.12, 1]]],
  Y: [[[.12, 0], [.5, .5], [.88, 0]], [[.5, .5], [.5, 1]]],
  Z: [[[.12, 0], [.88, 0], [.12, 1], [.88, 1]]],
  0: [[[.3, 0], [.7, 0], [.88, .18], [.88, .82], [.7, 1], [.3, 1], [.12, .82], [.12, .18], [.3, 0]]],
  1: [[[.3, .2], [.5, 0], [.5, 1]], [[.28, 1], [.72, 1]]],
  2: [[[.18, .18], [.35, 0], [.7, 0], [.88, .18], [.12, 1], [.88, 1]]],
  3: [[[.18, .12], [.35, 0], [.7, 0], [.88, .18], [.68, .5], [.88, .78], [.7, 1], [.35, 1], [.18, .88]]],
  4: [[[.7, 1], [.7, 0], [.12, .65], [.88, .65]]],
  5: [[[.88, 0], [.15, 0], [.15, .48], [.68, .48], [.86, .62], [.86, .86], [.68, 1], [.2, 1]]],
  6: [[[.82, .08], [.65, 0], [.3, 0], [.12, .2], [.12, .8], [.3, 1], [.68, 1], [.86, .82], [.86, .62], [.68, .5], [.12, .5]]],
  7: [[[.12, 0], [.88, 0], [.3, 1]]],
  8: [[[.3, 0], [.7, 0], [.84, .16], [.7, .5], [.3, .5], [.16, .16], [.3, 0]], [[.3, .5], [.7, .5], [.84, .84], [.7, 1], [.3, 1], [.16, .84], [.3, .5]]],
  9: [[[.3, 0], [.7, 0], [.88, .18], [.88, .48], [.7, .62], [.3, .62], [.12, .46], [.12, .18], [.3, 0]], [[.88, .48], [.7, 1], [.3, 1], [.12, .82]]],
  '?': [[[.15, .18], [.32, 0], [.68, 0], [.86, .18], [.86, .36], [.5, .56]], [[.5, .82], [.5, .84]]],
  ' ': [],
  '.': [[[.5, .84], [.5, .86]]],
  ',': [[[.5, .82], [.45, 1]]],
  '!': [[[.5, 0], [.5, .66]], [[.5, .84], [.5, .86]]],
  ':': [[[.5, .28], [.5, .3]], [[.5, .72], [.5, .74]]],
  '-': [[[.2, .5], [.8, .5]]],
  '+': [[[.2, .5], [.8, .5]], [[.5, .2], [.5, .8]]],
  '/': [[[.15, 1], [.85, 0]]],
  '(': [[[.7, 0], [.45, .2], [.45, .8], [.7, 1]]],
  ')': [[[.3, 0], [.55, .2], [.55, .8], [.3, 1]]],
  '[': [[[.72, 0], [.3, 0], [.3, 1], [.72, 1]]],
  ']': [[[.28, 0], [.7, 0], [.7, 1], [.28, 1]]],
  "'": [[[.5, 0], [.5, .18]]],
});

const glyphCache = new Map();

function segmentsFor(character) {
  const key = character.toUpperCase();
  if (glyphCache.has(key)) return glyphCache.get(key);
  const segments = [];
  const strokes = GLYPHS[key] ?? GLYPHS['?'];
  for (const stroke of strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      const from = stroke[index - 1];
      const to = stroke[index];
      segments.push([from[0], from[1], to[0], to[1]]);
    }
  }
  const result = Object.freeze(segments);
  glyphCache.set(key, result);
  return result;
}

export function normalizeGlyphTitle(title) {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return [...trimmed].map((character) => GLYPHS[character.toUpperCase()] ? character.toUpperCase() : (character === ' ' ? ' ' : '?'));
}

function outlineLengths(outline) {
  const lengths = [0];
  let total = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const next = outline[(i + 1) % outline.length];
    total += Math.hypot(next.x - outline[i].x, next.y - outline[i].y);
    lengths.push(total);
  }
  return { lengths, perimeter: total };
}

function pointAt(outline, lengths, distance) {
  const perimeter = lengths[lengths.length - 1];
  let d = ((distance % perimeter) + perimeter) % perimeter;
  let index = 0;
  while (index < outline.length && lengths[index + 1] < d) index += 1;
  const a = outline[index];
  const b = outline[(index + 1) % outline.length];
  const span = lengths[index + 1] - lengths[index] || 1;
  const t = (d - lengths[index]) / span;
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  let rotation = angle;
  while (rotation > 90) rotation -= 180;
  while (rotation < -90) rotation += 180;
  return { x, y, angle, rotation };
}

/** Layouts complete repeated titles around the current outline. `outline` is
 * decorative input only; it is not returned, cached, or passed to physics. */
export function layoutTitleGlyphs(outline, title, { preferredHeight = 14, gap = 7 } = {}) {
  const chars = normalizeGlyphTitle(title);
  if (!Array.isArray(outline) || outline.length < 3) return { title: chars, scale: 0, placements: [], perimeter: 0 };
  const { lengths, perimeter } = outlineLengths(outline);
  if (!Number.isFinite(perimeter) || perimeter <= 0) return { title: chars, scale: 0, placements: [], perimeter: 0 };
  if (chars.length === 0) return { title: chars, scale: 0, placements: [], perimeter };
  const advanceAt = (scale) => scale * 0.9 + gap;
  const needed = (scale) => chars.length * advanceAt(scale) + gap;
  const scale = Math.min(preferredHeight, Math.max(2, (perimeter - gap) / chars.length * 0.78));
  const advance = advanceAt(scale);
  const count = Math.max(chars.length, Math.floor(perimeter / advance));
  let topIndex = 0;
  for (let i = 1; i < outline.length; i += 1) {
    if (outline[i].y < outline[topIndex].y || (outline[i].y === outline[topIndex].y && outline[i].x < outline[topIndex].x)) topIndex = i;
  }
  const phase = lengths[topIndex];
  const placements = [];
  for (let i = 0; i < count; i += 1) {
    const forwardDistance = phase + (i + 0.5) * perimeter / count;
    const forwardPoint = pointAt(outline, lengths, forwardDistance);
    const reversed = Math.cos(forwardPoint.angle * Math.PI / 180) < 0;
    // Keep positions on one monotonic perimeter walk. On leftward runs, reverse
    // only the character order so the screen-space reading direction stays
    // left-to-right; glyph geometry itself is never mirrored.
    const point = forwardPoint;
    const characterIndex = i % chars.length;
    placements.push({
      char: chars[characterIndex], x: point.x, y: point.y, rotation: point.rotation,
      scale, distance: ((forwardDistance - phase) % perimeter + perimeter) % perimeter,
      reversed,
    });
  }
  for (let i = 0; i < placements.length; i += 1) {
    if (!placements[i].reversed) continue;
    let end = i;
    while (end + 1 < placements.length && placements[end + 1].reversed) end += 1;
    placements[i].char = chars[(end - i) % chars.length];
  }
  return { title: chars, scale, placements, perimeter, phase, completeRepeats: Math.floor(count / chars.length), needed: needed(scale) };
}

export function glyphPath(layout) {
  const commands = [];
  for (const placement of layout?.placements ?? []) {
    const radians = placement.rotation * Math.PI / 180;
    const tangent = { x: Math.cos(radians), y: Math.sin(radians) };
    const normal = { x: -tangent.y, y: tangent.x };
    for (const [x1, y1, x2, y2] of segmentsFor(placement.char)) {
      const map = (x, y) => ({
        x: placement.x + tangent.x * ((x - 0.5) * placement.scale) + normal.x * ((y - 0.5) * placement.scale),
        y: placement.y + tangent.y * ((x - 0.5) * placement.scale) + normal.y * ((y - 0.5) * placement.scale),
      });
      const a = map(x1, y1); const b = map(x2, y2);
      commands.push(`M${a.x.toFixed(2)},${a.y.toFixed(2)}L${b.x.toFixed(2)},${b.y.toFixed(2)}`);
    }
  }
  return commands.join('');
}

export { GLYPHS };
