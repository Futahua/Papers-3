# Returning to Papers after another maximized app

2026-10-15, LapDog.

## Diagnosis and correction

The host foreground event was ignored by the native coordinator. Before the change, the visible order was Papers, maximized Word, then the attached Chrome pane. Word was not topmost. Returning the host therefore did not raise its attached peers.

The coordinator now repaints on a current host foreground event and invokes the existing shared stacking implementation. Hub mode stacks once after routing the event to its scopes. The guard rejects stale foreground events and minimized hosts. This preserves existing focus, popup, and topmost rules.

## Verification

- Native foreground regression fixture covers standalone and hub coordinators, real Windows z-order, retained foreground focus, and rejection of stale events.
- Foreground, spans, discard, and bridge suites: 4 files, 27 checks passed.
- Desktop package completed; diff whitespace check passed.
- Installed on LapDog with the supported owner installer. Recovery inventory verified Data (5368 files), As you Go (174 files), Proxima (31 files), and the previous application. Installer verified unchanged profile and Backpack bytes.
- Installed app.asar SHA256: fe9854e72a65b03aea6ff7fa7a470939b8f586ec395e6db97f541053e22edc1b.
- Installer SHA256: 1928703df90dd85716e33c1518f7575950f2a87d4ea8adeb21acce6653fed5b7.
- Running native helper: pane-coordinator-b7ebeda980c6bfda.exe.
- Restored the existing saved workspace and maximized its window; closed only the blank startup window. Word and Chrome processes/documents remained open.

Live focus verification remains limited: Windows rejected the maintenance process's SetForegroundWindow request, so the actual foreground-return event could not be exercised on the user's current desktop. The real-window regression fixture passed; installation and helper loading were independently verified. No claim of a successful live user Alt-Tab cycle is made.

## Follow-up after creator screenshot

The first fix was insufficient. A live HWND_TOP request on Chrome returned true but the observed order remained Papers, Word, Chrome. An explicit insertion of that same Chrome HWND immediately after Papers produced Papers, Chrome, Word, without changing application geometry or topmost styles. The shared presentation stack now uses this relative ordering for each selected peer.

Microsoft documents foreground permission restrictions on bringing windows to the top: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos . The observed live order, rather than a successful API return, is the acceptance evidence for this correction.

Added a standalone/hub relative-order fixture that also checks foreground preservation. Latest run: 27 passed, 1 failed because the foreground fixture could not obtain foreground for its own host (before exercising the foreground-return assertion). Relative-order fixture passed. The earlier foreground fixture's success does not prove the cross-process production case.

Follow-up installer SHA256: c455256893e762fa3046caab70b3b7875e67c494ecd442fda1b07a25cb0b53b1. Follow-up app.asar SHA256: c502094b1a4fc64555cd23aa3dc4d55deefac8944efc5d96be17dd9efb0483f9.

Follow-up installation completed with verified recovery and unchanged Data/Backpack bytes (5422/174/31 files). Running helper is pane-coordinator-82506dc804438a87.exe. After reopening the existing workspace and restoring maximization, observed order was Papers HWND 8522984, selected Chrome HWND 198082, then Word HWND 855408 (with inactive AutoCAD minimized between Chrome and Word). Chrome retained its pane bounds 942,84–1527,854 and normal non-topmost style. This verifies installed cross-process ordering; a user-driven Alt-Tab cycle remains distinct from this maintenance check.

## SlopTop installation

Creator requested installation of the same corrected build on SlopTop. Installed app.asar matches c502094b1a4fc64555cd23aa3dc4d55deefac8944efc5d96be17dd9efb0483f9. Supported installer verified unchanged profile and four registered Backpack roots (15208/1805/15670/786/469 files or link records). Recovery is D:\Programs\evTEMP\papers-sloptop-foreground-20261015\recovery. Pencilcase's reviewed node_modules junction was preserved as a junction to its original shared dependency target; backup verification compares the link itself without following it. Existing pages were flushed and Papers closed normally before installation. Reopened the three existing saved workspaces; helper pane-coordinator-82506dc804438a87.exe loaded.
