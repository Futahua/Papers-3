# Papers — consequential decisions

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
readiness requires the non-coder human acceptance script in the authoritative plan. Papers
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
