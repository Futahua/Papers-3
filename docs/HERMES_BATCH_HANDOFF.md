# Hermes integration batch — implementation handoff

## Copy-paste pickup prompt

You are taking ownership of the first real Papers/Hermes product correction. Work on the
machine, implement the entire batch described in this document, test the human-visible
experience, rebuild the installed product, preserve all creator data, and publish the
source changes. Do not return another architecture proposal unless a hard technical fact
makes the requested behavior impossible. Research the installed Hermes and Papers code,
choose the smallest robust implementation that satisfies the outcomes, and continue
until the creator can launch and use it.

Read these files completely before editing:

1. `docs/HERMES_BATCH_HANDOFF.md`
2. `docs/PROBLEMS.md`
3. `docs/HERMES_SKIN.md`
4. `docs/PRODUCT.md`
5. `docs/DECISIONS.md`
6. `docs/ARCHITECTURE.md`
7. `docs/SYNCTHING_AND_DATA.md`
8. `HERMES.md`

The creator is not a coder. Acceptance must be demonstrated through the running product,
screenshots and plain language, not a request to inspect diffs.

## Objective

Deliver one global Hermes experience in Papers using the real Hermes Desktop interface.
It must move naturally between a Papers sidebar placement and a detached window, use
simple SVG controls, retain Hermes sessions and capabilities, carry a subtle readable
Papers Light/Dark skin, and remain maintainable as upstream Hermes improves.

This is a batch implementation of creator-reported problems 1–4. Do not add speculative
Backpack behavior, agent workflows or a new chat interface.

## Authoritative local locations

- Papers source:
  `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3`
- Installed Papers master:
  `D:\LapSlop brotherhood\Programs\Papers`
- Installed Papers executable:
  `D:\LapSlop brotherhood\Programs\Papers\App\Papers.exe`
- Papers creator data:
  `D:\LapSlop brotherhood\Programs\Papers\Data`
- Current Hermes source/runtime checkout:
  `D:\LapSlop brotherhood\Programs\Assistant\HermesAI\.hermes\hermes-agent`
- Canonical Papers repository:
  `https://github.com/Futahua/Papers-3`
- Upstream Hermes repository:
  `https://github.com/NousResearch/hermes-agent`

Discover the actual active branches, remotes, runtime home, session store and build
commands before changing them. Preserve dirty work and creator data. Never edit only a
generated bundle or packaged executable and call that the implementation.

## Product invariants

- Hermes is global. Backpack selection must not change its working directory,
  conversation or context.
- Papers reuses Hermes; it does not recreate chat, attachments, history, tool rendering,
  approvals, settings, models, credentials, voice or file browsing.
- There is one Hermes experience and one authoritative session history.
- Docked and detached are placements of that same experience, not two unrelated clients.
- Do not restore Programs, Runs, ACP validation screens or the test Backpack.
- Do not invent contents for Backpacks or change their current behavior in this batch.
- Preserve the current Papers theme and Basic/Backpacks/Tools/Settings shell except for
  the requested Hermes controls.
- Hermes must continue to receive upstream improvements. Do not solve customization by
  freezing the core forever.

## Current defect

Papers currently starts `hermes dashboard --host 127.0.0.1 --port 9119 --no-open` and
embeds its terminal-style `/chat` page in a `WebContentsView`. Its separate
`Hermes window` action starts `hermes desktop`, whose polished React interface starts a
second backend on another port. The same conversation can appear in radically different
frontends. This is the central defect, not merely a color mismatch.

The relevant Papers entry point is `src/main/hermes/hermesSurface.ts`. Inspect the current
Hermes Desktop Electron main process, renderer, preload and dashboard APIs before choosing
the integration. Do not assume the old `/chat` embedding is acceptable because it is easy.

## Required outcomes

### 1. One canonical Hermes Desktop interface

- Remove the terminal-style Dashboard `/chat` from the creator-facing Papers sidebar.
- Use the real Hermes Desktop frontend for both docked and detached placements.
- Do not leave two Hermes dashboard backends running for one user experience.
- Preserve the active conversation, scroll position, draft and visible state as far as
  technically possible when placement changes.
- Hiding the sidebar must not terminate Hermes or discard its session.
- Opening Hermes before or after Backpack interaction must behave identically.

Choose the least brittle architecture after proving it against the actual Hermes source.
Acceptable directions include a supported Hermes companion/dock mode, a reusable Hermes
renderer surface, or a Papers-managed Hermes window that visually docks without cloning
the UI. Native foreign-window reparenting is acceptable only if it is demonstrably stable
through focus, resizing, sleep/wake, crash and relaunch. Do not counterfeit Hermes Desktop
with a Papers-owned React chat.

### 2. Minimal SVG placement controls and drag docking

Remove the dotted Hermes status pill and the current redundant text buttons.

Provide two compact, recognizable SVG-symbol controls in the Papers top bar:

- sidebar toggle: turns the docked Hermes placement on or off;
- window toggle: turns the detached Hermes window on or off.

Requirements:

- each control clearly communicates active/inactive state;
- tooltips and accessible names state what it does;
- repeated clicks are true toggles;
- controls reflect reality after Hermes closes, crashes, detaches or docks by another path;
- do not add labels or explanatory chrome to the permanent top bar.

Also implement physical placement changes:

- dragging docked Hermes outward detaches it into the window;
- dragging the Hermes window back to the Papers docking edge visibly offers a dock target
  and docks it on release;
- resizing Papers keeps a docked surface aligned;
- the interaction must not create a second Hermes UI or lose the active session.

If OS-level free drag cannot be made reliable, implement a clear grab handle and snap
zone that produces the same direct-manipulation experience. Do not silently omit drag
docking merely because the SVG toggles work.

### 3. Subtle Papers Light and Papers Dark skin

Implement `docs/HERMES_SKIN.md` exactly as corrected by the creator.

The original Hermes appearance is already close. Keep its layout, component shapes,
density and deep dark character. Make only restrained readability improvements:

- increase undersized interface and conversation type by roughly 1–2 px where visual
  testing confirms the need;
- improve contrast for secondary and inactive text that is currently too gray/faint;
- preserve distinct primary, secondary, tertiary and disabled levels;
- create a calm warm-neutral Light mode corresponding to the refined Dark mode;
- ensure every existing Hermes surface uses the theme consistently.

Explicitly reject the earlier AI-generated fintech dashboard: no gradient primary
buttons, rainbow borders, neon terminal styling, pervasive outlines, dense component
showcase layout or wholesale Hermes redesign. The improvement should register as reduced
eye strain, not as a different product.

### 4. Updateable Hermes customization

Separate the creator-owned skin from the upstream Hermes core.

Preferred shape:

- versioned Papers Light/Dark theme data and assets outside generated Hermes files;
- one narrow, documented Hermes theme-loading seam;
- the existing `DesktopTheme` token model wherever possible;
- small isolated tokenization patches only where hard-coded values defeat the theme;
- a tracking branch or patch series that can be rebased onto selected upstream releases;
- an agent-runnable update/build/verification command.

Do not trust the stock binary updater to preserve a customized frontend. Provide a
source-based update path that fetches upstream, reapplies or rebases the small integration,
builds, tests and installs without touching Hermes sessions, credentials or creator data.
Prefer a generic external-theme loader suitable for an upstream contribution. Document
exactly what remains patched if upstream does not yet support it.

## Implementation sequence

### Phase A — Preserve and prove the current state

1. Inspect Git state and preserve all existing changes.
2. Identify Papers and Hermes processes, ports, data homes and current session storage.
3. Back up only the configuration/data files that the update or install path could touch.
4. Capture a baseline screenshot of Papers, docked Dashboard chat and Hermes Desktop.
5. Reproduce the duplicate-backend and duplicate-control problems.

### Phase B — Establish the canonical Hermes surface

1. Prototype the chosen integration against the real Hermes Desktop frontend.
2. Prove a single conversation can remain visible through dock, detach and redock.
3. Prove only one intended Hermes backend/process group owns the experience.
4. Replace the old Papers Dashboard `/chat` path.
5. Add lifecycle recovery for unavailable executable, slow start, crash and manual close.

Do not spend time polishing controls until this proof works; it is the critical path.

### Phase C — Complete placement behavior

1. Add the two SVG toggles and remove all three old top-bar Hermes controls.
2. Synchronize toggle state with actual docked/window state.
3. Implement outward drag, docking target, redock and resize behavior.
4. Verify focus, keyboard input, clipboard, file drop, attachments and window activation.
5. Verify Papers overlays and menus do not end up behind an embedded/docked surface.

### Phase D — Apply the restrained skin

1. Create the external Papers theme data with Light and Dark palettes.
2. Apply typography and contrast changes using the smallest stable token surface.
3. Audit every area listed in `docs/HERMES_SKIN.md` in both modes.
4. Capture before/after screenshots at the same size and Windows scaling.
5. Remove any change that makes Hermes louder, denser or less recognizable.

### Phase E — Make updates repeatable

1. Establish the upstream-tracking branch or deterministic patch application.
2. Add one documented command/script for update, build and verification.
3. Test it on a clean disposable worktree or clone, not against the only working install.
4. Document recovery if an upstream release breaks the integration.
5. Ensure theme assets and maintenance instructions survive Syncthing appropriately;
   never sync live credentials, locks or concurrent database journals by accident.

### Phase F — Verify, install and publish

1. Run relevant unit, type, build and Electron product tests in both repositories.
2. Add focused regression tests for one backend, control toggling and placement state.
3. Run the complete human acceptance path below.
4. Close Papers cleanly before replacing its application files.
5. Preserve `Papers/Data` and Hermes-owned state; rebuild and install under the existing
   master folders rather than creating another installation tree.
6. Relaunch the installed product and repeat the human acceptance path.
7. Update `docs/PROBLEMS.md` with evidence. Do not mark an item solved merely because a
   source test passes; record it as awaiting creator acceptance until the creator uses it.
8. Commit intentionally and publish the Papers changes to its canonical GitHub branch.
   Keep Hermes customization/update history version-controlled and report its remote or
   patch location unambiguously.

## Human acceptance path

Demonstrate these actions in the installed application:

1. Launch Papers with Hermes initially closed.
2. Click the sidebar SVG once: refined Hermes Desktop appears docked.
3. Click it again: Hermes hides without losing the conversation.
4. Reopen it and send or display a real existing conversation.
5. Click the window SVG: the same Hermes experience becomes or appears detached, without
   a terminal-style alternate frontend.
6. Toggle the window off and on; controls remain synchronized.
7. Drag Hermes out, then drag it back to the visible Papers dock target.
8. Resize and move Papers; docked Hermes remains aligned and usable.
9. Attach or drag a file/image in Hermes and confirm its normal UI still works.
10. Switch Papers Light/Dark and inspect conversation, sidebar, composer, tool calls,
    settings, file browser and terminal for readable size and contrast.
11. Create or select a Backpack and confirm Hermes conversation and working directory do
    not change.
12. Restart Papers and Hermes; theme and safe placement preferences persist, while the
    active session/history remains Hermes-owned.
13. Inspect processes/ports and show that the obsolete duplicate Dashboard backend is not
    left running.

Provide screenshots of at least: Light docked, Dark docked, detached, docking target and
the process/port verification in a readable report. The creator should not need source
knowledge to judge success.

## Required failure handling

- Hermes unavailable: Papers stays usable and reports a short actionable error.
- Hermes startup slow: show honest starting state without spawning repeated processes.
- Hermes crashes: toggle state corrects itself and offers relaunch.
- Docking fails: detached Hermes remains usable; never destroy the session to recover UI.
- Update incompatibility: keep the previous working build recoverable and report the
  exact failed compatibility patch.
- Theme loading fails: fall back to stock Hermes rather than preventing Hermes startup.

## Do not do

- Do not embed the terminal Dashboard `/chat` and call the mismatch solved.
- Do not create a third Hermes interface.
- Do not copy Hermes chat components into Papers.
- Do not add provider, model, permission or session-management UI to Papers.
- Do not introduce PowerToys as a requirement.
- Do not make Backpacks into folders, canvases or Hermes workspaces.
- Do not seed a demo Backpack.
- Do not apply the rejected prismatic-dashboard design.
- Do not update by overwriting the only working build with no rollback.
- Do not ask the creator to validate implementation line by line.

## Definition of done

The batch is done only when the installed Papers product visibly uses one real Hermes
Desktop experience in both placements; the two SVG toggles and drag docking work; the
subtle Light/Dark skin improves size and contrast without redesigning Hermes; Backpack
interaction never scopes Hermes; the old duplicate Dashboard path is absent; and an
agent can update upstream Hermes and rebuild the customized frontend through a documented,
tested, recoverable process.

End with a plain-language report containing:

- what the creator can now do;
- where Papers and Hermes were installed;
- where the version-controlled skin/update integration lives;
- screenshots or other visible evidence;
- tests run and their result;
- any remaining creator-verification item;
- the exact Git commit and branch/PR links.
