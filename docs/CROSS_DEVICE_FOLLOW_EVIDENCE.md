# Proxima follow implementation evidence

Reference under AGENTS.md and CROSS_DEVICE_PLAN.md; this is evidence, not a replacement scope or completion claim. Verified 2026-10-13.

Proxima exposes explicit independent copy and Copy and follow. The receiving Store.command stages and commits the approved graph, subscription and receipt in its existing IndexedDB transaction. Saved requests retain their mode and binding across restart. Following tracks the originally selected graph; newly required dependencies require review, while unrelated new source entries are neither imported nor retained in the subscription snapshot.

Clean source changes update approved domain fields while retaining local placement and unknown fields. Local edits hold the incoming change. The Following panel offers Keep mine, Use source and Save both, checks that the reviewed local/source conflict still matches, and saves both copies atomically. Source deletion remains a warning across repeated refreshes and reload; it never deletes the local record. Stop following retains the displayed local copy. Origin provenance prevents following one's own data back through another owner.

Running intervals and elastic queues use the existing queue calculation with the source's observed clock. Their receiving records do not start an independent timer. Online read-time projection advances without tick events or writes; loss of the owner freezes the last observation. Local interval edits freeze the displayed times in the same command transaction, including rollback on refusal or save failure. Cached owner snapshots can restore an offline projection after reopening. Local layout changes do not dirty the portable facts.

Evidence:

- `node --test remote-domain.test.mjs exact-timeline.test.mjs` in Proxima: 41 passed, including conflict choices, stale approval, source deletion, dependency approval, anti-loop checks, clock projection, stopping and failed-write rollback.
- Papers typecheck and build passed. Focused remote client, file capability and Backpack runtime tests: 54 passed.
- `node tools/probeProximaCrossDevice.mjs --follow`: two isolated real Papers instances pair through the host, display source data, approve a selected copy, retain it through IndexedDB reload, create a separate followed copy, apply a clean source update, retain an independent copy, resolve local conflict with Use source and Save both, and reopen all three approved task copies. The same fixture verifies an actual rendered live source blob with its visible source label and no durable tick event.
- Generated fixture evidence: `D:\Programs\evTEMP\papers-proxima-devices-0uUxFm`. Fixture processes retired normally. Creator profiles were not used.
- Local Lapdog reconnected; the laptop's installed Papers main process 80376 remains at the supported App path. This is reachability/liveness evidence, not installation of this new follow code.

Delivery limits remain explicit. This stage is source-verified; the laptop still has the earlier Papers/AYG installation and its existing Proxima. The phone still has the earlier read-only data client. Neither has received this follow stage. Actual two-machine following, full read-only remote calendar/timeline presentation, checked edit-session save-back, persistent background transfer lifecycle, creator resource onboarding and remaining performance/provider gates are still open under the full plan. A read-only fact list or a passing isolated fixture does not close those requirements.
