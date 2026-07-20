# Papers 3 — Architecture

Electron 43 + TypeScript. One `BaseWindow` hosts two layers of `WebContentsView`:

```text
Electron main process (src/main)
├── backpacks/    BackpackRegistry — identity, enter/leave, last-active
├── canvas/       CanvasRuntime + ProgramLoader — program views, lifecycle, crash isolation
├── capabilities/ CapabilityBroker + PermissionStore — validated grants, prompts
├── persistence/  AtomicJsonStore + PapersData layout + RecoveryService
├── hermes/       HermesAdapter — ACP client over stdio to `hermes acp`
├── agents/       AgentRunService — immutable invocations, run projection, results
├── external/     ExternalApplicationBridge — LibreOffice, file browser, URLs
└── git/          GitService — repo info + disposable worktrees via system git

Host renderer (src/host, React)        — Backpack switcher, Canvas frame, launcher,
                                          top shelf, Agent Runs, permission prompts,
                                          result previews, failure recovery
Sandboxed program renderers (programs/) — one WebContentsView per active program:
                                          contextIsolation, sandbox:true, no node,
                                          custom papers-program:// scheme, narrow
                                          PapersProgramAPI preload
```

## Boundary rules

- Renderers never receive raw `ipcRenderer`, Node, filesystem, shell, process, credential, or Electron APIs. Preloads expose explicit methods only.
- Every privileged request is validated in the main process: sender WebContents identity → program identity → manifest capability declaration → grant → zod argument schema → constrained execution → structured result/error.
- Program HTML/JS loads only from the packaged `programs/` directory through the `papers-program://` scheme; navigation and window creation are denied.
- Secrets and transport details stay in the main process. Programs receive opaque run/session references.
- Hermes owns model reasoning, sessions, approvals, and workers. Papers projects public events only.

## Persistence

`PapersData/` under Electron `userData` (survives uninstall by default): atomic temp+rename writes, `.backup` last-known-good, corrupt files quarantined into `recovery/` with reasons, schema versions everywhere, no destructive migration. See `src/main/persistence/`.

## Source layout limits

No file over ~700 lines without a recorded decision; one authoritative owner per state concept; no abstraction without an active consumer.
