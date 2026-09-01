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

This is the first narrow milestone. New commands must be added to the semantic
catalog with explicit target authority, redaction and confirmation policy. UI
geometry synchronization channels are not developer commands merely because
they exist in renderer IPC.
