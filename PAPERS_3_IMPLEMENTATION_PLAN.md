# Papers 3 — Complete One-Shot Implementation Plan

Document status: **authoritative implementation directive**

Prepared: 2026-07-20

Repository: [`Futahua/Papers-3`](https://github.com/Futahua/Papers-3)
Supersedes: every earlier Papers 3 implementation plan in full

## 0. Executor directive

Implement, verify, package, and document a complete usable Papers 3 in this repository.

Do not stop after planning, scaffolding, mocking the primary path, producing screenshots, or proving isolated components. Continue until the packaged Windows application passes the binary acceptance criteria in this document or a genuinely external blocker is proven with evidence.

Use parallel agents or workstreams where useful. Make reasonable, reversible implementation decisions without asking the creator to choose ordinary engineering details. Ask only when blocked by:

- unavailable credentials or accounts;
- unavailable proprietary software that cannot be installed safely;
- an irreversible operation on creator data;
- a product decision whose alternatives would materially contradict the creator's feedback; or
- an upstream defect for which safe workarounds have been exhausted.

When blocked, report the precise operation, evidence, attempted alternatives, smallest next action, and which acceptance criteria remain affected. Do not call an incomplete implementation complete.

“Complete” means the finite v1 defined here. It does not mean an infinite program ecosystem, every imagined Backpack type, or rebuilding every mature application mentioned as inspiration.

## 1. Authority and interpretation

When sources conflict, follow this order:

1. The creator's latest direct feedback.
2. The Canvas Backpack discussion that produced this plan.
3. This plan.
4. The corrected Papers founder brief, ontology clarification, and recovery documents.
5. Creator-accepted behavior from earlier Papers versions.
6. Existing implementation code.
7. Historical plans, generated roadmaps, and speculative documentation.

Never average contradictory documents. Record the conflict in `docs/DECISIONS.md` and follow the higher authority.

The governing correction is:

```text
Entering a Backpack
    !=
Activating a program
    !=
Invoking an agent action
```

A Backpack identifies an environment. A program defines a workflow. Only an exact program command plus an inspectable selection defines sufficient agent context.

The creator's feedback is product authority. Architecture exists to realize it, not reinterpret it into a more familiar application category.

## 2. Product statement

Papers 3 is a Windows desktop application that gives work persistent places called Backpacks.

Papers itself remains narrow:

```text
identify -> expose -> enter -> leave -> restore -> switch
```

The first finished Backpack type is the **Canvas Backpack**:

> A persistent programmable workbench that can transform into purpose-built programs while preserving a stable host frame, controlled capabilities, exact agent invocations, external-product integration, persistence, and recovery.

The product includes:

- a minimal Backpack shell;
- one complete Canvas Backpack;
- one active primary program at a time;
- a program launcher and contextual top shelf;
- independently styled, sandboxed program surfaces;
- program-owned workflow data and selection semantics;
- a permission-based capability broker;
- exact, previewable Hermes invocations;
- Hermes-controlled Codex and OpenCode workers;
- human observation, approval, clarification, cancellation, retry, and result review;
- external application integration;
- crash isolation and state recovery;
- a packaged Windows installer; and
- an end-to-end demonstration using a disposable checkout of `logseq/logseq`.

The primary first-party workflow is a **Repository Research and Production Program**. It treats a real repository as research material, permits precise selection of files and code regions, links evidence and notes, invokes Hermes from exact program actions, delegates coding work through Hermes to Codex or OpenCode in an isolated worktree, and produces a documented artifact that can be opened in LibreOffice.

## 3. What Papers 3 is not

Papers 3 is not:

- a universal operating system;
- a universal Backpack design;
- a universal block, page, document, graph, or project ontology;
- an empty plugin platform built before a real workflow;
- a fork of Logseq, AppFlowy, LibreOffice, Hermes, Codex, or OpenCode;
- a container that silently sends an entire Backpack to an AI;
- another Hermes conversation database;
- another agent framework;
- a provider catalogue;
- a worker supervisor competing with Hermes;
- a package marketplace in v1; or
- arbitrary third-party code execution in v1.

## 4. Repository roles and provenance

| Repository | Role | Rule |
|---|---|---|
| `Futahua/Papers-3` | Sole implementation repository | All new product code and documentation live here. |
| `Futahua/papers-real2` | Product and failure reference | Do not import the complete tree or merge history. Reuse only small reviewed assets/utilities with recorded provenance. |
| `Futahua/papers-are-papers` | Hermes integration and failure reference | Do not import its application/runtime architecture. |
| `Futahua/Assistant` | Orchestration failure and product-vision reference | Do not vendor its bridges, duplicate Hermes trees, state, or process topology. |
| `Futahua/Proxima-Obsidian` | Workflow and UI failure reference | Do not import its plugin source or patch scripts. |
| `logseq/logseq` | Realistic external demonstration fixture | Shallow-clone the pinned commit into a disposable workspace. Never push upstream and never copy Logseq code into Papers. |

The prior root plan is intentionally replaced rather than retained beside this file. Git history is the archive. This file is the single source of implementation truth.

At implementation start:

1. Add `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md`.
2. Record consequential assumptions and upstream API choices in `docs/DECISIONS.md`.
3. Record every copied asset or utility, its source commit, license, and reason in `THIRD_PARTY_NOTICES.md`.
4. Never modify any reference repository.

## 5. Ownership boundaries

### 5.1 Papers core owns

- Backpack identity and registry;
- Backpack-type dispatch;
- enter, leave, restore, and switch;
- last-active state;
- host-level persistence and recovery;
- permissions entry point; and
- creator-facing orientation.

### 5.2 Canvas Backpack owns

- the stable host frame;
- program discovery for bundled first-party programs;
- the program launcher;
- active-program lifecycle;
- the contextual top shelf;
- program state directories;
- capability requests;
- focus and escape recovery;
- save status; and
- program crash isolation and restart.

### 5.3 Programs own

- their data model;
- their visual language;
- their views;
- selection semantics;
- commands and workflows;
- agent-action definitions;
- invocation collection;
- result-schema validation;
- result destination semantics;
- applying accepted results; and
- program-specific undo/snapshots.

### 5.4 Hermes owns

- model reasoning;
- conversation and session authority;
- tools, skills, memory, and browser/computer use;
- public agent events;
- approvals and clarification;
- task orchestration and delegation;
- Codex/OpenCode worker selection and invocation; and
- worker-result reconciliation.

### 5.5 External applications own

- their native editing behavior;
- their file-format fidelity;
- their processes and windows;
- their internal undo/redo; and
- their own documents after launch.

### 5.6 Papers must never own

- a second model loop;
- a copied Hermes transcript store;
- a general provider/model abstraction;
- a universal selection ontology;
- an invented activity/progress model;
- a raw terminal exposed to programs;
- an OpenCode or Codex adapter already supplied by Hermes;
- arbitrary process supervision; or
- a universal cross-program undo stack.

## 6. Technical architecture

Use Electron with TypeScript and a maintained web renderer stack selected after a short upstream check. Prefer the smallest established libraries that reduce delivery risk. Pin exact versions and commit the lockfile.

```text
Electron main process
├── BackpackRegistry
├── BackpackRouter
├── CanvasRuntime
├── ProgramLoader
├── CapabilityBroker
├── PermissionStore
├── PersistenceService
├── HermesAdapter
├── ExternalApplicationBridge
└── RecoveryService

Host renderer
├── Backpack switcher
├── Canvas frame
├── Program launcher
├── Top shelf
├── Agent Runs panel
├── Permission prompts
├── Result previews
└── Failure recovery UI

Sandboxed program renderer
├── Program UI
├── Program-owned selection
├── Program commands
├── Program data worker
└── narrow Papers Program API

External services/products
├── Hermes headless service
├── Hermes Desktop
├── Codex
├── OpenCode
├── Git
└── LibreOffice
```

The architecture may be consolidated if fewer modules produce the same tested ownership boundaries. The diagram defines responsibilities, not a mandatory file count.

## 7. Program isolation and security

Run every program in its own sandboxed `WebContentsView`, or the current officially supported Electron equivalent if that API has changed.

Required renderer policy:

- `nodeIntegration: false`;
- `contextIsolation: true`;
- `sandbox: true`;
- restrictive Content Security Policy;
- only packaged local program code;
- navigation denied unless explicitly brokered;
- new-window creation denied;
- no unvalidated remote content;
- sender identity validated for every privileged request;
- no raw `ipcRenderer` exposure;
- no raw filesystem, shell, process, credential, or Electron API exposure; and
- program failure must not crash the host frame.

The preload bridge exposes explicit methods rather than generic IPC. Validate all arguments at the main-process boundary, even when the renderer is first-party.

Initially load only first-party program packages shipped with Papers. Do not implement downloading, marketplace discovery, unsigned packages, or arbitrary local program folders.

## 8. Stable Canvas frame

The Canvas frame remains recognizable regardless of program aesthetics.

It must always expose:

- Leave Backpack;
- Backpack identity;
- active-program identity;
- program launcher;
- save/persistence status;
- permissions;
- Agent Runs status;
- Escape/focus recovery;
- restart failed program; and
- return to the default program.

Conceptual layout:

```text
┌──────────────────────────────────────────────────────────┐
│ Backpack │ Programs │ Contextual shelf │ Runs │ Save    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                   ACTIVE PROGRAM                         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Only one primary program is active. Do not implement arbitrary splits, floating program windows, infinite spatial composition, or cross-program drag-and-drop in v1.

Programs may contribute bounded shelf items but cannot replace navigation, permissions, recovery, or agent-run truth.

## 9. Program contract

Programs are bounded packages with a manifest and a narrow versioned host API.

Conceptual manifest:

```json
{
  "id": "repository-research",
  "name": "Repository Research and Production",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "program/index.html",
  "stateSchemaVersion": 1,
  "capabilities": [
    "storage.read-own",
    "storage.write-own",
    "resources.read-granted",
    "resources.create",
    "external.open",
    "external.launch-approved",
    "agent.invoke",
    "agent.cancel-own"
  ]
}
```

Host API:

```ts
interface PapersProgramAPI {
  identity(): Promise<ProgramIdentity>;

  state: {
    load(): Promise<unknown>;
    save(value: unknown): Promise<void>;
  };

  shelf: {
    contribute(items: ShelfContribution[]): Promise<void>;
    clear(): Promise<void>;
  };

  commands: {
    register(commands: ProgramCommand[]): Promise<void>;
  };

  capabilities: {
    request<T>(request: CapabilityRequest): Promise<T>;
  };

  agent: {
    invoke(request: AgentInvocation): Promise<AgentRunReference>;
    cancel(runId: string): Promise<void>;
  };
}
```

The exact API may change during the vertical slice, but its authority must not broaden.

Do not require programs to implement blocks, documents, pages, databases, graph nodes, tabs, spatial objects, or a shared undo system.

## 10. Persistence and recovery

Use atomic, versioned, human-inspectable storage unless a stronger embedded database is proven simpler and more reliable for the packaged application.

Conceptual layout:

```text
PapersData/
├── registry.json
├── permissions.json
├── recovery/
├── backups/
├── backpacks/
│   └── <backpack-id>/
│       ├── backpack.json
│       ├── canvas.json
│       ├── resources.json
│       └── programs/
│           └── <program-id>/
│               ├── state.json
│               ├── state.backup.json
│               └── artifacts/
└── integrations/
    └── hermes.json
```

Required properties:

- temporary-file plus rename writes;
- schema versions;
- backup before migration;
- unknown-field preservation where applicable;
- corrupt-state quarantine;
- last-known-good restoration;
- no destructive automatic migration;
- no secrets in renderer-readable state;
- no external resource copied merely because it was referenced;
- program state isolated by Backpack and program identity; and
- uninstall never deletes creator data by default.

## 11. Capability broker

Initial capability vocabulary:

```text
storage.read-own
storage.write-own
resources.read-granted
resources.create
resources.register
clipboard.write
external.open
external.launch-approved
agent.invoke
agent.cancel-own
program.read-shared-summary
```

Request shape:

```ts
interface CapabilityRequest {
  invocationId: string;
  backpackId: string;
  programId: string;
  capability: string;
  arguments: unknown;
  reason: string;
}
```

The broker must:

1. validate program and Backpack identity;
2. validate the request schema;
3. check the current grant;
4. prompt when required;
5. redact secrets and sensitive paths from logs;
6. constrain paths, URLs, arguments, and result sizes;
7. execute through structured native APIs rather than shell strings;
8. record non-secret decision/result metadata;
9. return structured, attributable errors; and
10. never expose an unrestricted shell.

Permission choices:

- Allow once;
- Allow for this program; or
- Deny.

Permanent grants with machine impact require a visible settings surface and revocation.

## 12. Hermes integration

Use Hermes' supported headless interface, not terminal scraping and not a copied dashboard implementation.

During the initial spike, inspect the pinned Hermes version and select the least invasive supported connection:

1. Reuse the Hermes Desktop-managed backend if officially discoverable and stable.
2. Otherwise start the installed Hermes headless server using its supported CLI and the normal Hermes home.
3. Keep sessions visible in Hermes Desktop.
4. Never vendor or fork Hermes inside Papers.
5. Never build a second provider setup experience.
6. Never edit Hermes configuration directly unless current official behavior proves it unavoidable; document any unavoidable write, preserve unknown fields, back up first, write atomically, and validate afterward.

The adapter owns only:

- connection discovery or supported startup;
- health;
- session creation/resumption;
- turn submission;
- public-event subscription;
- approval/clarification forwarding when supported;
- cancellation;
- structured result receipt; and
- authoritative session-reference persistence.

Secrets and transport tokens remain in the main process. The program receives only opaque run/session references.

## 13. Exact agent invocation

There is no automatic “This Backpack” context.

Every agent action originates in a program that understands its objects and workflow.

```ts
interface AgentInvocation {
  version: 1;

  origin: {
    backpackId: string;
    programId: string;
    viewId?: string;
    commandId: string;
  };

  action: {
    id: string;
    label: string;
    creatorInstruction?: string;
  };

  selection: {
    type: string;
    references: ProgramReference[];
  };

  sharedMaterial: Array<{
    reference: ProgramReference;
    title: string;
    mediaType: string;
    preview: string;
    contentHash: string;
    content?: string;
  }>;

  destination: {
    programId: string;
    type: string;
    reference?: ProgramReference;
  };

  permissions: string[];

  execution?: {
    cwd?: string;
    hermesProjectId?: string;
    preferredWorker?: "hermes" | "codex" | "opencode";
  };
}
```

Before submission, show:

- requested action;
- selected objects;
- exact preview of shared content;
- omitted/truncated content;
- destination;
- requested capabilities; and
- preferred worker, if one was expressed.

Papers validates structure, permissions, hashes, and size. It never interprets program-specific types such as `source-records`, `blocks`, `graph-nodes`, or `code-regions`.

## 14. Results and mutations

Hermes returns a proposal rather than silently mutating program state.

```ts
interface AgentResultProposal {
  invocationId: string;
  sessionId: string;
  summary: string;
  structuredOutput?: unknown;
  artifacts?: ResultArtifact[];
  proposedOperations?: ProgramOperation[];
}
```

The originating program must:

1. validate the result schema;
2. verify that the destination still exists;
3. compare current selection hashes with invocation hashes;
4. mark stale results rather than applying them blindly;
5. preview the result;
6. require confirmation for destructive replacement;
7. apply accepted operations through program-owned code;
8. save atomically;
9. register produced artifacts; and
10. offer program-specific undo through a pre-apply snapshot.

## 15. Human observation and intervention

Papers provides a compact Agent Runs panel. Hermes remains authoritative.

States:

- Queued;
- Running;
- Waiting for approval;
- Waiting for clarification;
- Completed;
- Failed; and
- Cancelled.

Display only public Hermes events. Do not expose hidden reasoning. Do not invent percentages, phases, or confidence values.

Controls:

- Inspect in Hermes;
- answer clarification;
- approve or deny;
- Stop;
- retry the same immutable invocation;
- return to the originating program; and
- preview/apply the result.

If Hermes Desktop supports a stable session deep link, use it. Otherwise focus/open Hermes Desktop and display/copy the authoritative session ID. Do not rebuild the full Hermes chat UI unless an official reusable client makes that materially simpler than launching Hermes Desktop.

## 16. Codex and OpenCode workers

Hermes is the supervisor.

### 16.1 Codex

Use Hermes' existing Codex skill, Kanban lane, or Codex app-server runtime. Do not create a Papers Codex bridge.

Use Codex preferentially when the selected worker model is an OpenAI coding model or when its sandbox/app-server behavior is specifically desired.

### 16.2 OpenCode

Begin with Hermes' bundled OpenCode skill.

Build an OpenCode HTTP adapter only if a real acceptance run proves that the bundled path cannot provide a required capability:

- live progress;
- permission intervention;
- cancellation;
- durable session resumption; or
- structured result delivery.

Any approved adapter sits behind Hermes. Programs and the Papers renderer never call OpenCode directly.

### 16.3 Required comparison

Run the same real coding task through:

1. Hermes directly;
2. Hermes to Codex; and
3. Hermes to OpenCode using a different provider where available.

Record correctness, tests, duration, interventions, session recovery, changed files, model/provider, and cancellation behavior. Select defaults from evidence.

## 17. External application bridge

Support verified open/launch behavior for:

- files;
- URLs;
- the system file browser;
- LibreOffice Writer; and
- LibreOffice Calc when installed and useful.

Requirements:

- discover installed executables safely;
- validate every path, URL, and argument;
- never construct shell command strings from renderer input;
- use structured process argument arrays;
- return launch success/failure;
- do not claim an external document is saved merely because it was opened; and
- do not supervise external applications beyond the explicit workflow.

Document-production flow:

1. Generate a standard editable document format.
2. Verify the generated file structurally.
3. Launch LibreOffice Writer with the explicit path.
4. Let the creator edit normally.
5. Register the final/exported file only when it is selected or detected through a bounded explicit action.
6. Preserve earlier drafts.

## 18. Script execution

Support bounded scripts, not arbitrary Node access.

V1 script classes:

- **UI scripts:** packaged program-local renderer code inside the sandbox;
- **Data scripts:** Web Workers operating only on explicitly supplied data; and
- **Automation:** declarative requests through the capability broker.

Do not implement third-party program installation, unsigned scripts, remote code loading, or a general machine-automation scripting language in v1.

A shared GPU engine is not a host requirement. Programs may use normal browser Canvas/WebGL. Extract a shared rendering abstraction only after at least two real programs demonstrate repeated need.

## 19. Primary program — Repository Research and Production

This is the complete vertical product workflow, not a generic platform demo.

### 19.1 Entities

- Repository resource;
- source file;
- selected code/text region;
- evidence excerpt;
- research note;
- topic;
- relationship;
- collection;
- coding task;
- draft;
- agent result; and
- output artifact.

### 19.2 Required views

- Repository overview;
- file/source explorer;
- Notes/outliner;
- Evidence board;
- Coding Tasks;
- Draft Production; and
- Artifact History.

### 19.3 Required workflow

1. Register a local Git repository without copying it into Papers data.
2. Read basic Git identity, branch, status, and commit information through bounded host capabilities.
3. Browse and search explicitly granted files.
4. Capture file excerpts with path, commit, line range, and content hash provenance.
5. Create linked notes and topics.
6. Group and filter evidence.
7. Select files, code regions, notes, or evidence cards.
8. Invoke selection-specific Hermes actions.
9. Receive and preview result proposals.
10. Apply accepted results to the declared program destination.
11. Create an isolated worktree for approved coding tasks.
12. Ask Hermes to delegate the task to Codex or OpenCode.
13. Display worker progress through the Hermes run.
14. Inspect the resulting diff and test results.
15. Accept, reject, or retain the worktree for manual review.
16. Assemble a research/engineering report from selected evidence.
17. Generate an editable document.
18. Open it in LibreOffice Writer.
19. Register the final artifact without destroying earlier drafts.

### 19.4 Required agent actions

- Explain selected files;
- compare selected implementations;
- summarize selected evidence;
- find disagreements or inconsistencies;
- map dependencies of selected code;
- organize selected notes;
- suggest an outline;
- draft from selected evidence;
- check claims in selected draft sections;
- suggest missing evidence;
- propose a coding task from selected evidence; and
- implement the approved task in an isolated worktree.

Every action previews the exact selection, shared content, requested capabilities, and destination.

## 20. Logseq demonstration Backpack

Use [`logseq/logseq`](https://github.com/logseq/logseq) as the realistic, non-trivial demonstration repository.

Pin the fixture to:

```text
repository: https://github.com/logseq/logseq.git
commit: a4963dca579f42817135d8473166a03fa7ea2409
default branch: master
license: GNU Affero General Public License v3
```

The demonstration must:

1. Create a shallow/disposable checkout at the pinned commit outside the Papers source tree and outside creator data.
2. Register that checkout as a repository resource in a sample Backpack.
3. Display its identity, branch, clean status, languages/directories, and selected documentation.
4. Permit selection of exact README passages and source files.
5. Capture evidence with commit/path/hash provenance.
6. Invoke Hermes to explain selected architecture without sending the entire repository automatically.
7. Produce a linked research note and architecture report.
8. Create a disposable worktree/branch for a safe coding exercise chosen after inspection.
9. Run the same bounded exercise through Codex and OpenCode, or use two comparable tasks if concurrent edits would conflict.
10. Run relevant Logseq checks that are feasible in the available environment.
11. Never push to `logseq/logseq` or any fork unless the creator separately authorizes it.
12. Generate a final report and open it in LibreOffice.
13. Cleanly retain or remove disposable worktrees without touching the pinned base checkout.

### 20.1 License boundary

Logseq is AGPL-3.0. Treat it as external inspected data and a test target.

Do not copy, adapt, bundle, vendor, or redistribute Logseq code as part of Papers unless a separate explicit license decision is made. Reading files, analyzing a local checkout, executing its documented development commands, and producing original reports or patches in a disposable worktree do not make Logseq a Papers dependency.

The implementation must record the pinned commit and license in the demonstration report.

### 20.2 Demonstration success

The Logseq demonstration is successful only when a creator can watch this complete chain:

```text
Enter Logseq Demo Backpack
-> open Repository Research program
-> select exact files/regions
-> preview an agent action
-> invoke Hermes
-> inspect the authoritative run
-> receive a linked note/report
-> approve a coding task
-> delegate through Hermes to a coding worker
-> inspect diff and checks
-> produce and open the final document
```

## 21. Secondary proof program — Visual Dashboard

Build a small second program proving that Canvas programs can have a radically different visual language without controlling host safety.

It must:

- read only explicitly granted summary data from the Repository Research program;
- render a graphical dashboard using DOM, Canvas, or WebGL;
- contribute one contextual shelf control;
- persist its own layout/preferences;
- recover independently after reload;
- request no filesystem or machine-automation capability; and
- remain intentionally small.

Do not turn it into another product. Its purpose is to validate isolation, styling freedom, shared-summary permission, and program switching.

## 22. General Hermes access

A general Hermes conversation may exist as a Tool or program, not as intelligence that automatically understands the active Backpack.

Preferred implementation:

- open or focus Hermes Desktop;
- deep-link to a session when supported;
- otherwise present the authoritative session ID and open the session list;
- expose health and reconnection status; and
- never silently attach Backpack or program content.

General conversation and exact program invocation are distinct entry points.

## 23. Deadline policy

Let `T` be the total implementation time available before the creator's deadline. Allocate effort approximately:

| Phase | Share of T | Required outcome |
|---|---:|---|
| A. Vertical kill test | 10% | Packaged host, sandboxed program, capability call, Hermes invocation, event, cancellation, structured result |
| B. Product shell | 15% | Backpack registry, Canvas frame, program lifecycle, shelf, permissions, recovery |
| C. Primary workflow | 30% | Complete Repository Research and Production workflow |
| D. Agent/external integration | 20% | Invocation previews, result application, Hermes run panel, workers, LibreOffice |
| E. Secondary program/hardening | 10% | Visual Dashboard, extracted proven API, security hardening |
| F. Packaging/acceptance | 10% | Installer, fresh-install test, uninstall, documentation, evidence |
| Contingency | 5% | Integration, packaging, and real-machine corrections |

If behind schedule:

1. cut decorative animation and visual effects;
2. cut optional convenience commands;
3. keep only one excellent layout per program;
4. reduce nonessential analytics;
5. defer optional legacy import tooling; and
6. preserve the exact invocation boundary, isolation, persistence, primary workflow, real integrations, tests, and packaging.

Never respond to schedule pressure by leaving several broad half-built systems. Finish the vertical workflow.

## 24. Execution phases and gates

### Phase A — Vertical kill test

Prove in the packaged architecture, not a throwaway environment:

- Electron launches on Windows;
- a sandboxed program loads;
- program failure leaves the Canvas frame alive;
- a narrow capability request succeeds;
- program state persists and restores;
- Hermes session/turn creation works through an official machine interface;
- a public event is received;
- cancellation works;
- a structured result returns;
- the same session can be inspected in Hermes Desktop; and
- the packaged application reproduces the path.

Gate: do not build the larger program framework around a fake Hermes integration.

### Phase B — Papers and Canvas shell

Implement:

- Backpack registry;
- create/rename/archive Backpack;
- enter/leave/switch;
- last-active restore;
- Backpack-type routing;
- stable Canvas frame;
- first-party manifest validation;
- program load/unload/switch;
- contextual shelf;
- save status;
- permissions UI;
- focus recovery; and
- crash quarantine/restart.

Gate: shell acceptance passes with a deliberately crashing test program.

### Phase C — Repository Research and Production

Implement the complete workflow in section 19 against a small fixture first, then the pinned Logseq checkout.

Gate: a creator can progress from selected repository evidence to an editable document without direct database or filesystem manipulation.

### Phase D — Agent, workers, and external products

Complete:

- immutable invocation records;
- preview and hash checks;
- Hermes public-event projection;
- approval/clarification/Stop;
- result proposal and application;
- stale-result rejection;
- Codex validation;
- OpenCode validation;
- Git worktree isolation;
- diff and checks presentation;
- LibreOffice output/open flow; and
- Hermes Desktop inspection.

Gate: complete the Logseq demonstration chain.

### Phase E — Secondary proof and hardening

Build the Visual Dashboard and extract only host APIs used by both real programs. Run the security checklist and destructive-input tests.

Gate: program switching, isolation, and permission denial are proven.

### Phase F — Distribution and acceptance

Produce:

- Windows installer;
- installer checksum;
- clean install path;
- upgrade-in-place path for Papers-owned schemas;
- uninstall preserving data;
- sample Backpack creator;
- Logseq demonstration setup command;
- user documentation;
- developer/program-contract documentation;
- known-limitations report; and
- criterion-by-criterion acceptance report.

Gate: run acceptance from the packaged build, not only development mode.

## 25. Test plan

### 25.1 Automated tests

Cover:

- Backpack registry and restoration;
- atomic writes and last-known-good recovery;
- schema migration and unknown-field behavior;
- corrupt-state quarantine;
- program manifest validation;
- program crash isolation;
- sender validation;
- navigation/new-window denial;
- Content Security Policy expectations;
- permission matching and revocation;
- capability schema rejection;
- path traversal and unsafe URL rejection;
- structured process argument handling;
- state ownership isolation between programs;
- invocation snapshot and hash consistency;
- size/truncation disclosure;
- stale selection/destination rejection;
- result-schema validation;
- pre-apply snapshot and undo;
- Hermes adapter using a fake server;
- reconnect, retry, and cancellation;
- external launch validation;
- Git repository/worktree operations against disposable fixtures;
- Repository Research entity/view operations;
- exact agent-action selection snapshots;
- draft/export generation; and
- uninstall data-preservation rules.

### 25.2 Real-machine tests

Exercise:

- a real Hermes session;
- Hermes Desktop inspection;
- an approval or clarification;
- cancellation;
- Codex delegated coding work;
- OpenCode delegated coding work;
- a disposable Git worktree;
- the pinned Logseq checkout;
- relevant feasible Logseq checks;
- LibreOffice document opening;
- restart restoration;
- program crash recovery;
- packaged installation; and
- uninstall without data loss.

### 25.3 Security review

Verify:

- no program has raw Node/Electron/shell access;
- no secret crosses into a program renderer;
- every privileged request validates sender and schema;
- remote navigation is blocked or isolated;
- `shell.openExternal` or equivalent receives only validated URLs;
- process launches use structured arguments;
- logs redact secrets and sensitive material;
- permissions can be revoked;
- program data cannot read another program without an explicit grant;
- arbitrary local/remote program loading is absent; and
- a compromised program renderer cannot invoke undeclared capabilities.

## 26. Failure behavior

Every failure must state:

- which component failed;
- what is known;
- what remains intact;
- whether retry is useful;
- how to inspect details; and
- how to recover safely.

Required states include:

- corrupt Backpack registry;
- corrupt program state;
- program crash/hang;
- denied capability;
- missing resource;
- changed/stale selected content;
- Hermes unavailable;
- Hermes disconnected mid-run;
- approval timeout;
- worker unavailable;
- worker failed checks;
- Git worktree conflict;
- LibreOffice unavailable;
- generated document invalid; and
- packaged dependency missing.

Never reduce these to an unexplained “Failed.”

## 27. Engineering limits and stop rules

These limits are design alarms, not excuses to omit required behavior:

- no Papers-owned long-running agent process besides a supported Hermes child when necessary;
- one authoritative owner for every state concept;
- no vendored upstream application trees;
- no source file over roughly 700 lines without a recorded consolidation decision;
- no new abstraction without an active consumer;
- no universal program feature extracted from only one program unless required for security;
- no feature considered implemented until exercised end to end;
- no “configured” status accepted as a real integration test;
- no creator data mutated during fixtures or tests;
- no push to Logseq or any external repository; and
- no hidden expansion into a marketplace, OS, or universal editor.

If code size or module count grows unexpectedly, pause feature expansion, identify duplicated ownership, and delete or reuse before continuing.

## 28. Commit strategy

Use small, independently testable commits. Suggested sequence:

1. `docs: establish authoritative Canvas Backpack implementation plan`
2. `build: scaffold pinned Windows Electron application`
3. `core: add Backpack registry and restoration`
4. `canvas: add sandboxed program host and stable frame`
5. `security: add capability broker and permissions`
6. `integration: connect official Hermes machine interface`
7. `program: add repository research data and views`
8. `agent: add exact invocation preview and result proposals`
9. `git: add disposable worktree coding-task flow`
10. `workers: validate Hermes Codex and OpenCode lanes`
11. `documents: add LibreOffice production bridge`
12. `demo: add pinned Logseq demonstration Backpack`
13. `program: add isolated visual dashboard proof`
14. `recovery: harden persistence and program failure handling`
15. `build: package and verify Windows installer`
16. `docs: record acceptance, security, and known limitations`

The executor may reorganize commits to preserve a clean, reviewable history, but must not collapse the entire implementation into an opaque single commit.

## 29. Definition of done

Do not claim completion until every applicable item is evidenced:

1. A packaged Windows installer succeeds.
2. Papers launches without developer tooling.
3. A creator can create, rename, enter, leave, archive, and switch Backpacks.
4. The last active Backpack and program restore after restart.
5. The Canvas frame survives and recovers from program failure.
6. Programs are sandboxed behind the narrow capability API.
7. The Repository Research and Production program completes its full repository-to-document workflow.
8. Exact selections produce inspectable Hermes invocations.
9. No Backpack-wide or program-wide content is shared implicitly.
10. Shared content previews disclose truncation and match submitted hashes.
11. Results return to the declared program destination.
12. Stale selections/destinations are detected before mutation.
13. The Agent Runs panel supports inspection, approval/clarification where available, Stop, retry, and return to origin.
14. The authoritative session is visible in Hermes Desktop.
15. A Codex worker completes a real isolated coding task and relevant checks.
16. An OpenCode worker completes a comparable task using a different provider where available.
17. Worker failure cannot corrupt the base repository.
18. LibreOffice opens an editable generated report.
19. The Visual Dashboard proves independent program styling and isolation.
20. Programs have no raw Node, filesystem, process, shell, credential, or Electron access.
21. Permission denial and revocation work.
22. Corrupt state is recovered or quarantined honestly.
23. The pinned Logseq demonstration completes without pushing upstream or copying Logseq code into Papers.
24. A final Logseq architecture/implementation report is produced with selection provenance.
25. The packaged application passes restart and crash-recovery tests.
26. Uninstall preserves creator data by default.
27. Every dependency and reused asset has recorded provenance/license.
28. No reference repository was modified.
29. The previous plan is absent as a competing source of truth.
30. The final acceptance report links evidence for every criterion.

## 30. Final deliverables

The implementation must leave:

- working source;
- pinned dependency lockfile;
- automated tests;
- Windows installer;
- installer checksum;
- clean install/uninstall scripts or installer behavior;
- sample Repository Research Backpack;
- sample safe data;
- Logseq demonstration setup and cleanup workflow;
- Visual Dashboard proof program;
- `docs/PRODUCT.md`;
- `docs/ARCHITECTURE.md`;
- `docs/DECISIONS.md`;
- program-contract documentation;
- capability and permission reference;
- Hermes integration notes;
- Codex/OpenCode comparison record;
- security review;
- third-party notices;
- known-limitations report;
- reproduction commands; and
- final acceptance report.

## 31. Executor operating rules

- Read this document fully before changing code.
- Lead with end-to-end vertical progress rather than broad scaffolding.
- Inspect current upstream APIs instead of relying on historical docs.
- Reuse installed products through supported interfaces.
- Pin all versions and external fixture commits.
- Keep secrets out of repositories, renderer state, logs, and test fixtures.
- Preserve unrelated files and creator data.
- Run relevant tests after every meaningful change.
- Test the packaged application, not only development mode.
- Treat configured and implemented as unproven until exercised.
- Replace failed approaches instead of stacking compatibility layers around them.
- Do not expand the universal host contract to solve one program's internal problem.
- Do not ask the creator to make ordinary engineering choices.
- Use reversible assumptions and record them.
- When the deadline is threatened, finish the primary workflow and cut optional polish.
- Do not mark the project complete merely because the remaining work is difficult.
- Continue until the definition of done is satisfied or an external blocker is documented precisely.

## 32. Final product test narrative

The final packaged demonstration should be understandable without architecture knowledge:

1. Launch Papers.
2. Enter the **Logseq Repository Lab** Backpack.
3. Open **Repository Research**.
4. See the pinned Logseq repository without Papers claiming ownership of it.
5. Select exact documentation and source regions.
6. Choose an action such as **Explain selected architecture**.
7. Review precisely what will be shared and where the result will go.
8. Invoke Hermes.
9. Observe progress, respond if needed, and inspect the authoritative session in Hermes Desktop.
10. Receive a linked research note with commit/path/hash provenance.
11. Turn selected findings into an isolated coding task.
12. Let Hermes delegate to Codex or OpenCode.
13. Inspect the worktree diff and checks without touching the pinned base checkout.
14. Accept or reject the proposed result.
15. Assemble the research and implementation evidence into a report.
16. Open the editable report in LibreOffice Writer.
17. Switch to the Visual Dashboard and see the same explicitly shared summary represented through a completely different interface.
18. Quit and relaunch Papers.
19. Return to the same Backpack, program, state, notes, run references, and artifacts.

If that complete narrative works from the packaged build, the architecture has proven its purpose. If it does not, the product is not finished.
