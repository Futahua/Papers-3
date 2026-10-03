# 019E LIVE PROOF (non-interactive prep wave)

Sole probe editor: Winter. Reuses the proven 016R/018 probe utilities
(`probes/015r3-live-proof/cdp.mjs`, `control-window.ps1`,
`disposable-window.ps1`) with a fresh temporary userData/state, uniquely
titled disposable windows, hard timeouts, PID/owner allowlists and cleanup
receipts. No secrets or creator data are copied.

## Boundary (this wave)

The creator is on the shared desktop, so this wave runs ONLY rows that cannot
move the real cursor, synthesize global OS clicks/keys, focus/minimize creator
windows or disturb unrelated processes. All interactions are renderer-internal
CDP event dispatch on the ISOLATED app's pages and native read-only/process
operations on the isolated instance and its disposable targets. Rows that
require the real cursor, OS input or foreground are marked EXCLUSIVE_PHYSICAL
READY/NOT RUN pending BRAIN's short exclusive interval. No claimed conversion
of synthetic input to physical.

## Run

```
node probes/019e-live-proof/run-019e-live-proof.mjs
```

Output: console PASS/FAIL/NOT_RUN lines, plus
`probes/019e-live-proof/proof-019e-transcript.txt` and
`probes/019e-live-proof/proof-019e-app.log`.

## Rows

NONINTERACTIVE (run this wave):
- N1 seed: layout + two list-picked members.
- N2 compact widget open / reuse (no duplicate) / close.
- N3 card-only top-level bootstrap over a real BroadcastChannel.
- N4 workspace stays writable while the widget is open.
- N5 fresh snapshot/revision after a workspace command.
- N6 staged picker add / remove / Enter commit / Escape byte-zero cancel
  (renderer-driven mousemove/click/Enter/Escape on the pick overlay page; the
  candidate resolves through the helper hover at a disposable target centre -
  a native, non-input call). 019HR: each picker row selects the EXACT live
  overlay whose screen bounds contain the target, converts the target's screen
  coordinates to that overlay's LOCAL client coordinates (the overlay page adds
  its display origin), WAITS for the exact blue/red hover and the exact staged
  marker, and retains display/local/screen/hover/staged evidence on failure.
  019HR2: a row PASS requires no swallowed error AND the exact expected hover
  and staged evidence (byte-zero alone never passes a cancel row that did not
  prove its red removal stage).
- N7 two-genuine-missing retirement with a transient-helper negative control
  (a helper outage never removes). 019HR strengthened: after killing ONLY the
  proven descendant helper, waits through >2 observe cadence cycles AND helper
  recovery, asserts the persisted set stays EXACTLY the pre-kill member set
  (019HR3 exact set equality: no member missing, none added), then closes
  EXACTLY B. 019HR2 row-independent: the member set is snapshotted before the
  kill and the row requires exactly that pre-kill set minus B - it never
  assumes any specific member (e.g. D) is absent or present.
- N8 bounded group minimize/restore timing (measured wall clock). 019HR: runs
  BEFORE the destructive N7 row with a persisted-member preflight and
  typed/native evidence, so retirement cannot contaminate its verdict.
- N9 repeat / crash recovery (Page.crash the widget renderer; workspace
  unaffected; widget reopens).
- N10 forbidden persisted keys scan.
- N11 cleanup: close/WAIT the exact disposable targets before the zero-window
  receipt (the final cleanup remains a redundant safety oracle); zero owned
  helpers/test electrons/probe windows; installed creator Papers PIDs untouched.

EXCLUSIVE_PHYSICAL (READY/NOT RUN this wave):
- Real pointer-following live hover.
- Real OS click/Enter/Escape delivery to the picker.
- Real-cursor direct pick from the widget.

## Cleanup validation

Every exit path (success or failure) closes the isolated app, closes the
disposable targets, and verifies zero owned helpers / test electrons / probe
windows. The creator's installed Papers is enumerated before and after and is
never activated, moved or closed. Static syntax checks: `node --check`.
