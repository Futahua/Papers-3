# Papers — creator-reported problems

This is the plain-language work list, in creator priority order. A problem stays here
until the creator can use and judge the correction in the installed product.

## 1 — Hermes looks like two different products

**Awaiting creator acceptance (implemented and verified in the installed product,
2026-07-21).** The Papers sidebar used to display Hermes Dashboard's terminal-style
`/chat` while `Hermes Desktop` opened the polished interface on a *second* backend, so the
same conversation appeared in two different frontends.

Correction shipped: Papers now runs exactly **one** Hermes backend (`hermes dashboard` on
127.0.0.1:9119 with a Papers session token) and launches the **real Hermes Desktop**
pointed at it via `HERMES_DESKTOP_REMOTE_URL`/`_TOKEN`. The docked sidebar and the detached
window are the same real Hermes Desktop. The terminal `/chat` embedding is gone.

Evidence (installed `Papers/App/Papers.exe`): clicking the sidebar toggle started a single
backend on 9119 and the real Hermes Desktop docked beside Papers; a port scan showed **only
9119** listening — no duplicate Dashboard backend. See `docs/evidence/hermes-batch/`.

Remaining for the creator: use it in daily work and confirm it feels like one Hermes.

## 2 — Hermes controls are duplicated and the main button only opens

**Awaiting creator acceptance (implemented and verified, 2026-07-21).** The dotted status
pill and the two text buttons (`Hermes window`, `Hermes`) are removed. The top bar now has
exactly **two compact SVG toggles**: a sidebar toggle (dock/hide) and a window toggle
(detach/hide). Each shows its active/inactive state, carries a tooltip and accessible name,
and is a true toggle (clicking again hides without terminating Hermes or its session).

Docked and detached are two placements of the same real Hermes, with **real
native-window snap-docking** (2026-07-22 correction, replacing the earlier fake-drag
overlay the creator rejected): Hermes reports its own window position to Papers over a
loopback seam, so dragging the detached window toward the Papers edge shows a narrow edge
highlight (no overlay covering Papers) and snaps it into the strip on release; dragging a
docked window off detaches it; a docked window stays fully visible beside Papers (never
behind) and follows Papers as it moves/resizes. The two SVG toggles remain as fallbacks.

Evidence (installed product): a window dragged to x≈1102 snapped to the dock strip
(x=1094, w=538); moving Papers 280→80 tracked Hermes 1094→894; docking survives restart.
See `docs/evidence/hermes-batch/README.md`.

Remaining for the creator: confirm the toggles and drag docking feel natural in use.

## 3 — Define how far the Hermes interface can be customized

**Awaiting creator acceptance (skin-first correction implemented and verified,
2026-07-21).** A restrained **Papers** skin with coordinated **Papers Light** and
**Papers Dark** modes is added to Hermes Desktop as a new theme. It keeps original Hermes
layout, density and proportions and only: lifts too-faint secondary text, warms the primary
text to a readable off-white, keeps the deep navy-black dark canvas, and nudges undersized
interface/conversation text up ~1–2px. No fintech/prismatic redesign. **Papers Light was
corrected (2026-07-22)** after the creator found it washed out: the light skin now
suppresses the background illustration/watermark, uses an opaque warm-neutral canvas, and
re-mixes every text tier toward the canvas so conversation, thinking, tool and metadata text
is readable. Dark is unchanged. Evidence: the theme appears as "Papers" in Appearance (Light
and Dark); Papers Dark renders the deep navy-black Hermes with clearly readable text, and a
real Papers Light turn shows the user message, "Thinking" label, tool-call line (with
timing), reply with inline-code chips and sidebar/session titles all readable. See
`docs/evidence/hermes-batch/`. Remaining for the creator: read real conversations in both
modes and confirm the readability improvement.

The original open notes, kept for context:

The available levels are:

1. **Existing settings — limited but maintenance-free.** Hermes already supports
   light/dark/system modes, six built-in themes, installable VS Code Marketplace color
   themes, themed terminal colors, a resizable/collapsible session sidebar, reversible
   left/right pane placement and product-versus-technical tool display.
2. **A Papers skin — strong visual control with low disruption.** A maintained Hermes
   theme can control its complete color palette, accent, sidebar, cards, user bubbles,
   terminal colors and sans/monospace fonts. This is sufficient to make Hermes visually
   belong beside Papers, but it does not change the arrangement or behavior of controls.
3. **A maintained Hermes Desktop frontend — nearly total interface control.** Its CSS
   and React layout can be changed for spacing, typography, information density,
   navigation, pane arrangement, icons, message and tool presentation, title bar and
   responsive sidebar/window behavior. Hermes's existing backend and capabilities remain
   untouched. Custom frontend work must remain updateable as described in problem 4;
   it must not depend on freezing Hermes at one version.

Hermes does not currently expose a supported general `custom.css` field. Layout-level
customization therefore requires a version-controlled custom build, not an ad-hoc patch
inside generated or installed files.

Creator correction: change only the skin first and retain the existing Hermes layout.
Original Hermes is already close to the desired appearance; its type is slightly too
small and some secondary text is too gray and faint. The earlier AI-generated prismatic
preview is rejected as loud, dense and unlike Hermes. Build restrained Papers Light and
Papers Dark modes that look immediately like original Hermes, with modest type-size and
contrast improvements. The corrected specification is in [`HERMES_SKIN.md`](HERMES_SKIN.md).

Keep Hermes itself intact as the existing AI product. Only change layout later where
real use identifies a problem. The skin must apply to the one canonical Hermes surface
described in problems 1 and 2, so docked and detached Hermes never drift into different
interfaces.

## 4 — Hermes must keep receiving upstream improvements without losing the Papers skin

**Awaiting creator acceptance (updateable path implemented and verified, 2026-07-21).**
The skin is versioned data (`hermes-skin/papers-theme.json`) plus a three-change overlay on
a `papers-skin` branch of a clean Hermes clone (theme import, one registry entry, a scoped
type-bump CSS block). A documented command, `hermes-skin/update-hermes-skin.mjs`, fetches
upstream, rebases the overlay, rebuilds the renderer, verifies the theme is present, and
swaps it into the live install while keeping the previous build as a timestamped rollback —
never touching Hermes sessions, credentials or config. Verified: the themed renderer built
from the branch and, when swapped into the live Hermes, loaded cleanly with the Papers theme
selectable. Full details in `docs/HERMES_SKIN_INTEGRATION.md`. Remaining for the creator:
run the update command against a future upstream release when one is chosen.

The original open notes, kept for context:

Desired architecture:

- Treat upstream Hermes as the changing core and the Papers skin as a small user-owned
  overlay.
- Keep the skin's light/dark tokens and assets outside generated Hermes installation
  files, under version control in a stable location.
- Add only one narrow Hermes integration seam that loads the external Papers theme.
  Prefer Hermes's existing `DesktopTheme` token model; do not fork chat behavior merely
  to change appearance.
- When a component contains a hard-coded default color, convert that component to use a
  theme token through a small isolated patch. Avoid accumulating a second frontend.
- Keep any later layout experiments as separate, named patches so a skin change never
  becomes inseparable from Hermes core changes.

Update workflow:

1. Fetch a selected upstream Hermes release.
2. Merge or rebase it into the maintained Papers-compatible Hermes branch.
3. Reapply the small theme-loader and any still-required compatibility patches.
4. Build Hermes Desktop and test both Papers Light and Papers Dark across the component
   coverage in `HERMES_SKIN.md`.
5. Launch the updated build only after sessions, configuration and creator data locations
   have been preserved.
6. Record any upstream change that required adapting the theme; never silently discard
   the creator's current skin.

The ordinary official binary updater cannot be assumed to preserve a modified frontend:
it may replace the customized files with the stock build. Hermes updates should therefore
run through this source-based rebuild workflow, ideally automated for the agent, rather
than by editing packaged files after every release.

Preferred long-term improvement: contribute or maintain a generic Hermes feature that
loads user themes from a supported external theme file. If upstream accepts that seam,
the Papers skin can survive normal upgrades as data rather than as a recurring source
patch. Until then, a small tracking fork is acceptable; a permanently frozen fork is not.
