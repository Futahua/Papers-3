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

First migration slice is implemented but not yet committed at the time of this note:

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

Before continuing, inspect the root diff and commit this slice if it still matches the above.
