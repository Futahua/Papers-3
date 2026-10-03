# Papers agent entry point

Read [`HERMES.md`](HERMES.md) completely before changing Papers or proposing product
behavior. It is the canonical agent contract and documentation map.

Do not infer product rules from source code, old commits, predecessor projects or
historical evidence. A current creator correction outranks those records.

## Intended debugging pipeline for agents

Use Papers' existing visual diagnostics as the default workflow for Papers and
hosted Backpack rendering problems. Read
[`docs/DEVELOPER_CONTROL.md`](docs/DEVELOPER_CONTROL.md) for the connection and
MCP contract, and
[`docs/WORKSPACE_AND_CONTROL_PROGRESS.md`](docs/WORKSPACE_AND_CONTROL_PROGRESS.md)
for scope, acceptance evidence, and exact reviewer sign-offs. The completed
C1/P1-P4 infrastructure is reusable; future Backpacks do not require rebuilding
the debugging pipeline from scratch. Project-specific semantic keys, fixtures,
and assertions belong in the independent Backpack project when needed.

1. **Establish the running instance.** Inspect repository/remote parity and
   preserve unrelated changes. Use an existing diagnostic instance launched
   with `PAPERS_DEV_CONTROL=1` and its explicit descriptor. Check
   `inspect.process` for process/start/build identity, then `inspect.windows`
   and `inspect.surfaces` to identify the exact `windowId` and `surfaceId`.
   A source checkout or executable path alone does not prove which build is
   running. Ordinary production launches do not expose this endpoint; report
   that condition accurately and use the existing authorization for any
   diagnostic restart, or obtain authorization if none exists. Use isolated
   synthetic profiles for reproductions and tests. Treat the descriptor as a
   credential: never print, commit, or include its contents in evidence.
2. **Collect visual evidence.** Start with `papers:visual-debug` below. It
   composes exact-target inspection, lifecycle/diagnostic subscription, a
   bounded wait, composed-window capture, a surface report, and artifact SHA
   verification. Inspect the resulting `summary.json`, `events.ndjson`,
   `report.zip`, and available PNGs. Check capture consistency and reported
   failures; file existence or valid saved state does not prove rendered
   success. A surface PNG and a composed-window PNG answer different questions;
   neither alone proves the Windows desktop-compositor appearance.
3. **Use semantic control for targeted investigation.** Through the stdio MCP
   adapter (`papers_control`, with `{ method, params }`) or shared control
   client, use `visual.wait`, `inspect.visual.diagnostics`,
   `inspect.visual.timeline`, `inspect.visual.elements`, `visual.assert`,
   `capture.surface`, `capture.element`, and `capture.window` as appropriate.
   Name explicit targets and use registered element keys. Wait for events with
   bounded timeouts; do not repeatedly poll screenshots or invent arbitrary
   JavaScript/selector access. MCP forwards the existing control contract.
4. **Preserve intermittent incidents.** Use `papers:visual-incident` for a
   session-local transcript, bounded to at most 120 seconds, 1024 records, and
   4 MiB. Inspect truncation and recovered/cross-surface/unrecoverable sequence
   gaps. This extends client evidence without increasing Papers' ordinary
   history retention; missing evidence is not proof that no failure occurred.
5. **Compare against an explicit baseline.** Use `papers:visual-compare` with
   the selected synthetic fixture's baseline manifest and PNG, plus either a
   live exact target or an existing P1 evidence directory. Inspect dimension,
   pixel, and semantic differences separately. The comparison verifies input
   hashes and has no automatic baseline update/blessing path. Keep baseline
   approval separate from diagnosing a regression.
6. **Fix and verify the observed cause.** Keep host fixes generic and Backpack
   behavior in its own project. Reproduce using synthetic data, test the
   affected visual path, and record the actual validation results and exact
   pushed SHA. Distinguish source, development, packaged, and installed-runtime
   evidence. Reviewer sign-off does not imply every E2E test passes or that an
   installed copy contains the latest source. Update the progress document
   with remaining failures as well as successful evidence.

Run these templates from the source root, replacing placeholders with verified
values. Baseline paths are local client inputs, never Papers control parameters:

```text
npm run papers:visual-debug -- --descriptor <descriptor> --window <windowId> --surface <surfaceId> --output-dir <new-evidence-directory>
npm run papers:mcp -- --descriptor <descriptor>
npm run papers:visual-incident -- --descriptor <descriptor> --window <windowId> --surface <surfaceId> --duration-ms 60000 --output-dir <new-incident-directory>
npm run papers:visual-compare -- --baseline-manifest <manifest.json> --baseline-png <baseline.png> --descriptor <descriptor> --window <windowId> --surface <surfaceId>
npm run papers:visual-compare -- --baseline-manifest <manifest.json> --baseline-png <baseline.png> --evidence-dir <existing-P1-evidence-directory>
```

Diagnostic access does not authorize creator-data mutation, desktop control or
capture, automatic restarts, installation, publication, or release. Preserve
existing authorization boundaries and user-owned changes. Additional host-layer
inspection is conditional on a concrete diagnosis gap, not an unfinished
requirement to expand the host proactively.

## Reviewer handoff

The browser reviewer is audit-only. Supply an exact pushed SHA, source links,
validation evidence, and a question about the intended agenda's completeness.
Implement any concrete correction locally and resubmit its new SHA. Follow the
one-shot watcher contract in the progress document: one deferred operation must
observe `Stop answering` appear and disappear, then notify the current task
once. Keep the initiating turn alive; do not repeatedly inspect the browser or
create a recurring polling automation. Continue in a fresh reviewer conversation
with the same evidence and scope if the previous conversation reaches its limit.
