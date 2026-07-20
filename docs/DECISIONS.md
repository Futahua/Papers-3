# Papers 3 — Consequential decisions

Each entry records a decision that shapes the implementation, its evidence, and its reversibility. Ordinary reversible engineering choices are made without entries here.

## D-001 — Plan source: `PAPERS_3_IMPLEMENTATION_PLAN.md` from `agent/replace-papers3-plan` (2026-07-20)

`main` contained only the older `PAPERS_3_IMPLEMENTATION_PLAN.txt`. The branch `agent/replace-papers3-plan` (newest commit in the repository, same day as the implementation assignment) replaces it with `PAPERS_3_IMPLEMENTATION_PLAN.md` and a `README.md` — the exact files named in the implementation assignment. That branch was merged (fast-forward) into `agent/implement-papers3-v1` and its plan is treated as authoritative. The previous plan remains only in Git history, as the plan itself requires.

## D-002 — Hermes machine interface: ACP (`hermes acp`) (2026-07-20)

Installed Hermes: **Hermes Agent v0.16.0 (2026.6.5)**, Python 3.11.15, home `D:\LapSlop brotherhood\Programs\Assistant\HermesAI\.hermes`, executable `.hermes\hermes-agent\venv\Scripts\hermes.exe`.

Candidate machine interfaces inspected on the real installation:

- `hermes acp` — Agent Client Protocol (JSON-RPC over stdio) server for editor integration. `hermes acp --check` reports `Hermes ACP check OK`. Supports session creation, prompt turns, streamed session updates, permission requests, and cancellation per protocol.
- `hermes -z/--oneshot` — single prompt, final text only; no events, no cancellation, no session interaction. Verified working (`hermes -z` returned expected output), useful as a health probe only.
- `hermes dashboard` / `tui_gateway` — web UI with its own server; scraping it would duplicate a dashboard implementation, which the plan forbids.
- `hermes mcp` — Hermes as MCP server; tool-call surface, not a session/turn/event surface.

Decision: the HermesAdapter speaks ACP over stdio to a Papers-spawned `hermes acp` child process using the normal Hermes home. This is an officially supported, documented editor-integration surface with exactly the required semantics (sessions, turns, public events, approvals, cancellation, structured stop reasons). No Hermes configuration files are modified.

### D-002 verification (2026-07-20)

Live probe on the real installation (native Windows, Windows paths, no WSL): `initialize` → protocol v1, `agentInfo {name: "hermes-agent", version: "0.16.0"}`, `loadSession: true`, session fork/list/resume capabilities; `session/new` → ACP session id **equals** the durable Hermes session id in `~/.hermes/state.db` (`source=acp`), with `_meta.hermes.sessionProvenance` tracking internal rotation; `session/prompt` → streamed `agent_thought_chunk` + `agent_message_chunk` `session/update` notifications and returned `{stopReason: "end_turn", usage}`. Source inspection (acp_adapter/server.py) confirms: `session/request_permission` server→client requests for dangerous commands and edits (options allow_once/allow_session/allow_always/deny/deny_always, 60s timeout → deny), `session/cancel` notification → `stopReason: "cancelled"`, stop reasons limited to `end_turn | cancelled | refusal`. Sessions created over ACP are listed by `hermes sessions list`, resumable by `hermes --resume <id>`, and visible in Hermes Desktop (which reads the same `state.db` through the dashboard API). Alternative interface `hermes dashboard` + `/api/ws` JSON-RPC (the surface Hermes Desktop itself spawns) is documented as fallback; ACP chosen as the lighter, precisely scoped, per-plan "supported headless interface".

## D-007 — Worker delegation path: Hermes terminal tool, not a nonexistent skill (2026-07-20)

The plan (§16) says "Use Hermes' existing Codex skill … Begin with Hermes' bundled OpenCode skill." Inspection of the installed Hermes 0.16.0 shows **no bundled Codex or OpenCode delegation skill or tool**: `delegate_task` spawns internal Hermes subagents only; kanban dispatches Hermes profiles (`hermes -p <profile> chat -q …`); `codex_app_server` is the inverse direction (Codex driving Hermes' own loop as its model runtime); "opencode" appears upstream only as a model-provider profile. The supported, Hermes-supervised way to run Codex/OpenCode on a task is Hermes' own **terminal tool** executing the worker CLI (`codex exec …` / `opencode run …`) in the task's working directory, under Hermes' dangerous-command approval flow — which surfaces to Papers as ACP `session/request_permission` and tool-call events.

Decision: Papers' coding-task invocations instruct Hermes (in the exact, inspectable program-owned invocation text) to execute the chosen worker CLI in the isolated Git worktree, wait for completion, and report results. Hermes remains the supervisor; Papers and programs never invoke the worker CLIs directly; approvals and progress remain visible in the Agent Runs panel and in Hermes' own session record. This satisfies §16's boundary ("any approved adapter sits behind Hermes") with zero new adapters.

## D-003 — Codex worker binary: Codex Desktop-bundled CLI (2026-07-20)

The npm-installed `codex` shim is codex-cli **0.125.0** and currently fails to parse the user's `~/.codex/config.toml` (`service_tier = "default"` — variant no longer accepted by 0.125.0). The Codex Desktop installation bundles codex-cli **0.145.0-alpha.18** at `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe` (path recorded in `config.toml` `CODEX_CLI_PATH`), which parses the same config successfully and reports `Logged in using ChatGPT`.

Decision: worker validation uses the Desktop-bundled binary, resolved dynamically (via `CODEX_HOME` config `CODEX_CLI_PATH` value or newest `%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe`). The user's Codex configuration is **not** edited. The npm shim remains untouched and unused.

## D-004 — Worker provider diversity (2026-07-20)

OpenCode CLI **1.14.28** is installed with credentials for Ollama Cloud, OpenRouter, OpenCode Go, and OpenAI (oauth) — a different provider than Codex (ChatGPT) is therefore available for the required comparison (plan §16.3, done-criterion 16). Hermes' own inference is configured through provider `opencode-zen` and verified working end-to-end.

## D-005 — Build stack (2026-07-20)

Electron **43.1.1** (current stable; `WebContentsView` is the supported embedding API), electron-vite **5.0.0** + vite **7.3.6** (electron-vite 5 peer-depends on vite ≤7, verified during install), electron-builder **26.15.3** (NSIS Windows installer), TypeScript **5.9.3** (TS 7.x is the new Go-port major; 5.9 chosen for ecosystem compatibility), React **19.2.7** for the host renderer, zod **4.4.3** for boundary validation, vitest **4.1.10** for automated tests. All versions exact-pinned in `package.json`; `package-lock.json` committed.

## D-006 — Git operations via system `git` CLI (2026-07-20)

Repository inspection and worktree management use the installed `git` (2.53.0.windows.2) through `execFile` with structured argument arrays (no shell strings), rather than a bundled Git library. Rationale: the plan requires structured process arguments and worktree operations; system git is already a product dependency for the workflow and avoids shipping a second Git implementation.
