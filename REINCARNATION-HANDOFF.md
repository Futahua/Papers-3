# Reincarnated Papers — Current Refactor Guardrail / Durable Handoff

> Historical handoff / proposal under [AGENTS.md](AGENTS.md), the sole governing document.
> Dated instructions and implementation limits do not override current creator direction.
> The current cleanup is docs/comments only; this file does not activate a code roadmap.

Read this before doing refactor work on branch `reincarnated-i-was-stargazing`.

This document is the current durable record for the reincarnation effort. It does **not**
replace the governing authority in `AGENTS.md` or current creator corrections.
It points back to the refactor north star and narrows it to the work we are doing now.

## North star

The architectural north star is the exact historical document:

- `REFACTOR-HANDOFF.md` at `Futahua/Papers-3` commit
  `251aa0bf9e9ba3fe336b3354c3cd4b7f972af5c6`
- durable URL:
  `https://github.com/Futahua/Papers-3/blob/251aa0bf9e9ba3fe336b3354c3cd4b7f972af5c6/REFACTOR-HANDOFF.md`

For AYG's detailed extraction sequence, also use:

- `backpacks/as-you-go/POST-FEATURE-REFACTOR-PLAN.md` at the same exact commit
- durable URL:
  `https://github.com/Futahua/Papers-3/blob/251aa0bf9e9ba3fe336b3354c3cd4b7f972af5c6/backpacks/as-you-go/POST-FEATURE-REFACTOR-PLAN.md`

The complete product vision leads [AGENTS.md](AGENTS.md): Papers is the creator's
personal programmable environment over Windows; technologies serve that experience.
The architectural principles supporting it are:

> **Maximum useful capability and excellent UX, without capability growth making the system
> progressively more brittle or expensive for coding agents to change.**

> **Capability is unbounded. Coupling is bounded.**

Primary maintenance metric:

> **How much unrelated code must an agent understand before safely changing one capability?**

## Why this branch exists

The earlier refactor line became a poor continuation base. It attempted to reconstruct a large
amount of accumulated product behavior in a new workspace in one day, then mixed architecture
movement with new browser work and subsequent repairs to regressions introduced by that work.

The reincarnation does **not** continue from that implementation.

It starts from the stable post-mortem product histories and replays only justified architectural
extractions while keeping accepted behavior authoritative.

Current clean behavioral bases when this document was created:

- Papers `reincarnated-i-was-stargazing` base:
  `716a386c1a456eb4393c446fcbe391416ce4da3b` (`post-mortem`)
- AYG `reincarnated-i-was-stargazing` base:
  `fb9885524a74ed254549ab6539e702a05c0bd7d0` (`post-mortem`)
- Faulty refactor checkpoint `251aa0bf...` is **reference/donor evidence only**, never the
  behavioral base.

## Highest-order reincarnation rule

> **Stable post-mortem behavior is the oracle. Refactor by moving ownership, not by re-solving
> already-working behavior.**

An implementation or repair from the faulty refactor is **not** evidence that the stable
post-mortem implementation has the same defect.

Before carrying any semantic change from the faulty refactor back into reincarnated:

1. reproduce the defect on the reincarnated/post-mortem baseline;
2. prove it is genuinely present there;
3. treat the correction as a separate behavior-fix slice, not as refactor plumbing.

If the defect cannot be reproduced on the stable baseline, do not port the repair.

## Blast-radius rule

Every slice begins with a blast-radius declaration **before editing**.

For that slice record:

1. the one authority/lifecycle/semantic decision being moved;
2. exact production files allowed to change;
3. exact shared/high-blast files that must remain untouched;
4. stable behavior that characterizes the before-state;
5. focused tests proving the moved seam;
6. the relevant full-project gate;
7. `git diff --name-only` confirmation that the change stayed inside the declared radius.

If a required edit unexpectedly crosses into a protected subsystem, stop the slice and reassess
instead of widening scope opportunistically.

## Protected behavior / no-incidental-change zones

These are currently working behavior and are **not refactor targets merely because nearby code
is being reorganized**.

### Browser — frozen unless the creator reports a browser defect

The post-mortem browser is working behavior and is the browser oracle.

Preserve, among other accepted behavior:

- Papers-owned durable Chromium tabs / `WebContentsView` lifecycle;
- source tabs surviving `window.open` / `target=_blank` child creation;
- real child-tab adoption rather than loading the child URL over the opener;
- existing Chromium/web-app session behavior;
- current Lens capture/crop/result flow;
- downloads, progress/bubble/drag behavior;
- ad blocking;
- current tab visibility, navigation, sizing and restoration behavior.

Do **not** reintroduce the faulty refactor's renderer-owned `<webview>` browser merely because
OpenChamber uses `<webview>`. OpenChamber's ownership model is evidence, not a drop-in design.

Protected browser implementation/wiring includes at least:

- `src/main/backpacks/webBrowserHostBridge.ts`
- browser operations inside `src/main/backpacks/fileCapabilityService.ts`
- AYG browser behavior in `public/app/file-capability-panel.js`

An unrelated refactor slice must not edit these.

### Filesystem / file capability — frozen semantics

The creator did not report the filesystem/file-preview capability as broken. Preserve existing
open/reveal/search/list/stat/copy/move/rename/delete/native-drag/preview behavior and its data
safety.

`fileCapability` is a **shared host seam**, even though AYG is currently the principal live
consumer. Therefore edits to it have a wider blast radius than an AYG-local module suggests.

High-blast filesystem/shared-host files include at least:

- `src/main/backpacks/fileCapabilityService.ts`
- `src/main/hostFacade.ts`
- `src/preload/backpackProject.ts`
- generic Backpack project runtime/hosting files.

Do not alter filesystem semantics as collateral work for a window-layout refactor.

### Other Backpacks — frozen unless explicitly in scope

Current other live Backpack projects include Proxima and Delegate Wave. AYG refactoring does not
authorize changing their implementation, lifecycle, storage, rendering, or host behavior.

Shared Papers host changes require explicit proof that other Backpack contracts remain unchanged.
Do not make AYG concepts universal merely because Papers hosts AYG.

### Generic Papers host/preload — high blast radius

Treat these as high-blast by default:

- `src/main/index.ts`
- `src/main/hostFacade.ts`
- `src/main/backpacks/backpackProjectRuntime.ts`
- `src/main/backpacks/backpackProjectService.ts`
- `src/preload/backpackProject.ts`
- shared IPC/security/surface registries.

They may be refactored later when the named authority genuinely lives there, but not as a casual
dependency of an AYG-local cleanup. Any slice touching them needs broader characterization and
full Papers validation.

## What the faulty refactor is allowed to donate

Primarily **architectural knowledge**, not replacement behavior.

Useful evidence includes already-demonstrated extraction patterns such as:

- candidate binding/recovery becoming one named AYG owner;
- membership decisions converging before mutation;
- widget presentation lifecycle separated from durable document authority;
- preview/picker lifecycle owners in Papers;
- explicit runtime ownership boundaries;
- local boundary tests that reduce required agent context.

These ideas must be replayed against the current stable source, not cherry-picked blindly when
their surrounding source assumptions have changed.

Refactor-only bug repairs are not automatic donors. Examples include movement/resize repairs or
browser repairs that became necessary only after the refactor changed those implementations.

## Current preferred sequence

Start with **low-blast, AYG-local ownership extraction** before shared Papers host work.

The first candidate remains the north star's original seam:

**AYG window-layout candidate binding/recovery**

Why:

- it is already proven stable inline on post-mortem;
- both attached and compact-widget list paths rely on the same semantics;
- it can be extracted without changing Papers host, browser, filesystem, Proxima or Delegate Wave;
- it directly embodies the `1858d28d` historical lesson;
- it has a narrow behavioral contract and can be tested independently.

Then continue one authority boundary at a time. Do not mechanically replay every old refactor
commit. Re-evaluate each slice against the current post-mortem source and this blast-radius rule.

Shared-host slices such as file capability runtime extraction are **deferred/high-risk** because
the creator explicitly wants working browser/filesystem/other-Backpack behavior protected.
They may be reconsidered only with characterization evidence proving behavior equivalence and a
clear maintenance benefit.

## Slice acceptance gate

A reincarnation slice is accepted only when all are true:

- creator-visible behavior is unchanged unless a separate behavior correction was explicitly in
  scope;
- the stable pre-slice path was characterized first;
- one coherent authority/lifecycle/semantic owner was extracted;
- equivalent callers converge on it;
- no second persistence/identity/lifecycle authority was introduced;
- superseded code for that exact seam is removed;
- focused behavioral tests pass;
- the relevant full project suite passes, with unrelated/environmental failures called out
  literally rather than hidden;
- changed production files stay inside the declared blast radius;
- browser, filesystem and unrelated Backpack behavior were not incidentally rewritten;
- a future agent needs less unrelated context for the same capability.

File count or line-count reduction is not an acceptance criterion by itself.

## Permanent history rule

The `1858d28d` lesson remains binding:

> **If a behavior demonstrably worked recently and regresses, compare history before inventing
> new architecture.**

For reincarnated work, strengthen it to:

> **If a regression appears only after an extraction, first assume the extraction failed to
> preserve the baseline. Do not reinterpret the regression as a missing product feature.**

## Non-authorization

This refactor does not authorize:

- browser redesign;
- filesystem behavior changes;
- modifying unrelated Backpacks;
- turning AYG behavior into a generic Backpack framework;
- changing durable creator data merely to accommodate code movement;
- release, packaging, installation, termination or restart;
- broad cleanup adjacent to the current seam;
- importing a faulty-refactor repair without proving the same defect on the stable baseline.

## Resume checklist

Before the next code edit on this branch:

## Definition of success

The goal is not to make Papers small.

Papers may grow to millions of lines and use many technologies. Success is that arbitrary useful
capability can continue to grow while **the unrelated context required for one safe change stays
bounded**, and proven user behavior does not repeatedly get destroyed in the process of making
the architecture easier to change.
