# Inline As you Go device tabs — 2026-10-14

## Creator correction: Files only

The initial installation below embedded a whole remote workspace; the creator
rejected that composition. It is superseded by the Files-only AYG correction.
Clicking a device row in the existing Devices popup now immediately opens
`<device> · Files`, leaving the original Files location unchanged. The child mounts
only the navigator, with no Preview panel or native coordinator of its own.
The containing page resolves current native PageKey membership for selections and
further device opens, including after restart; it owns the existing shared Preview.
Mobile's previous layer/drive behavior remains unchanged.

Actual LapDog Devices-menu click opened SlopTop · Files inside Files; its original
location stayed As you Go. Child DOM had zero Preview/native panels and no visible
canvas; its navigator covered the entire 444 × 379 DIP slot. Cold restoration and
native close passed. Both machines received reviewed Backpack files with backups
and graceful window restoration. Host app.asar remains the same B8110C… build.
Final AYG integration suite: 2,032 tests passed. After cold restart the child URL
contained only device, inline flag and page key; clicking Poordroid from that restored
SlopTop Files tab still added Poordroid · Files to the same native Files group.
Both test tabs then closed normally. No additional Papers surface was presented.

Shared Preview follow-up: an installed SlopTop Files child sent the native remote
fixture `D:\Programs\evTEMP\papers-device-check\note.txt` through the same
previewPath sender used by navigator selection. LapDog's existing visible follow
Preview displayed note.txt and its text content, while the child had no Preview.
The disposable child was closed after inspection. This verifies the installed
sender/owner/rendering route; it was not a physical mouse-click selection test.

## Initial host machinery and evidence

Opening a new device view in PC As you Go adds an inline native document tab to
the existing Files group. It retains the outer Papers surface and its other groups.
An inline view has a durable logical surface identity, device ID and parent key,
but is excluded from the outer Papers strip. Restoring the workspace attaches that
child to its saved native tab. Closing the native tab saves and retires the child.

Five AYG modules and the Papers host changes are installed on SlopTop and LapDog.
Backpack originals were compared ignoring line endings and backed up. Papers used
the supported installer, `release-inline-device-dpi-20261014`; both app.asar hashes:
`B8110C3146FFFC92324BE0F675408D1B88926B956C1692E971FE8F37F2DBB371`.

## Verified

- Typecheck and focused topology/routing/hydration tests passed. Added checks cover
  same-project child authorization, native attachment before acknowledgement,
  outer-tab exclusion, device restoration and fractional DIP presentation settling.
- Real LapDog opened Poordroid in `system-workspace-files`, with no additional
  outer Papers tab. The child rendered at 444 × 379 DIP with its remote navigator.
- Cold restoration retained the child and its native tab. State/geometry revisions
  stayed 15/8 across a three-second sample. Native close removed that tab successfully.
- LapDog then exited gracefully and reopened its one recorded workspace.
- Real LapDog opened SlopTop in the same Files group, and closed it successfully.
  Existing Files/Preview, PDF, native apps and Proxima references remained present.
- SlopTop exited gracefully for installation and restored its three workspace IDs.
  No desktop process was force-closed. Both machines have the exact same host build.

The scaled laptop exposed a feedback loop: native WebContentsView bounds are integer
DIPs while pane geometry was fractional. Comparison now normalizes to the actual
integer bounds, avoiding repeated presentation updates. A stalled earlier laptop
background process was cleared only after diagnostics confirmed saves and zero
workspace windows; the corrected build subsequently passed graceful shutdown.

Moving an entire parent group across windows and opening another device from an
already-inline child have not been separately verified. Source remains uncommitted
alongside the pre-existing changes.
