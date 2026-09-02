# C1 — First-Class Visual Observability and Agent-Driven Visual Debugging

Last updated: 2026-09-02
Persistent status: C1.1 foundation in progress; renderer capture not started
Working branch: `agent/surface-context-routing`

This document replaces the completed workspace/control agenda at this path. The prior A3/B2/B3 completion record remains available in Git history. Read [`../HERMES.md`](../HERMES.md) before acting, preserve user-owned worktree changes, and advance only one reviewed C1.x gate at a time.

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
* [ ] implement the bounded renderer observation and native PNG capture.
* [ ] expose the first read-only `capture.surface` command only after the
  synchronized service exists.

Implementation checkpoint: local focused tests
`tests/unit/visualObservation.test.ts` (12/12) and
`tests/unit/papersControlProtocol.test.ts` (21/21) pass, and `npm run typecheck`
passes. This is not C1.1 completion; the remaining unchecked items are the
user-visible capture and packaged proof.

Reviewer checkpoint: **SIGNED OFF** for the process-identity/fence foundation
at pushed head `58b27f6cb7ef4dca1a9ef2f99dbd06c7d1d0c468`. The reviewer found no
remaining defect in this narrow slice after the `dev:0n` correction. Source was
inspected from the pushed branch; validation reported 34/34 focused tests,
typecheck, and `git diff --check`. Renderer capture/API remain intentionally
unclaimed and are the next C1.1 work.

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
* [ ] attribute real resource failures through `session.webRequest` to an exact
  monitored WebContents/surface; the adapter does not claim a nonexistent
  WebContents event.
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
* [ ] expose event subscription and resource attribution through the
  authenticated control plane.

Implementation checkpoint: `tests/unit/visualDiagnostics.test.ts` passes 6/6;
`tests/unit/visualLifecycleMonitor.test.ts` passes 3/3;
the full host suite passes 761/761 with 4 skipped across 68 files; typecheck and
diff check pass. This is not C1.2 completion; project-frame routing, resource
attribution, event subscription, and broader control exposure remain unchecked.

Reviewer checkpoint: **SIGNED OFF** for the lifecycle adapter at
`efd24422296d9b64c974dcb3b97073d0629e25b0` and for the host-composition/control
slice at `730e3ab2659cc66ff910635dd8376f8b4a09da4c`. The final host review found
no remaining defect after the exact `isMainFrame === true` correction. The
reviewer specifically confirmed opt-in composition, close cleanup, exact target
authority, schema revalidation, bounded/redacted records, and no polling or
recovery side effects. Resource attribution and project-frame routing remain
explicitly unclaimed.

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

* [ ] lifecycle ordering for successful fixture;
* [ ] navigation-started occurs before DOM-ready;
* [ ] state-hydrated cannot be synthesized by Papers without a project signal;
* [ ] first-paint independently observable;
* [ ] layout-stable only after bounded geometric stability;
* [ ] hydration failure produces `hydration-failed`/`render-failed`;
* [ ] thrown renderer exception surfaces without killing control;
* [ ] failed resource attributed to correct surface;
* [ ] console of two same-project surfaces remains isolated;
* [ ] renderer crash produces `renderer-gone`;
* [ ] diagnostic buffers obey maximum length/count;
* [ ] redaction tests reject secret/path leakage;
* [ ] no timer-based continuous polling.

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

* [ ] semantic key collision rejected within one surface;
* [ ] same semantic key in two surfaces remains surface-local;
* [ ] hidden/display/opacity/zero-area cases;
* [ ] ancestor clipping;
* [ ] viewport clipping;
* [ ] overlap calculation;
* [ ] element crop corresponds to reported device bounds;
* [ ] contrast known/unknown behavior;
* [ ] layout epoch change invalidates stale geometry;
* [ ] caller cannot supply selector/script.

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

* [ ] identical fixture produces zero diff;
* [ ] one known visual mutation produces deterministic diff;
* [ ] dimension change separately detected;
* [ ] semantic geometry failure detected even when pixel threshold might tolerate it;
* [ ] update workflow requires explicit opt-in;
* [ ] interrupted update leaves previous baseline intact;
* [ ] baseline manifest hash matches PNG;
* [ ] user profile/state directories are never baseline sources.

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

* [ ] ring buffer age/count enforcement;
* [ ] event revisions remain correlated;
* [ ] two surfaces do not mix timelines;
* [ ] lifecycle-only screenshot count bounded;
* [ ] no timer polling;
* [ ] report manifest hashes verify;
* [ ] interrupted report leaves no exposed partial artifact;
* [ ] artifact reader cannot access arbitrary filesystem paths;
* [ ] expired artifact refused;
* [ ] no project state file included in report.

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
* [ ] `capture.element` works without selectors/JS;
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
