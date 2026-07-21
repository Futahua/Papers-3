# Implement Papers now

Run this locally on the creator's Windows machine:

```text
Finish Papers in D:\Letters\MatTroiSeConMoc\PAPERS 3\Papers-3 on branch
agent/implement-papers3-v1 and update draft PR #3.

Read PAPERS_3_IMPLEMENTATION_PLAN.md and implement it completely. Do not produce another
plan, prototype or framework. Continue until the installed application passes the visible
acceptance list.

The product is simple:

1. Basic is always available and contains Backpacks, Tools and Settings.
2. Hermes is global. Embed the existing Hermes Dashboard `/chat` and offer the existing
   Hermes Desktop as a separate window. Do not recreate or wrap its chat, attachments,
   history, models, settings, permissions or tools.
3. Hermes keeps its own global conversation and context. Backpack activity must never
   change its working directory, start a conversation, inject context or pass `--cwd`.
4. Preserve Hermes's existing machine capabilities. A normal Hermes request may use its
   existing file, terminal, browser, computer-use or coding-delegation tools when those
   are installed and allowed by Windows. Do not build a Papers orchestration, validation,
   self-edit or rebuild workflow around this.
5. Add Backpack asks only for a name and creates nothing else.
6. Enter on a new Backpack shows exactly: `Nothing here yet. Create something under
   “Backpack name”.`
7. A Backpack is a future machine-wide environment, not a folder, project, canvas,
   PowerToys scene or boxed application. Do not invent its contents now.
8. Tools is a permanent global destination for reusable machine capabilities. Its exact
   contract is still open, so provide an honest empty state and no speculative system.
9. Remove the fake entered environment, `(machine wide complex capability)`, folder and
   cover behavior, hardcoded programs, Runs and validation UI from production.
10. Keep historical engineering fixtures available only with PAPERS_ENABLE_FIXTURES=1.

Use existing products and ordinary Windows security boundaries. Do not add UI or systems
not required above. Make technical decisions yourself; do not ask the non-coder creator
to inspect source.

Run type checks, unit tests, production E2E, fixture regressions and packaged-app tests.
Install the package locally and verify every visible acceptance statement in
PAPERS_3_IMPLEMENTATION_PLAN.md. Exercise real Hermes with a harmless prompt, attachment
and allowed machine action; never use real creator files for destructive tests.

Fix failures, commit the intended changes, push the branch, update PR #3 and leave the
worktree clean. Return only: what the creator can now click and do, the installer path,
the evidence that it worked, and any genuine blocker. Do not call it finished otherwise.
```
