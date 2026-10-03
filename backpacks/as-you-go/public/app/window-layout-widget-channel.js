import { snapshotMemberNote } from './window-layout-member-note.js';
/**
 * 019C (RoketPuncha sole-editor lane): the AYG-owned same-origin compact-widget
 * channel. One native widget per (projectId, layoutId); the workspace and the
 * widget window share the same origin, so they talk over ONE named
 * BroadcastChannel with EXACT schemas and bounded values.
 *
 * The workspace is the SOLE durable writer and revision source. The widget
 * sends READY and bounded command intents carrying `layoutId`, `clientId`,
 * `commandId` and `baseRevision`; the workspace validates that the layout still
 * exists and the revision matches, applies the intent through the existing
 * functions/store, then answers with a typed committed snapshot/revision, a
 * stale re-sync, or an error. The widget NEVER calls saveWorkspace,
 * store.commit, store.replace or recording persistence.
 */
export const WINDOW_LAYOUT_WIDGET_CHANNEL = 'as-you-go:window-layout-widget';
export const WINDOW_LAYOUT_WIDGET_MAX_KEY_BYTES = 512;
export const WINDOW_LAYOUT_WIDGET_MAX_MEMBER_IDS = 64;
// 037: the ONE shared compact presentation maximum - a WIDTH bound (never a
// member/icon/column-count breakpoint) that is the same for attached and
// detached. The detached native window snaps its client width here (no empty
// surrounding canvas around a capped card), the persisted card geometry is the
// actual client/card width capped here, and the attached shell never exceeds
// it. The bound matches the creator-approved compact eight-icon presentation;
// larger sets wrap into balanced rows instead of stretching into a toolbar.
export const WINDOW_LAYOUT_CARD_MAX_WIDTH = 280;
// 019DR2: the real Papers pick-member ceiling (the preload parsePickMembers
// bound) bounds the picker-commit add/remove arrays.
export const PAPERS_PICK_MEMBER_LIMIT = 32;
// The candidate is NOT authoritative: the only display data consumed is the
// optional icon. Data URLs can exceed the 512-byte key bound, so the icon has
// its own generous-but-bounded ceiling.
export const WINDOW_LAYOUT_WIDGET_MAX_ICON_BYTES = 262144;
// A COMMITTED command may carry ONE short sentence saying what actually
// happened: a pick whose removals were all refused (nothing changed) or one
// that removed some members and could not match others. It is display text
// beside the snapshot, never a payload and never a substitute for the message:
// a refusal is NOT a failure, so it travels as `committed` with a status and
// not as an `error` (which would tell the widget a working command broke).
// Bounded like the member note it appears next to.
export const WINDOW_LAYOUT_WIDGET_MAX_STATUS_CHARS = 160;

const COMMAND_KINDS = new Set(['activate-member', 'bring-to-front', 'member-toggle', 'group-action', 'range-toggle', 'picker-commit', 'reorder', 'remove-member', 'retire-closed-window', 'toggle-tracking', 'dock-widget-to-pill', 'delete-layout', 'clear-layout']);
const GROUP_ACTIONS = new Set(['minimize', 'restore', 'isolate']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** UTF-8 byte length (TextEncoder), falling back to character count only where
 * the encoder is unavailable. The Papers string bounds are byte bounds. */
function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length;
}

function boundedString(value, name, max = WINDOW_LAYOUT_WIDGET_MAX_KEY_BYTES) {
  return typeof value === 'string' && value.length > 0 && utf8ByteLength(value) <= max;
}

function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/**
 * The ONE bound on a committed status, called by both ends: the responder that may put it on the wire and
 * the surface that renders it. Nothing to say (`undefined`, a non-string, or whitespace) answers `null`, so
 * the field is absent rather than empty; anything longer than a short line is cut at the bound instead of
 * being dropped, because a truncated sentence still tells the creator more than silence does.
 */
export function windowLayoutWidgetCommittedStatus(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length <= WINDOW_LAYOUT_WIDGET_MAX_STATUS_CHARS
    ? trimmed
    : trimmed.slice(0, WINDOW_LAYOUT_WIDGET_MAX_STATUS_CHARS);
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 019DR2/045: exact persisted Papers descriptor schema. The native host may
 * add one opaque windowInstanceId to a freshly bound descriptor; it is the
 * only optional field accepted here and lets the writer distinguish sibling
 * windows with the same title + executable. The legacy three-field shape is
 * still accepted. Arbitrary fields remain fail-closed. */
function parseDescriptorLike(raw) {
  if (!isPlainObject(raw)) return null;
  const hasWindowInstanceId = raw.windowInstanceId !== undefined;
  const keys = hasWindowInstanceId
    ? ['version', 'title', 'executableFingerprint', 'windowInstanceId']
    : ['version', 'title', 'executableFingerprint'];
  if (!exactKeys(raw, keys)) return null;
  if (raw.version !== 1) return null;
  if (!boundedString(raw.title, 'descriptor.title')) return null;
  if (typeof raw.executableFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.executableFingerprint)) return null;
  if (hasWindowInstanceId
    && (typeof raw.windowInstanceId !== 'string' || !/^W[0-9a-f]{16}$/i.test(raw.windowInstanceId))) return null;
  return {
    version: 1,
    title: raw.title,
    executableFingerprint: raw.executableFingerprint,
    ...(hasWindowInstanceId ? { windowInstanceId: raw.windowInstanceId } : {}),
  };
}

function parseRetirementDescriptor(raw) {
  if (isPlainObject(raw)
    && exactKeys(raw, ['version', 'windowInstanceId'])
    && raw.version === 1
    && typeof raw.windowInstanceId === 'string'
    && /^W[0-9a-f]{16}$/i.test(raw.windowInstanceId)) {
    return { version: 1, windowInstanceId: raw.windowInstanceId };
  }
  return parseDescriptorLike(raw);
}

/** 019DR2: exact Papers capability schema — keys version,bindingId; version 1;
 * non-empty UTF-8 <= 512 bytes. Returns a copied capability or null. */
function parseCapabilityLike(raw) {
  if (!isPlainObject(raw) || !exactKeys(raw, ['version', 'bindingId'])) return null;
  if (raw.version !== 1) return null;
  if (!boundedString(raw.bindingId, 'capability.bindingId')) return null;
  return { version: 1, bindingId: raw.bindingId };
}

function parseMemberIdList(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > WINDOW_LAYOUT_WIDGET_MAX_MEMBER_IDS) return null;
  const ids = [];
  for (const item of raw) {
    if (!boundedString(item, 'memberId')) return null;
    ids.push(item);
  }
  return ids;
}

/** 019DR2: exact inner command schemas at the widget BroadcastChannel boundary.
 * Applies exactKeys to every command-kind object and the nested pick shape, and
 * validates/copies descriptor and capability exactly as Papers does. Returns
 * null for any missing/extra/invalid field — never forwards an arbitrary object
 * or reference. */
export function windowLayoutWidgetParseCommand(raw) {
  if (!isPlainObject(raw) || typeof raw.kind !== 'string' || raw.kind.length === 0) return null;
  if (!COMMAND_KINDS.has(raw.kind)) return null;
  if (raw.kind === 'member-toggle') {
    if (!exactKeys(raw, ['kind', 'memberId']) || !boundedString(raw.memberId, 'memberId')) return null;
    return { kind: 'member-toggle', memberId: raw.memberId };
  }
  if (raw.kind === 'activate-member') {
    // The widget never resolves members from its own document - its mirror can
    // lag the writer, and "no such member" is what a right-click got there. It
    // asks the workspace, which owns the state, to bring the window forward.
    if (!exactKeys(raw, ['kind', 'memberId']) || !boundedString(raw.memberId, 'memberId')) return null;
    return { kind: 'activate-member', memberId: raw.memberId };
  }  if (raw.kind === 'remove-member') {
    // 040: the widget's `Remove from this layout` context action routes through
    // the workspace writer with the exact memberId; the layout is implied by the
    // channel's layoutId. Bounded memberId only.
    if (!exactKeys(raw, ['kind', 'memberId']) || !boundedString(raw.memberId, 'memberId')) return null;
    return { kind: 'remove-member', memberId: raw.memberId };
  }
  if (raw.kind === 'retire-closed-window') {
    if (!exactKeys(raw, ['kind', 'descriptor'])) return null;
    const descriptor = parseRetirementDescriptor(raw.descriptor);
    return descriptor ? { kind: 'retire-closed-window', descriptor } : null;
  }
  if (raw.kind === 'toggle-tracking') {
    if (!exactKeys(raw, ['kind'])) return null;
    return { kind: 'toggle-tracking' };
  }
  if (raw.kind === 'dock-widget-to-pill' || raw.kind === 'delete-layout' || raw.kind === 'clear-layout') {
    if (!exactKeys(raw, ['kind'])) return null;
    return { kind: raw.kind };
  }
  if (raw.kind === 'group-action') {
    if (!exactKeys(raw, ['kind', 'action', 'memberIds'])) return null;
    if (!GROUP_ACTIONS.has(raw.action)) return null;
    const memberIds = parseMemberIdList(raw.memberIds);
    if (memberIds === null) return null;
    return { kind: 'group-action', action: raw.action, memberIds };
  }
  if (raw.kind === 'range-toggle') {
    if (!exactKeys(raw, ['kind', 'memberId', 'memberIds'])) return null;
    if (!boundedString(raw.memberId, 'memberId')) return null;
    const memberIds = parseMemberIdList(raw.memberIds);
    if (memberIds === null) return null;
    return { kind: 'range-toggle', memberId: raw.memberId, memberIds };
  }
  if (raw.kind === 'reorder') {
    // 024: the widget drag-reorder intent - move `memberId` to `toIndex`
    // (0-based within the persisted member order). Bounded.
    if (!exactKeys(raw, ['kind', 'memberId', 'toIndex'])) return null;
    if (!boundedString(raw.memberId, 'memberId')) return null;
    if (typeof raw.toIndex !== 'number' || !Number.isInteger(raw.toIndex)
      || raw.toIndex < 0 || raw.toIndex > WINDOW_LAYOUT_WIDGET_MAX_MEMBER_IDS) return null;
    return { kind: 'reorder', memberId: raw.memberId, toIndex: raw.toIndex };
  }
  if (raw.kind === 'picker-commit') {
    if (!exactKeys(raw, ['kind', 'pick'])) return null;
    const pick = raw.pick;
    if (!isPlainObject(pick)) return null;
    if (pick.outcome === 'cancelled') {
      if (!exactKeys(pick, ['outcome'])) return null;
      return { kind: 'picker-commit', pick: { outcome: 'cancelled' } };
    }
    if (pick.outcome !== 'committed') return null;
    if (!exactKeys(pick, ['outcome', 'adds', 'removes'])) return null;
    if (!Array.isArray(pick.adds) || !Array.isArray(pick.removes)) return null;
    if (pick.adds.length > PAPERS_PICK_MEMBER_LIMIT || pick.removes.length > PAPERS_PICK_MEMBER_LIMIT) return null;
    // 019DR2: an ENTIRE malformed picker-commit command is rejected instead of
    // silently filtering malformed add/remove entries.
    const adds = [];
    for (const add of pick.adds) {
      const parsed = parsePickerCommitAdd(add);
      if (!parsed) return null;
      adds.push(parsed);
    }
    const removes = [];
    for (const remove of pick.removes) {
      if (!isPlainObject(remove) || !exactKeys(remove, ['descriptor'])) return null;
      const descriptor = parseDescriptorLike(remove.descriptor);
      if (!descriptor) return null;
      removes.push({ descriptor });
    }
    return { kind: 'picker-commit', pick: { outcome: 'committed', adds, removes } };
  }
  return null;
}

/** 019DR2: an add is descriptor+capability (exact Papers schemas) plus the
 * candidate's bounded display data ONLY (the optional icon). The candidate is
 * not authoritative; an arbitrary object/reference is never forwarded. */
function parsePickerCommitAdd(add) {
  if (!isPlainObject(add) || !exactKeys(add, ['descriptor', 'capability', 'candidate'])) return null;
  const descriptor = parseDescriptorLike(add.descriptor);
  const capability = parseCapabilityLike(add.capability);
  if (!descriptor || !capability) return null;
  if (!isPlainObject(add.candidate)) return null;
  let candidate = {};
  if (add.candidate.icon !== undefined) {
    if (typeof add.candidate.icon !== 'string' || add.candidate.icon.length === 0
      || utf8ByteLength(add.candidate.icon) > WINDOW_LAYOUT_WIDGET_MAX_ICON_BYTES) return null;
    candidate = { icon: add.candidate.icon };
  }
  return { descriptor, capability, candidate };
}

/** The interactive card's SEMANTIC identity - deliberately a little wider than
 * literal DOM-markup identity. The markup itself reads only the layout id and
 * the ordered members' id/state/icon/descriptor.title, but renderWidgetCard()
 * is also where windowLayoutWidgetPreviewSnapshot is replaced and the preview
 * capability cache cleared, so descriptor.version/executableFingerprint must
 * cross this boundary too or a re-identified window would keep resolving its
 * preview through a stale capability. Protocol revision, appearance and
 * cardSize are ABSENT - they are applied without replacing the DOM.
 *
 * Revision equality is not a sound render-identity rule in either direction.
 * It is too permissive: each workspace responder owns a private revision map
 * that starts at 0, so two live workspace surfaces answering the same request
 * produce r=3, r=0, r=3, r=0 for identical content, and an equality-only guard
 * accepts every one. It is also too restrictive: `broadcast()` re-sends a
 * changed member icon WITHOUT bumping the revision, so equal revisions can
 * carry genuinely new content. Compare what the DOM is made of instead. */
export function windowLayoutWidgetRenderIdentity(snapshot) {
  // The layout name is NOT here: the widget card body never renders it.
  return JSON.stringify([
    snapshot?.id ?? '',
    snapshot?.tracking?.enabled === true,
    (snapshot?.members ?? []).map((member) => [
      member?.id ?? '',
      member?.state === 'normal' ? 'normal' : 'minimized',
      member?.icon ?? '',
      member?.descriptor?.title ?? '',
      member?.descriptor?.version ?? '',
      member?.descriptor?.executableFingerprint ?? '',
      // The opaque native instance identity is not rendered, but it is part
      // of preview resolution. Include it so a re-identified duplicate-title
      // window cannot retain a stale capability.
      member?.windowInstanceId ?? '',
    ]),
  ]);
}

/** 019DR2: the bounded persisted member descriptor identity required by the
 * Papers direct-pick begin validation (exact keys version/title/
 * executableFingerprint), validated/copied field-by-field. Returns NULL for an
 * invalid descriptor so the snapshot fails closed per member instead of
 * emitting a partial `{}` that later poisons pickWindowBegin. Never carries a
 * runtime capability, token or any extra field. */
function memberDescriptorSnapshot(member) {
  // Preserve the exact window identity in the descriptor as well as the
  // snapshot's preview field. List membership and Direct Pick seeds compare
  // descriptors; dropping it made every existing widget member appear new.
  const raw = member?.descriptor;
  if (!isPlainObject(raw)
    || raw.version !== 1
    || !boundedString(raw.title, 'descriptor.title')
    || typeof raw.executableFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/i.test(raw.executableFingerprint)) return null;
  return {
    version: 1,
    title: raw.title,
    executableFingerprint: raw.executableFingerprint,
    ...(typeof raw.windowInstanceId === 'string' && /^W[0-9a-f]{16}$/i.test(raw.windowInstanceId)
      ? { windowInstanceId: raw.windowInstanceId }
      : {}),
  };
}

/** The bounded snapshot the workspace broadcasts and the widget renders: the
 * layout identity plus the minimal member card fields (including a bounded
 * icon data URL when the workspace can supply one, and the persisted layout
 * name). Members with an invalid persisted descriptor are OMITTED (fail
 * closed) so every descriptor the widget later forwards to pickWindowBegin is
 * accepted. Never the whole state, never a capability/token. */
export function windowLayoutWidgetSnapshot(layout, memberIcon = () => null, memberNote = () => null) {
  const members = [];
  for (const member of layout?.arrangement?.members ?? []) {
    const descriptor = memberDescriptorSnapshot(member);
    if (descriptor === null) continue;
    let icon = null;
    const rawIcon = memberIcon?.(layout?.id ?? '', member.id);
    if (typeof rawIcon === 'string' && rawIcon.length > 0
      && utf8ByteLength(rawIcon) <= WINDOW_LAYOUT_WIDGET_MAX_ICON_BYTES) {
      icon = rawIcon;
    }
    const note = snapshotMemberNote(memberNote?.(layout?.id ?? '', member.id));
    const windowInstanceId = typeof member?.descriptor?.windowInstanceId === 'string'
      && /^W[0-9a-f]{16}$/i.test(member.descriptor.windowInstanceId)
      ? member.descriptor.windowInstanceId
      : null;
    members.push({
      id: member.id,
      descriptor,
      ...(member.bounds && Number.isFinite(member.bounds.x) && Number.isFinite(member.bounds.y)
        && Number.isFinite(member.bounds.width) && Number.isFinite(member.bounds.height)
        && member.bounds.width > 0 && member.bounds.height > 0
        ? { bounds: { x: member.bounds.x, y: member.bounds.y,
          width: member.bounds.width, height: member.bounds.height } } : {}),
      // Preserve the per-member distinction, and fail closed for malformed or
      // not-yet-confirmed values so an unknown window is never underlined as
      // if it were known to be open.
      state: member.state === 'normal' ? 'normal' : 'minimized',
      icon,
      ...(windowInstanceId === null ? {} : { windowInstanceId }),
      // The sentence a member card says when the surface checked and could not confirm its window. It rides
      // the snapshot for the same reason the icon does: the compact widget and the detached surface render
      // from this snapshot and have no runtime of their own to ask. Absent for every healthy member, and
      // bounded like every other value on this wire.
      ...(note === null ? {} : { note }),
    });
  }
  // 035: the shared card geometry rides the snapshot so an opening widget can
  // restore the window to the layout's persisted size. Bounded to [1, 2000].
  const rawCardSize = layout?.cardSize;
  const cardSize = rawCardSize && typeof rawCardSize === 'object' && !Array.isArray(rawCardSize)
    && typeof rawCardSize.width === 'number' && Number.isFinite(rawCardSize.width)
    && typeof rawCardSize.height === 'number' && Number.isFinite(rawCardSize.height)
    && rawCardSize.width >= 1 && rawCardSize.width <= 2000
    && rawCardSize.height >= 1 && rawCardSize.height <= 2000
    ? { width: Math.round(rawCardSize.width), height: Math.round(rawCardSize.height) }
    : null;
  return {
    id: layout?.id ?? '',
    name: layout?.name ?? layout?.id ?? '',
    tracking: { enabled: layout?.tracking?.enabled === true },
    members,
    cardSize,
  };
}

/** 019G/021: bounded retry for a transient channel failure (e.g. a widget
 * snapshot requested before the workspace finished loading -> 'unknown-layout').
 * Pure and timer-injected so tests run without real time. `request` returns a
 * result; `shouldRetry(result)` decides; `onResult(result)` receives the final
 * result after the last attempt or a non-retryable one. */
export function createBoundedRetry({
  attempts = 3,
  delayMs = 250,
  request,
  shouldRetry,
  onResult,
  setTimer = (fn) => setTimeout(fn, delayMs),
  clearTimer = (id) => clearTimeout(id),
}) {
  if (typeof request !== 'function' || typeof shouldRetry !== 'function') {
    throw new TypeError('request and shouldRetry are required');
  }
  let timer = null;
  let cancelled = false;
  let attempt = 0;
  async function run() {
    if (cancelled) return;
    let result;
    try {
      result = await request();
    } catch (error) {
      result = { error };
    }
    if (cancelled) return;
    attempt += 1;
    if (!shouldRetry(result) || attempt >= attempts) {
      onResult?.(result);
      return;
    }
    timer = setTimer(() => { timer = null; void run(); });
  }
  return {
    start: () => { void run(); },
    cancel: () => {
      cancelled = true;
      if (timer !== null) { clearTimer(timer); timer = null; }
    },
  };
}

/** Workspace side: validates every widget intent, applies it through the
 * injected writer, owns the per-layout revision, and posts typed responses.
 * `noteCommitted(layoutId)` is the single broadcast the workspace calls after
 * ITS OWN durable window-layout commits so open widgets re-sync.
 * 035: the workspace also tracks a layout's detached-widget lifecycle:
 * `onWidgetOpen` fires when a widget announces itself, `onWidgetDispose` when
 * it reports closing, and `onCardSize` when a live widget reports its window
 * content size (persisted to the shared card geometry). */
export function createWindowLayoutWidgetChannelWorkspace({
  channel,
  getLayout,
  snapshot = windowLayoutWidgetSnapshot,
  memberIcon,
  memberNote,
  applyCommand = async () => ({ ok: false, error: 'no command handler wired' }),
  onWidgetOpen,
  onWidgetDispose,
  onCardSize,
  /** Fires on the AUTHORITATIVE surface only, after it answers a widget. Member
   * icons live in each surface's own in-memory cache, so the writer has to
   * hydrate the ones it is missing itself: another surface resolving them can
   * no longer publish, and the writer may not even be displaying that layout. */
  onAuthoritativeWidgetOpen,
  getHoverPolicy,
  // Answered fresh on every protocol effect: is THIS surface the one authority
  // for the layout right now? A project may be open in several workspace
  // surfaces (the multi-tab feature), and every one of them constructs a
  // responder, so without this gate all of them answer one widget.
  //
  // That is not merely noisy, it is incorrect. Each responder owns a PRIVATE
  // revision map starting at 0, so responder A's bump cannot make responder B
  // stale: both pass their own baseRevision check and both execute the command.
  // A `member-toggle` reads the window's LIVE state and inverts it, so running
  // it twice minimizes and then restores - the creator clicks a member icon,
  // sees it press, and the window never moves. Absolute group actions survive
  // duplication because they are idempotent, which is exactly the asymmetry the
  // creator reported.
  //
  // The predicate is dynamic rather than a construction-time flag because the
  // writer role moves: when the electing surface dies the Web Lock is reclaimed
  // by another, whose already-installed listener simply starts answering. No
  // listener lifecycle race, no reconnection on the widget side.
  isAuthoritative = () => true,
}) {
  const revisions = new Map();
  const revisionOf = (layoutId) => revisions.get(layoutId) ?? 0;
  function bump(layoutId) {
    const next = revisionOf(layoutId) + 1;
    revisions.set(layoutId, next);
    return next;
  }
  const buildSnapshot = (layout) => snapshot(layout, memberIcon, memberNote);
  const post = (message) => {
    try { channel.postMessage(message); } catch { /* channel closed */ }
  };
  async function reply(event) {
    const message = event.data;
    if (!isPlainObject(message) || typeof message.type !== 'string') return;
    // Authority is decided PER BRANCH, never once at the top. Two different
    // kinds of effect arrive on this channel and they need opposite policies:
    //
    //   authoritative - native commands, revision ownership, snapshot replies
    //                   and durable card-size. Exactly the WRITER, or two
    //                   surfaces execute one toggle and cancel it out.
    //   local presence - "a widget for this layout is open/closed". That is
    //                   in-memory per-surface state driving whether THIS
    //                   surface shows the greyed placeholder, so every ordinary
    //                   workspace surface must see it. Gating it would let a
    //                   non-writer tab keep displaying a live attached card
    //                   while the widget is the sole live card, and would leak
    //                   placeholder state on a surface demoted between a
    //                   widget's open and its close.
    //
    // Validation runs BEFORE either, so a malformed message has no effect on
    // any surface regardless of who is writer.
    if (message.type === 'widget-ready' || message.type === 'snapshot-request') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      const { layoutId, clientId } = message;
      // 035: a widget announcing itself marks this layout's attached card as a
      // greyed placeholder (the widget is the sole live card). Local, unGated.
      // A snapshot-request counts as presence too: it only comes from a live
      // widget, so a surface that missed widget-ready still converges.
      onWidgetOpen?.(layoutId);
      if (!isAuthoritative()) return;
      const layout = getLayout(layoutId);
      if (!layout) {
        post({ type: 'error', layoutId, clientId, code: 'unknown-layout' });
        return;
      }
      post({ type: 'snapshot', layoutId, clientId, revision: revisionOf(layoutId), snapshot: buildSnapshot(layout) });
      onAuthoritativeWidgetOpen?.(layoutId);
      return;
    }
    if (message.type === 'hover-policy-request') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      if (!isAuthoritative()) return;
      const policy = getHoverPolicy?.(message.layoutId);
      if (!policy || !Array.isArray(policy.blockedBindings) || policy.blockedBindings.length > 256) return;
      post({ type: 'hover-policy', layoutId: message.layoutId, clientId: message.clientId,
        enabled: policy.enabled === true, blockedBindings: policy.blockedBindings });
      return;
    }
    // 035: a live widget reports its window content size so the workspace
    // persists the shared card geometry. Exact keys + bounded integers only.
    if (message.type === 'card-size') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId', 'width', 'height'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      const width = message.width;
      const height = message.height;
      if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width)
        || !Number.isFinite(height) || width < 1 || width > 2000 || height < 1 || height > 2000) return;
      // Durable: the callback replaces and saves workspace state.
      if (!isAuthoritative()) return;
      onCardSize?.(message.layoutId, Math.round(width), Math.round(height));
      return;
    }
    // 035: the widget reports it is closing; the workspace restores the attached
    // card (no longer a placeholder).
    if (message.type === 'dispose') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')) return;
      // Local presence, NOT a durable write: every ordinary workspace surface
      // must restore its own attached card, whoever the writer happens to be.
      onWidgetDispose?.(message.layoutId);
      return;
    }
    if (message.type === 'command') {
      if (!exactKeys(message, ['type', 'layoutId', 'clientId', 'commandId', 'baseRevision', 'command'])) return;
      if (!boundedString(message.layoutId, 'layoutId') || !boundedString(message.clientId, 'clientId')
        || !boundedString(message.commandId, 'commandId')
        || typeof message.baseRevision !== 'number' || !Number.isFinite(message.baseRevision)) return;
      // Native window mutation and revision ownership: WRITER only. Dropped
      // before parsing, since a non-writer produces neither effect nor reply.
      if (!isAuthoritative()) return;
      const command = windowLayoutWidgetParseCommand(message.command);
      if (!command) return;
      const { layoutId, clientId, commandId, baseRevision } = message;
      const layout = getLayout(layoutId);
      if (!layout) {
        post({ type: 'error', layoutId, clientId, commandId, code: 'unknown-layout' });
        return;
      }
      if (baseRevision !== revisionOf(layoutId)) {
        post({ type: 'stale', layoutId, clientId, commandId, revision: revisionOf(layoutId), snapshot: buildSnapshot(layout) });
        return;
      }
      // 019DR: capture the starting revision and re-read the layout AFTER the
      // apply. The production command path calls noteCommitted() inside
      // applyCommand (already bumped + broadcast a FRESH snapshot), so the
      // committed response must NOT bump again or reuse the stale pre-apply
      // layout: it must carry the authoritative current revision and the
      // freshly re-read immutable layout, or a higher stale committed message
      // could overwrite the earlier fresh broadcast.
      const startingRevision = revisionOf(layoutId);
      let result;
      try {
        result = await applyCommand(layoutId, command);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!result || result.ok !== true) {
        post({ type: 'error', layoutId, clientId, commandId, code: 'apply-failed', message: result?.error ?? 'command failed' });
        return;
      }
      const freshLayout = getLayout(layoutId);
      if (!freshLayout) {
        if (command.kind === 'delete-layout' && result.deleted === true) {
          const revision = revisionOf(layoutId) === startingRevision ? bump(layoutId) : revisionOf(layoutId);
          post({ type: 'committed', layoutId, clientId, commandId, commandKind: command.kind, revision, deleted: true });
          return;
        }
        post({ type: 'error', layoutId, clientId, commandId, code: 'unknown-layout', message: 'layout disappeared during the apply' });
        return;
      }
      const revision = revisionOf(layoutId) === startingRevision ? bump(layoutId) : revisionOf(layoutId);
      const committedStatus = windowLayoutWidgetCommittedStatus(result.status);
      post(committedStatus === null
        ? { type: 'committed', layoutId, clientId, commandId, commandKind: command.kind, revision, snapshot: buildSnapshot(freshLayout) }
        : { type: 'committed', layoutId, clientId, commandId, commandKind: command.kind, revision, snapshot: buildSnapshot(freshLayout), status: committedStatus });
    }
  }
  const listener = (event) => { void reply(event); };
  channel.addEventListener('message', listener);
  return {
    revisionOf,
    noteCommitted(layoutId, { reason } = {}) {
      if (!boundedString(layoutId, 'layoutId')) return revisionOf(layoutId);
      if (!isAuthoritative()) return revisionOf(layoutId);
      const revision = bump(layoutId);
      const layout = getLayout(layoutId);
      if (layout) post({ type: 'snapshot', layoutId, revision, ...(reason ? { reason } : {}), snapshot: buildSnapshot(layout) });
      return revision;
    },
    /** 019G/021: readiness broadcast without a revision bump. The entry calls
     * this for each layout after durable state is loaded so an already-open
     * widget gets its real snapshot even before any user commit (fixes the
     * cold-open 'unknown-layout' stall). A same-revision message is a no-op
     * for a widget that already holds that snapshot. */
    broadcast(layoutId) {
      if (!boundedString(layoutId, 'layoutId')) return revisionOf(layoutId);
      if (!isAuthoritative()) return revisionOf(layoutId);
      const layout = getLayout(layoutId);
      if (layout) {
        post({ type: 'snapshot', layoutId, revision: revisionOf(layoutId), snapshot: buildSnapshot(layout) });
        // A widget can announce itself before writer election finishes. The
        // first snapshot then legitimately carries placeholder icons, but a
        // later writer broadcast must also kick the authoritative icon
        // hydration path; otherwise the detached card stays icon-less while
        // the attached card eventually fills from its local cache.
        onAuthoritativeWidgetOpen?.(layoutId);
      }
      return revisionOf(layoutId);
    },
    /** Tell an open widget that NO surface can act for it, so it shows a reason
     * instead of an empty card. Deliberately ungated: when writer election has
     * failed there is by definition no authority to send it, and the widget's
     * own retry only ever arms on an explicit `unknown-layout`, never on
     * silence. Refusing to act stays correct - inventing a fallback authority
     * would recreate exactly the plural-execution bug - but refusing silently
     * is not. Idempotent: duplicate notices set the same status. */
    announceUnavailable(layoutId, reason) {
      if (!boundedString(layoutId, 'layoutId')) return;
      post({ type: 'error', layoutId, code: 'coordination-unavailable', message: reason });
    },
    close() {
      channel.removeEventListener('message', listener);
      try { channel.close(); } catch { /* already closed */ }
    },
  };
}

/** Widget side: a thin, bounded intent sender. The returned object exposes NO
 * store/save/commit/replace/recording surface - only the channel verbs. */
export function createWindowLayoutWidgetChannelClient({
  channel,
  layoutId,
  clientId = generateId(),
  onMessage,
  reorderAckTimeoutMs = 1500,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  if (!boundedString(layoutId, 'layoutId')) throw new TypeError('a bounded layout id is required');
  if (!boundedString(clientId, 'clientId')) throw new TypeError('a bounded client id is required');
  let revision = 0;
  const pendingReorders = [];
  let inFlightReorderId = null;
  let reorderTimer = null;
  const pendingCommands = new Map();
  const post = (message) => {
    try { channel.postMessage(message); } catch { /* channel closed */ }
  };
  const send = (message) => post({ ...message, layoutId, clientId });
  const listener = (event) => {
    const message = event.data;
    if (!isPlainObject(message) || typeof message.type !== 'string') return;
    if (message.layoutId !== layoutId) return;
    if (message.type === 'hover-policy' && message.clientId !== clientId) return;
    if (message.type === 'snapshot' || message.type === 'committed' || message.type === 'stale') {
      if (typeof message.revision === 'number' && Number.isFinite(message.revision)) revision = message.revision;
    }
    onMessage?.(message);
    if ((message.type === 'committed' || message.type === 'stale' || message.type === 'error')
      && message.commandId && pendingCommands.has(message.commandId)) {
      const pending = pendingCommands.get(message.commandId);
      pendingCommands.delete(message.commandId);
      if (pending.timer !== null) clearTimer(pending.timer);
      pending.resolve(message);
    }
    if ((message.type === 'committed' || message.type === 'stale' || message.type === 'error')
      && message.commandId === inFlightReorderId) {
      if (reorderTimer !== null) {
        clearTimer(reorderTimer);
        reorderTimer = null;
      }
      if (message.type === 'stale') {
        // The authoritative revision was latched above; resend the same valid
        // reorder immediately rather than dropping it or requiring a ritual.
        const pending = pendingReorders[0];
        if (pending) {
          pending.baseRevision = revision;
          sendReorder(pending);
        }
      } else {
        pendingReorders.shift();
        inFlightReorderId = null;
        sendNextReorder();
      }
    }
  };
  function sendReorder(pending) {
    inFlightReorderId = pending.commandId;
    pending.attempts = (pending.attempts ?? 0) + 1;
    send({ type: 'command', commandId: pending.commandId, baseRevision: pending.baseRevision, command: pending.command });
    if (reorderTimer !== null) clearTimer(reorderTimer);
    reorderTimer = setTimer(() => {
      reorderTimer = null;
      if (inFlightReorderId !== pending.commandId || pendingReorders[0] !== pending) return;
      if (pending.attempts < 3) {
        pending.baseRevision = revision;
        sendReorder(pending);
        return;
      }
      // Never leave the queue wedged behind a lost acknowledgement. Re-sync
      // authoritative order, drop only the exhausted intent, then allow the
      // next consecutive drag to proceed immediately.
      pendingReorders.shift();
      inFlightReorderId = null;
      send({ type: 'snapshot-request' });
      sendNextReorder();
    }, reorderAckTimeoutMs);
  }
  function sendNextReorder() {
    if (inFlightReorderId || pendingReorders.length === 0) return;
    pendingReorders[0].baseRevision = revision;
    sendReorder(pendingReorders[0]);
  }
  channel.addEventListener('message', listener);
  return {
    ready: () => send({ type: 'widget-ready' }),
    requestHoverPolicy: () => send({ type: 'hover-policy-request' }),
    requestSnapshot: () => send({ type: 'snapshot-request' }),
    /** 035: the live widget reports its window content size (debounced by the
     * page) so the workspace persists the shared card geometry. Bounded to the
     * same [1, 2000] range the workspace/IPC accepts. */
    sendCardSize: (width, height) => {
      if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width)
        || !Number.isFinite(height) || width < 1 || width > 2000 || height < 1 || height > 2000) {
        return false;
      }
      send({ type: 'card-size', width: Math.round(width), height: Math.round(height) });
      return true;
    },
    /** 035: the widget reports it is closing (pagehide) so the workspace stops
     * rendering its attached card as a greyed placeholder. */
    dispose: () => send({ type: 'dispose' }),
    sendCommand: (command, options = {}) => {
      const parsed = windowLayoutWidgetParseCommand(command);
      if (!parsed) return null;
      // The baseRevision defaults to the live-latched revision; a caller may
      // pin it to the revision of the snapshot it is acting on (e.g. a
      // widget re-issuing an action after a re-sync) - bounded and validated
      // workspace-side.
      const baseRevision = typeof options.baseRevision === 'number' && Number.isFinite(options.baseRevision)
        ? options.baseRevision
        : revision;
      const commandId = generateId();
      if (parsed.kind === 'reorder') {
        pendingReorders.push({ commandId, baseRevision, command: parsed, attempts: 0 });
        sendNextReorder();
      } else {
        send({ type: 'command', commandId, baseRevision, command: parsed });
      }
      return commandId;
    },
    /** Send a non-reorder command and wait for its authoritative acknowledgement.
     * Picker loops must not issue the next command against the previous
     * revision while the writer is still applying the current add/remove. */
    sendCommandAndWait: (command, options = {}) => {
      const parsed = windowLayoutWidgetParseCommand(command);
      if (!parsed) return Promise.resolve(null);
      if (parsed.kind === 'reorder') {
        return Promise.resolve({ type: 'error', layoutId, clientId, code: 'invalid-command', message: 'Use sendCommand for reorder' });
      }
      const baseRevision = typeof options.baseRevision === 'number' && Number.isFinite(options.baseRevision)
        ? options.baseRevision : revision;
      const commandId = generateId();
      // Ordinary commands keep the 3s default. Picker commits explicitly ask
      // for a longer bound because their authoritative acknowledgement can
      // include a native observe request plus durable writer persistence.
      const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
        ? Math.max(250, Math.min(30000, Math.trunc(options.timeoutMs))) : 3000;
      return new Promise((resolve) => {
        const pending = { resolve, timer: null };
        pendingCommands.set(commandId, pending);
        pending.timer = setTimer(() => {
          if (pendingCommands.get(commandId) !== pending) return;
          pendingCommands.delete(commandId);
          resolve({ type: 'error', layoutId, clientId, commandId, code: 'ack-timeout', message: 'Command acknowledgement timed out' });
        }, timeoutMs);
        send({ type: 'command', commandId, baseRevision, command: parsed });
      });
    },
    get revision() { return revision; },
    close() {
      if (reorderTimer !== null) {
        clearTimer(reorderTimer);
        reorderTimer = null;
      }
      pendingReorders.length = 0;
      inFlightReorderId = null;
      for (const pending of pendingCommands.values()) {
        if (pending.timer !== null) clearTimer(pending.timer);
        pending.resolve({ type: 'error', layoutId, clientId, code: 'closed', message: 'Widget channel closed' });
      }
      pendingCommands.clear();
      channel.removeEventListener('message', listener);
      try { channel.close(); } catch { /* already closed */ }
    },
  };
}
