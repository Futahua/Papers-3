/**
 * Windows needs a non-black RGB payload for zero-alpha Electron surfaces.
 * Keep this shared so every transparent Papers view uses the same compositing value.
 */
export const TRANSPARENT_SURFACE_COLOR = '#00ffffff';

/**
 * Child WebContentsViews composite differently from the top-level window: the
 * zero alpha above is not honoured, so the RGB payload paints literally and a
 * "transparent" program view renders solid white. Fully-zero ARGB leaves the
 * view unpainted so the transparent window behind it shows through instead.
 */
export const TRANSPARENT_CHILD_SURFACE_COLOR = '#00000000';

/** The opaque Papers paper colour, used whenever transparency is off. */
export const OPAQUE_SURFACE_COLOR = '#efede7';
