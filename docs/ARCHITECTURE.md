# Papers — current architecture boundary

> Reference / evidence under [AGENTS.md](../AGENTS.md), the sole governing document.
> Dated instructions and implementation limits do not override current creator direction.
> The current cleanup is docs/comments only; this file does not activate a code roadmap.

## Compact widget renderer resumption — 2026-10-06

The creator reported a frozen/throttled widget on immediate Alt+Q resummon after
an icon click. The compact BrowserWindow now disables background throttling in
its existing webPreferences. This removes Chromium visibility-based suspension
from this repeatedly hidden/offscreen parked surface; no extra delay, polling
loop, window recreation, or change to dismissal/Peek ownership is introduced.

Validation: typecheck and 1,395 host tests passed (four skipped). A private Windows
desktop probe, without desktop input, observed a default-throttled hidden renderer
still hidden with only one frame after a 100 ms reveal, versus 13 frames and visible
state with throttling disabled. Subsequent three-cycle frameless/topmost runs
resumed under both settings, so the baseline stall is intermittent. All three
unthrottled cycles remained responsive (13–14 frames within 100 ms), and synthetic
DOM button handlers executed. This does not prove the creator's DWM Peek sequence
is resolved; the installed eye test remains outstanding.

## Widget dismissal while peeking — 2026-10-06

The creator observed Alt+Q hiding a hovered widget while leaving DWM Peek
active. Compact widget hiding now sends a dismissal through the existing
interaction-mode channel and releases the existing native preview owners.
Hidden source windows cannot begin a new peek. The capability service's existing
peek generation invalidates live-preview requests queued before dismissal.
The project owns hover disarming and re-arms it only on a fresh host summon.
Validation: type checking, 1,395 host tests and 1,891 AYG tests passed without
desktop input. Installed compositor behavior still requires the creator eye test.

## Native file drag reveal — creator request, 2026-10-06

During a Papers file drag, pressing Shift after the drag starts temporarily
hides its originating Papers window; releasing Shift reveals that window again.
Dropping restores Papers without activation and requests activation of the
external root window captured beneath the pointer at release. Escape restores
the source without requesting destination activation. Existing source windows
are preserved; neither the taskbar nor unrelated windows are enumerated or
restyled by this workflow.

`windows/nativeFileDrag.ts` wraps the existing synchronous Electron native drag.
`hoverInputBridge.ts` and its existing native keyboard hook/release watchdog own
the temporary session. Shift presses consumed by this session have balanced
releases and do not change its native copy/link effect. Shift already down at
session start keeps its ordinary modifier behavior until released. The existing
foreground bridge performs the single exact-window activation request.
Project file drags and completed browser-download drags use the same wrapper.

Electron does not expose the native accepted/cancelled drop result. The captured
root is the window under the pointer at release, not proof that an application
accepted a file. No accepted-file claim is made from that capture. Private-desktop
OLE tests establish source-hide survival, real synthetic-file delivery, and
cancellation restoration without desktop input; installed Electron end-to-end
verification remains separate.

Validation on 2026-10-06: the staged feature passed type checking and 1,378
unit tests (four skipped) in an isolated source snapshot. The installed package
matched the built package hash. The creator dragged an image through hidden
Papers into Codex and confirmed that Papers returned behind the destination
window after the drop. This establishes the installed primary workflow;
Shift-release, cancellation, and repeated-session handling also have automated
coverage without injected desktop input.

The production shell has four concepts:

## Backpack boundary

Papers currently persists Backpack identity and whether real contents exist. New
Backpacks contain only a name. `Enter` checks for genuine contents; when none exist it
shows the required warning rather than creating a fake environment.

The future contents contract is intentionally absent. No folder, canvas, scene or program
runtime may become that contract by implementation accident.

Accepted ownership boundary: Papers is the stable host, while a real Backpack may be an
independently developed project outside `App` and the packaged `app.asar`. Backpack
interfaces and workflow code do not belong in the main binary merely because Papers
displays them. This plugin-like ownership does not yet select a universal project format
or loading architecture.

Papers may eventually contain unique and shared Backpacks, but the architecture does not
define those terms or prescribe storage, synchronization, portability or local bindings
before a real Backpack requires them.

Papers 1.2.2 had a placement error: the exact “As you Go” ID selected a dedicated renderer
and main-process service compiled into Papers. The source correction prepared for the
explicitly authorized 1.2.3 release removes that exact ID, interface, pickup prompt and
action definitions from compiled source.

The concrete host seam now demonstrated by the local project is deliberately small:

```text
machine-local binding (PapersData/backpack-projects.json)
        │ exact Backpack ID → absolute project root; never sent to the renderer
        ▼
Papers main process
  ├── validates the binding, project entry and declared action IDs
  ├── serves only static files under that project's `public/` subtree
  │   on a per-Backpack secure origin
  ├── opens only absolute action targets declared in the external project
  ├── opens a project-requested web link only after validating `http` or `https`
  ├── resolves only real disk-backed files/folders the creator drops from Windows
  └── offers narrow state, target-picker, icon, copy-text and close mediation
        ▼
sandboxed project frame
```

Project files are read again when the Backpack is entered or an action is used. Therefore
ordinary interface, prompt and action changes to the local “As you Go” project do not
require rebuilding, versioning, releasing or restarting Papers. The binding is optional;
an unbound Backpack still receives the honest empty warning.

Papers persists only which Backpack is active in the existing registry
`lastActiveBackpackId`. On startup the host reopens that Backpack through the same normal
entry path. Leaving through **Back to Papers** clears the field. Papers does not capture a
project's internal working state; an independent project may restore its own richer state
behind its stable origin when real use requires it.

`project.json`, `actions.json` and their absolute paths are private main-process control
records. They cannot be fetched through the project scheme; real-path containment also
rejects a junction or symbolic-link alias from `public/` back to a private record.

This is current implementation required by one demonstrated project, not a required format
for every Backpack. It does not define plugin installation, discovery, synchronization,
portability or the future architecture of any other Backpack.

## Tool boundary

The independent Pencilcase Backpack owns the creator's tool definitions and management
UI. Papers exposes actual backend availability, supported execution controls and measured
usage through capabilityRuntimeService and the existing file-capability seam. Runtime
policies use the existing editor owner; the host has no competing Tools destination.

## Fixture boundary

The program sandbox, ACP adapter, Agent Runs and demonstration workflows load only with
`PAPERS_ENABLE_FIXTURES=1`. They are not part of production Papers.

## Evolving synchronization boundary

The installed master folder is outside Syncthing and must not be synchronized as a whole.
Executable files, durable creator work and live machine state are different kinds of
data. Papers does not freeze a speculative schema before real Backpacks exist. Each useful
feature must identify its data owner and sync behavior using
[the data inventory](SYNCTHING_AND_DATA.md).

That feature-by-feature classification is a data-safety practice. It does not define
unique or shared Backpacks in advance.

Durable creator-authored work must be preserved, but preservation does not itself decide
whether it synchronizes. Caches, locks, credentials, browser profiles, live database
journals and installations default toward machine-local state. Ambiguous data is
preserved and documented until real use makes the decision auditable.

Pencilcase also owns the ChatGPT local coder view, opened from its dedicated tool
entry as a separate page. The Delegate Wave Backpack is retired and archived. Its
existing companion service remains the operational owner; Papers transfers the
single trusted relay binding to Pencilcase. No second agent manager is introduced.
