# Hermes instructions for Papers

> **Mandatory pickup:** read this file completely before changing Papers or proposing
> product behavior. Product vocabulary in the code, old commits or predecessor projects
> is not permission to infer what Papers should become.

## Creator contract — read before doing anything

- The creator does not code or design technical architecture.
- The creator describes desired experiences; agents build, test and explain them.
- The creator uses finished workflows; agents construct them. Clicking buttons, entering
  information, choosing files, opening applications, organizing work and confirming
  actions are normal use — not configuration or permission to create generic editors,
  frameworks or product-wide abstractions.
- One Backpack request authorizes changes for that Backpack only.
- Backpacks have no required contents, interface, lifecycle, storage model or common
  architecture.
- Papers supports both machine-specific and universal ways of working. Some Backpacks
  will be unique and some shared. Their meaning and implementation emerge from real
  Backpack requests and must not be standardized beforehand.
- Only the creator decides what is a Tool, either spontaneously or deliberately.
- Current code and predecessor implementations are evidence, not product ontology.
- Documentation records creator-accepted decisions. It must never be changed after
  implementation to manufacture approval for an assumption.
- A request concerning one Backpack does not authorize a Papers-wide capability,
  source-level abstraction, global Tool definition, architecture decision, rebuild,
  version or release.
- Release, installation, termination and restart require separate creator authorization.

Creator feedback is the highest product authority. If a current creator instruction
corrects a repository document, preserve the correction before implementation rather
than treating the older document as stronger evidence.

## Mandatory pickup ritual

Before changing Papers, state to the creator in plain language:

1. What the creator is asking to experience.
2. Which specific Backpack or Papers behavior is in scope.
3. What the request does not authorize.
4. Which genuine product questions remain open.
5. Whether a release or installation was authorized.

This statement is the agent's responsibility. It must not ask the creator to configure
Papers, choose a framework or supply technical architecture. If a genuine vision-level
fork remains, surface it in product language before deciding it.

## Where to pick up

- Canonical repository: `https://github.com/Futahua/Papers-3`
- Primary-machine checkout: `D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3`
- This file exists in both the source root and installed master. The source copy is
  canonical. A sibling `.git` identifies source; a sibling `App` identifies the installed
  master.
- Authoritative product definition: `docs/PRODUCT.md`
- Chronological creator-accepted decisions: `docs/DECISIONS.md`
- Current implementation boundary: `docs/ARCHITECTURE.md`
- Creator-reported problems, in priority order: `docs/PROBLEMS.md`
- Current acceptance evidence: `docs/ACCEPTANCE.md`
- Syncthing and data policy: `docs/SYNCTHING_AND_DATA.md`
- Release and update procedure: `docs/UPDATING_PAPERS.md`
- Completed Hermes batch: `docs/HERMES_BATCH_HANDOFF.md`. It is historical evidence;
  its old paths and instructions are not current authority.

If the source checkout is unavailable on another machine, obtain the canonical repository
instead of editing packaged files under `App`. Inspect the active branch, working tree,
open pull request and recent commits before continuing existing work.

## Current product boundaries

- Basic remains permanently reachable and contains Backpacks, Tools and Settings.
- Hermes is global. Selecting or entering a Backpack must not automatically change
  Hermes's conversation, working directory or context.
- Creating a Backpack currently asks only for its name. Until real contents are built,
  entering it honestly says that nothing exists yet. This current empty state does not
  define future Backpack contents.
- The permanent Tools destination may remain empty. Only the creator can identify
  something as a Tool; its detailed contract remains open.
- Reuse existing applications and products. Papers should associate, launch, embed,
  restore or coordinate them instead of recreating their interfaces and agent systems.
- Preserve the warm-paper visual character inherited from Papers 1.
- Historical Programs, Runs, ACP workflows and demonstrations remain test fixtures,
  not creator-facing product features.

## Lessons from earlier Papers attempts

- Technical sophistication does not prove that the product has the right shape.
- One Backpack's furniture cannot define every Backpack.
- A specific request cannot silently become a framework.
- An implementation cannot be used as proof that the creator approved its assumptions.

These are boundary lessons, not permission to restore architecture from Papers 1,
Papers 2 or a reverted Papers 3 implementation.

### Concrete correction: “As you Go”

The creator's request concerning the “As you Go” Backpack was specific to that Backpack.
Commit `ba94ecc` wrongly converted it into a universal launch-button editor, generic
Backpack-owned button storage and a product-wide Tool interpretation, then released that
interpretation as Papers 1.2.0. Commit `f81c561` reverted it.

“As you Go” is local to the creator's current machine. That is a fact about this Backpack
only; it does not create a general local/shared classification, setting or storage rule.

Do not restore or reproduce that generalization. The current creator request must define
what “As you Go” becomes; its controls and implementation cannot define other Backpacks
or Papers as a whole.

## When asked to build a Backpack

1. Treat the creator's prompt, attachments and named files as the working specification.
2. Read the current repository documents and inspect the installed behavior before
   changing it. Start with open items in `docs/PROBLEMS.md`; do not revive superseded
   plans from history.
3. Identify the existing product or Windows capability that already does most of the
   work. Build the smallest real, useful connection through Papers.
4. Build the requested workflow for the named Backpack. Do not turn its controls,
   contents or supporting code into a generic Backpack editor or Papers-wide contract.
5. Never infer a Backpack working directory merely from its name or activation.
6. Preserve unrelated creator data and changes. Make migrations reversible.
7. Use isolated test profiles. Test the human-visible path and explain what the creator
   can now do without requiring source-code review.
8. Do not infer authorization to rebuild, version, release, install, terminate or
   restart Papers. When a release is explicitly requested, follow
   `docs/UPDATING_PAPERS.md`; publish only after all required assets finish uploading.
   Installed copies offer the update themselves. Never hand-copy a build over `App`.

## Data and Syncthing rule

Papers data is allowed to evolve feature by feature. These data-safety defaults do not
define what a unique or shared Backpack is and do not authorize a scope field,
synchronization schema or generic Backpack model.

- Durable creator-authored work must be preserved. Whether it synchronizes, where it
  lives and how it appears elsewhere are decided from the real feature and creator request.
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
