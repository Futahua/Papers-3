# Hermes instructions for Papers

This is the pickup file for building Papers and its Backpacks. Hermes loads
`HERMES.md` when its working directory is this folder or a folder beneath it.

## Where to pick up

- Canonical repository: `https://github.com/Futahua/Papers-3`
- Primary-machine checkout: `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3`
- This file exists in both the source root and installed master. A sibling `.git`
  identifies source; a sibling `App` identifies the installed master.
- Product definition: `docs/PRODUCT.md` in the source repository
- Architecture boundary: `docs/ARCHITECTURE.md` in the source repository
- Consequential decisions: `docs/DECISIONS.md` in the source repository
- Syncthing and data policy: `docs/SYNCTHING_AND_DATA.md` in the source repository
- Creator-reported problems, in priority order: `docs/PROBLEMS.md` in the source repository
- Current Hermes batch handoff: `docs/HERMES_BATCH_HANDOFF.md` in the source repository

If the source checkout is unavailable on a synced machine, obtain the canonical
repository instead of editing packaged files under `App`. Inspect the active branch,
open pull request and recent commits before continuing existing work.

## Creator and product invariants

- The creator is not a coder. Demonstrate behavior and describe outcomes in plain
  language; never require line-by-line code review as acceptance.
- Creator feedback is the highest product authority. Papers is deliberately shaped
  through real use, so do not force speculative architecture before a real need exists.
- Hermes is global. Selecting or entering a Backpack must not automatically change
  Hermes's conversation, working directory or context.
- A Backpack is a named machine-wide environment or lens. It is not inherently a
  folder, canvas, project, conversation, boxed application or PowerToys scene.
- Creating a Backpack asks only for its name. Until real contents are built, entering
  it honestly says that nothing exists yet.
- Tools are reusable global capabilities. Their detailed contract remains open.
- Reuse existing applications and products. Papers should associate, launch, embed,
  restore or coordinate them instead of recreating their interfaces and agent systems.
- Preserve the warm-paper visual character inherited from Papers 1.
- Historical Programs, Runs, ACP workflows and demonstrations remain test fixtures,
  not creator-facing product features.

## When asked to build a Backpack

1. Treat the creator's prompt, attachments and named files as the working specification.
2. Read the current repository documents and inspect the installed behavior before
   changing it. Start with open items in `docs/PROBLEMS.md`; do not revive superseded
   plans from history.
3. Identify the existing product or Windows capability that already does most of the
   work. Build the smallest real, useful connection through Papers.
4. Do not turn every decision into UI. Prefer the simple interaction already requested:
   prompt, optional attachments, optional explicitly chosen folder, and a reply.
5. Never infer a Backpack working directory merely from its name or activation.
6. Preserve unrelated creator data and changes. Make migrations reversible.
7. Test the human-visible path, rebuild the installed product, launch it, and explain
   what the creator can now do. Publish source changes to the canonical repository.

## Data and Syncthing rule

The Papers master folder may be synchronized to other machines, but the future data
model is intentionally allowed to evolve feature by feature.

- Durable creator-authored work should default toward surviving synchronization.
- Caches, logs, locks, temporary files, live browser profiles, process state, provider
  credentials, device paths and machine installations should default to machine-local.
- If ownership is ambiguous, preserve the data and document it. Do not silently delete,
  ignore, relocate or declare it disposable merely to simplify synchronization.
- Never assume that copying an executable, Python virtual environment, PATH entry,
  service or live database makes a capability installed on another machine.
- Do not use the same live SQLite/browser/WAL state concurrently on two machines.
- For every new durable feature, update the data inventory in
  `docs/SYNCTHING_AND_DATA.md`: owner, location, sync expectation, secret status,
  concurrency behavior and recovery path.

The intended destination is not “sync everything” or “sync nothing.” It is a simple,
auditable separation that grows from actual Backpack use without losing future work.
