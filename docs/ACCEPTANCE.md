# Papers — current acceptance status

## Verified in the installed shell

- Production runs one Hermes backend and shows the real Hermes Desktop docked or detached
  (D-011). The earlier `/chat` embedding was removed, not retained.
- Papers can open Hermes Desktop.
- Papers locates Hermes on each machine at run time, with no per-machine settings (D-016),
  and starts the backend from that install rather than PATH (D-018).
- Settings reports which build is running, so two machines can be compared (D-017).
- Papers finds, downloads and installs its own updates from its GitHub releases (D-019).
- Backpack names persist.
- Programs, Runs and Papers agent permissions can remain absent from production.
- The packaged Electron shell can launch and pass its existing product E2E.
- Permanent Basic navigation visibly containing Backpacks, Tools and Settings.
- Hermes remains global and is never given Backpack-derived working context.
- `Add Backpack` asks only for a name.
- New Backpacks create no folder, cover, canvas, conversation or fake contents.
- `Enter` opens the Backpack; an empty one says `Nothing here yet.` and offers `Add button`.
- A creator can name a button, choose or type an existing Windows shortcut, script,
  application, file or folder, and launch it from the Backpack.
- Button definitions persist under `Shared/backpacks/<id>/buttons.json`; automated product
  E2E proves a real `.cmd` target executes, not merely that a tile renders.
- Tools is a global destination with an honest state and no invented Tool contract.
- The `(machine wide complex capability)` placeholder and simulated entered environment
  are absent from the shipped experience.
- No Backpack folder is passed to `hermes desktop --cwd`.
- Restart preserves names and normal settings.
- The Papers shell visibly reuses Papers 1's theme without importing its obsolete agent
  workbench behavior or restyling Hermes internally.
- The installed creator profile contains no seeded or test Backpack, and automated tests
  prove they use isolated temporary profiles.

## Human acceptance

The creator can verify the present promise by entering a Backpack, adding a named button
for an existing shortcut or script, clicking it and seeing the real target open or run.
Returning to Papers and reopening the Backpack must preserve the button. Hermes remains
global before and after this interaction. No source-code review is required.

Future usefulness is accepted through real Backpack use, not by accumulating speculative
framework screens or declaring undecided behavior complete.
