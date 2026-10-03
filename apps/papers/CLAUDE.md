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

## In-app ChatGPT reviewer browser workflow

The browser reviewer is an audit-only collaborator. It cannot edit this
checkout, create patches, or write repository files. Ask it for an audit,
diagnosis, design options, implementation steps, and a verdict; implement the
chosen correction locally in the Papers checkout.

When continuing an existing review, reclaim the exact persistent in-app tab by
its reviewer URL. This is the Codex app's browser session, not an instruction
to operate the creator's desktop or external browser. Keep the browser work
scoped to the reviewer conversation and any screenshots or evidence the creator
explicitly supplied.

Every audit request should include:

- the exact pushed commit SHA being reviewed, with source paths or commit links;
- the intended behavior and the concrete observed failure, including the
  relevant screenshot or reproduction sequence;
- validation evidence (tests, build/package result, executable hash, and any
  known pre-existing or out-of-scope issue); and
- an explicit question asking whether the overall agenda is complete, what
  remains missing, and the smallest set of hardening/implementation steps.

Do not ask the reviewer to implement code. After applying its recommendations,
run the relevant tests, commit and push the new exact SHA, then resubmit that
SHA for audit. Treat a reviewer verdict as source-scope evidence, not as a
replacement for local validation or packaged/native acceptance. If the review
conversation reaches its message limit, open a fresh reviewer conversation and
carry forward the current SHA, prior verdict, scope, evidence, screenshots,
and unresolved questions.

### One deferred completion watcher

After sending a reviewer message, keep the same Codex turn alive and use one
deferred watcher operation. Inside that single operation, sample roughly once
per second until the reviewer UI has shown `Stop answering` and then the button
has disappeared. The watcher must have a generous bounded timeout, terminate
itself, and call `notify(...)` exactly once when complete. Only after that wake
should Codex read the completed response, implement changes, or send another
review request. Do not repeatedly inspect the page from model turns and do not
create a recurring polling automation. If the tab handle was released, reclaim
the exact reviewer URL from the persistent browser session before replacing the
watcher.

The watcher shape is documented in `AGENTS.md`; keep its two-state requirement
(`Stop answering` appeared, then disappeared) intact so an immediate pre-send
snapshot cannot be mistaken for a completed answer.
