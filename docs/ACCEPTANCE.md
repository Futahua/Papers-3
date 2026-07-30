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
- Archived Backpacks can be deleted only after an inline confirmation that names the
  exact Backpack. Deletion removes it from Papers without touching external files,
  applications, scripts or folders; Papers retains the internal record for recovery.
- Programs, Runs and Papers agent permissions can remain absent from production.
- The packaged Electron shell can launch and pass its existing product E2E.
- Permanent Basic navigation visibly containing Backpacks, Tools and Settings.
- Hermes remains global and is never given Backpack-derived working context.
- `Add Backpack` asks only for a name.
- New Backpacks create no folder, cover, canvas, conversation or fake contents.
- `Enter` on an empty Backpack shows the exact required warning.
- Tools is a permanent Basic destination.
- The `(machine wide complex capability)` placeholder and simulated entered environment
  are absent from the shipped experience.
- No Backpack folder is passed to `hermes desktop --cwd`.
- Restart preserves names and normal settings.
- The Papers shell visibly reuses Papers 1's theme without importing its obsolete agent
  workbench behavior or restyling Hermes internally.
- The installed creator profile contains no seeded or test Backpack, and automated tests
  prove they use isolated temporary profiles.

## Source-verified for the explicitly authorized 1.2.3 correction

- Papers 1.2.3 contains no compiled “As you Go” name, ID, renderer, pickup prompt or action
  definitions. On the primary machine, `Enter` displays the separately maintained local
  project through the narrow host seam.
- The local “As you Go” project shows the four existing actions and a **Copy agent pickup
  prompt** control. The copied text directs an agent to current `AGENTS.md`, `HERMES.md`
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

## Known mismatch

The current Tools screen still presents an unapproved global/shared Tool definition and
examples. That copy is not accepted product truth; only the creator decides what is a
Tool. Its correction remains separately unauthorized and is recorded in
[`PROBLEMS.md`](PROBLEMS.md).

## Human acceptance

The creator can verify the present promise by clicking through Basic, creating a named
Backpack, observing the exact empty warning, opening Tools, opening Hermes before
and after Backpack interaction, entering “As you Go,” copying the agent pickup prompt,
restarting Papers and confirming the name remains. No source-code review is required.

Future usefulness is accepted through real Backpack use, not by accumulating speculative
framework screens or declaring undecided behavior complete.
