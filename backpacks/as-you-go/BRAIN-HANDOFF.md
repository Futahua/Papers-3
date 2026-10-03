# BRAIN handoff — 2026-08-05

You are the replacement BRAIN for the "As you Go" Backpack project. Read this
before `BRAIN-WORKER.txt`. It exists because the outgoing brain lost the plot on
a specific problem and the creator asked for a handoff. Read the failure section
first; it is the most useful thing here.

## Do this first

1. Read the `CURRENT STATUS` block at the top of `BRAIN-WORKER.txt`. It is the
   only part of that file that is edited rather than appended, and it names the
   live assignment. The log is ~8,000 lines and append-only, so withdrawn
   assignments keep their `(ACTIVE)` headers forever. Never trust a header.
2. Read this whole file.
3. Do **not** write an assignment until the creator asks for one.

## What is finished and creator-accepted

The set system in As you Go is complete and eye-checked. Do not reopen any of it
without a fresh creator complaint:

- Assignments 001–003: set physics (hull separation, drag-anchored ellipse,
  exclusion escape). Creator verdict: "perfect". **Closed. Do not touch.**
- 004–006: customizable hotkeys page, set naming, spatial colours, repeated
  single-stroke vector lettering around named-set perimeters.
- 007–009: anime.js effects (interior ripple/wash), drag trails, region colours
  for set intersections.
- 010–018: settings page, opacity sliders, set-drawing level rules, glyph
  spacing, and identity-seeded set hues (seed from set id + drift by distance
  travelled — position-derived hue could not work because gravity converges
  positions).
- 022–023: dark mode via a 79-token semantic vocabulary; the square grid removed.

Two commits are pushed to `feat/sets-ring` (`7d04f87`, `a7fe2e9`, `6cc9ebe`).
683 tests passing.

## What is unfinished

**Papers host transparency.** Papers 1.2.11 is released and installed. On top of
that, `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3` has ~12 uncommitted modified
files from Assignments 025–036: a transparent-window mode, a settings persistence
fix, a home-screen-bleed fix, and a cyan-overlay fix. All of it works. **None of
it is committed**, so the creator's running build is stamped `+local`.

The creator's remaining complaint: with transparency on, the set interiors render
as a pale cream panel instead of showing the wallpaper through them.

The outgoing brain's last diagnosis — untested, treat as a hypothesis only — is
that set/region colours are emitted as `oklch(68% 0.18 <hue>deg)` at
`public/workspace-20260730b.js:398/403/408`, which is a **pale** colour regardless
of theme. Against the old opaque paper background that read as a tint; with the
background transparent it is the only thing painting the set interior. If true,
the fix is theme-aware lightness in As you Go, not anything in Papers. **Verify
before acting. The outgoing brain's diagnoses in this area were wrong repeatedly.**

## How the outgoing brain failed — read this

The transparency work took eleven assignments and most of them were wasted. The
failure pattern, so you can avoid repeating it:

1. **Accepted a conclusion without checking its evidence.** A worker reported
   that transparency was "not achievable without rehosting" and that the earlier
   working screenshots were CDP capture artifacts. The brain accepted this. The
   creator refused to. The brain then opened
   `D:\Papers-assignment-029\desktop-bright-final3.png` — a capture the worker
   itself had labelled real-screen — and it plainly contained Chrome's own tab
   bar and address bar. A CDP screenshot of the Papers renderer cannot contain
   another application's window furniture. The conclusion was false and one look
   at the artifact disproved it.

2. **Diagnosed from source instead of running the thing.** Three separate
   diagnoses (a `canvasRuntime` colour, a CSS specificity race, a Settings-pane
   attribute) were each derived by reading code, stated as concrete causes, and
   each disproved by the worker actually launching the app. In this project,
   **launching it is the minimum bar** for anything touching window creation,
   compositing, or rendering.

3. **Let the creator and the worker test different binaries.** The creator runs
   Papers from `release\win-unpacked`. Workers build to separate output folders
   so they do not disturb the running app. For an entire round the creator
   reported failure while the worker reported success — because the brain had
   never swapped the fixed build in. **If a creator-reported failure cannot be
   reproduced, compare the binaries before diagnosing anything.**

4. **Did not read the worker's replies.** The brain wrote Assignment 032
   demanding a runtime probe the worker had already performed, repeating a cause
   the worker had already disproved. The creator caught it with "did you check
   workers last reply". Read the reply first, every time.

5. **Kept generating assignments after the signal was gone.** After the second
   failed diagnosis the right move was to stop and hand the decision to the
   creator. Instead the brain produced more confident-sounding theories, and the
   contradictions between them are now permanent in the log.

The worker performed well throughout. It twice refused to implement a brain
assignment that contradicted evidence it had already produced, and it was right
both times. There is a standing rule in the status block telling it to do exactly
that — honour it, and treat a worker's contradiction as a signal you are wrong.

## Rules that still hold

- **Never claim a visual result is accepted before the creator's real eye check.**
  Passing tests and correct-looking source are not evidence for anything visual.
- **Mutation-check load-bearing rules, and assert the mutation is on disk first.**
  These files are CRLF; string replacement silently fails. Use line indices. This
  bit the outgoing brain three times.
- **Standing safety rule.** The creator reported eye strain three times (a
  flashing pulse effect, hue easing five times too fast, then a hue mapping with
  a 180° discontinuity at the canvas centre). No visual behaviour may change a
  large area's opacity, fill, luminance **or hue** at a rate the eye reads as
  flashing. State an animated value's area and rate before shipping it.
- **Build discipline.** Workers build to a separate output directory and never
  swap. BRAIN performs swaps only with the creator's say-so, which means closing
  their running Papers — always ask.
- **Authority.** Papers work needs fresh creator permission each time; the
  permission granted for the transparency work is spent. No commit, push,
  release, install, or Papers launch/restart without an explicit creator yes.
  `state.json` is creator data and gitignored — never touch it.

## Housekeeping left undone

- The Papers repo has stale build folders: `release-clean`, `release-tmp`,
  `release-v2` … `release-v5`, `release-verify`. Several hundred MB. Safe to
  delete; the creator's live app is `release\win-unpacked`.
- A `git stash` entry `assignment-025-transparency` exists in Papers. It has been
  superseded by the working-tree changes. Confirm before dropping it.
- Known cosmetic issue, logged and deliberately not fixed: the period and comma
  glyphs render sub-pixel and read faint in a set name.
- The vendored `anime.js` is the 408KB unminified bundle; trimming it is a
  load-time-only improvement.
