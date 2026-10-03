# 019E exclusive physical-input gate

This is the isolated final gate for the three physical-input rows deferred by
`../019e-live-proof/run-019e-live-proof.mjs`.

It is intentionally **not** part of `npm test` and must run only while the
creator grants an exclusive desktop interval. It moves the real cursor and
sends real left-click, Enter, and Escape input.

The runner:

- copies As you Go into a fresh temporary Papers profile;
- launches only uniquely titled disposable probe windows;
- discovers the primary display work area and computes non-overlapping target
  positions at runtime (there are no 1366x768 or 1920x1080 coordinates);
- discovers the live picker overlay that contains each target point;
- captures the original cursor and exact foreground HWND/PID/CreationDate;
- aborts on external cursor movement, an unexpected foreground identity,
  target loss, or a 150-second physical-input budget;
- restores cursor/foreground only when no external input claimed the desktop
  and the captured foreground identity still matches;
- cleans up only exact disposable titles/process handles and PID+CreationDate
  descendants of the isolated Papers root;
- observes creator Papers and foreign helpers but never controls them.

## Run only after explicit creator handoff

```powershell
node .\probes\019e-physical-gate\run-019e-physical-gate.mjs
```

Do not touch the mouse or keyboard until the process reports that the exclusive
phase has ended. Any detected interference aborts the run; an interference
abort deliberately does not restore cursor or foreground because the creator
has taken control.

Outputs are written beside the runner:

- `proof-019e-physical-transcript.txt`
- `proof-019e-physical-app.log`
- `shots/*.png`
