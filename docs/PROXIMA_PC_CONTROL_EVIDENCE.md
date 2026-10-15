# PC-to-PC Proxima control — 13 October 2026

The creator approved editing the other PC's Proxima only through its live owner. Android delivery and phone gesture work were excluded.

The existing Devices entry opens the full Proxima page against a granted owner snapshot. Commands are transported to the owner's existing Store.command, require the viewed source sequence and an idempotency key, and return a current owner snapshot only after persistence confirms. Refused, disconnected or unconfirmed acts never become receiver-local saves or an offline edit queue. Startup seeding and expiry remain owner work.

The live control snapshot includes approved task/activity placement separately from copy/follow projections. Existing copy/follow tests continue to pass. Remote persistence overrides the local IndexedDB adapter; deploying persistence.js with the other page files is required. An installed test caught that missing dependency before completion.

Backpack grant identity survives same-node/same-client automatic rejoin while authentication is renewed. Independent clients retain separate grants.

Verification:

- TypeScript typecheck and focused gateway/runtime checks passed (27 tests); device/grant and gateway checks passed (11 tests).
- Exact timeline and remote-domain tests passed, including stale sequence refusal, request replay and separated placement metadata.
- Full browser interface check verified delayed owner confirmation, accepted snapshots, stale refusal, disconnected refusal, local database preservation, and return to local.
- Real SlopTop-to-LapDog and LapDog-to-SlopTop gateway checks each created, replayed, edited, refused a stale edit, and deleted a uniquely named temporary task.
- Installed LapDog Devices UI opened SlopTop's full interface and confirmed a temporary owner edit without changing LapDog's local facts. Cleanup removed the temporary entry through the owner.

Both supported NSIS installers exited 0. Final installed app.asar SHA-256 on both PCs: `189A7235B8DF4E6D49BF511A07C96EE54A733B50857C75BB2D52198F6C5F450D`. Three desktop workspace IDs and one laptop workspace ID were preserved through graceful shutdown and the existing reload token. No desktop process was force-closed. Proxima public files were backed up before copying; no App files were hand-copied. No Android build or install was performed for this task. The laptop was returned to an ordinary launch; the temporary 9229 debugger listener was verified closed.

Rerunnable checks: `tools/probeProximaRemoteControl.mjs`, `tools/probeProximaLiveCommands.mjs`, and `tools/probeProximaDevicesExit.mjs`. The live check only mutates its uniquely named temporary task, then deletes it.

Source changes remain uncommitted alongside concurrent touch work. No public release or version increment was made.
