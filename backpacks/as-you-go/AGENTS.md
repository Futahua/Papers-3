Read `README.md`, then read `AGENTS.md` and `HERMES.md` completely in the canonical Papers
repository at `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3` before acting.

Before changing code, read `ARCHITECTURE.md` in this repository: it maps each change type
to the module that owns it and lists the interaction, store, host and compatibility rules
that keep this codebase from reverting to a monolith. New features belong in the named
modules, not back in the entry file.

Before changing the window-layout feature, read `EYE-TEST-PROBLEMS.md`. It records current
creator-observed failures and supersedes conflicting automated acceptance assumptions.

This is the machine-local “As you Go” Backpack project. Modify it here; do not place its
name, ID, interface, prompt or action definitions into Papers' compiled source. Do not
release Papers for ordinary changes to this project.

The creator has explicitly authorized the As you Go explorer feature. Its tree model,
presentation, persistence shape and ordinary behavior belong here. Papers may carry only
the generic project-state, target-picker and shortcut-launch seam required to host it; do
not generalize that seam into a universal Backpack editor or file manager.

## BRAIN + OpenCode worker workflow

Large or cross-repository milestones may use one BRAIN session to coordinate four named
OpenCode workers: Winter, Gazelle, RoketPuncha and Ning. This workflow is optional for
small changes, but when it is active the following contract is mandatory.

### Authority and files

- BRAIN owns product interpretation, decomposition, architecture rulings, lane boundaries,
  cross-report review, final integration and creator checkpoints.
- `BRAIN-WORKER.txt` is the coordination bridge. Workers read the latest authoritative EOF
  block before every assignment. A newer BRAIN block supersedes conflicting older blocks;
  raw chat history and worker logs are not decision authority.
- Worker artifacts live under
  `D:\Letters\MatTroiSeConMoc\Papers\User Generated\August 10th 26' logs\workers\<worker>\`.
  Keep `logs`, `reports` and `dispatch` nested under each worker instead of placing files in
  the logs root. `worker-registry.json` records session IDs, the current report and whether
  each lane is active.
- `append-now.cmd` refreshes captured session logs. `worker-status.cmd` and the live-feed
  scripts report progress; status is evidence of activity, not permission to change scope.

### Wave design

1. BRAIN writes one bounded assignment per worker into the bridge before dispatch.
2. If creator feedback reverses an architectural assumption, begin with parallel
   **report-only audits**. Assign non-overlapping questions, then let BRAIN synthesize one
   ruling before any source edits.
3. Implementation waves give each worker one exclusive source/test seam. Never assign two
   workers overlapping edits merely to make all four busy. A worker that finishes early
   stops or receives a new non-overlapping lane.
4. Workers may spawn subagents for concrete bounded subtasks when that reduces elapsed time.
   The named worker remains responsible for checking their evidence and producing one
   coherent report. Subagents do not broaden the lane.
5. Gazelle may provide a curated/manual reasoning log because her private reasoning is not
   automatically exported. Judge her lane by the same source diff, tests and report evidence
   as every other worker; distribute work evenly unless a task specifically benefits from
   her higher-cost reasoning.

### Worker stop contract

Every assignment states whether product edits, app launches, physical input and commits are
allowed. Unless explicitly granted, they are forbidden. Before stopping, a worker writes the
requested report in its own `reports` directory with:

- exact files and behavior inspected or changed;
- tests run and literal pass/fail counts;
- unresolved risks, environmental NOT RUN rows and pre-existing failures separated from new
  failures;
- a concise STOP line confirming the lane made no further changes.

Workers preserve unrelated dirty hunks and do not stage or commit unless BRAIN explicitly
assigns that action. Intended behavior is never inferred from a passing mock when the real
host path can differ; inspect decisive runtime values before exploring exotic hypotheses.

### Review, live proof and creator handoff

- BRAIN reviews every report against source and reruns focused checks independently. A report
  is input, not acceptance.
- Automated app runs use isolated profiles and disposable windows. Never target the creator's
  live Papers process or data unless the creator explicitly authorizes a real-data eye test.
- Tests requiring global mouse/keyboard input or window manipulation wait for an exclusive
  desktop interval. If the creator is using the machine, mark contaminated rows inconclusive
  rather than converting them into passes or failures.
- Finish nonvisual proofs first. Return to the creator only for a short visual eyecheck that
  states exactly what to observe. Record the creator's observations as the new product
  authority, append the next bridge checkpoint, and correct the plan before continuing.
- After a milestone is accepted, prepare a refactor roadmap separately. Do not mix broad
  cleanup into behavior correction or execute the roadmap before behavior is visually frozen.

### Resource-budget lessons from the 015R3–019 session

The creator reported that one long BRAIN session consumed roughly 90% of the weekly model
allowance. This was Codex BRAIN consumption, not OpenCode worker consumption. Winter,
Gazelle, RoketPuncha and Ning were comparatively inexpensive external labor and should not
be blamed for the Codex allowance burn. The work produced valuable fixes and proofs, but
BRAIN used Codex as a continuously reasoning manager, auditor and secondary engineering
team instead of a sparse decision authority.

Observed sources of avoidable resource burn:

- BRAIN kept one Codex thread alive across the complete development history instead of
  starting fresh from compact accepted checkpoints;
- BRAIN repeatedly loaded large external-worker logs and reasoning streams into Codex when
  short reports or targeted excerpts would have been enough;
- BRAIN spawned additional Codex-side subagents for audits and proof lanes, duplicating
  expensive Codex context and reasoning independently of the four OpenCode workers;
- BRAIN applied high-depth reasoning to routine coordination, status and verification work
  that the external workers could perform cheaply;
- BRAIN repeatedly ingested verbose test output, command output and unchanged status polls;
- BRAIN initiated overlapping audits, full-suite reruns and new proof waves after small
  corrections instead of consolidating evidence once;
- BRAIN prioritized deep technical proof before the creator's early visual eyecheck, so
  technically green work later entered another cycle when the visible experience failed.

Use this optimized protocol for future waves:

1. Treat the OpenCode workers as the primary labor pool. BRAIN assigns independent lanes and
   remains a sparse product and architecture authority; it does not redo their implementation
   or routine verification inside Codex.
2. Before theorizing, workers identify and log the smallest decisive runtime values. Rank checks by
   information gained per cost. Intended code behavior is not evidence of the value actually
   used at runtime.
3. Cap each normal worker report at about 1–2 pages. It contains only: ruling/root cause,
   exact files changed, compact diff summary, literal test counts, remaining blocker and STOP.
   Full reasoning logs stay on disk and BRAIN reads them only when the compact report or a
   failing test cannot support a decision.
4. Each correction report is a delta from the last accepted checkpoint. Never restate the
   whole feature history. BRAIN likewise reviews the changed seam and focused evidence first.
5. Run focused tests during implementation, then one consolidated full-suite/live-proof wave
   after compatible lanes converge. Do not repeatedly run or ingest the same large suite when
   no relevant dependency changed.
6. Keep tool output bounded: request summaries/tails, record artifacts on disk and surface
   only failures plus final counts. Poll only when state could reasonably have changed; do not
   narrate unchanged polls.
7. Do not spawn Codex-side subagents by default. If a unique high-risk decision genuinely
   requires one, give it only a short assignment, the authoritative bridge block and named
   files; never fork the full BRAIN conversation. OpenCode workers may still use their own
   inexpensive subagents within bounded lanes.
8. Set a creator-visible budget checkpoint before each major wave. If usage is materially
   higher than expected, stop optional audits and UI polish, preserve a resumable checkpoint
   and report the tradeoff immediately.
9. Start a fresh BRAIN session after a stable milestone when the next work can be expressed by
   the bridge, accepted reports, current diff and test baseline. Do not carry a giant reasoning
   transcript merely for continuity.
10. A successful proof ends the lane. Further hardening requires a concrete uncovered risk,
    not curiosity or a desire to keep every worker occupied.

The optimization target is specifically low Codex BRAIN consumption, not reduced OpenCode
worker utilization. Preserve source review, literal receipts, creator-data isolation and the
final human eyecheck while moving implementation, diagnosis and routine testing to the
external workers and reserving Codex for compact checkpoint decisions.

### Account-separated controller

The creator-facing Codex Desktop Manager and the headless Codex CLI BRAIN use separate
ChatGPT accounts. Account A is reserved for creator conversation, product judgment and
eye-check handoff. Account B is authenticated only through the isolated
`D:\Programs\CodexBrainB` CLI home and handles bounded coordination decisions. Never
copy or expose either account's authentication files.

The controller lives under
`D:\Letters\MatTroiSeConMoc\Papers\User Generated\August 10th 26' logs\brain`.
Its watcher is deterministic: it sleeps without a model and invokes Account B once only when
a creator request becomes READY or an active worker wave reaches a terminal report/attention
state. It fingerprints attempts so an unchanged failing event cannot repeatedly consume
allowance. Do not replace this with continuous Codex polling or full-response streaming.

Budget state is refreshed from local Codex rate-limit telemetry, with the usage dashboard or
interactive CLI `/status` as the visual oracle. Compute runway from remaining percentage,
protected reserve and days until reset. Every decision-bearing CLI BRAIN invocation uses
Terra; deterministic waiting/status/dispatch uses no model. There is no Luna downgrade, and
Sol is never selected automatically. Once the reserve is reached, automatic invocations stop. The
machine-readable controller state is a planning guard, not a claim that Codex exposes its
weekly percentage through a local API.

The controller records Account B invocation counts but imposes no fixed daily ceiling; live
allowance, event fingerprints and the protected reserve govern continuation. There is no
separate Terra ceiling. Optional Codex apps, browsers, plugins, image tools, multi-agent support and skill
discovery are disabled for routine routing; compact snapshots are capped before invocation.
When the creator-facing Manager itself runs on Account B, it must not invoke a nested Account B
CLI BRAIN because both consume the same allowance. In that temporary arrangement the Manager
assumes the sparse BRAIN role and dispatches OpenCode workers directly.
