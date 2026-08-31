# Wave organization relay — creator-directed exception

2026-08-31: creator requested archive/restore/delete waves, names, custom groups and
drag movement in the Delegate Wave Backpack, then approved the identified missing
durable contract. This is a narrow host seam, not ordinary Backpack UI moved into
Papers.

Adds only `organization.get` (fixed GET `/v1/wave-organization`) and
`organization.change` (fixed POST). The latter forwards an enumerated action,
bounded IDs, a name of at most 240 characters, and a boolean deletion confirmation.
No arbitrary route, URL, token or shell capability reaches the page. Existing
bound-Backpack checks and server-owned operator credentials remain unchanged.
The DW server enforces archive/deletion lifecycle rules; the host does not invent
an independent state machine. Delete affects organizer visibility, not audit data.

UI lives in the external `delegate-wave-backpack` repository. Durable preferences
live in DW schema 38, not Papers storage. All three updates are needed for the live
feature. This source commit does not install, release or restart Papers, Hermes or DW.
The existing hidden launch paths must remain intact during eventual deployment.

Local checks: 16/16 relay tests; full Papers suite 483 passed / 4 skipped;
TypeScript check passed. Companion backend/UI evidence is in DW's
`WAVE-ORGANIZATION.md`. Deployment and real Papers validation remain a separate gate.
