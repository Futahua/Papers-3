# Papers — consequential decisions

> Reference / evidence under [AGENTS.md](../AGENTS.md), the sole governing document.
> Dated instructions and implementation limits do not override current creator direction.
> The current cleanup is docs/comments only; this file does not activate a code roadmap.

## Creator clarification — Backpack projects stay outside Papers binaries (2026-07-30)

A Backpack's closest equivalent is a plugin in ownership and development. It may become a
project of its own, and its interface, behavior and implementation belong outside Papers'
main binaries unless a concrete requirement explicitly needs host support. The analogy
does not approve a plugin format, marketplace, SDK, lifecycle or universal Backpack
architecture.

“Local” includes implementation and experience, not only data paths. A local Backpack
change must not update other machines. Release authorization is a separate delivery
permission and cannot convert Backpack work into universal Papers code.

Papers 1.2.2 violated this boundary by compiling the exact local “As you Go” ID, renderer
and workflow service into Papers. That release is preserved as history, but its placement
is not an accepted decision. Corrective implementation must separate the Backpack project
from the smallest required Papers-host seam before further “As you Go” development.

## D-001 — Existing products are the product boundary (2026-07-21)

The creator explicitly rejected Papers-owned agent validation workflows, modular agent
programs and duplicated interfaces. Before implementing any capability, Papers must use
the existing product that already owns it and limit itself to association, launch, focus,
embedding or restoration.

This decision supersedes the program-centric decisions in the previous plan and decision
log, which remain available in Git history.

## D-002 — Backpacks are machine-wide environments (2026-07-21)

> **Current clarification (2026-07-30):** “Machine-wide” describes how far a Backpack
> may reach within one machine. It does not decide whether a Backpack is unique, shared,
> portable or synchronized. Those meanings remain open until real Backpack work requires
> them. The original decision is preserved below as a chronological record.

  conversation history, voice, settings, models and credentials;

## D-004 — PowerToys proposal (deferred, 2026-07-21)

The creator's Windows machine has Microsoft PowerToys Workspaces. It was considered for
optional desktop arrangement, but it is not part of the current build or Backpack
definition. No PowerToys integration should be implemented before real Backpack behavior
creates a demonstrated need for it.

## D-005 — Historical programs are opt-in fixtures (2026-07-21)

Repository Research, Visual Dashboard and Kill Test were useful vertical proofs but are
not creator workflows. Production loads no programs and starts no ACP child. The old path
is enabled only with `PAPERS_ENABLE_FIXTURES=1` for regression testing.

## D-006 — Acceptance is human-facing (2026-07-21)

Automated tests establish engineering confidence but cannot establish usefulness. Release
readiness requires the non-coder human acceptance path in `docs/ACCEPTANCE.md`. Papers
must not call itself complete while its primary everyday workflow remains absent.

## D-007 — Folder/cover first-Backpack proposal (superseded, 2026-07-21)

A Backpack is a machine-wide environment or lens that may later contain several pages,
views, features and uses of shared Tools. It is not a single boxed application to enter
and leave. Basic remains permanent with Backpacks, Tools and Settings. Tools are global
reusable machine capabilities; their exact contract remains explicitly undecided.

## D-009 — Reuse Papers 1's visual theme (2026-07-21)

The creator likes the feel of Papers 1 and wants it carried forward. Papers 3 will reuse
the actual warm paper palette, faint grid, translucent permanent top bar, fine borders,
rounded controls, restrained shadows, muted green accent and compact desktop typography
from `Futahua/papers-are-papers/src/styles.css`.

## D-010 — Sync classification evolves with real features (2026-07-21)

> **Current clarification (2026-07-30):** The Papers master folder is outside Syncthing
> and must remain outside it as a whole. Creator-authored work must be preserved, but
> synchronization is decided from each real feature and creator request. This decision
> does not reserve `Shared/`, default Backpack definitions to sync or define what unique
> and shared Backpacks mean. The original decision is preserved below as a chronological
> record.

The Papers master folder lives inside Syncthing, but the creator cannot know every future
feature or which of its data should survive across machines before using it. Papers will
not answer this uncertainty by syncing all live runtime state or by ignoring all data.

For each real feature, durable creator-authored work defaults toward sync and survival;
caches, locks, credentials, installations and process state default toward machine-local;
ambiguous data is preserved and recorded until use makes its value clear. Every durable
feature must update `docs/SYNCTHING_AND_DATA.md` with ownership, location, sync behavior,
secret status, concurrency limits and recovery.

## D-012 — Papers-managed snap-dock, not window reparenting (2026-07-21)

## D-014 — Slim theme-matched title bar, no wordmark or menu (2026-07-22)

The creator rejected the generic dark Electron title bar, the P/PAPERS wordmark, the
File/Edit/View/Window menu and the stacked decorative pane headers (eyebrow + pill + big
title + description + divider) as "ugly" and not part of Papers.

Decision: the Papers window is frameless (`titleBarStyle: 'hidden'`) with a slim
theme-matched title bar. The OS paints only the standard minimize/maximize/close controls
in a reserved top-right inset (`titleBarOverlay`, colour driven from the active Papers
theme so the two always match); the rest of the band is Papers' own bar with an invisible
drag region so the window still moves. There is no application menu
(`Menu.setApplicationMenu(null)`) and no wordmark. The Basic control shows only the current
section name ("Backpacks"/"Tools"/"Settings"). Panes start their content near the top: the
Backpacks pane drops its heading, description and the horizontal divider entirely (the pill
already labels the section); other panes keep a single heading with no divider.

## D-020 — Resolving paths at run time does not reach processes already running (2026-07-28)

D-016 and D-018 removed recorded paths from Papers, and `b7d2787` removed the last one from
the companion connector. All three fix what a process resolves **when it starts**. None of
them reach a process that is **already running**.

- The connector rebuilt a whole directory tree under the abandoned path and minted a second
  device identity there, breaking the phone pairing. Fixed at the source in `b7d2787`.
  while the real 5.1 MB one sat untouched — presenting as an empty, flashing session list
  with no error anywhere.

The general form, now seen three times: **a path captured at any moment — build time,
process start, or first write — is wrong as soon as the thing it names moves.** Resolution
must happen at the point of use, and anything holding an older resolution must be restarted.

## D-019 — Papers updates itself from its public GitHub releases (2026-07-27)

Updating Papers meant building on one machine and hand-copying a folder to the other, and
nothing in the product knew a newer version existed. With two machines this made "are these
the same Papers?" a manual chore even after D-017 made it *answerable*.

An auto-updater was initially argued against as speculative architecture for a
single-creator product. The creator overrode this and asked for frictionless updating,
choosing the conventional path over a bespoke one. Two facts made the standard path cheap:
the repository is **public**, so no token ships inside the application, and Papers already
resolved its profile relative to its own executable, so an installer-managed location needed
no code change.

Decision: `electron-updater` against the public `Futahua/Papers-3` releases.
`npm run release` builds and publishes; installed copies check on launch and download in the
background.

- **Never install unasked.** `autoInstallOnAppQuit` is off, so quitting Papers never swaps
- **Never interrupt.** A failed or offline check resolves quietly to "up to date"; only a
  downloaded, ready update surfaces. The reason is retained so an explicit check can explain
  itself — silence and failure must not be indistinguishable to someone asking directly.

The version field, frozen at `1.0.0` since the beginning, now moves per release: an updater
compares versions, so a static one can never offer an update. D-017's commit stamp remains
the identity mechanism; the version is what the updater compares.

Consequence for both machines: Papers must be installed once by its own installer, pointed
at the existing `App` folder so `Data` stays beside it. A hand-copied install has no Windows
record and would receive a second copy rather than an upgrade.

PATH is machine setup a build cannot carry. Worse, it is not even stable within a machine —
a process started before the venv was added to PATH inherits a stale copy, so the same
build works or fails depending on when the launching shell started. Papers reported only
"exited before it became ready", naming neither the command nor a path, because
`stdio: 'ignore'` discarded the reason.

Verified with PATH deliberately reduced to the bare Windows system directories: the backend
reaches ready, which was a guaranteed failure before.

The general rule, now applied twice: **anything a build needs to find must be derived at
run time from something Papers can see, never from a path or PATH entry baked in at package
time or inherited from an ambient environment.**

## D-017 — A build identifies itself by commit, not by version (2026-07-27)

Papers runs on two machines and every copy ever built reported version `1.0.0`.
Nothing else distinguished one build from another, so "are these two machines running
the same Papers?" could not be answered from inside the product — and comparing versions
gave a false *yes* even when the builds were completely different.

Bumping the version was considered and rejected as the primary answer. It depends on a
release discipline that does not exist here (no tags, no releases, no CI), and a forgotten
bump reintroduces exactly the false match. The commit is derived automatically and cannot
drift from the code it names.

Decision: `electron.vite.config.ts` stamps the short commit, branch and build time into the
main process at package time, and Settings shows them in a "This build" card alongside the
machine name, install folder and data folder. A build made with uncommitted edits is marked
`+local`, because it matches no other machine exactly; a build made without git reports
`unknown` rather than inventing a value.

The split follows D-016: the commit is a property of the BUILD, so baking it in is correct.
Paths and machine name are properties of a MACHINE and are read at run time.

The version field remains `1.0.0` and is still shown. Bumping it on real releases stays
worth doing, but it is no longer what tells two machines apart.

When every rule misses, the banner lists each path tried and what suggested it, so a
moved folder is visible at a glance instead of requiring a search.

## D-015 — Docking is a deliberate toggle, not drag-to-dock (2026-07-22)

## D-019 — A Backpack document is saved by compare-and-set, not by last writer (2026-09-01)

Papers is to open several windows, each able to show a different Backpack — or the same
Backpack shown differently. That makes two writers to one project document possible for
the first time.

The existing per-project save queue is not enough. It serialises writes, but each write
carries a whole board: `A1 -> B1 -> A2` still lets A2 write a document that predates B1,
and B1 is gone with nothing reported. The creator has been through an unannounced wipe of
this exact file before; a silent erase is the failure that matters here.

Decision: a load reports the revision it observed, and a save may name the revision it was
built on. A save whose revision is no longer current is refused and the caller is told,
rather than written. A refusal is a normal outcome, not an error.

The revision is a hash of the exact bytes on disk. Papers therefore keeps no second record
that could drift from the file, an edit made outside Papers is caught by the same check,
and the host still reads no meaning out of the document — it hashes opaque bytes.

The unversioned load/save pair remains and still writes unconditionally, so the
single-writer path in use today is unchanged. This decides host mechanism only. How two
surfaces of one project coordinate is a separate decision and belongs to the project.

## D-020 — Two surfaces of one Backpack are coordinated by the project, not merged by Papers (2026-09-01)

Refusing a stale save prevents loss but does not let two surfaces work together. The
obvious next step — Papers merging two documents — was rejected.

“As you Go” names its own store the single owner of workspace history and persistence, and
keeps undo/redo locally. Merging two such stores would require Papers to understand groups,
shortcuts, selection, navigation and undo semantics. That is precisely the schema leakage
that `ba94ecc` was reverted for.

Decision: a project has one logical document owner at a time. The project owns that
semantic coordination; Papers provides only a generic lease and message transport, and
never interprets the document. This follows the existing detached-surface handshake, which
already transfers ownership rather than permitting two independent writers.

## D-022 — A surface carries an opaque project-defined key (2026-09-01)

Two windows showing the same Backpack differently — a “variation” — must not become a
Backpack schema owned by Papers.

Decision: a Papers surface may carry a `surfaceKey` supplied by the project. Papers
preserves, routes and restores that key and may not interpret it. Papers never knows that
a key means a particular group, board, filter or view.

This is the same shape as the `layoutKey` the surface registry already carries, and it
extends unchanged to panes within a window and to saved layouts.

Not decided here: where saved layouts live, and what a saved layout may contain beyond
native windows, pane topology, ratios, project ids and opaque surface keys.

## Creator correction — 2026-10-05: Alt+Shift+A

Alt+Shift+A belongs in Papers code and must bring its existing window forward
quickly. The creator explicitly rejected relying on a Windows shortcut hotkey.
Restore the application registration and direct foreground handler; remove the
Windows shortcut binding added during diagnosis so it cannot compete.

## 2026-10-07 — Remove the fixed project-state size ceiling

The creator explicitly removed the unproven five-million-character restriction. Valid state saves have no fixed character limit in the IPC schema or project service. Existing shape validation, checked revisions, and atomic replacement remain the save contract.

## D-020 — Pencilcase tool ownership (2026-10-07)

The creator explicitly defines tool management as an independent Backpack named Pencilcase.
This supersedes the built-in Tools destination and undecided placeholder contract described
in earlier decisions. Papers retains execution owners, supported runtime controls and measured
observations. Pencilcase owns definitions, catalog and the management/recording interface.

## Pencilcase retirement correction — 2026-10-07

Retiring Delegate Wave also migrates its saved workspace surface references to
Pencilcase. Merely archiving the registry entry leaves unavailable project ids in
startup layouts and blocks hydration and subsequent opens. Two saved references
were migrated, preserving surface identities, group structure, sizes and focus.
The original workspace file is preserved in the migration backup. Full Basic pages
also hold the native host overlay lease so background project/browser views cannot
intercept their controls.

## Diagnostic bridge parity — 2026-10-07

Diagnostic project preloads add observations to the production bridge. They do
not maintain a second request dispatcher. The shared production source is inlined
into the diagnostic sandbox entry using a distinct build module identity; local
CommonJS requires are not supported by sandboxed Electron preloads. Both modes
forward file requests and preserve the production gesture and scope checks.
Packaged diagnostics-enabled search replies and Pencilcase controls are covered
by regression tests. The former diagnostic dispatcher silently dropped searches.

## Failed native preview fallback — 2026-10-07

A registered Windows preview handler can still fail to host a particular file.
AYG then requests the existing preview chain with that handler bypassed; Office
files can use the existing cached LibreOffice PDF conversion. Navigation fences
discard stale results and release their resources. A failed handler does not leave
the pane at a permanent hosting error or implicitly open an editor. The creator's
EXCHANGE.xlsx converted successfully without changing its source hash.
