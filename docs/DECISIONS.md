# Papers — consequential decisions

## D-021 — The first Backpack content is a Windows launch button (2026-07-29)

The creator defined the first Backpack, “As you Go,” as something built incrementally and
asked first for buttons that act as shortcuts to scripts and other existing machine targets.

Decision: entering a Backpack opens a restrained Backpack surface. It may contain
creator-named launch buttons whose targets are existing Windows shortcuts, scripts,
applications, files or folders. Papers stores only the association and delegates opening to
Windows; it does not copy the target, invent a program runtime or turn the Backpack into a
folder. Empty Backpacks still say `Nothing here yet.` and offer `Add button`.

Button definitions are durable creator-authored data in
`Shared/backpacks/<backpack-id>/buttons.json`. Absolute targets are necessarily
machine-specific: another machine may receive the definition but must have the same target
path before the button can work. Corrupt definitions are preserved through the existing
atomic backup/recovery path. This is one content type, not a final Backpack or Tool contract.

## D-001 — Existing products are the product boundary (2026-07-21)

The creator explicitly rejected Papers-owned agent validation workflows, modular agent
programs and duplicated interfaces. Before implementing any capability, Papers must use
the existing product that already owns it and limit itself to association, launch, focus,
embedding or restoration.

This decision supersedes the program-centric decisions in the previous plan and decision
log, which remain available in Git history.

## D-002 — Backpacks are machine-wide environments (2026-07-21)

A Backpack is not a Canvas. It can eventually span application windows, folders, browser
destinations, documents, multiple monitors and Papers surfaces. It does not own or scope
Hermes. Entering an empty Backpack currently warns that no contents exist.

## D-003 — Hermes UI is reused, not recreated (2026-07-21)

The installed Hermes Agent already provides:

- `hermes dashboard`, including an unconditional embedded `/chat` surface;
- Hermes Desktop with chat, attachments, streaming tools, previews, file browsing,
  conversation history, voice, settings, models and credentials;
- `hermes desktop --cwd <folder>` for an initial project directory.

Decision: production Papers embeds the dashboard chat and launches Hermes Desktop without
Backpack-derived arguments. The `--cwd` capability exists but is not inferred from a
Backpack. Papers does not own chat messages, session state, agent approvals or settings.
The ACP integration is a fixture only.

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

This proposal treated a compact name/folder/cover flow as the first useful Backpack. D-008
supersedes it: creation is name-only, Hermes stays global, and no contents are invented
before the creator shapes the Backpack through use.

## D-008 — Global Hermes and name-only Backpacks (2026-07-21)

The creator corrected the first-Backpack plan. Hermes is global and Backpack interaction
must not change its working directory, conversation or context automatically. Creating a
Backpack asks only for a name and creates no folder, cover, canvas or contents. Entering a
new empty Backpack displays `Nothing here yet. Create something under “name”.`

A Backpack is a machine-wide environment or lens that may later contain several pages,
views, features and uses of shared Tools. It is not a single boxed application to enter
and leave. Basic remains permanent with Backpacks, Tools and Settings. Tools are global
reusable machine capabilities; their exact contract remains explicitly undecided.

This decision supersedes the folder/cover first-release flow and any automatic
`hermes desktop --cwd <Backpack folder>` behavior in earlier Papers 3 documents.

## D-009 — Reuse Papers 1's visual theme (2026-07-21)

The creator likes the feel of Papers 1 and wants it carried forward. Papers 3 will reuse
the actual warm paper palette, faint grid, translucent permanent top bar, fine borders,
rounded controls, restrained shadows, muted green accent and compact desktop typography
from `Futahua/papers-are-papers/src/styles.css`.

This is visual reuse only. Papers 1's custom agent workbench, Work rail, provider wizard,
Inspect, approval and self-edit behaviors do not return. Hermes keeps its existing UI.

## D-010 — Sync classification evolves with real features (2026-07-21)

The Papers master folder lives inside Syncthing, but the creator cannot know every future
feature or which of its data should survive across machines before using it. Papers will
not answer this uncertainty by syncing all live runtime state or by ignoring all data.

For each real feature, durable creator-authored work defaults toward sync and survival;
caches, locks, credentials, installations and process state default toward machine-local;
ambiguous data is preserved and recorded until use makes its value clear. Every durable
feature must update `docs/SYNCTHING_AND_DATA.md` with ownership, location, sync behavior,
secret status, concurrency limits and recovery.

Hermes uses the `HERMES.md` in the Papers master folder as its native pickup instruction
when the creator points Hermes at that folder. Papers does not automatically change the
global Hermes working directory to force this context.

## D-011 — One Hermes backend, real Hermes Desktop in both placements (2026-07-21)

The prior build ran two Hermes backends for one experience: Papers embedded the terminal
`hermes dashboard /chat` (port 9119) in its sidebar, while `hermes desktop` spawned a
second identical `hermes dashboard` backend on another port behind the polished React UI.
Same data, two frontends, two Python backends. This was the central defect (PROBLEMS.md 1).

Proven from the Hermes Desktop source (`apps/desktop/electron/main.cjs`): the desktop's
own local backend is literally `hermes dashboard --no-open --host 127.0.0.1 --port <n>`
with a per-launch `HERMES_DASHBOARD_SESSION_TOKEN`, and the desktop honours
`HERMES_DESKTOP_REMOTE_URL` + `HERMES_DESKTOP_REMOTE_TOKEN` to connect to an existing
token-auth backend instead of spawning its own.

Decision: Papers starts exactly one `hermes dashboard` backend (127.0.0.1:9119) with a
Papers-generated session token, then launches the real Hermes Desktop app pointed at that
backend via the two env vars. Both the docked sidebar placement and the detached window
are the same real Hermes Desktop frontend on the same single backend. The terminal `/chat`
embedding is removed entirely.

## D-012 — Papers-managed snap-dock, not window reparenting (2026-07-21)

Hermes Desktop exposes no companion/dock mode and no renderer set-bounds IPC; it is a
frameless top-level Electron `BrowserWindow` in its own process. Native cross-process
window reparenting on Windows (`SetParent`) is fragile through focus, keyboard input, DPI,
sleep/wake and crash — the handoff permits it only if demonstrably stable.

Decision (creator-approved): Papers manages the real Hermes Desktop window as a placement
it positions flush against its docking edge ("docked sidebar"), keeps aligned on Papers
move/resize, and offers a visible dock target when the detached window is dragged back.
Hermes remains a real, independently-stable window the whole time; docking never destroys
the session. This is the handoff's "Papers-managed Hermes window that visually docks
without cloning the UI."

## D-013 — Restrained skin as external theme data on a Hermes tracking branch (2026-07-21)

The Papers Light/Dark skin (HERMES_SKIN.md, PROBLEMS.md 3-4) lives as versioned external
theme data plus one narrow theme-loading seam in Hermes Desktop, on a tracking branch of
`NousResearch/hermes-agent` that can be rebased onto selected upstream releases. Updates
run through a documented source-based rebuild command, never by overwriting the only
working build. If theme loading fails, Hermes falls back to its stock appearance rather
than failing to start.

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

A process inherits its environment at launch and keeps that snapshot for life. After Hermes
was relocated, every long-lived process started beforehand went on handing the old
`HERMES_HOME` to its children, and nothing in its command line revealed it. Two consequences
were observed:

- The connector rebuilt a whole directory tree under the abandoned path and minted a second
  device identity there, breaking the phone pairing. Fixed at the source in `b7d2787`.
- Hermes Desktop, running since before the move, read the phantom's empty 180 KB `state.db`
  while the real 5.1 MB one sat untouched — presenting as an empty, flashing session list
  with no error anywhere.

Decision: relocating a Hermes home is not complete until every process that predates the
move has been restarted. Code-level resolution is necessary but not sufficient, and this
step belongs in any relocation procedure rather than being rediscovered from symptoms.

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

Two deliberate restraints, both following the D-011 principle that Papers must not disturb a
live Hermes:

- **Never install unasked.** `autoInstallOnAppQuit` is off, so quitting Papers never swaps
  the application underneath a running Hermes. Restarting is the creator's choice.
- **Never interrupt.** A failed or offline check resolves quietly to "up to date"; only a
  downloaded, ready update surfaces. The reason is retained so an explicit check can explain
  itself — silence and failure must not be indistinguishable to someone asking directly.

The version field, frozen at `1.0.0` since the beginning, now moves per release: an updater
compares versions, so a static one can never offer an update. D-017's commit stamp remains
the identity mechanism; the version is what the updater compares.

Consequence for both machines: Papers must be installed once by its own installer, pointed
at the existing `App` folder so `Data` stays beside it. A hand-copied install has no Windows
record and would receive a second copy rather than an upgrade.

## D-018 — The Hermes backend runs from the located install, not from PATH (2026-07-27)

D-016 removed the build-time path for Hermes *Desktop*, but the *backend* was still
spawned as a bare `hermes`, resolved through PATH. Found on the laptop during the D-016
verification: Desktop resolution succeeded, and Hermes still failed to start.

PATH is machine setup a build cannot carry. Worse, it is not even stable within a machine —
a process started before the venv was added to PATH inherits a stale copy, so the same
build works or fails depending on when the launching shell started. Papers reported only
"exited before it became ready", naming neither the command nor a path, because
`stdio: 'ignore'` discarded the reason.

Decision: the backend runs `<hermesRoot>\venv\Scripts\hermes.exe` — the interpreter beside
the code Papers has already located — falling back to a bare `hermes` only when no venv is
present, for a differently-arranged Hermes where PATH may still be correct. Backend stderr
is captured (tail only) and every failure names the exact command Papers ran plus whatever
Hermes reported.

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

## D-016 — Hermes is located at run time, never baked into a build (2026-07-27)

Papers located Hermes Desktop through a single absolute path written into the source
(`D:\LapSlop brotherhood\Programs\Assistant\HermesAI\.hermes\...`). That path was
whatever the packaging machine happened to use, so every build was correct on exactly
one computer. When Hermes moved, Papers showed "Hermes Desktop is not installed where
Papers expects it" and the banner never said which path it had tried. Papers runs on two
machines with different roots (`D:\Letters\...` and `C:\This is Minh\...`), so a
build-time path is wrong by construction.

Decision: Papers resolves Hermes at run time in `src/main/hermes/hermesLocation.ts`,
taking the first hit from: an explicit `PAPERS_HERMES_DESKTOP_EXE` override; the location
Papers itself resolved and remembered last time (kept in the Papers data folder, written
only after a successful resolution, so a move self-heals); `HERMES_HOME`, which the Hermes
installer already sets on every machine; then a short probe of ordinary locations,
including a `HermesAI\.hermes` beside the Papers installation. No layout from the build
machine survives in the build.

`HERMES_HOME` alone was rejected as the sole rule: a process started before Hermes moves
keeps a stale copy of it, which was observed on the primary machine. Remembering plus
probing survives that; a single source of truth would not have.

When every rule misses, the banner lists each path tried and what suggested it, so a
moved folder is visible at a glance instead of requiring a search.

The Hermes root is now derived from the executable rather than configured separately, so
the two cannot disagree. A `PAPERS_HERMES_ROOT` pointing at the `.hermes` home is
corrected to the `hermes-agent` folder beneath it — the machine-local stopgap was set that
way, and it would have sent the update helper looking for `venv\Scripts\hermes.exe` one
level too high.

This removes the need for the per-machine `PAPERS_HERMES_DESKTOP_EXE` and
`PAPERS_HERMES_ROOT` environment variables. They remain supported as deliberate overrides.

## D-015 — Docking is a deliberate toggle, not drag-to-dock (2026-07-22)

An earlier iteration docked the real Hermes window when it was dragged to a Papers edge.
The creator found even a tight edge-sliver activation unnecessary and preferred to leave a
detached Hermes wherever it is dropped.

Decision: docking and detaching are done only through the two SVG toggles (sidebar / window).
Dragging a detached Hermes never docks it; there is no drag activation zone and no edge
highlight. Papers still keeps a *docked* window aligned and raised above Papers (non-topmost
moveTop) as Papers moves/resizes, and dragging a docked window off its strip frees it so the
drag wins over realignment. This supersedes the "drag docking / dock target / edge sliver"
parts of the earlier docking notes; the one-backend surface and non-topmost raise (D-011,
D-012 and the security hardening) are unchanged.
