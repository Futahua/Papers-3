/**
 * 019G (RoketPuncha AYG lane): the member hover-preview controller. Consumes
 * ONLY the exact shared thumbnail API/result from the Papers host bridge
 * (`host.windowThumbnailCapability(capability, { maxWidth, maxHeight })`).
 *
 * On member hover the caller shows the full title immediately and calls
 * `schedule(layoutId, memberId)`: capture is debounced 120 ms, the member's
 * current capability is resolved through the existing runtime logic, a 240x135
 * thumbnail is requested, and an `<img>` is rendered ONLY for a strictly valid
 * success (`outcome:'success'`, a `data:image/png;base64,...` URL, integer
 * bounded dimensions). A generation/latest-only guard drops old replies when
 * hovering rapidly; `cancel()` (pointer leave, card removal, picker start,
 * pagehide) discards pending work and clears the preview. Fallback stays
 * icon/name-only — a placeholder thumbnail is never fabricated. The controller
 * writes NO state/store; its only side-effect seams are setPreviewImage and
 * clearPreview.
 */

export const WINDOW_LAYOUT_PREVIEW_DEBOUNCE_MS = 120;
/** How many members keep their last captured image for an instant re-hover. */
export const WINDOW_LAYOUT_PREVIEW_CACHE_LIMIT = 24;
export const WINDOW_LAYOUT_PREVIEW_MAX_WIDTH = 240;
export const WINDOW_LAYOUT_PREVIEW_MAX_HEIGHT = 135;
export const WINDOW_LAYOUT_PREVIEW_DIMENSION_LIMIT = { maxWidth: 320, maxHeight: 180 };
/** Proof switch: whether a member hover asks the control helper for a capture.
 * See the note in capture() - captures are what a click can end up waiting
 * behind. ON is the shipped behavior; OFF was the one-purpose proof build that
 * judged the click path with nothing of ours in front of it. */
export const WINDOW_LAYOUT_HOVER_THUMBNAIL_CAPTURE = true;
export const WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES = 256 * 1024; // 256 KiB
export const WINDOW_LAYOUT_PREVIEW_MAX_URL_CHARS = 512 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_PNG_PREFIX = 'data:image/png;base64,';
const SUCCESS_KEYS = ['height', 'imageUrl', 'outcome', 'width'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Strict base64 grammar (RFC 4648 alphabet, canonical padding) then decode.
 * Returns null for any alphabet/padding/length deviation; never trusts a
 * lenient platform decoder. */
function strictBase64ToBytes(base64) {
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length % 4 !== 0) return null;
  const padMatch = /=+$/.exec(base64);
  const padding = padMatch ? padMatch[0].length : 0;
  if (padding > 2) return null;
  const core = base64.slice(0, base64.length - padding);
  if (core.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+$/.test(core)) return null;
  const coreMod = core.length % 4;
  if (coreMod === 1) return null;
  if (coreMod === 2 && padding !== 2) return null;
  if (coreMod === 3 && padding !== 1) return null;
  if (coreMod === 0 && padding !== 0) return null;
  let binary;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length === 0) return null;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decodes a `data:image/png;base64,...` URL and enforces the bounded data-URL
 * string, the decoded 256 KiB cap and the PNG magic signature. Null otherwise. */
function decodePngDataUrl(imageUrl) {
  if (typeof imageUrl !== 'string' || imageUrl.length === 0
    || imageUrl.length > WINDOW_LAYOUT_PREVIEW_MAX_URL_CHARS
    || !imageUrl.startsWith(DATA_PNG_PREFIX)) return null;
  const bytes = strictBase64ToBytes(imageUrl.slice(DATA_PNG_PREFIX.length));
  if (!bytes || bytes.length > WINDOW_LAYOUT_PREVIEW_MAX_DECODED_BYTES) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  return bytes;
}

/** 019GR strict success: exact `{ outcome:'success', imageUrl, width, height }`
 * keys, a bounded data-PNG URL with strict base64 grammar + PNG magic +
 * decoded <= 256 KiB, and positive integer dimensions within the 320x180
 * clamp. Anything else (typed fallback, extra keys, bad alphabet/padding/
 * signature, oversize) is rejected so no fabricated/oversized thumbnail ever
 * renders. */
export function isValidThumbnailSuccess(result) {
  if (!isPlainObject(result)) return false;
  const keys = Object.keys(result).sort();
  if (keys.length !== SUCCESS_KEYS.length
    || keys.some((key, index) => key !== SUCCESS_KEYS[index])) return false;
  if (result.outcome !== 'success') return false;
  if (decodePngDataUrl(result.imageUrl) === null) return false;
  const { width, height } = result;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > WINDOW_LAYOUT_PREVIEW_DIMENSION_LIMIT.maxWidth
    || height > WINDOW_LAYOUT_PREVIEW_DIMENSION_LIMIT.maxHeight) return false;
  return true;
}

/** 019GR pure exact-member hover transition predicate. `targetMember` and
 * `relatedTargetMember` are the resolved member elements (or null) that the
 * delegated mouseover/mouseout computed via `closest('[data-wl-member]')`.
 * - 'outside': the pointer is not over a member (the delegated handler hides/
 *   cancels).
 * - 'inside': the pointer moved between descendants of the SAME member - do
 *   NOT reschedule or clear (the member has not changed).
 * - 'enter': the pointer entered a member from another member or the outside -
 *   show + schedule (and on mouseout: leave this exact member -> cancel). */
export function windowLayoutPreviewHoverState(targetMember, relatedTargetMember) {
  if (targetMember === null || targetMember === undefined) return 'outside';
  if (relatedTargetMember === targetMember) return 'inside';
  return 'enter';
}

export function createWindowLayoutMemberPreview({
  resolveCapability,
  requestCachedThumbnail = async () => ({ outcome: 'cache-miss' }),
  requestThumbnail,
  debounceMs = WINDOW_LAYOUT_PREVIEW_DEBOUNCE_MS,
  /** Proof switch, injectable so the capture path keeps its coverage while the
   * shipped default is off. */
  captureEnabled = WINDOW_LAYOUT_HOVER_THUMBNAIL_CAPTURE,
  /** Papers-side lifecycle hold taken for the whole hover intent (dwell plus
   * capture), so the periodic desktop scan cannot start in the middle of it. */
  holdPreview = () => undefined,
  releasePreview = () => undefined,
  setPreviewImage = () => undefined,
  clearPreview = () => undefined,
  /** Papers no longer recognises the capability we resolved - the helper
   * restarted, or the window is gone. The caller caches capabilities across
   * renders now, so a stale one must be dropped explicitly or every later
   * preview for that member retries the same dead token. */
  onCapabilityMissing = () => undefined,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}) {
  if (typeof resolveCapability !== 'function' || typeof requestThumbnail !== 'function') {
    throw new TypeError('the preview controller needs resolveCapability and requestThumbnail');
  }
  let generation = 0;
  let timer = null;
  const intentReleases = new Set();
  /** The last image captured for each member. A hover shows this IMMEDIATELY and
   * the fresh capture replaces it when it lands, so the wait for a capture is
   * never the wait to see something. Bounded, newest last. */
  const previewCache = new Map();
  const previewCacheKey = (layoutId, memberId) => `${layoutId}\u0000${memberId}`;
  function rememberPreview(key, imageUrl, width, height) {
    previewCache.delete(key);
    previewCache.set(key, { imageUrl, width, height });
    while (previewCache.size > WINDOW_LAYOUT_PREVIEW_CACHE_LIMIT) {
      const oldest = previewCache.keys().next().value;
      if (oldest === undefined) break;
      previewCache.delete(oldest);
    }
  }
  function acquireIntent() {
    if (intentReleases.size === 0) holdPreview();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      intentReleases.delete(release);
      if (intentReleases.size === 0) releasePreview();
    };
    intentReleases.add(release);
    return release;
  }

  async function requestFreshThumbnail(layoutId, memberId, gen, capability, releaseIntent) {
    try {
      if (gen !== generation) return;
      // PROOF SWITCH - member hover thumbnail capture.
      //
      // The control helper serves one request at a time and cannot preempt one
      // already running, so a PrintWindow capture started by a hover preview sits
      // in front of the next minimize/restore, however the control request is
      // ordered. With this off the popover still shows the icon and the title and
      // the preview area keeps its honest fallback; list Peek, the icon peek and
      // every window action are untouched.
      if (captureEnabled !== true) return;
      let result;
      try {
        result = await requestThumbnail(capability, {
          maxWidth: WINDOW_LAYOUT_PREVIEW_MAX_WIDTH,
          maxHeight: WINDOW_LAYOUT_PREVIEW_MAX_HEIGHT,
        });
      } catch {
        result = { outcome: 'failed' };
      }
      if (gen !== generation) return; // late response discarded (rapid A->B / leave)
      if (result?.outcome === 'missing') onCapabilityMissing(layoutId, memberId);
      if (isValidThumbnailSuccess(result)) {
        rememberPreview(previewCacheKey(layoutId, memberId), result.imageUrl, result.width, result.height);
        setPreviewImage(result.imageUrl, result.width, result.height);
      }
      // otherwise: honest typed/name-only fallback, never a fabricated image
    } finally {
      releaseIntent();
    }
  }

  function schedule(layoutId, memberId) {
    const gen = ++generation;
    clearTimeoutFn(timer);
    // Intent hold: from the hover itself, so the periodic desktop scan cannot
    // start during the dwell and end up in front of this capture. Reference
    // counted, because a sweep schedules the next member before the previous
    // capture has settled.
    const releaseThisIntent = acquireIntent();
    // Instant: whatever we captured for this member last time is shown NOW, and
    // the fresh capture replaces it when it lands. Nothing waits to be seen.
    const cached = previewCache.get(previewCacheKey(layoutId, memberId));
    if (cached) setPreviewImage(cached.imageUrl, cached.width, cached.height);
    let capability = null;
    let capabilityReady = false;
    let cacheReady = false;
    let freshDue = false;
    let freshStarted = false;
    const runFreshWhenReady = () => {
      if (!freshDue || !cacheReady || freshStarted) return;
      freshStarted = true;
      if (!capability || captureEnabled !== true) {
        releaseThisIntent();
        return;
      }
      void requestFreshThumbnail(layoutId, memberId, gen, capability, releaseThisIntent);
    };
    timer = setTimeoutFn(() => {
      timer = null;
      freshDue = true;
      runFreshWhenReady();
    }, debounceMs);
    // Resolve while the hover is fresh, then fetch the persisted frame before
    // allowing a fresh capture to replace it. A live capability is mandatory:
    // the Papers host validates its current target binding before reading cache.
    void (async () => {
      try {
        capability = await resolveCapability(layoutId, memberId);
        if (gen !== generation) return;
        capabilityReady = true;
        if (!capability) return;
        if (!cached) {
          let cachedResult;
          try {
            cachedResult = await requestCachedThumbnail(capability);
          } catch {
            cachedResult = { outcome: 'cache-miss' };
          }
          if (gen !== generation) return;
          if (cachedResult?.outcome === 'missing') onCapabilityMissing(layoutId, memberId);
          if (isValidThumbnailSuccess(cachedResult)) {
            rememberPreview(previewCacheKey(layoutId, memberId), cachedResult.imageUrl,
              cachedResult.width, cachedResult.height);
            setPreviewImage(cachedResult.imageUrl, cachedResult.width, cachedResult.height);
          }
        }
      } catch {
        // Keep the existing honest icon/name fallback when resolution or the
        // optional durable cache path is unavailable.
      } finally {
        if (gen !== generation) {
          releaseThisIntent();
          return;
        }
        cacheReady = true;
        // `capabilityReady` distinguishes a resolver still in flight from a
        // completed empty result; cache misses must still fall through to the
        // fresh request when a capability exists.
        if (!capabilityReady) capability = null;
        runFreshWhenReady();
      }
    })();
    return gen;
  }

  function cancel() {
    generation += 1;
    clearTimeoutFn(timer);
    timer = null;
    for (const release of [...intentReleases]) release();
    clearPreview();
  }

  return { schedule, cancel };
}
