# Papers 3 — Product

Papers 3 gives work persistent places called **Backpacks**. Papers itself stays narrow: identify → expose → enter → leave → restore → switch.

The first finished Backpack type is the **Canvas Backpack** — a persistent programmable workbench that transforms into purpose-built **programs** while preserving:

- a stable host frame (leave, identity, launcher, save status, permissions, agent runs, recovery);
- one active primary program at a time;
- sandboxed, independently styled program surfaces;
- program-owned data, selection, and commands;
- a permission-based capability broker;
- exact, previewable Hermes invocations — never an implicit "send this Backpack to the AI";
- Hermes-supervised Codex and OpenCode coding workers in isolated Git worktrees;
- external application integration (LibreOffice, file browser, URLs);
- crash isolation, persistence, and recovery.

The primary first-party program is **Repository Research and Production**: register a real repository, browse and select exact files/regions, capture evidence with commit/path/hash provenance, link notes and topics, invoke precise agent actions, delegate approved coding tasks to workers in disposable worktrees, and assemble an editable report opened in LibreOffice Writer.

A small second program, **Visual Dashboard**, proves program isolation and styling freedom against explicitly shared summary data.

The end-to-end demonstration uses a disposable pinned checkout of `logseq/logseq` (commit `a4963dca579f42817135d8473166a03fa7ea2409`, AGPL-3.0) as external research material — never imported into Papers, never pushed to.

The authoritative scope, boundaries, and acceptance criteria are in [PAPERS_3_IMPLEMENTATION_PLAN.md](../PAPERS_3_IMPLEMENTATION_PLAN.md).
