# Papers — current acceptance status

## Verified in the installed shell

  (D-011). The earlier `/chat` embedding was removed, not retained.
  launching a duplicate.
  and starts the backend from that install rather than PATH (D-018).
- Settings reports which build is running, so two machines can be compared (D-017).
- Papers finds, downloads and installs its own updates from its GitHub releases (D-019).
- Backpack names persist.
- Archived Backpacks can be deleted only after an inline confirmation that names the
  exact Backpack. Deletion removes it from Papers without touching external files,
  applications, scripts or folders; Papers retains the internal record for recovery.
- Programs, Runs and Papers agent permissions can remain absent from production.
- The packaged Electron shell can launch and pass its existing product E2E.
- Permanent Basic navigation visibly containing Backpacks and Settings.
- `Add Backpack` asks only for a name.
- New Backpacks create no folder, cover, canvas, conversation or fake contents.
- `Enter` on an empty Backpack shows the exact required warning.
- Pencilcase provides tool management as an independent Backpack.
- The `(machine wide complex capability)` placeholder and simulated entered environment
  are absent from the shipped experience.
- Restart preserves names and normal settings.
- The Papers shell visibly reuses Papers 1's theme without importing its obsolete agent
- The installed creator profile contains no seeded or test Backpack, and automated tests
  prove they use isolated temporary profiles.

## Source-verified for the explicitly authorized 1.2.3 correction

- Papers 1.2.3 contains no compiled “As you Go” name, ID, renderer, pickup prompt or action
  definitions. On the primary machine, `Enter` displays the separately maintained local
  project through the narrow host seam.
- The local “As you Go” project shows the four existing actions and a **Copy agent pickup
  and the repository document map before work.
- Changing that external project's interface, prompt or declared actions does not require
  a Papers version, release, install or restart. Other machines receive none of those
  project changes unless the creator separately decides how to provide them.
- The host serves only the project's `public/` subtree. Its private manifest and absolute
  action targets cannot be retrieved directly or through a junction alias, and forged
  wrong-source, wrong-origin or malformed project messages cannot launch, copy or close.

## Source-verified for the explicitly authorized 1.2.4 correction

- Entering “As you Go,” closing Papers without choosing **Back to Papers**, and reopening
  the same isolated profile restores the external project automatically.
- Choosing **Back to Papers** clears the resumable Backpack selection.
- Backpack project files and the internal Backpack record remain unchanged by entry,
  restart and leave; only the existing registry activity fields change.

## Tool ownership

The creator's 2026-10-07 request replaces the host's placeholder Tools screen with the
independent Pencilcase Backpack. Its catalog and management UI own tool definitions;
Papers reports actual backend availability, supported lifecycle controls and usage.

## Human acceptance

Future usefulness is accepted through real Backpack use, not by accumulating speculative
framework screens or declaring undecided behavior complete.

## 2026-10-07 — Creator-requested removal of the project-state size cap

Removed the fixed five-million-character rejection in project-state IPC and persistence. A synthetic 5.1-million-character record saves atomically and reloads with its complete contents. Relevant host tests: 43 passed; TypeScript checking passed. Local installer built with the current public version and `--publish never`; no public release created. Independent Backpack snapshot-size checks were removed separately.
