# Hermes batch — verification evidence (2026-07-21)

Human-visible verification of the Hermes integration batch, captured against the
**installed** product (`D:\LapSlop brotherhood\Programs\Papers\App\Papers.exe` and the real
Hermes Desktop). Screenshots were shown to the creator in the working session; the
observable facts are recorded here.

## Problem 1 — one Hermes, one backend

- Before: two Python backends listened at once — `127.0.0.1:9119` (Papers' embedded
  terminal `/chat`) and a second port (e.g. `9120`) started by `hermes desktop`. Confirmed
  live via `netstat` + `/api/status` (both answered, same `hermes_home`).
- After: clicking the Papers sidebar toggle started **only** `127.0.0.1:9119` and launched
  the **real Hermes Desktop** (not the terminal page) pointed at it. A port scan showed
  only 9119 listening — no duplicate backend. The docked window is the polished React
  Hermes, connected ("Gateway ready").

## Problem 2 — two SVG toggles, real native-window snap-docking

- The installed top bar shows exactly two compact SVG symbol controls (sidebar + window)
  and none of the old controls (dotted status pill, "Hermes window" button, "Hermes"
  button). Tooltips: "Dock Hermes as a sidebar" / "Open Hermes as a window".

> **Superseded (2026-07-22, D-015): docking is toggle-only.** At the creator's request,
> drag-to-dock was removed entirely — dragging a detached Hermes no longer docks it and
> there is no activation zone or edge highlight. Docking/detaching is done only via the two
> SVG toggles. Papers still keeps a *docked* window aligned + raised above Papers on
> move/resize, and dragging a docked window off its strip frees it. The drag-docking notes
> below are kept as a record of the intermediate iteration and its verification.

- **Real snap-docking (intermediate iteration, later superseded).** The earlier Papers-side
  "fake drag" overlay
  was removed. Hermes Desktop now reports its OWN window bounds to Papers over a loopback
  seam (`HERMES_DESKTOP_PAPERS_DOCK_URL`) on every move/resize, and accepts `setBounds`
  commands back. Verified end-to-end:
  - A detached Hermes window dragged toward the Papers docking edge is detected by its real
    reported position; a **narrow edge highlight** appears (no permanent overlay covering
    Papers), and on settle Papers snaps it into the dock strip. Measured: window moved to
    x≈1102 near the edge → Papers repositioned it to the exact strip x=1094, w=538.
  - **Docked Hermes stays fully visible beside Papers** (kept above Papers via
    always-on-top), never behind it.
  - **Moving Papers keeps Hermes aligned**: Papers moved from x=280→80 and Hermes tracked
    from x=1094→894, staying flush against the new dock edge.
  - Dragging a docked window off the strip detaches it.
  - The two SVG toggles remain as reliable fallback controls.
- The seam round-trip was also proven headlessly (`seam-harness`): report-server bind →
  Hermes `hello`+`move`+`focus` reports → Papers→Hermes `setBounds` control reply
  `{ok:true}`.

### Security + reliability hardening (2026-07-22)

The loopback dock channel is authenticated and hardened both directions:
- **Shared token.** Papers generates a random `HERMES_DESKTOP_PAPERS_DOCK_TOKEN` per launch.
  Every report and every control request carries it (`X-Papers-Dock-Token`); the other side
  requires it (constant-time compare) and returns **401** on missing/incorrect. The token is
  never logged. Verified: 401 with no token and with a wrong token, on BOTH the Papers report
  server and the Hermes control server; authed reports are accepted.
- **Input limits.** Request bodies are capped (**413** oversized), unknown operations are
  rejected (**400**), only `setBounds`/`focus`/`minimize`/`raise` are allowed, and every
  bound is validated as a finite, in-range screen coordinate (**422** on NaN / absurd
  coords). Verified with the security harness (401/401/413/400/422/422/200/200 all as
  expected).
- **No global always-on-top.** `setAlwaysOnTop` was removed. Docking now uses a `raise` op
  (BrowserWindow.moveTop()) that lifts Hermes above Papers in the normal z-order. Verified:
  the docked Hermes has `WS_EX_TOPMOST=False`, and when Chrome was focused over the docked
  region **Chrome covered Hermes** (Hermes did not stay on top of another application).
- **Occupied port 9119.** Papers persists its backend session token and, if 9119 is already
  in use, adopts it ONLY after authenticating a protected endpoint (`/api/sessions`) with the
  stored token (proving Papers-owned). Verified: a foreign/empty token returns 401 → Papers
  reports an actionable conflict and never silently starts a second backend.

### Real human native-drag acceptance (2026-07-22)

Verified by actually dragging the Hermes window by its real title bar (not programmatic
`SetWindowPos`):
- **Drag off the strip → detaches** (window ended at x=366, off the dock).
- **Drag to the Papers edge → redocks** (window snapped to the strip x=934, w=538).
- **Cross-monitor**: the window was moved onto the top monitor (y=-700, negative coords) and
  the seam handled the multi-monitor / negative coordinates without error.
- **After docking, no global always-on-top** (confirmed via WS_EX_TOPMOST and the Chrome
  overlap test above).

## Problem 3 — Papers Light / Papers Dark skin

- The theme picker (Appearance / Cmd-K → Change theme) lists **Papers** under both LIGHT and
  DARK, exactly where a built-in theme appears.
- **Papers Dark** renders the real Hermes Desktop in the deep navy-black skin with warm,
  clearly-readable primary text and legible secondary text — same Hermes layout and density.
- **Papers Light (corrected 2026-07-22).** The earlier washed-out Light mode is fixed: the
  background illustration/watermark is suppressed for Light, the canvas is an opaque
  warm-neutral, and every text tier is re-mixed toward the canvas colour so it no longer
  depends on background bleed. Verified with a real turn: the user message, the "Thinking"
  label, the tool-call line ("Ran · printf …", with its "1.2s" timing), the reply with
  inline-code path chips, the sidebar labels and session titles are all distinct and
  readable. Dark was left unchanged.

## Problem 4 — updateable skin

- The themed Hermes renderer was **built from the `papers-skin` branch** of a clean Hermes
  clone (theme data import + one registry entry + a scoped type-bump CSS block). The build
  verified the Papers theme (`data-hermes-theme`, `"papers"`, and the palette colours
  `#0a0a18` / `#f4f2ec` / `#a9a6c8` / `#f3f0e8`) was present in the output assets.
- The built renderer was swapped into the live Hermes with the previous build preserved
  under `_PapersHermesRollback\`; the live Hermes then loaded cleanly with Papers selectable.
- The whole cycle is driven by `hermes-skin/update-hermes-skin.mjs`
  (see `docs/HERMES_SKIN_INTEGRATION.md`).

## Preserved throughout

- Papers creator data (`Papers/Data/PapersData`, the "Papers" Backpack) preserved across the
  reinstall.
- Hermes sessions, credentials and config never touched (the "Hermes Portal Login" session
  remained; only the renderer `dist/` was swapped, with rollback copies kept).

## Tests

- `tsc --noEmit`: clean. Unit tests: 60/60 pass.
- `product-shell.e2e.ts`: asserts exactly two Hermes SVG toggles, their accessible names and
  initial state, and the absence of the old pill/buttons/`/chat` embed. Passes.
- Fixture regressions: `killtest.e2e.ts` passes. `repository-workflow.e2e.ts` fails at its
  post-relaunch "research program restored" step with "Execution context was destroyed …
  because of a navigation." This failure is **pre-existing and unrelated to this batch** —
  it reproduces identically on clean `HEAD` with all Hermes-batch changes stashed, and this
  batch touches none of the Canvas runtime / program-restart path it exercises. It is a
  historical `PAPERS_ENABLE_FIXTURES=1` engineering fixture, not a creator-facing feature.

## Shell chrome — slim theme-matched title bar (2026-07-22, D-014)

The creator flagged the generic dark Electron title bar, the P/PAPERS wordmark, the
File/Edit/View/Window menu, the stacked pane headers and the dividing lines as "ugly" and
not part of Papers. Fixed and verified in the installed product:

- The window is frameless (`titleBarStyle: 'hidden'`); the OS paints only the standard
  minimize/maximize/close controls in a reserved top-right inset, coloured to match the
  active Papers theme (`titleBarOverlay`, driven from `--titlebar-bg`/`--titlebar-symbol`).
- No application menu (`Menu.setApplicationMenu(null)`), no wordmark. The Basic control
  shows only the section name ("Backpacks"/"Tools"/"Settings").
- The whole title-bar band is an invisible OS drag region; the window still moves normally
  (verified: dragging the empty title-bar area moved the window from x=272 to x=-44). The
  Basic menu still opens.
- No dividing line under the title bar, and the Backpacks pane drops its heading,
  description and horizontal divider so content begins right below the slim bar. The top now
  reads as one continuous Papers surface rather than a desktop wrapper.
