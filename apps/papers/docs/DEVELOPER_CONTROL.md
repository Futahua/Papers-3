# Papers developer control

Papers has an opt-in local control plane for automation, diagnostics and tests.
It is deliberately absent from ordinary production launches.

## Start

Set both variables before launching Papers:

```powershell
$env:PAPERS_DEV_CONTROL = '1'
$env:PAPERS_DEV_CONTROL_DESCRIPTOR = 'D:\temp\papers-control.json'
npm start
```

The descriptor contains a random process-specific named-pipe address and a
random 256-bit bearer token. Treat it as a temporary credential. Papers writes
it with restrictive permissions where supported and removes it during normal
shutdown. Never commit, sync or log it.

## Use

```powershell
npm run papersctl -- inspect.snapshot --descriptor D:\temp\papers-control.json
npm run papersctl -- inspect.windows --descriptor D:\temp\papers-control.json
npm run papersctl -- window.create --descriptor D:\temp\papers-control.json
# Keep this process attached and print one JSON object per event.
npm run papersctl -- events.subscribe --events window.created,workspace.changed --descriptor D:\temp\papers-control.json
# Cross-window movement names both windows explicitly.
npm run papersctl -- layout.moveSurfaceToWindow --source-window 1 --target-window 2 --surface sf-1 --group group-main --index 0 --descriptor D:\temp\papers-control.json
# Destructive actions require an exact, operation-bound confirmation phrase.
npm run papersctl -- backpack.archive --project bp-… --confirmation 'ARCHIVE BACKPACK "Exact name"' --descriptor D:\temp\papers-control.json
npm run papersctl -- backpack.remove --project bp-… --confirmation 'DELETE BACKPACK "Exact name"' --descriptor D:\temp\papers-control.json
```

`inspect.snapshot` is a coherent, versioned, redacted view of current Papers
authority: build identity, native windows and global Hermes placement/owner. It
does not expose project roots, tokens, credentials or Backpack documents.

The protocol is newline-delimited JSON over a Windows named pipe, never TCP.
Requests are size-limited, versioned, token-authenticated and Zod-validated.
The control actor uses explicit semantic commands; it never fabricates an
Electron sender id or executes arbitrary renderer JavaScript.

`events.subscribe` subscribes only the authenticated connection that issued the
request. Event frames are newline-delimited JSON and are distinct from request
responses, so a client can receive `window.created` or `workspace.changed`
while a command is still pending. Payloads contain only logical IDs and the
validated workspace topology; URLs, roots, sender/WebContents IDs, native
handles and Dockview internals are not part of the event schema.

`backpack.archive` and `backpack.remove` are the only destructive control
workflows. Each keeps one authenticated connection open while Papers issues a
single-use challenge and then executes it. The challenge is bound to that
connection, exact action, Backpack ID and current name; it expires after five
minutes, is consumed by the first execution attempt, and is revoked when the
connection closes. Papers rechecks the Backpack's name and archived state
while holding the same per-project ownership gate used by rename, archive,
restore and removal, and keeps that gate through mutation. A different
connection, stale name/state, wrong phrase, expired challenge or replay is
refused. `backpack.remove` also retains the product rule that only an already
archived Backpack may be removed; its internal record remains recoverable and
external files/applications are not touched.

When attached to a terminal, `papersctl` prompts for the exact phrase. Automated
callers may pass `--confirmation`, but must supply the complete phrase naming
the exact Backpack. There is no `--yes`, force flag, durable approval, or way to
separate prepare and execute across connections.

New commands must be added to the semantic
catalog with explicit target authority, redaction and confirmation policy. UI
geometry synchronization channels are not developer commands merely because
they exist in renderer IPC.

## MCP adapter

Papers also ships a standalone stdio MCP adapter for developer/agent use:

```powershell
npm run papers:mcp -- --descriptor D:\temp\papers-control.json
```

The adapter exposes one tool, `papers_control`, with `{ method, params }`. It
forwards those values unchanged through the shared `papersControlClient`; the
existing local protocol remains the sole command catalog, schema validator,
target authority, redaction boundary and business-logic layer. The adapter
opens no TCP/HTTP listener, does not call Electron or the host facade directly,
does not inspect project files, and never exposes the descriptor or bearer
token in tool output.

Explicit identities remain mandatory. For example,
`layout.moveSurfaceToWindow` still requires `sourceWindowId`, `surfaceId`,
`targetWindowId`, `targetGroupId` and `targetIndex`; MCP does not infer a
current, focused or only target.

Destructive flows use the same two calls on one underlying control connection:
first `backpack.archive.prepare` or `backpack.remove.prepare`, then
`confirmation.execute` with the exact returned phrase. The adapter does not
auto-confirm or add a one-shot destructive tool. MCP cancellation or adapter
shutdown closes the control connection, revoking any outstanding challenge.
Events are not exposed in this first MCP slice; future event support must
consume the existing `events.subscribe` stream rather than create another bus.
