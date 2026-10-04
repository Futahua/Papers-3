# Papers Refactor — Durable Handoff / North Star

Read this before changing anything in this repository.

Workspace: `C:\Users\admin\Desktop\Papers-Refactored`

This file exists so a fresh agent can resume correctly if the current conversation dies,
loses context, or is replaced.

## What Papers is

Papers is not fundamentally an Electron app. It is the creator's **personal programmable
environment layered over Windows**: a sandbox/control layer that keeps the best tools,
applications, native machinery, agents, custom surfaces, scripts and behaviors under the
creator's fingers with minimal cognitive overhead.

Windows remains the compatibility substrate because the creator depends on Windows software
and the existing machine as-is. Papers may use Electron, C#, Win32 processes, Chromium,
external programs, local services, agents, remote systems, or future machinery. None of
those implementation choices define the product.

The creator does **not** code and does not want to become the maintainer or chief architect.
They state desired experience. Agents own architecture, implementation, migration, testing
and evidence.

Product goal:

> **Maximum useful capability and excellent UX, without capability growth making the system
> progressively more brittle or expensive for coding agents to change.**

## Highest-order rule

> **Capability is unbounded. Coupling is bounded.**

Architecture exists to preserve freedom, not veto behavior.

Do not impose purity rules such as “everything must run in Electron”, “every Backpack must
share one lifecycle”, “all state must use one model”, or “native Windows behavior is forbidden”.

If a current contract cannot support correct UX:

1. use an existing owner if it genuinely owns the truth;
2. widen that contract if the owner is still correct; or
3. introduce a new capability owner when the truth/lifecycle is different.

Do not make an unrelated subsystem quietly own the new truth.

## UX north star

The creator should normally only need to say things like:

- “When I click this, do that.”
- “When I type this, invoke that.”
- “This window should behave like this.”
- “This widget should disappear after reboot.”
- “This should be instant.”
- “Use the best existing app instead of recreating it.”
- “Do not sacrifice this behavior to make the architecture prettier.”

Implementation state must not leak into the creator's head. They should not need to reason
about candidate rows, renderer writer locks, hydration, IPC authority, CAS retries, HWND
lifetime, startup reconciliation, or which process owns an internal role.

Success means one user behavior requires understanding only the subsystem that owns it.

## Native resident machinery is valid

`window-control.cs` is a key example.

It is a resident native Windows control process with global low-level mouse and WinEvent
hooks, pre-registered window identities, QPC physical mouse-down timestamps, and the ability
to act without waiting for a renderer click round-trip.

That is not an architectural embarrassment. It is the correct locality when timing and truth
live at the Windows input layer.

Prefer:

`physical input -> resident native machinery -> Windows action`

when that is the correct path, instead of forcing:

`mouse -> renderer -> IPC -> Electron main -> helper -> Windows`

for uniformity.

## Backpacks

Backpacks are independently evolvable compositions of behavior and presentation. They may
have completely different UI, storage, lifecycle and implementation.

Do not invent a universal Backpack ontology merely because this refactor introduces cleaner
boundaries.

Useful long-term model:

- **capabilities/authorities** own reusable truths or operations;
- **Backpacks** compose capabilities into specific experiences;
- **presentation surfaces** display/request behavior but do not automatically become state
  authorities.

A capability does not become product-wide merely because two Backpacks happen to use
something similar. Share only after demonstrated reuse.

## Why this refactor exists

The current system is still viable, but the **regression radius is too large**.

The warning sign is not file size alone. Small user-facing changes increasingly require agents
to understand unrelated lifecycle, state and authority systems, and new features break old
behavior.

Because essentially all coding is delegated, the architecture must be **agent-operable**.

Primary maintenance metric:

> **How much unrelated code must an agent understand before safely changing one capability?**

Target: one named owner, narrow contract, explicit lifecycle, local failure, boundary tests.

## Camel's-back incident: AYG 1858d28d

Treat this as a permanent lesson.

Recovery commit:

`1858d28d1d7416c3552206a882fb22bd71719eb8`

Sequence:

1. Oct 2 merge `a123d8f` touched 62 files / about 9,547 changed lines.
2. Conflict resolution silently selected an older Sep 24 widget-picker implementation.
3. That old path discarded the exact chooser row before candidate binding.
4. The working Oct 1 path retained the row so stale short-lived candidate ids could be
   relisted/rebound safely.
5. Agents treated the broken current code as intentional architecture.
6. A speculative widget-local versioned-load/CAS/retry persistence path was invented around
   the symptom.
7. The creator remembered that the behavior had worked recently and forced a historical
   comparison.
8. `1858d28d` deleted the speculative direct-CAS detour and restored the known-good
   row-preserving path.

Permanent rule:

> **If a behavior demonstrably worked recently and regresses, compare history before
> inventing new architecture.**

Also:

> **Different UI/discovery paths for the same semantic action must converge before identity,
> mutation and persistence.**

## Authority defaults

These are defaults, not cages:

- One owner per truth.
- Presentation is not authority.
- AYG durable document state has one durable writer/store authority.
- Native window identity belongs at the native/window capability boundary.
- Physical-input timing belongs near resident native input machinery.
- A compact widget may request/display AYG behavior; widget existence must not redefine
  document authority.
- Preview failure disables preview, not workspace state.
- Native-control failure disables that operation, not unrelated durable state.
- Different languages/processes are acceptable.
- Delete superseded paths once the replacement is proven.

## Imported source baselines

Clean current snapshots imported on 2026-10-03:

- Papers: `cdc13bbe4b76ff1779a71e3bfc2bfc8fa16654c6`
- As you Go: `1858d28d1d7416c3552206a882fb22bd71719eb8`
- Proxima: `69fdaf630c5a7c06ff9bc1ff8c65bca29730a009`
- Delegate Wave Backpack: `f48b8346fa290fb27e526de1d02e08a2ef5f2001`

Workspace layout:

- `apps/papers`
- `backpacks/as-you-go`
- `backpacks/proxima`
- `backpacks/delegate-wave`

These are source baselines only, not proof of the installed runtime.

The Local Lapdog machine currently exposes only `C:`. The creator's `D:` runtime/source
paths are not mounted through this connector, so current source was pulled from GitHub.

## Delegate Wave continuity

Delegate Wave is the projection/UI over Local Coder's durable workstream journal.

Current rule:

- one stable `workstream_token` = one actual ChatGPT conversation/workstream;
- every tool-using user turn starts with `turn_begin`;
- first Local turn in a genuinely new chat uses `new_workstream=true`;
- later turns reuse the prior `workstream_token`;
- each turn gets a fresh `turn_token`;
- missing both identities fails closed;
- stale/unended turns remain history/waiting state instead of fake parallel LIVE sessions;
- tool/session activity is persisted immediately.

Authoritative admin projection:
`http://127.0.0.1:3001/api/activity/workstreams`

Delegate Wave UI:
`http://127.0.0.1:4317/`

Preserve this workstream continuity in later turns.

## Migration strategy: strangler, not clean-room rewrite

The creator uses Papers every day. Do not create a flag-day replacement.

For each slice:

1. identify one behavior/authority boundary;
2. characterize current required behavior;
3. extract one coherent owner behind an injected contract;
4. route semantically equivalent callers through it;
5. run focused tests;
6. run the relevant project's full suite;
7. delete the superseded path in the same slice;
8. move to the next boundary only after the slice is proven.

Moving code into more files is not success by itself.

## First planned slice

**AYG window-layout picker candidate binding/recovery.**

Why first:

- it is the exact seam implicated by `1858d28d`;
- the logic currently sits inside the ~400k workspace composition root;
- attached and compact-widget list paths both depend on it;
- it has a precise behavioral invariant.

Behavior to preserve:

1. candidate ids are short-lived;
2. retain the exact chooser row across async bind;
3. first call `bindWindowCandidate(candidateId)`;
4. only on typed `missing`, relist;
5. rebind only when exactly one unambiguous title/application match exists;
6. duplicate/ambiguous matches fail closed;
7. after binding, exact persisted descriptor/window identity decides add/remove;
8. attached and widget list paths use the same binding/recovery implementation;
9. both converge on the existing single durable writer path;
10. do not create another widget-local persistence authority.

Planned implementation:

- extract binding/recovery from `public/workspace-20260730b.js` into one
  dependency-injected AYG module;
- add behavioral tests for fresh bind, stale-id recovery, ambiguous refusal and exact-row
  preservation;
- switch attached and widget list callers to the module;
- keep writer/membership semantics unchanged in this slice;
- run focused tests and full AYG suite.

## Later likely slices

Order may change based on evidence.

- Converge AYG identity/membership policy so Auto/manual/widget paths share identity semantics
  before mutation.
- Isolate widget presentation lifecycle from durable document authority.
- Reduce the AYG workspace root by coherent lifecycle/authority domains, not arbitrary chunks.
- Decompose Papers' large main composition root by real ownership domains: native/window
  control, preview, Backpack hosting, diagnostics, persistence, etc.
- Introduce a minimal capability registry/runtime **only when real extracted capabilities need
  it**. Do not build a speculative universal framework.
- Keep Proxima on a strangler path: stable command/data facade first, implementation swap
  underneath later.
- Delegate Wave is not a rewrite target; preserve it as the projection over Local Coder's
  durable journal.

## Tests / evidence

Tests should protect behavior and ownership, not fossilize implementation trivia.

Prefer tests that prove:

- one owner for an authority;
- ambiguous identity fails closed;
- missing capability fails locally;
- lifecycle start/stop is explicit;
- equivalent UI paths converge;
- failures do not mutate unrelated durable state;
- history regressions like the lost chooser-row invariant cannot return.

A slice is complete only when:

- behavior is preserved;
- old path is removed;
- regression radius is smaller;
- tests prove the boundary;
- a future agent needs less unrelated context.

## Explicit non-authorization

Do not do these without a new explicit instruction:

- install or replace live Papers;
- terminate/restart live Papers;
- publish/release;
- mutate creator data;
- invent a universal Backpack ontology;
- sacrifice legitimate UX/capability to satisfy an abstraction;
- turn the creator into the architecture/configuration operator;
- treat retired UniversalBox work as current architecture;
- infer current product direction from obsolete Hermes/Apers history;
- create parallel authority paths merely to get a feature working.

## Resume checklist

A fresh agent must:

1. read this file completely;
2. read root `AGENTS.md` if present;
3. read local project instructions before changing an imported project
   (`apps/papers/HERMES.md`; AYG `README.md` and `ARCHITECTURE.md`);
4. check root Git status and preserve in-progress work;
5. confirm baseline/refactor commits before assuming state;
6. continue the current migration slice rather than start a new architecture experiment;
7. preserve Delegate Wave workstream continuity;
8. keep progress visible;
9. leave the live installation alone unless separately authorized;
10. inspect history first when a regression reportedly worked recently.

## Definition of success

Papers may become much larger and more technologically heterogeneous.

Success is **not** small code or few technologies.

Success is:

> The creator can keep adding arbitrary useful behavior while the amount of unrelated system
> an agent must understand for one change stays bounded.

User-side cognitive load and agent-side cognitive load are the same architectural problem
viewed from opposite sides.

## Current refactor progress — 2026-10-03

Baseline/handoff checkpoint committed as root commit 8503f50.

First migration slice committed as 379d079 (extract AYG window candidate binding recovery):

- added public/app/window-layout-candidate-binding.js as the sole owner of short-lived
  chooser candidate binding/recovery;
- removed the inline binder from public/workspace-20260730b.js;
- attached and compact-widget list paths now call the same injected binder;
- added window-layout-candidate-binding.test.mjs with fresh-bind, stale-id recovery,
  ambiguous fail-closed, application-label disambiguation, and no-row/no-guess tests;
- wired that test into AYG's explicit npm test list;
- focused syntax + behavior run: **57/57 pass**;
- full AYG run: **1679/1680 pass**. The only failure is environmental and pre-existing for
  this connector machine: test.mjs requires D:\Programs\CLIP STUDIO PAINT\CLIPS.bat,
  while Local Lapdog exposes only C:\. No refactor-related test failed.

Second migration slice committed as e4b17be (converge AYG bound window membership decisions):

- extended windowLayoutPickForBoundCandidate with an explicit toggle/remove intent so bound
  window membership has one semantic decision before durable writer coordination;
- attached toggle, attached explicit remove, and compact-widget list paths all route through
  that same decision;
- deleted the separate remove-only helper, which also removed a latent runtime defect where
  that path referenced an undefined identity helper and was called without a workspace import;
- explicit remove is proven unable to turn an absent window into an add;
- focused syntax + window-layout run: **58/58 pass**;
- full AYG run: **1680/1681 pass**. The only failure remains the known environment-only
  D:\Programs\CLIP STUDIO PAINT\CLIPS.bat check on this C:-only connector machine.

Third migration slice committed as 052e927 (extract AYG native widget presentation lifecycle):

- verified first that widget ready/dispose presence is already local and intentionally
  ungated from writer election; durable commands/snapshots remain writer-authoritative;
- extracted native widget open success, bounded retry, and startup-open selection into
  public/app/window-layout-widget-lifecycle.js;
- the lifecycle receives only presentation inputs and has no store, revision, membership,
  or document-writer interface;
- direct user opens still activate normally; startup opens remain activate:false;
- focused widget/workspace run: **93/93 pass**;
- full AYG run: **1684/1685 pass**, with only the same environment-only CLIP STUDIO check.

Delegate Wave local projection correction on the Lapdog machine was also validated separately:
typecheck passes and **92/92 tests pass**. It now projects turn_progress from the durable
journal's visible_report_text, suppresses duplicate tool_executed receipts and raw guard JSON,
and renders concise tool rows. That project had pre-existing unrelated dirty work, so this
handoff records the validated local change without claiming a clean standalone commit.

First Papers host-side seam committed as 2716175 (centralize Papers preview owner lifecycle):

- added backpacks/previewOwnerGroup.ts so main/index.ts no longer repeats the concrete preview
  engine set for owner close/visibility/bounds/raise lifecycle;
- provider-specific preview implementations remain unchanged and file capability behavior is
  untouched;
- added focused unit coverage for lifecycle fanout and empty-provider fail-local behavior;
- adapted the existing window-helper provenance tests to use Git's checkout prefix so their
  exact staged/HEAD blob proof remains valid when Papers is embedded below this refactor root;
- Papers typecheck passes;
- full Papers unit suite: **1334 pass / 8 skipped / 0 fail**.

Second Papers host-side seam committed as 1cdd09f (extract Papers file preview capability runtime):

- added backpacks/fileCapabilityRuntime.ts as the owner of concrete file/preview engine
  construction, preview-protocol resources, and provider disposal;
- main/index.ts now receives only fileCapability plus previewOwners instead of constructing
  Everything/Revit/shell-thumbnail/Calibre/AutoCAD/Mlight/PowerPoint/Windows/PDF/HTML/web
  preview implementations itself;
- the runtime still receives Papers' window resolver explicitly; it does not gain window or
  Backpack authority beyond the preview/file capability it owns;
- Papers typecheck passes;
- full Papers unit suite remains **1334 pass / 8 skipped / 0 fail**.

Third Papers host-side seam committed as 338dc1f (extract SlopTop picker file transport):

- extracted the SlopTop Direct Pick filesystem signal transport from main/index.ts into
  windows/slopTopPickerFileTransport.ts;
- picker semantics, capability binding, result validation and cancellation policy remain in
  slopTopPickerProtocol; the new module owns only signal paths, atomic writes, BOM-tolerant
  JSON reads and cleanup;
- focused transport tests: **3/3 pass**;
- Papers typecheck passes.

Window interaction journal reliability slice committed as ea1f777:

- the default parallel Papers suite exposed a pre-existing Windows write flake where exactly
  one bounded diagnostic record could be silently dropped because record() swallowed a failed
  fixed-temp rename replacement;
- journal writes now use unique temp names and a Windows-safe overwrite fallback while keeping
  the same bounded/redacted record contract;
- focused journal test passed **5 consecutive runs**;
- Papers typecheck passes;
- full default parallel suite passed **twice consecutively: 1337 pass / 8 skipped / 0 fail**.

Fourth Papers host-side seam committed as c9ef08d (centralize Papers window capability runtime):

- added windows/windowCapabilityRuntime.ts as the single lifecycle owner for the semantic
  window-capability service plus the resident native window-control broker;
- the broker remains resident native machinery and keeps all existing low-latency behavior;
  it simply stops leaking as a separately coordinated bootstrap authority;
- window capability IPC registration is owned by the runtime;
- picker and window-dock callers still consume the same WindowCapabilityService contract;
- runtime stop drains both the semantic service and resident broker exactly once;
- focused runtime test: **1/1 pass**;
- Papers typecheck passes;
- full default parallel suite: **1338 pass / 8 skipped / 0 fail**.

Fifth Papers host-side seam committed as 6dcd4b6 (extract Papers candidate picker document):

- extracted the native candidate-picker document/CSS/interaction script from main/index.ts
  into windows/candidatePickerDocument.ts;
- the new module is presentation-only: native window/session lifecycle, peek behavior,
  capability binding and picker authority remain outside it;
- candidate JSON stays in one escaped data island; markup-capable titles are regression-tested;
- existing candidate-picker shell-contract tests now read the new presentation owner rather
  than freezing the old composition-root location;
- focused picker tests: **4/4 pass**;
- Papers typecheck passes;
- full default parallel suite: **1340 pass / 8 skipped / 0 fail**.

Sixth Papers host-side seam committed as 1f31ec9 (centralize Papers candidate picker signal parsing):

- added windows/candidatePickerSignal.ts as the single fail-closed parser for candidate-picker
  preload IPC and the legacy/navigation signal path;
- unknown fields/actions, oversized ids, wrong hosts, malformed URLs and stale candidate ids
  now converge through one tested contract instead of separate inline checks;
- the parser returns semantic picker intents only; native picker lifecycle and window
  capability authority remain outside it;
- focused signal + shell-contract tests: **5/5 pass**;
- Papers typecheck passes;
- full default parallel suite: **1343 pass / 8 skipped / 0 fail**.

Proxima architecture reassessment: deliberately **no code change**.

- DATA-PLANE.md's intended strangler seam is already real, not aspirational;
- app.js has one cockpit command helper and exactly one Store.command mutation call;
- direct localStorage access is confined to store.js (board implementation + cockpit prefs);
- therefore the future SQLite/HTTP service can replace Store internals without another UI
  mutation path. Adding another façade now would duplicate the boundary rather than improve it.
- Open finding #19 (bad-read recovery still allows a later overwrite) remains a product/recovery
  UX decision, not something to hide inside this maintainability refactor.

AYG CLIP action-path note: this connector machine has a Desktop CLIP STUDIO PAINT shortcut
pointing to the installed app under C:\Program Files\CELSYS, but no CLIPS.bat exists. The AYG
source action still intentionally points at D:\Programs\CLIP STUDIO PAINT\CLIPS.bat, so the
single AYG full-suite failure on this machine remains an environment/path mismatch; do not
rewrite the product action merely to manufacture a green count.

Fourth AYG refactor slice committed as 31d6824 (separate shared document merge policy):

- extracted the pure three-way shared-document merge policy from
  public/app/workspace-surface-coordinator.js into workspace-surface-merge.js;
- snapshot merge policy, prompt-tree/stable-id merge logic, keyed/set merges and stripping of
  surface-local navigation fields now live together;
- writer election, forwarding, mutation ACK/cancellation, conflict recovery and host CAS stay
  in the coordinator and retain authority;
- coordinator tests import mergeSurfaceSnapshots from its new owner, proving the seam directly;
- focused coordinator suite: **78/78 pass**;
- full AYG suite: **1684/1685 pass**, with only the known CLIP action-path environment failure.

Seventh Papers host-side seam committed as b1d8a29 (extract Papers hover preview presentation):

- added windows/hoverPreviewPresentation.ts as the pure owner of hover-preview signature,
  window geometry/clamping and HTML/title escaping;
- focused presentation tests: **4/4 pass**;
- Papers typecheck passes;
- full default parallel suite: **1347 pass / 8 skipped / 0 fail**.

Eighth Papers host-side seam committed as 3a62873 (centralize Papers hover preview window lifecycle):

- added windows/hoverPreviewWindowManager.ts as the owner of hover-preview BrowserWindow
  creation, one-window-per-sender reuse, repaint revisioning, sender cleanup and shutdown disposal;
- main/index.ts now asks one manager to show/hide project and compact-widget previews instead
  of carrying preview-window maps and lifecycle inline;
- the manager consumes the separate pure presentation module; presentation policy and native
  lifecycle stay distinct;
- focused preview presentation + lifecycle tests: **6/6 pass**;
- Papers typecheck passes;
- full default parallel suite: **1349 pass / 8 skipped / 0 fail**.

Ninth Papers host-side seam is validated and ready to commit:

- added windows/candidatePickerWindowManager.ts as the owner of native candidate-picker
  BrowserWindow/session lifecycle, reuse, loading delivery, outside-click dismissal, bounded
  peek timing, preload signal routing and cleanup;
- main/index.ts now delegates show/update/dismiss to that manager instead of carrying the
  complete picker lifecycle inline;
- window identity, candidate binding and preview release still come from WindowCapabilityService;
  the picker manager does not become a second window authority;
- existing candidate-picker document/signal contract tests were repointed to the manager where
  lifecycle now lives rather than weakened;
- focused candidate-picker tests: **7/7 pass**;
- Papers typecheck passes;
- full default parallel suite: **1349 pass / 8 skipped / 0 fail**.

Ninth Papers host-side seam committed as 79a4c8d (centralize Papers candidate picker window lifecycle).

Testable build checkpoint on 2026-10-04:

- production electron-vite build succeeds;
- electron-builder --win --dir succeeds and produces
  apps/papers/release/win-unpacked/Papers.exe;
- packaged executable size: 225,821,696 bytes;
- packaged executable SHA-256:
  d25e55cbbb76b365ae2c1234ee0719c3baa6dacd02ae385a58e8d13dcaf3c92a;
- isolated packaged startup smoke passes: one visible Papers BaseWindow is created and the
  packaged file:// renderer loads from app.asar;
- the packaged build was smoke-tested with PAPERS_TEST_USER_DATA pointing to a temporary
  directory, so no live creator data was touched;
- ordinary manual launch from this win-unpacked directory uses the sibling release/Data
  directory by Papers design, keeping this refactor build isolated from another installed copy.

Current automated gates before packaging:

- Papers typecheck: pass;
- candidate-picker focused tests: **7/7 pass**;
- full Papers unit suite: **1349 pass / 8 skipped / 0 fail**;
- package startup smoke: pass.

Two old product-shell E2E assertions and one startup-hydration assertion are stale against the
current product contracts rather than failures introduced by this refactor: one still asserts
iframe-hosted Backpack presentation, another is explicitly written around retired Hermes/old
empty-Backpack copy, and startup-hydration rejects preserved surfaceKey values even though the
current durable topology intentionally keeps stable surface keys. Do not make current product
behavior regress merely to satisfy those historical assertions; refresh those E2Es separately.

Backpack integration follow-up on 2026-10-04:

- the isolated packaged Papers build initially had no Backpack registry or project bindings, so
  imported Backpack source alone did not make AYG, Proxima or Delegate Wave usable;
- AutoHotkey v2 is installed on this machine and the creator's Startup sloptop_engine.ahk is
  already running;
- the current Delegate Wave UI is the ChatGPT-local journal projection backed by Local Coder
  on port 3001, not the retired port-47321 control workflow;
- Papers' Delegate Wave relay now has one read-only activity.journal operation pinned to Local
  Coder's /api/activity/workstreams endpoint, usable without the retired operator token, while
  all existing privileged legacy operations retain their token requirement;
- the permitted Delegate Wave Backpack identity defaults to the creator-owned stable id
  bp-a5d07080-7210-45e6-b3f1-93978873a2fe and is still derived from the papers-backpack origin,
  never page-supplied;
- Papers typecheck passes, focused Delegate Wave relay tests are **18/18**, and the full Papers
  suite after this relay change is **1350 pass / 8 skipped / 0 fail**;
- the current external Delegate Wave checkout was separately updated so its dev build still
  reads /local-api while a papers-backpack launch requests activity.journal through Papers;
  its typecheck/tests/build:public pass. Do not claim that external checkout as a clean root
  refactor commit because it contains its own independent history/work.

Post-mortem browser behavior parity and account-login compatibility on 2026-10-04:

- the original Papers-3 and AYG `post-mortem` branches remain authoritative and untouched;
  behavior is ported into this laptop refactor, never the reverse;
- durable Chromium tabs, 3-live-renderer hibernation/history restore, AYG persistent tab UI,
  Google Lens, downloads, Ghostery toggle and browser-capabilities-v2 are present here;
- a later post-mortem compatibility round had been missed by the first parity port. It found
  that the ads+tracking Ghostery preset broke real X account authentication, so this build now
  uses the ads-only preset instead;
- Chromium `storage-access` is allowed in the dedicated persistent browser partition so account
  and SSO flows can regain cookie/site-storage access; camera, microphone, geolocation,
  notification and other permissions remain denied by default;
- live browser tabs use `setBackgroundThrottling(false)`. The concrete prior regression was
  ChatGPT stalling/"hit a snag" while the Lens overlay occluded the browser; the 3-live-tab cap
  plus hibernation remain the memory-control mechanism instead of throttling a live tab;
- focused account-compatibility/browser-host tests: **4/4 pass**;
- Papers typecheck: pass;
- full Papers suite: **1353 pass / 8 skipped / 0 fail**.

Next deployment step: rebuild the isolated `release-parity` Papers package, copy
AYG/Proxima/current Delegate Wave runtime roots beside the package, seed only that package's
UTF-8/no-BOM registry/project bindings, remap only packaged AYG action targets to working local
paths, and reopen it for real X/ChatGPT login testing. Do not mutate installed/live Papers data
or either original repository branch.
