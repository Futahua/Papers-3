# Papers 3 — consequential decisions

## D-001 — Existing products are the product boundary (2026-07-21)

The creator explicitly rejected Papers-owned agent validation workflows, modular agent
programs and duplicated interfaces. Before implementing any capability, Papers must use
the existing product that already owns it and limit itself to association, launch, focus,
embedding or restoration.

This decision supersedes the program-centric decisions in the previous plan and decision
log, which remain available in Git history.

## D-002 — Backpacks are machine-wide environments (2026-07-21)

A Backpack is not a Canvas. It can span application windows, folders, browser destinations,
documents, multiple monitors, Hermes and an optional Papers surface. Entering one activates
an environment; it does not automatically invoke an agent or share all Backpack content.

## D-003 — Hermes UI is reused, not recreated (2026-07-21)

The installed Hermes Agent already provides:

- `hermes dashboard`, including an unconditional embedded `/chat` surface;
- Hermes Desktop with chat, attachments, streaming tools, previews, file browsing,
  conversation history, voice, settings, models and credentials;
- `hermes desktop --cwd <folder>` for an initial project directory.

Decision: production Papers embeds the dashboard chat and launches Hermes Desktop. Papers
does not own chat messages, session state, agent approvals or settings. The ACP integration
is a fixture only.

## D-004 — Desktop scenes delegate to PowerToys Workspaces (2026-07-21)

The creator's Windows machine already has Microsoft PowerToys Workspaces, including its
editor, snapshot tool, launcher and window arranger. Papers will associate Backpacks with
PowerToys scenes rather than implement window capture, application launch or placement.

## D-005 — Historical programs are opt-in fixtures (2026-07-21)

Repository Research, Visual Dashboard and Kill Test were useful vertical proofs but are
not creator workflows. Production loads no programs and starts no ACP child. The old path
is enabled only with `PAPERS_ENABLE_FIXTURES=1` for regression testing.

## D-006 — Acceptance is human-facing (2026-07-21)

Automated tests establish engineering confidence but cannot establish usefulness. Release
readiness requires the non-coder human acceptance script in the authoritative plan. Papers
must not call itself complete while its primary everyday workflow remains absent.
