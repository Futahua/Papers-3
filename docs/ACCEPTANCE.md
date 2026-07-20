# Papers 3 — final acceptance report (plan section 29)

Build under test: source commit `70ccc69cad6c4341a29af706f99c95e38c925881`,
Windows x64 package `1.0.0`, verified 2026-07-21. Machine-readable records are
in [`docs/evidence/`](evidence/).

Status legend: ✅ passed · 🔶 implemented with a narrower automated proof

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Packaged Windows installer succeeds | ✅ | NSIS installer exited `0` in a dedicated install directory; [build verification](evidence/build-verification.json) |
| 2 | Papers launches without developer tooling | ✅ | Installed executable passed the vertical kill test; packaged `win-unpacked` executable passed both final E2E workflows |
| 3 | Create, rename, enter, leave, archive, switch Backpacks | ✅ | `backpackRegistry.test.ts`; real UI creation/entry in both E2E workflows |
| 4 | Last active Backpack and program restore after restart | ✅ | `killtest.e2e.ts` relaunch phase and `repository-workflow.e2e.ts` restoration phase |
| 5 | Canvas frame survives and recovers from program failure | ✅ | Real renderer process kill, recovery UI, program restart, state-preserving app restart |
| 6 | Programs sandboxed behind the narrow capability API | ✅ | CSP/sandbox loader, sender validation, broker and loader unit tests |
| 7 | Repository Research completes repository-to-document workflow | ✅ | `repository-workflow.e2e.ts`: register → evidence → notes → draft → FODT → shared summary → restart |
| 8 | Exact selections produce inspectable Hermes invocations | ✅ | Preview assertions in kill test and [Logseq demonstration](evidence/logseq-demonstration.json) |
| 9 | No Backpack/program-wide content shared implicitly | ✅ | Invocation schema requires an explicit selection/material list; prompt discloses that boundary |
| 10 | Shared previews disclose truncation and match submitted hashes | ✅ | `runService.test.ts`: hash mismatch rejection, omission and truncation disclosures |
| 11 | Results return to the declared program destination | ✅ | Destination validation/unit coverage plus real proposal acceptance in Logseq workflow |
| 12 | Stale selections/destinations detected before mutation | 🔶 | `proposals.js` re-hashes selected objects and converts stale draft mutations into create-new-only; branch is not separately driven by E2E |
| 13 | Agent Runs panel: inspect, approve, Stop, retry, return to origin | 🔶 | Cancellation, retry and interaction state unit-tested; inspect/approve/return exercised E2E; no automated click-through of every control |
| 14 | Authoritative session visible in Hermes Desktop | ✅ | Real ACP session IDs persisted by Hermes in kill, worker and Logseq evidence |
| 15 | Codex worker completes a real isolated coding task and checks | ✅ | Codex lane in [worker comparison](evidence/worker-comparison.json), delegated success and checks asserted |
| 16 | OpenCode worker completes a comparable task, different provider | ✅ | `opencode/big-pickle` lane in [worker comparison](evidence/worker-comparison.json) |
| 17 | Worker failure cannot corrupt the base repository | ✅ | Host resolves only granted worktrees; all lanes fingerprinted the base and Papers repositories unchanged |
| 18 | LibreOffice opens an editable generated report | ✅ | Exact 15,408-byte FODT opened through permission boundary in [Logseq demonstration](evidence/logseq-demonstration.json) |
| 19 | Visual Dashboard proves independent styling and isolation | ✅ | Repository workflow publishes an explicitly approved summary, renders it in the isolated dashboard, then restores it |
| 20 | Programs have no raw Node/fs/process/shell/credential/Electron access | ✅ | Sandboxed WebContentsView, context isolation, restrictive CSP, explicit preload surface, security tests |
| 21 | Permission denial and revocation work | ✅ | `capabilityBroker.test.ts`: deny, allow-once non-persistence, standing grant and revoke |
| 22 | Corrupt state recovered or quarantined honestly | ✅ | Atomic store and registry recovery tests; startup recovery report path |
| 23 | Logseq demonstration completes without pushing or copying the repository | ✅ | Pinned source stayed clean and push URL remained `DISABLED-no-push`; only three explicitly selected excerpts became evidence |
| 24 | Final Logseq report produced with selection provenance | ✅ | FODT structurally validated with pin, line ranges and three SHA-256 entries; [evidence](evidence/logseq-demonstration.json) |
| 25 | Packaged app passes restart and crash-recovery tests | ✅ | Final `win-unpacked` and installed-executable kill tests passed |
| 26 | Uninstall preserves creator data by default | ✅ | Silent uninstall exited `0`, removed the app, and preserved `%APPDATA%\papers3\PapersData`; builder also sets `deleteAppDataOnUninstall: false` |
| 27 | Every dependency/reused asset has recorded provenance | ✅ | `THIRD_PARTY_NOTICES.md`; no copied UI asset set |
| 28 | No reference repository modified | ✅ | Logseq remained at `a4963dca…`, clean, with pushing disabled after final run |
| 29 | Previous plan absent as competing source of truth | ✅ | The Markdown implementation plan is the sole plan file in the checkout |
| 30 | Final acceptance report links evidence for every criterion | ✅ | This report plus build, worker, and Logseq evidence records |

## Final command results

- `npm run typecheck` — passed
- `npm test` — 8 files, 59 tests passed
- Development E2E — kill test and Repository Research workflow passed
- Real Logseq E2E — passed in 35.6 s, including Hermes and LibreOffice
- Worker E2E — Hermes direct, Hermes→Codex, and Hermes→OpenCode passed
- `npm run package` — NSIS and `win-unpacked` produced successfully
- Packaged E2E — kill test and Repository Research workflow passed
- Installed E2E — kill test passed

The two 🔶 rows are coverage qualifications, not known product failures. They identify
useful regression tests to add after the deadline rather than unfinished runtime behavior.
