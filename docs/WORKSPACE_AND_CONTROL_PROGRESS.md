# C1 — First-Class Visual Observability and Agent-Driven Visual Debugging

Last updated: 2026-09-02
Persistent status: C1.1 synchronized surface/composed-window capture signed off at `b5a1fb6a46812d05b7aea25597123644ae23f7df`; C1.3 synchronized geometry, assertions, element capture, and semantic-key authority evidence are signed off through `1eb0e538faf6cce7bbba7eb1babbac6d456fd0af`; C1.4 baseline/diff core is signed off at `5e850881da809f9d301040ee1acddabe73c5aa43`; C1.5 bounded per-surface timeline is implemented at `c6435976bfd08470b0aedc1eabe52e348a503093`, awaiting exact-SHA reviewer audit; packaged visual proof remains outside the current no-package boundary
Working branch: `agent/surface-context-routing`

This document replaces the completed workspace/control agenda at this path. The prior A3/B2/B3 completion record remains available in Git history. Read [`../HERMES.md`](../HERMES.md) before acting, preserve user-owned worktree changes, and advance only one reviewed C1.x gate at a time.

## Multi-session reviewer continuation

If the in-app reviewer reaches its message limit before issuing a verdict,
open a fresh ChatGPT reviewer session and provide enough context to continue
the same gate. Include:

* the active agenda slice and the concrete question still awaiting review;
* the repository/branch and exact pushed commit SHA;
* a remote commit link, for example
  `https://github.com/Futahua/Papers-3/commit/<sha>`, plus the branch link
  `https://github.com/Futahua/Papers-3/tree/<branch>`;
* the relevant validation results, user-owned dirty files that must remain
  untouched, and the standing no-release/install/package boundary;
* the prior reviewer’s concrete blocker or sign-off and the smallest requested
  correction, if any.

Do not treat a message-limit notice as a sign-off. Do not start the fresh
session while the prior response is still generating. After sending the
context, use one bounded internal completion watcher that requires
`Stop answering` to appear and then disappear; read the response only after
that watcher finishes. If the prior tab was released, reclaim the exact
reviewer URL or use the newly created session, and keep the same exact-SHA
review/validation loop.

### One-shot watcher contract

The watcher is one deferred operation attached to the still-live initiating
turn. It owns the quiet sampling loop internally (about once per second),
rather than returning unchanged browser state to the model or creating a
recurring automation that sends messages. It must observe both transitions:

1. `Stop answering` appears, proving generation actually started;
2. `Stop answering` disappears, proving that generation finished.

Use the following session-local shape, with a generous bounded timeout and no
browser reads between samples:

```js
async function waitForReviewerCompletion(
  tab,
  { intervalMs = 1000, timeoutMs = 30 * 60 * 1000 } = {},
) {
  const startedAt = Date.now();
  let sawGenerating = false;

  while (Date.now() - startedAt < timeoutMs) {
    const generating =
      (await tab.playwright
        .getByRole('button', { name: 'Stop answering' })
        .count()) > 0;
    sawGenerating ||= generating;

    if (sawGenerating && !generating) {
      return { status: 'finished', elapsedMs: Date.now() - startedAt };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { status: 'timeout', elapsedMs: Date.now() - startedAt };
}
```

The outer deferred operation must await this function and call the
orchestration `notify(...)` channel exactly once with its result. Only after
that wake-up may the task read the completed response, act on it, and start a
new watcher after sending another reviewer message. Keep the same task turn
alive while the watcher is pending: finalizing early can release the claimed
in-app tab and leave the watcher with `Tab not found`. If that happens,
reclaim the exact reviewer URL from `browser.user.openTabs()` before starting
a replacement watcher. A timeout is a monitoring result, not a reviewer
verdict; do not claim sign-off or send a duplicate message.

## Milestone purpose

Papers is primarily a visual rendering and user-experience application. Logical correctness alone is therefore insufficient evidence of product correctness.

The Papers 1.3.11 incident demonstrated the gap clearly: persistent state could contain the expected document, Papers could prove logical surfaces and topology, and the application could still visibly render an empty document. Diagnosis required manual screenshots, Windows accessibility inspection, repeated restarts, process inspection, and temporary project instrumentation. A junction-launched stale Electron process further made apparent restarts unreliable until process identity was understood independently of path strings.

C1 makes the rendered result itself a first-class, semantically inspectable part of Papers' control plane.

This plan authorizes **planning and later implementation of visual observability only**. It does not authorize release, installation, publication, unrelated UX features, arbitrary renderer execution, broad filesystem access, or mutation of creator data for diagnostics.

---

# 0. Non-negotiable invariants

These apply to every C1 phase.

* [ ] **Rendered evidence is independent evidence.** A valid logical topology, document file, or state revision must never be treated as proof that the corresponding UI rendered successfully.
* [ ] **Diagnostics are read-only with respect to creator data.** Captures, timelines, visual reports, fixtures, and baselines must never rewrite Backpack/project documents or state files.
* [ ] **No diagnostic recovery by mutation.** A failed capture must not reload, normalize, rewrite, migrate, reopen, restart, or otherwise alter the user's document merely to obtain evidence.
* [ ] **No continuous polling.** Readiness and changes are event-driven through Electron lifecycle events, renderer observers, explicit project hydration signals, and bounded timeouts.
* [ ] **No path-string restart inference.** Process freshness is established from PID + start/instance identity + build identity and canonical executable identity. Junction/symlink spelling is not process identity.
* [ ] **Exact surface authority remains mandatory.** Visual operations name explicit `windowId`/`surfaceId` targets and resolve through existing Papers authority. No “active”, “current”, “first”, or “only surface” inference.
* [ ] **No arbitrary JavaScript control operation.** Renderer observation uses predefined Papers-owned observation code and strict schemas only.
* [ ] **No new broad filesystem API.** Generated visual artifacts live in a Papers-owned diagnostic artifact store and are addressed by opaque artifact IDs.
* [ ] **No secret-bearing raw transport leakage.** Tokens, descriptor contents, sender/WebContents IDs, native handles, install roots, arbitrary URLs, query strings, project filesystem roots, and hidden form secrets stay outside control/MCP output.
* [ ] **Observation must fail separately from product state.** If visual observation breaks, the user's existing runtime remains authoritative and untouched.
* [ ] **Bound every operation.** Snapshot stabilization, timeline collection, report construction, artifact retention, DOM summaries, event buffers, console buffers, and retries all have explicit upper bounds.
* [ ] **One reviewed gate at a time.** Each C1.x phase receives exact-SHA review and sign-off before the next phase begins.

---

# 1. Host-generic vs project-specific ownership

## Papers host-generic responsibilities

Papers owns all reusable visual-debug infrastructure:

* native window/surface targeting;
* synchronized screenshots;
* process/build/start identity;
* renderer lifecycle observation;
* bounded console/error/resource diagnostics;
* generic DOM/accessibility projection;
* semantic element registration contract;
* stable geometry calculations;
* visual assertions;
* diagnostic artifact storage;
* visual timelines;
* control protocol schemas;
* MCP transport exposure;
* deterministic fixture harness infrastructure;
* baseline storage/update mechanics;
* packaged Electron acceptance.

Papers must not know that a particular project contains groups, shortcuts, graph nodes, canvases, or any As-you-Go-specific concepts.

## Project responsibilities

A project may optionally contribute only generic observability signals:

* opaque document/state revision;
* `state-hydrated` success/failure signal;
* stable semantic element keys;
* safe project-defined summary counters;
* deterministic project fixture data;
* project-owned visual assertions and screenshot baselines.

Those integrations live in the project repository.

## As you Go specifically

As you Go may use C1 once the generic Papers contract exists, but:

* [ ] no `As you Go` ID, filename, schema, group model, shortcut model, or rendering behavior is embedded in Papers;
* [ ] its existing state-envelope fix remains project-owned;
* [ ] its regression fixture uses copied synthetic fixture state, never creator `state.json`;
* [ ] Papers generic tests use a neutral diagnostic fixture project instead.

---

# 2. Phase order

Priority is determined by diagnostic information gained per unit of implementation risk.

1. **C1.1 — Atomic synchronized visual snapshot + canonical process identity**
2. **C1.2 — Renderer lifecycle, hydration, console and failure observability**
3. **C1.3 — Semantic elements, element capture and geometry assertions**
4. **C1.4 — Deterministic visual fixtures and screenshot baselines**
5. **C1.5 — Bounded visual timeline and self-contained debug report**
6. **C1.6 — Full control/MCP agent workflow and packaged closure**

C1.1 is deliberately first because a single synchronized surface capture would have answered the central 1.3.11 question immediately:

> “The logical document says X; what exact process is running, what revision did this renderer hydrate, and what is visibly on screen right now?”

---

# C1.1 — Atomic synchronized visual snapshot + canonical process identity

## User-visible capability

An authenticated agent can request one bounded capture of a real Papers window or project surface and receive one correlated observation containing:

* PNG screenshot;
* exact `windowId` / `surfaceId`;
* workspace topology revision;
* opaque project/document state revision when reported;
* render-cycle identity;
* safe DOM/accessibility summary;
* stable semantic element bounds already registered by the project;
* current presentation state;
* process/build/start identity;
* capture consistency status.

Initial commands:

```text
capture.window
capture.surface
```

`capture.element` is reserved for C1.3.

## Architectural boundary / likely owner

**Main-process owner:** new Papers-owned visual observation service, composed from `src/main/index.ts`.

Likely separation:

```text
src/main/visual/
  visualObservationService.ts
  visualArtifactStore.ts
  processIdentity.ts
  visualSchemas.ts
```

Existing integration points:

* Papers window registry for exact native ownership;
* logical surface registry;
* workspace topology + revision maps;
* `BackpackProjectRuntime` / surface collection for exact WCV;
* project preload for predefined renderer observation;
* `papersControlProtocol.ts` for safe control exposure.

The main process remains canonical. The renderer reports observation facts; it never decides which logical surface it represents.

## Synchronization contract

A capture must not casually combine evidence from different render states.

For a surface capture:

1. resolve exact live `{windowId,surfaceId}`;
2. record topology revision and process instance identity;
3. request renderer observation with fresh `captureId`;
4. renderer waits only for bounded requested readiness;
5. renderer returns:

   * document revision;
   * render cycle;
   * layout epoch;
   * DOM/accessibility projection;
   * semantic bounds;
6. main captures the exact WCV PNG;
7. main obtains a cheap post-capture fence:

   * document revision;
   * layout epoch;
   * render cycle;
8. main rechecks topology revision and exact sender/surface binding;
9. snapshot is accepted only if the pre/post identities agree.

One bounded retry is permitted when state changes during capture. A second mismatch returns an explicit unstable result.

No indefinite “wait until things stop changing”.

## Proposed API schema

```text
capture.surface
input:
  windowId: integer
  surfaceId: string
  settle:
    mode: "layout-stable" | "immediate"
    timeoutMs: 0..5000
  include:
    domSummary: boolean
    accessibilitySummary: boolean
    semanticBounds: boolean

output:
  captureId: UUID
  target:
    windowId
    surfaceId
    projectId
  observedAt: datetime
  consistency:
    status: "stable" | "unstable"
    reason?: "layout-changed" | "state-changed" | "topology-changed" |
             "renderer-replaced"
  process:
    pid
    appInstanceId
    startedAt
    build:
      version
      commit
      packaged
    executableIdentity:
      canonicalFileId
  revisions:
    workspaceTopologyRevision
    documentStateRevision: string | null
    renderCycleId: string | null
    layoutEpoch: integer | null
  presentation:
    "visible" | "hidden" | "not-created"
  summary:
    documentTitle?
    viewport
    visibleNodeCount
    semanticElements[]
    accessibilityNodes[]
  png:
    artifactId
    mimeType: "image/png"
    size
    sha256
```

`capture.window` follows the same envelope but reports the actual composed native window and the set of currently visible logical surfaces.

## Canonical process identity

Papers must introduce an identity that survives path aliases but distinguishes actual process instances.

Internal identity should include:

```text
pid
appInstanceId: random UUID generated once at process start
startedAt
build.version
build.commit
executableCanonicalFileId
```

On Windows, `executableCanonicalFileId` should derive from file/volume identity or equivalent canonical handle-based identity, not the input pathname.

Raw canonical filesystem paths do not need to cross control.

## Current implementation slice

The first bounded slice is intentionally below the control/API boundary. It
establishes the identity and comparison primitives that a later observation
service must use, without pretending that a screenshot is coherent merely
because one request completed:

* [x] `src/main/visual/processIdentity.ts` records PID, process-lifetime
  app-instance ID, process start time derived from `process.uptime()`, safe
  build identity, and a lossless BigInt-backed stat dev/ino executable identity
  after `realpath`.
* [x] `src/main/visual/visualObservation.ts` compares the pre/post capture
  fences and returns an explicit unstable reason on any identity, topology,
  document, render-cycle, or layout change.
* [x] aliases are tested against the file identity rather than pathname
  equality; realpath/stat failure reports `{ status: "unavailable" }` while
  preserving PID/app-instance/start evidence and never blocks control startup.
  A zero Windows volume identity is also treated as unavailable; inode alone is
  not enough to claim a globally canonical file identity.
* [x] mismatch priority is process identity, exact target, sender binding,
  topology, document/render state, then layout, so renderer replacement cannot
  be misreported as ordinary layout churn.
* [x] compose the identity once in the opt-in main-process control plane and
  expose only the redacted `inspect.process` query; ordinary Papers runs do
  not initialize the diagnostic identity.
* [x] implement the bounded renderer observation and native PNG capture.
* [x] expose the read-only `capture.surface` and composed `capture.window`
  commands only after their synchronized services exist.

### Current per-surface observation tracker (active C1.1 work)

The diagnostic ring is historical evidence, not the current capture fence.
The tracker must retain, per exact live project surface:

```text
windowId
surfaceId
currentSenderGeneration
renderCycleId
documentStateRevision | null
domReady
hydrated
firstPaint
layoutEpoch
layoutStable
renderFailed
```

* [x] did-start-loading starts a new cycle and clears document/readiness state;
* [x] hydration, paint, layout-epoch, and layout-stable signals apply only to the current sender and accepted document instance;
* [x] a new layout epoch invalidates prior layout-stable state;
* [x] replacement/gone invalidates current state;
* [x] cross-window adoption and rollback re-establish the exact generation;
* [x] no capture infers current state by searching historical diagnostics.

Implementation checkpoint: pushed head [`b5a1fb6`](https://github.com/Futahua/Papers-3/commit/b5a1fb6a46812d05b7aea25597123644ae23f7df)
adds the main-issued per-navigation document token, buffered scoped
observations, exact sender/document fences, layout-epoch invalidation,
immutable pre/post surface snapshots, bounded renderer replacement retries,
process-ephemeral artifact cleanup, and the composed native-window capture
slice. `capture.window` obtains the exact `BaseWindow.getMediaSourceId()`,
matches it against Electron's `desktopCapturer` window sources, records the
thumbnail's actual pixel dimensions, snapshots the native bounds/topology and
visible surface revisions, and retries once on any member/window change. The
same opaque artifact store and post-write deletion fence are used for both
surface and window captures. Focused deterministic tests cover exact source
matching, timeout/bounds rejection, stable capture, state-change retry, and
protocol dispatch. Validation: `npm run typecheck`, `npm test` (84 files:
836 passed, 4 skipped), build, focused visual diagnostics E2E, focused composed
window E2E with two same-title windows, and `git diff --check` all pass. The
full E2E aggregate remains non-green only in the previously recorded
permission/fixture-sensitive suites; no release/install/package action was run.

The older pre-capture checkpoints above are retained as history. The active
implementation checkpoint is `b5a1fb6`; packaged/alias proof and later
geometry/assertion layers remain unchecked until the reviewer clears this
capture gate.

Reviewer checkpoint: **SIGNED OFF** for the process-identity/fence foundation
at pushed head `58b27f6cb7ef4dca1a9ef2f99dbd06c7d1d0c468`. The reviewer found no
remaining defect in this narrow slice after the `dev:0n` correction. Source was
inspected from the pushed branch; validation reported 34/34 focused tests,
typecheck, and `git diff --check`. Renderer capture/API remain intentionally
unclaimed and are the next C1.1 work.

Reviewer checkpoint: **SIGNED OFF** for the C1.3 semantic-key
identity/surface-local-authority foundation at exact pushed head
`d440466b87d4234339b3fb5dd0ac6845b0be7fa8`. The reviewer accepted bounded
opaque keys, duplicate/invalid-payload atomicity, predefined attribute-only
observation, exact sender-derived targeting, surface isolation, generation and
navigation invalidation, exact-surface retirement, prepared-sender refusal,
cross-window/rollback recovery, and diagnostic-refresh failure isolation.
Validation for the accepted correction included `npm run typecheck`,
`npm test` (78 files: 812 passed, 4 skipped), build, focused Electron E2E, and
`git diff --check`. The user-owned
`docs/evidence/worker-comparison.json` remained untouched and unstaged.

The next active gate is C1.1 capture infrastructure. Its correction-tranche
checklist is:

* [x] canonical current per-surface observation state, independent of the
  historical diagnostic ring;
* [x] fixed bounded renderer fence request/response with capture correlation;
* [x] Papers-owned opaque artifact store with atomic finalize and bounded reads;
* [x] synchronized `capture.surface` and composed `capture.window` control
  commands, with exact native source matching and actual pixel dimensions;
* [x] exact-target, retry, instability, no-mutation and artifact-integrity
  deterministic evidence;
* [x] service-level rejection of a native image whose source ID is foreign to
  the exact requested Papers window;
* [x] same-renderer document/render identity changes classified as
  `state-changed`, distinct from sender-generation replacement;
* [x] focused Electron proof reconstructs `capture.window` through bounded
  `visual.artifact.read` chunks and verifies size plus SHA-256;
* [ ] packaged/alias/restart acceptance evidence;
* [ ] exact-SHA reviewer sign-off before advancing to geometry/assertions.

Reviewer checkpoint: **SIGNED OFF** for the synchronized `capture.surface`
slice at exact pushed head `d25b5d643092b3a32e7e2836b7cea10d16c370d3`.
The reviewer accepted the main-issued navigation token, exact renderer fence,
layout epoch, immutable summaries, renderer-churn retry, and artifact cleanup.
The composed `capture.window` implementation and this hardening tranche are
now at `b5a1fb6a46812d05b7aea25597123644ae23f7df` and are awaiting their own exact-SHA review; do not advance
to geometry/assertions until that review is explicit.

### Required invariant

Two launches of the same executable through:

```text
real path
junction alias
symlink alias
```

may have the same executable file identity but are fresh only if their PID/start/app-instance identity differs.

## Security / redaction / authority

* exact existing window/surface authority only;
* no sender IDs or WebContents IDs in output;
* no filesystem paths;
* no raw descriptor/token;
* no arbitrary selector;
* DOM/AX projection has hard node/count/size limits;
* password/value-bearing inputs always redact value;
* hidden form state is omitted;
* script source URLs and project roots are omitted;
* screenshot is an explicit local authenticated operation and may naturally contain whatever is visibly rendered;
* screenshot capture never expands into hidden document content.

## Deterministic tests

* [ ] exact foreign/retired surface rejected;
* [ ] two surfaces of same project remain distinguishable;
* [ ] screenshot and semantic snapshot carry same capture ID;
* [ ] topology revision change during capture produces unstable/retry, never false stable;
* [ ] document revision change produces unstable/retry;
* [ ] renderer replacement during capture is detected;
* [ ] second instability returns bounded failure;
* [ ] process instance ID changes on real restart;
* [ ] canonical executable identity remains identical across a Windows junction alias;
* [ ] no test uses executable path-string equality as restart proof;
* [ ] capture causes zero writes to project/Backpack state.

## Packaged live proof

Using a packaged Electron build:

* open deterministic neutral fixture;
* verify screenshot contains its visible fixture;
* verify logical surface and topology revision match the capture;
* verify project-reported document revision matches capture;
* launch packaged executable through a junction alias and prove reported canonical executable identity still matches the real image;
* start a genuinely new process and prove PID/app-instance/start identity changes.

No release or installation is part of this gate.

## Reviewer gate

Reviewer must explicitly answer:

> Does this command prove one coherent visual observation of the exact logical surface, and can a stale process or alias-launched process be distinguished without relying on path spelling?

## Completion evidence

Record:

* implementation SHA;
* exact pushed review head;
* unit/focused suite counts;
* packaged Electron test result;
* example redacted capture manifest;
* proof no project state changed;
* process-alias identity proof;
* reviewer SIGNED OFF / blocker.

## Rollback / failure behavior

Observation failure:

* never closes/reloads/reopens a project;
* never retires a logical surface;
* never mutates topology;
* never changes project state;
* deletes any incomplete diagnostic artifact;
* returns explicit partial/unstable status;
* leaves the renderer running exactly as before.

---

# C1.2 — Renderer lifecycle, hydration, console and failure observability

## User-visible capability

Agents can subscribe to the actual rendering lifecycle and know where rendering stopped.

Required lifecycle events:

```text
navigation-started
dom-ready
state-hydrated
first-paint
layout-stable
render-failed
```

Required diagnostic classes:

```text
console
uncaught-error
unhandled-rejection
navigation-failed
resource-failed
renderer-gone
hydration-failed
```

This phase eliminates restart-and-stare debugging.

## Current implementation slice

The first C1.2 slice defines the bounded, path-redacted evidence buffer that
later lifecycle hooks will append to:

* [x] `src/main/visual/visualDiagnostics.ts` defines strict lifecycle and
  diagnostic payloads for navigation, DOM readiness, hydration, paint,
  stability, render failure, console, uncaught errors, rejected promises,
  navigation/resource failures, and renderer exit.
* [x] the in-memory ring buffer has a bounded capacity, monotonic sequence,
  exact target, timestamp, and copy-out snapshot; it never writes project
  state and never starts a polling loop.
* [x] local paths, URLs, and credential-like assignments in diagnostic text
  are redacted before storage; unknown payload fields and malformed targets are
  refused.
* [x] `src/main/visual/visualLifecycleMonitor.ts` maps real Electron
  `did-start-loading`, `dom-ready`, `did-fail-load`, `console-message`, and
  `render-process-gone` events into the bounded buffer;
  renderer-owned hydration/paint/stability phases are accepted only through a
  target-bound signal seam.
* [x] the adapter detaches listeners cleanly and introduces no timers, polling,
  reloads, or recovery side effects.
* [x] `src/main/visual/visualResourceMonitor.ts` attributes real
  `session.webRequest.onErrorOccurred` failures through the exact current
  WebContents/surface authority. It records only bounded resource kind and
  sanitized error text; source URLs and unknown/stale WebContents are ignored,
  and the single listener detaches on shutdown.
* [x] compose one monitor and bounded buffer per opt-in Papers host window,
  detach both on native-window close, and expose the read-only exact-target
  `inspect.visual.diagnostics` control query.
* [x] route host/project renderer paint and stability signals through the
  authenticated sender → `{windowId,surfaceId}` mapping; renderer-supplied
  targets are ignored, unbound senders/main-owned phases are refused, and the
  current runtime WebContents is rechecked to reject stale replaced senders.
  No preload claims paint or layout stability automatically; real producers
  remain explicit and project hydration remains project-owned.
* [x] the authority resolver has a focused old-sender/current-runtime
  regression at the IPC composition boundary.
* [x] extend the existing authenticated control event hub with
  `visual.lifecycle` and `visual.diagnostic`; subscriptions require an exact
  live `{windowId,surfaceId?}` target whenever either visual event is named,
  and reject a target when no visual event is requested.
* [x] publish only after a diagnostic record is successfully appended and
  schema-validated; window targets receive host plus project records in that
  window, surface targets receive only that surface, and no URL/path/sender or
  raw renderer detail crosses the frame boundary.
* [x] validate the visual target before activating the socket subscription and
  drop visual frames when the socket is under backpressure rather than growing
  an unbounded queue; historical sequence numbers remain available through
  `inspect.visual.diagnostics`.
* [x] opt-in host and project preloads forward only strict bounded
  `uncaught-error` and `unhandled-rejection` `{kind,message}` signals through
  the authenticated renderer IPC channel; stacks, filenames, event objects,
  and payload-supplied targets are not forwarded.
* [x] the main IPC boundary resolves the sender-authoritative target, refuses
  stale/unbound senders and malformed or oversized failure payloads, and keeps
  redaction/retention and live event publication on the existing bounded path.
* [x] dev-control project runtimes forward non-empty console messages from
  their live renderer through the exact sender/surface callback; main maps the
  bounded message and level into the existing redacted diagnostic buffer.

The resource-attribution adapter, event-subscription adapter, and renderer
failure slice are implemented against the existing bounded path and have
reviewer sign-off below. The renderer failure path is opt-in, strict,
sender-authoritative, redacted, bounded, and best-effort; it does not make
ordinary project startup depend on observation.

Implementation checkpoint: focused preload/host/IPC/lifecycle coverage passes
12/12 and the developer-control plus neutral-project Electron suite passes
7/7, including main-world uncaught-error and unhandled-rejection capture,
exact host-window/surface authority, redaction, bootstrap isolation, staged
sender refusal, current replacement acceptance, and no duplicate observer
records. The full host suite passes 776/776 with 4 skipped across 70 passed
files and 1 skipped file; typecheck, production build, and diff check pass.
This closes the current C1.2 renderer-failure gate. C1.2 remains a broader
phase whose later visual lifecycle work is tracked separately below and must
still receive its own exact-SHA review.

Reviewer checkpoint: **SIGNED OFF** for the lifecycle adapter at
`efd24422296d9b64c974dcb3b97073d0629e25b0` and for the host-composition/control
slice at `730e3ab2659cc66ff910635dd8376f8b4a09da4c`. The final host review found
no remaining defect after the exact `isMainFrame === true` correction. The
reviewer specifically confirmed opt-in composition, close cleanup, exact target
authority, schema revalidation, bounded/redacted records, and no polling or
recovery side effects. Resource attribution and project-frame routing were
subsequently completed and signed off below.

The renderer-signal routing extension is also **SIGNED OFF** at
`dd70318f04a2da8539727286a4d129f26a46bb17`. The reviewer confirmed that
`resolveVisualDiagnosticTarget` is the production authority seam, stale replaced
project senders are refused even while logical bindings lag cleanup, renderer
payload targets are ignored, and no preload claims paint or layout stability
automatically. The resource-attribution slice is **SIGNED OFF** at
`ddfdd2e7f7bf3383179961f482a90d584b205fb6`, and exact-target event subscription
is **SIGNED OFF** at `6ba945d137939afeab4460fcba7a21d9e5bd0bd4`; screenshot
capture remains unchecked.

The current renderer-failure diagnostic slice is intentionally awaiting review:
the normal preloads contain no failure observer; `PAPERS_DEV_CONTROL=1` selects
dedicated dev-control preload entries that expose one fixed reporting seam, and
the host's actual main-world renderer code installs the two failure listeners.
The project dev-control preload requests the same fixed observer through
Electron's `contextBridge.executeInMainWorld` at document start. Electron 43 can
emit a project's first synchronous throw/rejection as an error-level
`console-message` before that experimental callback's listeners receive it, so
the project runtime keeps an early-error fallback on the exact newly-created
project WebContents. The same callback now also forwards every non-empty
console message after DOM-ready; main retains it as a bounded `console`
diagnostic and uses the sender-authoritative resolver immediately before
recording. A prepared cross-window renderer therefore has no canonical surface
and is refused; a replaced old renderer is refused even if its listener has not
detached yet. The failure parser runs only when the runtime marks the console
event as pre-DOM bootstrap; post-DOM console text cannot become an
uncaught-error or unhandled-rejection candidate. The failure path suppresses
only a matching cross-source pair (bootstrap-console plus observer) for the
same exact pre-redaction message, target, and short burst. The transient matcher
stores only a SHA-256 fingerprint of that raw message and at most 64 unmatched
candidates; a suppressed pair is consumed so it cannot hide a later same-source
failure. Same-source repeats and different raw messages that redact alike remain
separate. It is best-effort and is not awaited by `show()`, so observation cannot
make ordinary project startup fail.
The main-process IPC boundary accepts only strict bounded `{kind,message}`
payloads after sender-authoritative target resolution. No runtime capability
query, shared sandbox preload chunk, arbitrary renderer execution, or polling
loop is involved. The dev-only main-world test seams have no arguments and emit
fixed path/credential-shaped messages solely to prove the end-to-end redaction
and exact-target paths. The neutral project regression uses immediate startup
throw/rejection, a prepared cross-window renderer, and a post-adoption
replacement failure; it proves that staged records are refused, current
replacement records are accepted, and `show()` still resolves while failures
are captured.

The same-project console-isolation slice is now implemented against that
existing path. The real two-surface Electron fixture emits a distinct console
message through each live project sender, queries each exact surface stream,
and proves each message appears on exactly one `{windowId,surfaceId}` target.
No project identity or target is supplied by the renderer message itself.

Reviewer checkpoint: **SIGNED OFF** for the complete forward renderer-failure
slice at exact pushed head
`178c874ea203c1e953b5942ed46c452f55ea24f6`. The reviewer found no remaining
defect in the SHA-256-only transient matcher, its 64-candidate bound, consumed
cross-source pair behavior, same-source repeat behavior, redaction-collision
separation, or the existing sender-authority/startup-isolation regressions.

Current narrow reviewed slice: **reverse Papers → Dockview reconciliation with
feedback suppression**. When Papers/main applies canonical workspace topology
to Dockview during restore/load/open/close/move reconciliation, suppress only
the Dockview callbacks caused by that application so they cannot echo as a
second topology mutation or commit. Genuine subsequent user Dockview actions
must immediately resume forward reporting.

Implementation checkpoint: `WorkspaceDock` now uses a synchronous,
nestable reconciliation-feedback gate around the complete Papers-applied
Dockview projection effect: panel add, canonical removal, active-panel
application, and topology reconciliation. The gate has no timer or polling
window: structural, active-panel, and layout callbacks emitted during the API
operation are ignored, then user callbacks are eligible immediately after it
returns. `synchronizingRemovals` remains in place so canonical removal cannot
become a semantic user-close callback. Focused unit coverage proves scoped
suppression, immediate resumption, and nested operations. The workspace E2E
proves canonical identity/order/focus convergence, no delayed echo commit
after restore/open/close, and genuine post-reconciliation tab movement
producing the next canonical update. Validation: full Vitest 778 passed/4
skipped across 71 passed/1 skipped files; focused developer-control,
renderer-diagnostics, and workspace E2E 8/8; typecheck; build; diff check.

Reviewer checkpoint: **SIGNED OFF** for the reverse Papers → Dockview
reconciliation slice at exact pushed head
`073e48fa5c710170e32465959521e07894155ef2`. The reviewer confirmed that the
complete Papers-driven projection is gated—panel add, canonical removal,
canonical active-panel application, and topology reorder/split/size
reconciliation—while `synchronizingRemovals` independently preserves
semantic close suppression. The E2E confirms canonical restore/open/close
without delayed echo revisions and immediate resumption of genuine Dockview
interaction.

Current smallest reviewed slice: **C1.2 generic project hydration reporting** —
sender-authoritative `state-hydrated` / `hydration-failed` signals with opaque
revision and bounded safe metadata, no state bytes, and no Papers-synthesized
hydration success.

Implementation checkpoint: the opt-in project dev-control bridge exposes fixed
`reportStateHydrated(revision, summary?)` and
`reportHydrationFailed(revision?, stage, code)` methods. Revisions are bounded
delimiter-free opaque tokens; success summaries are limited to 32 named
nonnegative integer counters; failure stage/code are bounded metadata tokens.
Main strictly parses the hydration signal as exactly
`{kind, phase, revision, summary?}`—no `detail`, state bytes, target, or
unknown fields—then resolves the exact target from the authenticated sender.
Malformed/foreign signals are refused and no raw state bytes are retained.
Unit and neutral-project E2E coverage proves success and failure delivery,
spoofed-target/extra-field refusal, bounded metadata, and exact
window/surface authority. Validation: full Vitest 784 passed/4 skipped across
72 passed/1 skipped files; focused developer-control, renderer-diagnostics,
and workspace E2E 8/8; typecheck; build; diff check.

The exact-SHA reviewer gate must confirm that hydration remains project-owned:
Papers does not synthesize success from DOM-ready/file reads, and no state
bytes or renderer-supplied target cross the diagnostic boundary.

Reviewer checkpoint: **SIGNED OFF** for generic project hydration reporting at
exact pushed head `7488be957038cbba4e8e2d99bfb56452586ba5a5`. The reviewer
confirmed the exact state-hydrated shape `{kind, phase, revision, summary?}`,
shared bounded schemas, refusal of `detail`/state/target/unknown fields,
sender-derived target authority, fixed bridge limits, and project-owned
hydration semantics.

Next smallest reviewed slice: **C1.2 first-paint observability** — add a real
project/main-world paint producer for the existing sender-authoritative
`first-paint` lifecycle signal, without treating DOM-ready, load, or hydration
as paint.

Current implementation checkpoint: the opt-in project dev-control preload
installs a Papers-owned `PerformanceObserver` for the browser-provided `paint`
entry named `first-paint`, with a buffered-entry check and one-shot disconnect.
The fixed first-paint emitter is no longer present on the page-visible bridge;
project code can report hydration and failure facts, but cannot forge paint
success. The preload emits the fixed sender-authoritative lifecycle signal only
after that real Paint Timing entry exists; unsupported Paint Timing leaves the
phase unknown and never infers it from load, DOM-ready, or hydration. Focused
unit coverage proves the private emitter/public bridge boundary, and
neutral-project E2E proves the actual producer reaches the exact
window/surface diagnostic stream while `reportFirstPaint` is unavailable to the
project page.
Validation: full Vitest 785 passed/4 skipped across 72 passed/1 skipped files;
focused developer-control, renderer-diagnostics, and workspace E2E 8/8;
typecheck; build; diff check.

Reviewer checkpoint: **SIGNED OFF** for C1.2 first-paint observability at exact
pushed head `2731daca6f610de6a6ddaa70980cd9499bfa8e8b`. The reviewer confirmed
the preload-owned Paint Timing observer, page capability separation, one-shot
buffered observation, unsupported-API unknown behavior, and actual producer E2E.

Next smallest reviewed slice: **C1.2 real layout-stable observability** — use
event-driven `ResizeObserver` / `MutationObserver` geometry stabilization with
a bounded unchanged window, no perpetual polling, and no inference from
DOM-ready, paint, or hydration.

Current implementation checkpoint: the opt-in project dev-control preload
observes the document from document-start, anchoring `MutationObserver` to the
`Document` until parser-created roots exist, then tracking document/body
geometry through `ResizeObserver` where available. Three unchanged animation
frames are required; repeated activity is bounded to 12 frames and emits
structured `render-failed` with `layout-stability-timeout` instead of waiting
forever. A later mutation starts a fresh bounded epoch. Layout-success and
timeout emission remain preload-owned and are absent from the page-visible
bridge; font readiness is an event-driven refresh, not a polling loop.
Deterministic unit tests cover stable, renewed, and timed-out epochs, and
neutral-project E2E proves the real event-driven `layout-stable` record reaches
the exact window/surface diagnostic stream.
Validation: full Vitest 792 passed/4 skipped across 73 passed/1 skipped files;
focused developer-control, renderer-diagnostics, and workspace E2E 8/8;
typecheck; build; diff check.

Reviewer checkpoint: **SIGNED OFF** for C1.2 real layout-stable observability
at exact pushed head `256e4f402c8e01488a7bcc3ac1c118de8ade9db3`. The reviewer
confirmed empty/text-only geometry handling, null-geometry frame consumption,
bounded mutation epochs, document-start ownership, structured timeout behavior,
and actual producer E2E.

Next smallest reviewed slice: **C1.2 hydration-failure → render-failed
lifecycle correlation** — an exact sender-authoritative hydration failure must
produce both the structured `hydration-failed` diagnostic and the corresponding
`render-failed` lifecycle fact, without conflating it with navigation/load/layout
failures.

Current implementation checkpoint: the fixed page-facing
`reportHydrationFailed(revision?, stage, code)` bridge validates bounded
metadata, emits the `hydration-failed` diagnostic, and emits a paired strict
`render-failed` lifecycle payload carrying the same bounded revision/stage/code.
The main process accepts that correlation shape only for `render-failed`, while
ordinary render failures retain their separate bounded-detail shape; the shared
retained schema rejects mixed detail-plus-correlation payloads. All records
still use the authenticated sender-derived window/surface target.
Focused IPC, bridge, lifecycle-schema, and neutral-project E2E coverage proves
the pair and rejects extra/foreign fields.
Validation: full Vitest 792 passed/4 skipped across 73 passed/1 skipped files;
focused developer-control, renderer-diagnostics, and workspace E2E 8/8;
typecheck; build; diff check.

Reviewer checkpoint: **SIGNED OFF** for C1.2 hydration-failure → render-failed
correlation at exact pushed head `6871673e39988c9b7c21ac7a09e0f64e17b5be90`.
The reviewer confirmed diagnostic-first then lifecycle pairing, identical
bounded correlation metadata, strict mutual exclusion from ordinary
render-failed detail, and sender-derived target authority.

Next smallest reviewed slice: **C1.2 deterministic lifecycle ordering** — prove
on one exact surface that `navigation-started` precedes `dom-ready`, and
establish the successful fixture’s recorded lifecycle sequence without
synthesizing or imposing false ordering between independent hydration,
first-paint, and layout-stable facts.

Current implementation checkpoint: project runtime lifecycle callbacks are
composed before `loadURL()`, so the canonical project WebContents records
`did-start-loading` as `navigation-started` and `dom-ready` through the same
authenticated exact-surface target path. Prepared cross-window renderers still
remain unrecorded until canonical adoption. The deterministic unit proof
attaches to an exact `{windowId, surfaceId}` target and verifies source-event
order; the production neutral-project E2E verifies
`navigation-started.sequence < dom-ready.sequence`. The tests assert only the
required navigation-to-DOM ordering; they do not impose an ordering among
independent renderer-owned hydration, first-paint, and layout-stable signals.
Validation: full Vitest 793 passed/4 skipped across 73 passed/1 skipped files;
focused developer-control, renderer-diagnostics, and workspace E2E 8/8;
typecheck; build; diff check.

Reviewer checkpoint: **SIGNED OFF** for C1.2 deterministic lifecycle ordering
at exact pushed head `ec6f6a4cb81cb1a6561c5983b2120621ae0a7771`. The reviewer
confirmed production project lifecycle composition before navigation, exact
sender/surface retention, prepared-sender refusal, and deliberate non-total
ordering for independent hydration/paint/layout facts.

Next smallest reviewed slice: **C1.2 deterministic negative hydration
ownership** — prove `state-hydrated` cannot appear for an exact surface unless
that project explicitly reports it, including DOM-ready/load/paint/layout
occurring without synthesizing hydration success.

Current implementation checkpoint: the neutral-project E2E asserts that the
initial exact-surface lifecycle sequence contains navigation-started and
dom-ready in that order, then waits for the actual first-paint and
layout-stable records before checking that no state-hydrated record exists.
Only after that negative assertion does the project call
`reportStateHydrated`; the test then verifies the exact revision appears after
that explicit bridge call. Main process lifecycle hooks do not read project
state or infer hydration from any other event.
Validation: full Vitest 793 passed/4 skipped across 73 passed/1 skipped files;
focused developer-control, renderer-diagnostics, and workspace E2E 8/8;
typecheck; build; diff check.

Reviewer feedback at exact pushed head `e27c0e6037198857b6c37f4e9ac9fc11b7fe5675`
identified one evidence-ordering gap: the prior test reported hydration before
awaiting first-paint and layout-stable, so it did not prove those independent
facts while hydration was absent. The narrow correction reordered the existing
E2E only; no production code change was needed. The exact-SHA reviewer gate
must reconfirm the reordered negative assertion, explicit-report positive
assertion, exact sender authority, and no state mutation or polling.

Reviewer checkpoint: **SIGNED OFF** for C1.2 deterministic negative hydration
ownership at exact pushed head
`8a196eccd094d5cdc8c138b5b220d3b4db9d334e`. The reviewer confirmed that the
exact surface reaches navigation-started, dom-ready, first-paint, and
layout-stable before the negative hydration check; explicit project-owned
hydration is then the only source of the positive state-hydrated record.

Next smallest reviewed slice: **C1.2 deterministic same-project console
isolation** — prove two simultaneously live surfaces showing the same project
retain console diagnostics only under their own exact `{windowId,surfaceId}`
targets, with no cross-surface attribution.

Current implementation checkpoint: dev-control project runtimes forward every
non-empty `console-message` from the live renderer, including messages emitted
after DOM-ready. Main maps Electron levels through the shared bounded console
schema and resolves the target from the authenticated sender plus the named
surface; the renderer cannot provide or redirect that target. The two-surface
fixture emits one distinct message through each native project sender and
confirms that each exact surface query owns only its corresponding message.
Its post-DOM error-shaped message regression proves that ordinary console
output is retained without creating a failure record; the existing project
visual E2E continues to prove the pre-DOM fallback path. The E2E now also
requires the two message owners to be the two different logical surfaces and
checks both exact streams for the absence of a false failure record.
Unit coverage for runtime forwarding and lifecycle mapping is 18/18; full
Vitest is 794 passed/4 skipped; focused developer-control,
renderer-diagnostics, same-project, and workspace E2E is 9/9; typecheck,
build, and diff check pass.

The exact-SHA reviewer gate must confirm both same-project messages remain
isolated, ordinary post-DOM console output is retained, stale/prepared senders
cannot attribute records, and the existing redaction/bounded/no-polling rules
remain intact.

Reviewer feedback at exact pushed head
`3e84ec2045d383b1c8516e3b65eb324fcfadd7ec` identified a concrete regression:
making the console callback permanent also made post-DOM text beginning with
`Uncaught` enter the bootstrap failure classifier. The correction carries an
explicit bootstrap boolean through the runtime/collection/factory callback;
all console events are retained, but failure classification is gated to
pre-DOM events. Unit coverage proves both metadata values, and the real
same-project E2E proves post-DOM `console.error('Uncaught ...')` is console-only.
This exact-SHA gate must review the corrected callback propagation and confirm
the prior pre-DOM failure behavior remains intact.

Reviewer feedback at exact pushed head
`7aa06ca808314d607a1851e32e54d587e634fea4` found that the prior E2E proved
each injected message had one owner but did not prove the two owners were
different; both messages could have been routed to one surface. The narrow
correction requires the collected owner set to equal both logical surface IDs
and checks all exact surface streams for the post-DOM error-shaped message’s
absence of uncaught-error/unhandled-rejection records. No production change
was needed for this blocker.

Reviewer checkpoint: **SIGNED OFF** for C1.2 deterministic same-project console
isolation at exact pushed head
`34558f731080151d41a276149e7486d4c13cdfe8`. The reviewer confirmed distinct
same-project sender messages retain under distinct exact surfaces, post-DOM
error-shaped console text cannot create failure diagnostics, and the existing
authority, redaction, bounds, stale/prepared refusal, and no-polling behavior
remain intact.

Next smallest reviewed slice: **C1.2 exact project renderer-gone
observability** — retain a real project `WebContents` `render-process-gone`
event under its authenticated current `{windowId,surfaceId}`, refuse
staged/stale senders, and prove it in Electron E2E without recovery/reload
behavior.

Current implementation checkpoint: project runtimes forward
`render-process-gone` with its bounded reason through the surface-aware
callback chain. Main re-resolves the current sender and exact surface before
retaining `renderer-gone`; a prepared or replaced sender therefore fails
closed. The neutral-project E2E force-crashes the exact moved project renderer
and verifies the retained diagnostic without any reload or recovery action.
Validation: typecheck; runtime/surface unit tests 22/22; project visual E2E
1/1; build; diff check.

The exact-SHA reviewer gate must confirm real project renderer exit retention,
current exact-sender authority, staged/stale refusal, bounded reason handling,
and no recovery or polling side effect.

Next smallest reviewed slice: **C1.2 real failed-resource exact-surface
attribution** — make a neutral project trigger a real failed script/style/image/
font request and prove `resource-failed` is retained only under that current
`{windowId,surfaceId}`, with no URL leakage and stale/prepared sender
attribution refused.

Current implementation checkpoint: the main-process resource monitor observes
both Electron transport failures and completed HTTP responses with status 400+
so failed resources served by Papers' custom protocol are observable as well.
For either source it resolves the originating WebContents through the current
surface authority before appending a bounded, redacted `resource-failed`
record. The record keeps only the safe resource kind and message; complete URLs,
paths, query strings, and token-like values are excluded. The neutral-project
E2E requests a missing script from the exact moved project surface, verifies
the record's exact target and kind, checks that the resource URL and token do
not appear, and then continues to the renderer-gone proof. Unit coverage also
exercises HTTP 404 attribution and detach cleanup.

Validation: typecheck; full Vitest 796 passed/4 skipped across 73 passed/1
skipped files; focused developer-control, renderer-diagnostics, same-project,
and workspace E2E 9/9; project visual diagnostics E2E 1/1; production build;
diff check.

The exact-SHA reviewer gate must confirm real failed-resource retention,
current exact-sender/surface authority, stale/prepared refusal, bounded and
redacted messages, and no URL leakage, recovery, or polling side effect.

Reviewer checkpoint at exact pushed head
`924c440189cce7294ca57d0adac6a0eb27ba8224`: **SIGNED OFF** for real
failed-resource exact-surface attribution. The reviewer confirmed that both
transport failures and HTTP 400+ completions share sender-authoritative target
resolution, prepared/stale senders fail closed, only resource kind plus a
bounded redacted message is retained, both listeners detach cleanly, and the
neutral-project E2E proves a genuine missing script without URL/token leakage.

Next smallest reviewed slice: **C1.2 deterministic diagnostic-buffer bound
closure** — prove mixed real visual events cannot exceed the configured
retained-record cap while sequence numbers remain monotonic and observation/
event publication continues without affecting product state.

Current implementation checkpoint: no production buffer change was needed.
The narrow closure adds a mixed-event unit proof with a capacity-3 buffer,
monotonic sequences, oldest-record eviction, and a deliberately failing
publication callback whose later events still publish. The neutral-project
Electron E2E drives 132 real console observations through the moved project,
proves the real default 128-record window cap and monotonic retained
sequences, subscribes only after overflow, then emits real console,
unhandled-rejection, and failed-image events. It verifies exact-surface
publication, bounded retention, redaction/no URL-token leakage, and unchanged
workspace topology/state. The user-owned
`docs/evidence/worker-comparison.json` remains unstaged and untouched.

The exact-SHA reviewer gate must confirm mixed-event overflow, monotonic
sequences, post-overflow publication, exact target filtering, redaction,
unchanged product state, and no polling or recovery side effect.

Reviewer checkpoint at exact pushed head
`591cc12aff5040b32defa8d17c59fc7dad92d358`: **SIGNED OFF** for deterministic
diagnostic-buffer bound closure. The reviewer confirmed the real default
128-record cap, oldest-record eviction, strictly increasing retained
sequences, the capacity-3 mixed-event unit proof, publication continuing after
a throwing callback, exact-target live publication after overflow, redaction,
and workspace immutability across the overflow burst and later events.

Next smallest reviewed slice: **C1.2 deterministic redaction closure** — prove
the existing redaction guarantees comprehensively at the control boundary,
especially that retained diagnostics and live-published diagnostic frames
cannot expose path, URL, query, token, or credential material across console,
renderer-error, hydration, resource, navigation, and renderer-exit classes.
Start as an evidence/test slice; change production redaction only if the
targeted closure exposes a concrete leakage case.

Current implementation checkpoint: no production redaction change was needed.
The real control event hub is now composed with the real bounded diagnostic
buffer in unit coverage across console, uncaught-error, unhandled-rejection,
navigation-failed, resource-failed, renderer-gone, hydration-failed,
state-hydrated, and render-failed records. The test injects Windows paths,
URLs/queries, tokens, passwords, secrets, and API-key values, verifies neither
retained snapshots nor serialized live frames expose them, and confirms
hostile hydration metadata is rejected by existing schemas. The neutral-project
E2E also checks the serialized live frames themselves after the post-overflow
console/rejection/failed-image publication.

Validation and exact-SHA reviewer gate are pending for this slice. The
user-owned `docs/evidence/worker-comparison.json` remains unstaged and
untouched; no release, install, package, or policy action is in scope.

Reviewer checkpoint at exact pushed head
`7c6f2974af16566741495555c0c25e3c6c93a6a8`: **SIGNED OFF** for no timer-based
continuous polling and recovery-side-effect closure. The reviewer confirmed
event-driven lifecycle/resource observation, bounded layout epochs, listener
cleanup and post-detach inertness, absence of reload/loadURL/restart and
polling call paths, unchanged workspace state, and unchanged renderer
`performance.timeOrigin` across real diagnostic activity. The focused test
drives real navigation-failure and renderer-gone events; only intended
bounded `requestAnimationFrame` and browser paint observation remain.

Next smallest reviewed slice: **C1.2 deterministic hydration-failure pairing
closure** — prove one authenticated project `reportHydrationFailed(revision,
stage,code)` produces exactly one correlated `hydration-failed` →
`lifecycle/render-failed` pair under the same exact `{windowId,surfaceId}`,
with matching metadata, no duplicate/synthesized record, and deterministic
ordering.

Current implementation checkpoint: the production pair already exists and the
neutral-project E2E observes both records. The narrow evidence correction
will assert exact counts, ordering, target identity, and revision/stage/code
matching around one report; no production change is expected.

The implementation checkpoint is now complete: the neutral-project E2E captures
the sequence immediately before one authenticated project hydration-failure
report and requires exactly one ordered `hydration-failed` then
`lifecycle/render-failed` pair under the same exact surface, with matching
revision/stage/code metadata. No production change was needed.

Reviewer checkpoint at exact pushed head
`d91608a841eddf824407a524ebb8ff3240d4c82e`: **SIGNED OFF** for deterministic
hydration-failure pairing. The reviewer confirmed one authenticated report
produces exactly one ordered `hydration-failed` then `lifecycle/render-failed`
pair under the same exact surface, with strictly increasing sequence values
and matching revision/stage/code metadata.

Next smallest reviewed slice: **C1.2 thrown renderer-exception/control-
survival closure** — fence one deliberate real main-world renderer exception,
prove its exact-surface `uncaught-error` record, then immediately prove the
developer-control plane remains responsive and the same renderer/document was
not implicitly recovered or replaced.

Implementation checkpoint: the neutral-project E2E adds a sequence-fenced
deliberate throw, exact-target assertion, immediate control query, and
unchanged `performance.timeOrigin`/document proof; no production change was
needed.

Reviewer checkpoint at exact pushed head
`25069086076fcbfc9930986375e2ac3ab3a20e50`: **SIGNED OFF** for C1.2 thrown
renderer-exception/control-survival closure. The reviewer confirmed the
sequence-fenced real throw, exact-surface redacted `uncaught-error`, immediate
control response, unchanged renderer/document identity, and no implicit
recovery.

Next smallest reviewed slice: **C1.2 no timer-based continuous polling /
recovery-side-effect closure** — prove that attaching, observing, failing, and
detaching visual observation never creates recurring polling loops, reloads or
restarts a renderer as diagnostic recovery, or mutates workspace/product
state, while allowing only intended bounded one-shot timing and animation-frame
mechanisms and cleaning up observers/listeners.

Implementation checkpoint: no production correction was needed. The focused
side-effect suite proves listener cleanup, inert post-detach behavior,
coalesced layout frames, bounded stable/timeout epochs, and no recurring
timer. Real navigation-failure and renderer-gone E2E evidence confirms the
renderer and workspace remain unchanged.

Reviewer checkpoint at exact pushed head
`7c6f2974af16566741495555c0c25e3c6c93a6a8`: **SIGNED OFF** for C1.2 no
timer-based continuous polling/recovery-side-effect closure. The reviewer
confirmed event-driven observation, bounded one-shot timing only, teardown
inertness, and absence of reload/restart recovery behavior.

Next smallest reviewed slice: **C1.2 deterministic hydration-failure pairing
closure** — prove one authenticated project `reportHydrationFailed(revision,
stage,code)` produces exactly one correlated `hydration-failed` then
`lifecycle/render-failed` pair under the same exact surface.

Reviewer checkpoint at exact pushed head
`d91608a841eddf824407a524ebb8ff3240d4c82e`: **SIGNED OFF** for deterministic
hydration-failure pairing. The reviewer confirmed one ordered pair, strictly
increasing sequence values, matching revision/stage/code metadata, and exact
surface authority.

Next smallest reviewed slice: **C1.3 semantic-key identity / surface-local
authority foundation** — define a strict bounded opaque semantic-key contract,
allow only predefined project-side registration/observation, reject duplicate
keys within one surface, allow the same key independently in two surfaces,
and expose only the smallest read-only inspection seam needed to inspect key
identity. No caller-provided selector, XPath, or script is allowed.

The user-owned `docs/evidence/worker-comparison.json` remains unstaged and
untouched; no release, install, package, or policy action is in scope.

## Architectural boundary / likely owner

Main-process visual observation service owns correlation and retention.

Sources:

**Electron/main**

* navigation events;
* DOM ready;
* load failure;
* render process gone;
* resource/network failure;
* first presentation state.

**Project preload / generic visual bridge**

* window error;
* unhandled rejection;
* project `state-hydrated`;
* project `hydration-failed`;
* stable-layout observer;
* paint observer.

Projects report hydration; Papers does not infer it from successful file reads.

## Lifecycle schema

One event stream:

```text
event: "visual.lifecycle"

payload:
  kind:
    "navigation-started" |
    "dom-ready" |
    "state-hydrated" |
    "first-paint" |
    "layout-stable" |
    "render-failed"
  windowId
  surfaceId
  projectId
  eventSeq
  observedAt
  renderCycleId
  navigationId
  revisions:
    workspaceTopologyRevision
    documentStateRevision?
  detail:
    stage?
    stabilityWindowMs?
    failureCode?
```

Diagnostics:

```text
event: "visual.diagnostic"

payload:
  kind:
    "console" |
    "uncaught-error" |
    "unhandled-rejection" |
    "navigation-failed" |
    "resource-failed" |
    "renderer-gone" |
    "hydration-failed"
  severity
  windowId
  surfaceId
  eventSeq
  renderCycleId?
  message
  source:
    category
    line?
    column?
  resource?:
    type
    scheme?
    host?
    status?
    errorCode?
```

## Hydration contract

Papers defines the generic signal only:

```text
reportStateHydrated({
  revision: opaque string,
  summary?: bounded string→integer map
})
```

and:

```text
reportHydrationFailed({
  revision?: string,
  stage: bounded enum/string,
  code: bounded string
})
```

Sender context determines the surface/project. The project cannot claim another `surfaceId` or `projectId`.

No state bytes cross this bridge.

## Layout-stable definition

Event-driven only:

* observe semantic/layout root changes using `ResizeObserver` / `MutationObserver` where appropriate;
* wait for fonts readiness when requested;
* require a short bounded unchanged geometry window across animation frames;
* emit one `layout-stable` for that render cycle;
* new mutations may begin a new layout epoch.

No perpetual interval.

If stability is not achieved before the bound, emit structured failure/degraded readiness rather than waiting forever.

## First-paint definition

Use an actual renderer paint/performance signal where available.

Do not define “first paint” as:

```text
DOM ready
load finished
state file loaded
```

Those are separate lifecycle facts.

## Security / redaction / authority

* console messages capped in length and count;
* token-like values, URLs with paths/query, filesystem-looking strings and known credential patterns redacted before control exposure;
* stack traces projected to safe function/line metadata rather than raw machine paths;
* resource failures expose resource type + safe origin/error, not complete URL;
* diagnostic buffers live only in memory unless an explicit report is requested;
* exact surface authority retained.

## Deterministic tests

* [x] lifecycle ordering for successful fixture;
* [x] navigation-started occurs before DOM-ready;
* [x] state-hydrated cannot be synthesized by Papers without a project signal;
* [x] first-paint independently observable;
* [x] layout-stable only after bounded geometric stability;
* [x] hydration failure produces `hydration-failed`/`render-failed`;
* [x] thrown renderer exception surfaces without killing control;
* [x] failed resource attributed to correct surface;
* [x] console of two same-project surfaces remains isolated;
* [x] renderer crash produces `renderer-gone`;
* [x] mixed visual events remain within the diagnostic-record cap with
  monotonic sequences and continued publication;
* [x] diagnostic buffers obey maximum length/count;
* [x] redaction tests reject secret/path leakage;
* [x] no timer-based continuous polling.

## Packaged live proof

Packaged neutral fixture has two modes:

1. successful hydration and render;
2. intentionally failed hydration/resource.

Prove the real packaged event sequence and that an agent can identify the failed stage without screenshot interpretation or source instrumentation.

## Reviewer gate

Reviewer must explicitly determine:

> Can an agent distinguish “document loaded”, “document hydrated”, “first pixels painted”, “layout settled”, and “render failed” as separate facts for one exact surface?

## Completion evidence

* exact event sequences from packaged success/failure fixtures;
* redaction test evidence;
* event buffer bounds;
* exact SHA and reviewer sign-off.

## Rollback / failure behavior

Visual listeners are observational.

If lifecycle instrumentation itself throws or becomes unavailable:

* mark observer state degraded;
* continue normal rendering;
* never fail project startup solely because diagnostics failed.

---

# C1.3 — Semantic element observation, capture.element and visual assertions

## User-visible capability

Agents can ask:

```text
Where is the graph?
Is it actually visible?
Is it clipped?
Is it underneath something?
Are these elements overlapping?
Is the foreground/background contrast acceptable?
Capture just this semantic element.
```

without DOM selectors or arbitrary JS.

## Architectural boundary / likely owner

Papers defines a generic semantic-key contract.

Projects opt elements into observation using stable semantic keys, for example conceptually:

```text
data-papers-visual-key="canvas.root"
data-papers-visual-key="toolbar.primary"
```

The key describes project semantics only to the project and tests. Papers treats it as an opaque stable identifier.

No Papers code knows what `canvas.root` means.

## API schemas

```text
capture.element
input:
  windowId
  surfaceId
  elementKey
  paddingCssPx?: 0..32

output:
  captureId
  element:
    key
    boundsCss
    boundsDevice
    visible
    visibilityReasons[]
    clipping
    overlapSummary
    contrast?
  png:
    artifactId
    size
    sha256
```

Generic semantic inspection:

```text
visual.inspect.elements
input:
  windowId
  surfaceId
  keys?: bounded array

output:
  layoutEpoch
  elements:
    key
    role?
    accessibleName?
    bounds
    visible
    clippedPercent
    opacity
    zEvidence?
```

Assertions are declarative:

```text
visual.assert
input:
  windowId
  surfaceId
  assertions:
    - kind: "visible"
      elementKey: ...
    - kind: "not-clipped"
      elementKey: ...
      maxClippedPercent: ...
    - kind: "inside"
      elementKey: ...
      containerKey: ...
    - kind: "no-overlap"
      a: ...
      b: ...
      maxIntersectionPercent: ...
    - kind: "min-contrast"
      elementKey: ...
      ratio: ...
```

No arbitrary expression language.

## Visibility model

A semantic element may be reported non-visible because of:

```text
display-none
visibility-hidden
opacity-zero
zero-area
outside-viewport
ancestor-clipped
covered-at-sample-points
detached
surface-hidden
```

“Visible” must therefore mean more than “DOM node exists”.

## Stable geometry

Bounds:

* measured only after a known layout epoch;
* relative both to surface viewport and owning window;
* include CSS-pixel and device-pixel representations;
* quantized consistently for deterministic comparisons;
* associated with the layout epoch that produced them.

## Contrast

Compute WCAG-style contrast only when foreground/background can be determined safely.

For gradients, images, transparency chains, or uncertain composition:

```text
contrast.status = "unknown"
```

Never fabricate a passing contrast value.

## Security / authority

* semantic key only, no caller-provided CSS/XPath selector;
* project DOM traversal remains predefined;
* accessible names/text capped;
* password/input values excluded;
* exact surface target;
* no arbitrary computed-style property access from control.

## Deterministic tests

* [x] semantic key collision rejected within one surface;
* [x] same semantic key in two surfaces remains surface-local;
* [x] hidden/display/opacity/zero-area cases are represented by bounded
  visibility reasons;
* [x] ancestor and viewport clipping are represented with clipped percentage;
* [x] overlap calculation remains surface-local and key-based;
* [x] element crop uses the accepted CSS viewport and actual PNG dimensions
  for non-1:1 scaling, and reports the exact clamped crop with bounded CSS
  padding;
* [x] conservative contrast is known only for opaque solid RGB pairs and is
  otherwise `unknown`;
* [x] geometry is invalidated at layout-epoch start and accepted only when its
  payload epoch matches the current stable epoch;
* [x] caller cannot supply selector/script;
* [x] fixed declarative `visual.assert` evaluates visible, clipping,
  containment, overlap, and minimum-contrast predicates with bounded failure
  reasons.
* [x] `visual.assert` returns explicit `geometry-unavailable` evidence during
  navigation or before a stable observation instead of treating empty/stale
  geometry as a missing element assertion.

## Packaged live proof

Packaged fixture intentionally contains:

* one visible element;
* one clipped element;
* one overlapping pair;
* one poor-contrast pair.

Agent captures and asserts each through control and receives the expected structured outcome.

## Reviewer gate

Reviewer asks:

> Can a caller diagnose geometry and visibility using stable semantic identities without obtaining general-purpose DOM execution?

## Completion evidence

* fixture assertion matrix;
* element PNGs;
* structured assertion output;
* redaction/schema proofs;
* exact SHA/sign-off.

Reviewer checkpoint: **SIGNED OFF** for the C1.3 semantic-key
identity/surface-local-authority foundation at exact pushed head
`d440466b87d4234339b3fb5dd0ac6845b0be7fa8` and for stable-epoch geometry at
`0d4447a58a4e8e0f0f2c17f53ae91582a96b98db`. The explicit unavailable-result
guard and live assertion coverage are at
`5f9e1b7a00001edd29a0c903d97869daa4f2ff5c`. Same-surface
`capture.element` cropping and its artifact-coordinate correction are
implemented at
`26963baad5e0457bb24de4e39a80445ade1afa49` with docs SHA
`b2fa135adfd6c0e7cca8eed5716c578aff7f2ab3`. No remaining capture-element
blocker was found. Duplicate observations are now rejected atomically at
`30f3f31c0b3d188beb51640c2a0de351b7f3ed9c` with docs SHA
`08fce721b29b18429f792a018e751f55104cd81f`. No remaining defect was found in
this slice. A dedicated exact-surface two-registry proof for same-key locality
is signed off at exact code/test SHA `1eb0e538faf6cce7bbba7eb1babbac6d456fd0af`
with docs SHA `2d4bf9a3b093e4ee757d82729ee380fc736ae0ed`.

## Rollback / failure behavior

Unknown/missing semantic key is an observation failure only.

No DOM mutation is performed to “make it observable”.

---

# C1.4 — Deterministic visual fixtures and screenshot baseline diffing

## User-visible capability

Visual regressions become reproducible, reviewable test failures instead of manual screenshot comparisons.

## Architectural boundary / likely owner

**Papers repository owns the fixture harness.**

Projects own their own fixture contents and baselines.

The generic harness controls:

```text
window dimensions
content dimensions
device scale factor
theme
transparency
locale
timezone where applicable
animation/transitions
font set
fixture data
startup route
render readiness contract
```

## Deterministic rendering profile

Define a versioned profile such as:

```text
visualProfileVersion: 1
window: 1280x800
deviceScaleFactor: 1
theme: light
transparency: false
animations: disabled
reducedMotion: true
locale: en-US
fixtureFont: pinned test font
```

Do not rely on whatever fonts/settings happen to be installed on the developer machine.

CI pixel baselines may use a deterministic rendering mode.

Real packaged acceptance remains separately required and should not pretend arbitrary user GPUs produce byte-identical pixels.

## Baseline structure

Each baseline is keyed by:

```text
fixtureId
captureTarget
visualProfileVersion
platform
electronMajor/minor as required
```

Manifest:

```text
baselineId
pngSha256
dimensions
semanticSnapshotSha256
createdFromCommit
visualProfileVersion
```

## Diff result

Produce at minimum:

```text
changedPixelCount
changedPixelPercent
maxBoundingDiffRect
perceptualScore
expectedDimensions
actualDimensions
diffPngArtifact
```

A semantic-layout failure and a pixel failure are reported separately.

## Intentional update workflow

No automatic baseline replacement.

Explicit update operation only, e.g. test tooling equivalent of:

```text
UPDATE_VISUAL_BASELINES=1
```

An update must:

1. preserve old baseline until new capture succeeds;
2. generate old/new/diff evidence;
3. record old/new hashes;
4. update atomically;
5. require normal code review.

A failing test must never silently “bless” its new screenshot.

## Security / data safeguards

* baselines contain synthetic fixture data only;
* no baseline is generated from creator user data;
* fixture directories are isolated temp profiles;
* diagnostic runs assert fixture source data hashes before/after.

## Deterministic tests

* [x] baseline core produces zero-diff evidence for identical RGBA images;
* [x] one known pixel mutation produces a deterministic diff rectangle;
* [x] dimension changes are reported separately from pixel comparison;
* [x] semantic snapshot changes remain separate even when pixels are identical;
* [x] update workflow requires explicit opt-in;
* [x] content-addressed PNG plus atomic manifest publication preserves the
  previous baseline until replacement is complete;
* [x] baseline reads re-hash the referenced PNG;
* [x] successful reads/replacements remove orphaned content-addressed PNGs and
  temporary files without deleting the manifest-referenced baseline;
* [x] baseline reads and updates share one serialized operation queue, so
  cleanup cannot delete staged files from an in-progress update;
* [ ] user profile/state directories are never baseline sources.

Implementation checkpoint: deterministic baseline/diff core and its integrity
corrections are prepared at `5e850881da809f9d301040ee1acddabe73c5aa43`.
The core preserves the previous manifest on interrupted publication, validates
PNG structure/dimensions, serializes updates, and cleans orphaned artifacts.
Reads and updates across all store instances use one process-wide serialized
queue, so filesystem aliases and differing path spellings cannot bypass the
lock; a deterministic two-instance race test proves a reader cannot delete
staged PNG or temporary manifest files.
Integration with a live capture command and a real fixture remains open; the
baseline/diff core itself is signed off at exact code SHA
`5e850881da809f9d301040ee1acddabe73c5aa43` with docs SHA
`6e04a7805814dd83b74917c9dec3046eaf6856c5`. The dedicated
`capture.element` slice has its own review gate.

## Packaged live proof

Use packaged executable against the same synthetic fixture.

Required proof is:

* correct fixture reaches lifecycle readiness;
* screenshot capture succeeds;
* semantic assertions pass;
* gross visual output matches expected dimensions/content.

CI baseline exactness does not replace this packaged test.

## Reviewer gate

Reviewer confirms:

> Are visual changes impossible to bless accidentally, and are baselines based only on deterministic synthetic data?

## Completion evidence

* baseline manifest;
* zero-diff run;
* intentional-diff run;
* update workflow evidence;
* packaged fixture result;
* exact SHA/sign-off.

## Rollback / failure behavior

Baseline write uses temp + atomic replacement.

Failure keeps the previous reviewed baseline.

---

# C1.5 — Bounded visual timeline + self-contained visual-debug report

## User-visible capability

An agent can request a compact record of:

> what state/lifecycle/diagnostic changes happened immediately before and during this bad render?

without recording the desktop continuously.

## Architectural boundary / likely owner

Visual observation service owns bounded per-surface ring buffers.

Data is captured from events already emitted by C1.1/C1.2/C1.3.

No polling loop and no continuous video recorder.

## Timeline model

Per exact surface maintain bounded recent history, for example:

```text
maxAge: 10 seconds
maxEvents: 256
maxDiagnostics: 128
```

Each item carries:

```text
eventSeq
observedAt
renderCycleId
navigationId?
workspaceTopologyRevision
documentStateRevision?
layoutEpoch?
kind
```

Explicit timeline request may include:

```text
beforeMs: <= 10000
until:
  "layout-stable" |
  "render-failed" |
  bounded duration <= 5000
frames:
  "lifecycle-only"
```

Lifecycle-only frames may capture at significant edges:

```text
navigation-started
state-hydrated
first-paint
layout-stable
render-failed
```

No 30/60 FPS capture.

## Report command

```text
visual.report.create
input:
  windowId
  surfaceId?
  include:
    windowCapture
    surfaceCapture
    semanticElements
    recentLifecycle
    recentDiagnostics
    timeline
  beforeMs
```

Output:

```text
reportId
artifactId
size
sha256
createdAt
manifestSummary
```

## Self-contained report format

A single ZIP-like artifact:

```text
manifest.json
process.json
snapshot.json
lifecycle.ndjson
diagnostics.ndjson
timeline.ndjson
window.png
surfaces/<surface-id>.png
elements/<semantic-key>.png
diff/...
```

Manifest includes hashes for every entry.

It contains **observations only**, never copied creator state files.

## Artifact store

Papers-owned diagnostics area only.

Rules:

* opaque artifact IDs;
* no arbitrary pathname reads;
* temp-write + atomic finalize;
* explicit TTL/cleanup;
* maximum artifact size;
* report generation never automatically uploads anything.

## Artifact retrieval

Control API:

```text
visual.artifact.read
input:
  artifactId
  offset
  maxBytes <= bounded chunk size

output:
  artifactId
  offset
  eof
  base64Chunk
  sha256
```

This works within the existing framed control transport without opening filesystem access.

## Security / redaction

* report creation is explicit;
* screenshots may contain visible user content and manifest marks that classification clearly;
* hidden document/state bytes excluded;
* diagnostics redacted before entering report;
* tokens/descriptor/install roots excluded;
* artifact IDs unguessable;
* artifact read limited strictly to artifacts generated by Papers.

## Deterministic tests

* [x] ring buffer age/count enforcement;
* [x] event revisions remain correlated;
* [ ] two surfaces do not mix timelines;
* [ ] lifecycle-only screenshot count bounded;
* [x] no timer polling;
* [ ] report manifest hashes verify;
* [ ] interrupted report leaves no exposed partial artifact;
* [ ] artifact reader cannot access arbitrary filesystem paths;
* [ ] expired artifact refused;
* [ ] no project state file included in report.

Implementation checkpoint: the bounded per-surface timeline store and
`inspect.visual.timeline` query are implemented at
[`c6435976`](https://github.com/Futahua/Papers-3/commit/c6435976bfd08470b0aedc1eabe52e348a503093).
The append path consumes only already-emitted diagnostic events, enforces the
256-event/10-second bounds, and carries render-cycle, document, layout, and
workspace-topology revisions. Report generation, artifact storage, packaged
proof, and the remaining isolation checks are still open.

## Packaged live proof

Packaged fixture intentionally fails after hydration.

Generate one report and prove it contains enough evidence to reconstruct:

```text
correct process/build
correct state revision
hydration success
subsequent render failure
bad screenshot
relevant diagnostics
exact surface identity
```

without adding temporary project UI instrumentation.

## Reviewer gate

Reviewer answers:

> Is this report sufficient for another session or another agent to diagnose the visual incident without access to transient desktop state?

## Completion evidence

Store:

* one synthetic successful report;
* one synthetic failed-render report;
* manifest verification;
* bounded-size proof;
* exact SHA/sign-off.

## Rollback / failure behavior

Report failure cannot affect active rendering.

Delete incomplete artifacts and return a structured report-generation failure.

---

# C1.6 — Full agent/control/MCP workflow + packaged closure

## User-visible capability

An MCP-connected agent can perform the complete safe workflow:

```text
identify exact process
subscribe to visual lifecycle
wait for event-driven readiness
capture exact surface
inspect semantic geometry
retrieve screenshot/report
diagnose failures
```

without:

```text
arbitrary JavaScript
Windows desktop clicking
raw filesystem access
temporary project instrumentation
continuous polling
path-string process guessing
```

## Architectural boundary / likely owner

The existing reviewed local control protocol remains the semantic authority.

The existing standalone MCP adapter remains transport-only.

New visual commands are added to the control catalog; MCP continues forwarding exact `{method,params}`.

Do not duplicate visual business logic inside MCP.

## Control command surface

Final expected visual command family:

```text
capture.window
capture.surface
capture.element

visual.inspect.elements
visual.assert

visual.report.create
visual.artifact.read
```

Event subscription extends the existing validated event mechanism with:

```text
visual.lifecycle
visual.diagnostic
```

No independent MCP event bus.

If MCP event subscription support is later needed, it consumes the same reviewed control event stream.

## Agent readiness workflow

Canonical workflow:

```text
inspect process identity
→ resolve explicit window/surface
→ subscribe
→ observe navigation-started
→ observe DOM-ready
→ observe state-hydrated
→ observe first-paint
→ observe layout-stable
→ capture.surface
```

If `render-failed` arrives at any point, the agent captures/report-generates immediately.

No loop that repeatedly asks “are we ready yet?”

## MCP/security rules

* one authenticated local Papers connection;
* strict existing control schemas;
* no control descriptor/token in MCP output;
* no arbitrary selector;
* no JS;
* no arbitrary file path;
* artifact reads only by opaque generated artifact ID;
* cancellation closes/revokes relevant control state as already established by B3;
* observation commands are read-only and need no destructive confirmation;
* future mutating visual-debug commands are out of C1.

## Deterministic tests

* [ ] MCP exact parameter pass-through for every visual command family;
* [ ] invalid/foreign surface refusal preserved;
* [ ] artifact chunk reconstruction yields expected SHA;
* [ ] MCP cannot turn element key into selector/script;
* [ ] lifecycle events remain correctly correlated with outstanding calls;
* [ ] cancellation during capture leaves no partial artifact and no continued operation;
* [ ] adapter contains no Papers visual business rules.

## Real packaged Electron acceptance

The final packaged acceptance must use the real packaged executable and real stdio MCP adapter.

Minimum scenario:

1. launch packaged Papers with isolated synthetic profile;
2. inspect process identity;
3. open deterministic fixture;
4. subscribe to lifecycle;
5. observe hydration + first paint + layout stable;
6. capture surface;
7. inspect/capture semantic element;
8. make one semantic geometry assertion;
9. create visual-debug report;
10. retrieve report through control/MCP artifact API;
11. verify report hashes;
12. close normally.

A second packaged fixture deliberately fails render and must produce an actionable failure report.

## Reviewer gate

Final reviewer question:

> Can a remote agent, using only reviewed control/MCP semantics, establish what exact Papers process is running and what the user actually sees, identify where rendering failed, and preserve enough evidence for another session—without mutating the user's data or gaining arbitrary execution/filesystem authority?

## Completion evidence

Final C1 closure records:

* all C1.x implementation and reviewed SHAs;
* protocol version/schema state;
* full unit suite;
* all focused visual suites;
* deterministic baseline suite;
* packaged success/failure E2E;
* MCP packaged E2E;
* artifact integrity proof;
* production audit;
* `git diff --check`;
* reviewer sign-off.

No release follows automatically from C1 completion.

## Rollback / failure behavior

The complete visual subsystem must be removable/disableable without changing ordinary Papers behavior.

If visual control is unavailable:

* Papers still opens and renders normally;
* no project is migrated/restarted;
* control returns “visual observation unavailable”;
* no creator data is touched.

---

# 3. As you Go companion track — project repository only

These tasks begin only when the corresponding generic Papers phase exists.

## AY-C1.1 — Generic hydration/revision integration

* [ ] Preserve the versioned `{state,revision}` state envelope through the existing fixed path.
* [ ] After successful decode/parse/normalization and model installation, report generic `state-hydrated` with the opaque revision.
* [ ] Optionally provide safe summary counters such as model/entity totals through the generic bounded summary map.
* [ ] On parse/decode/hydration failure, report structured `hydration-failed`.
* [ ] Never send raw serialized state through the visual diagnostics channel.
* [ ] Regression fixture proves non-empty source state cannot silently become an empty hydrated model without generating observable disagreement/failure.
* [ ] Hash fixture source state before/after; prove no mutation.

This specifically guards the class of defect fixed by `a247778`, but the implementation remains entirely project-owned.

## AY-C1.3 — Stable project semantic keys

Project chooses stable keys such as conceptual equivalents of:

```text
document.root
empty-state
primary-canvas
group.<fixture-key>
shortcut.<fixture-key>
```

Exact names are an As you Go decision.

* [ ] keys are stable across styling/refactors;
* [ ] they do not encode DOM selectors;
* [ ] fixture assertions verify expected semantic elements are visible and correctly bounded;
* [ ] Papers contains no knowledge of those keys.

## AY-C1.4 — Deterministic project fixture

Create synthetic fixed state representing a meaningful non-empty document.

For the historical failure class, the fixture should ensure:

```text
persisted model clearly non-empty
hydrated revision known
rendered semantic summary non-empty
visual graph visibly non-empty
```

The exact group/shortcut counts belong to the As you Go fixture, not Papers.

* [ ] no creator `state.json` copied or modified;
* [ ] deterministic theme/font/window profile;
* [ ] screenshot baseline;
* [ ] semantic geometry assertions;
* [ ] intentional baseline-update workflow.

## AY-C1.5 — Incident-style visual report regression

Synthetic regression intentionally injects a hydration/model failure and proves the generic report exposes:

```text
source/document revision
state-hydrated or hydration-failed
model summary
first-paint/layout state
visible screenshot
diagnostics
```

No temporary red box, visible counter, manual instrumentation, or Windows accessibility inspection should be required.

---

# 4. Incident-derived acceptance safeguards

These are explicit reviewer checks, not informal lessons.

## Process/restart safeguard

* [ ] every packaged visual report records PID;
* [ ] every report records process `appInstanceId`;
* [ ] every report records process start time;
* [ ] every report records build version/commit;
* [ ] every report records canonical executable file identity;
* [ ] junction/symlink alias spelling never establishes process sameness/freshness;
* [ ] a “fresh restart” claim without changed process start identity is rejected as evidence.

## Render-success safeguard

* [ ] document file presence is not render success;
* [ ] valid state JSON is not render success;
* [ ] topology membership is not render success;
* [ ] visible native surface is not render success;
* [ ] DOM-ready is not hydration success;
* [ ] hydration success is not first-paint;
* [ ] first-paint is not layout-stable;
* [ ] each fact has its own explicit evidence.

## Creator-data safeguard

Before and after any packaged diagnostic acceptance:

* [ ] snapshot/hash source fixture data;
* [ ] prove diagnostics did not modify it;
* [ ] reports contain observation copies/summaries only;
* [ ] no “fix by rewriting state” diagnostic path exists.

## Event-driven safeguard

* [ ] no background screenshot polling;
* [ ] no “check every 500 ms until ready” production mechanism;
* [ ] observers signal changes;
* [ ] callers wait on events with bounded timeout;
* [ ] timeline screenshots occur only on explicit lifecycle boundaries.

---

# 5. Persistent multi-session workflow

For every C1 implementation session:

1. [ ] Read `HERMES.md` and the current persistent progress/visual-observability plan.
2. [ ] Inspect branch/head/origin parity and dirty worktree.
3. [ ] Preserve all user-owned modifications.
4. [ ] Identify the single active C1.x gate.
5. [ ] Re-read the previous exact-SHA reviewer verdict.
6. [ ] Do not implement later phases opportunistically.
7. [ ] Run focused tests before changing the seam.
8. [ ] Keep Papers-generic logic free of project identities.
9. [ ] Keep project-specific fixtures/assertions in their own repositories.
10. [ ] Add control schemas concurrently with each new semantic capability.
11. [ ] Verify authority/redaction before adding MCP exposure.
12. [ ] Run typecheck + focused tests + full suite + build + packaged E2E + diff check as appropriate.
13. [ ] Record evidence using exact commit SHA.
14. [ ] Obtain explicit reviewer SIGNED OFF or concrete blocker.
15. [ ] Update the persistent checklist only after the reviewer verdict.
16. [ ] Do not release/install/package beyond the packaged test artifact required for acceptance unless separately authorized.

---

# 6. Milestone completion definition

C1 is complete only when all of the following are true:

* [ ] an agent can capture the actual window/surface pixels;
* [ ] capture is synchronized with topology/document/render revisions;
* [ ] process identity distinguishes stale vs genuinely fresh instances across path aliases;
* [ ] lifecycle exposes navigation → DOM → hydration → paint → stability/failure;
* [ ] renderer console/errors/resource/hydration failures are safely observable;
* [ ] stable semantic element bounds exist;
* [x] `capture.element` works without selectors/JS;
* [ ] visibility/clipping/overlap/contrast assertions exist;
* [ ] deterministic fixture rendering exists;
* [ ] baseline screenshot diff/update workflow is review-safe;
* [ ] bounded event-driven timelines exist;
* [ ] self-contained diagnostic reports exist;
* [ ] reports never contain creator state files or broad filesystem contents;
* [ ] MCP can use the same reviewed control semantics without gaining extra authority;
* [ ] successful and failing flows work in real packaged Electron acceptance;
* [ ] As you Go can consume the generic contract without any As-you-Go-specific logic appearing in Papers;
* [ ] diagnostics demonstrably do not mutate project data;
* [ ] no reviewed blocker remains.

**C1 completion means Papers can prove both what it believes the application state is and what the user actually sees.**
