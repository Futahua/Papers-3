# Claude pickup for Papers

Read [`HERMES.md`](HERMES.md) completely before changing Papers or proposing
product behavior. It is the canonical creator contract and documentation map.

## Programmatic control and audits

Prefer Papers' supported developer control plane over mouse/keyboard computer
control or arbitrary renderer JavaScript for routine setup, inspection and
verification. Read [`docs/DEVELOPER_CONTROL.md`](docs/DEVELOPER_CONTROL.md).

The control plane is opt-in and absent from ordinary launches. For a source
checkout audit, choose a temporary descriptor path and launch with:

```powershell
$env:PAPERS_DEV_CONTROL = '1'
$env:PAPERS_DEV_CONTROL_DESCRIPTOR = 'D:\temp\papers-control.json'
npm start
```

Then use the semantic CLI:

```powershell
npm run papersctl -- inspect.snapshot --descriptor D:\temp\papers-control.json
npm run papersctl -- inspect.windows --descriptor D:\temp\papers-control.json
npm run papersctl -- window.create --descriptor D:\temp\papers-control.json
```

Use `inspect.snapshot` as the authoritative redacted audit state. It reports the
build, live Papers windows and global Hermes placement/owner without exposing
project roots, Backpack documents or credentials. Use Playwright/computer
control only for behavior that genuinely requires visual, keyboard,
accessibility, focus, crash or native-window evidence.

Security invariants:

- Never log, commit, sync or paste the descriptor; it contains a live bearer
  token and process-specific pipe address.
- Never enable the server for a normal production launch.
- Never fabricate a `WebContents` sender or bypass window/project authority.
- Add only semantic commands with strict schemas and explicit targets. Renderer
  geometry/event IPC is not a developer command surface.
- Destructive commands are not currently supported. Do not add one without an
  explicit confirmation protocol and creator-authorized scope.

The contract and transport tests are:

```powershell
npx vitest run tests/unit/papersControlProtocol.test.ts tests/unit/papersControlServer.test.ts
npm run build
npx vitest run --config vitest.e2e.config.ts tests/e2e/dev-control.e2e.ts
```

The Electron E2E proves that the API can inspect Papers, create a real second
native window and verify both windows without DOM injection.
