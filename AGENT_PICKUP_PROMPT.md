# Pickup prompt — build the honest Papers base

Run this locally on the creator's Windows machine.

```text
Continue Papers 3 in D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3 on the existing
agent/implement-papers3-v1 branch and draft PR #3.

Read PAPERS_3_IMPLEMENTATION_PLAN.md completely before changing code. It is the current
plain-language product contract and overrides older plans, prototypes and assumptions.
Also read Futahua/papers-are-papers PROJECT_CONTEXT.md for the original definitions of
Basic, Backpacks, Tools and global AI, but follow the creator's newer instructions in the
Papers 3 plan when they differ.

Implement the usable base described there through packaged, installed, human-visible
acceptance. Do not design the first Backpack's contents. The creator will shape it while
using the product.

Non-negotiable behavior:
- Basic is permanent and contains Backpacks, Tools and Settings.
- Hermes is one global interface. Use the existing Hermes Dashboard `/chat` and plain
  Hermes Desktop product. Backpack activity must not change its working directory,
  conversation or context automatically.
- Add Backpack asks only for a name and creates no folder, cover, canvas, program,
  conversation or hidden contents.
- Entering a newly created Backpack shows exactly: `Nothing here yet. Create something
  under “Backpack name”.`
- A Backpack is a machine-wide environment or lens, not a boxed app, folder workspace,
  project, canvas or PowerToys scene.
- Tools is a permanent global destination. Tools may eventually represent programs,
  shortcuts, scripts, automation, locations, synchronization and utilities shared across
  Backpacks. Its exact contract is undecided, so show an honest empty state and do not
  invent a marketplace, registry architecture or Backpack-specific Tool system.
- Historical programs, ACP, Runs and validation UI remain invisible unless
  PAPERS_ENABLE_FIXTURES=1.

Remove current production behavior and documentation that associates a Backpack folder
with Hermes or passes `--cwd` during Backpack entry/pop-out. Keep manual context selection
inside Hermes itself. Remove the shipped `(machine wide complex capability)` placeholder
and any fake environment that makes an empty Backpack appear implemented.

Make normal technical decisions autonomously, but do not answer the explicitly open
Backpack-content, Tool-contract or Data-Source questions with code. Do not ask the
non-coder creator to review source. Validate behavior through the visible application.

Run type checks, unit tests, production build, product E2E, packaged-app tests and fixture
regressions. Install the package locally. Verify the ten human-acceptance statements in
PAPERS_3_IMPLEMENTATION_PLAN.md, including that Hermes remains global and Backpack entry
does not change its context. Capture concise screenshots of Basic, Backpacks, the empty
warning, Tools and global Hermes.

Fix primary-workflow failures until acceptance passes. Then explicitly stage only the
intended changes, commit, push the existing branch and update draft PR #3. Leave the
worktree clean. In the final handoff, explain only what the creator can now click and see,
what was tested, and which product questions remain deliberately unanswered.
```
