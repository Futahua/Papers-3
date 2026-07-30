# Papers — current architecture boundary

This describes the current implementation, not the product ontology. Product meaning
comes from [`PRODUCT.md`](PRODUCT.md), and agent behavior is governed by
[`HERMES.md`](../HERMES.md).

The production shell has four concepts:

```text
Papers  (slim theme-matched title bar; native window controls only)
├── Basic
│   ├── Backpacks
│   ├── Tools
│   └── Settings
├── Global Hermes — the real Hermes Desktop, docked or detached (two SVG toggles)
├── Backpack names and future contents
└── Tools destination (meaning and contract still open)
```

## Global Hermes boundary

Papers runs exactly one Hermes backend (`hermes dashboard` on 127.0.0.1:9119 with a
Papers-generated session token) and shows the **real Hermes Desktop** against it in two
placements — docked as a sidebar or detached as a window — controlled by two SVG toggles.
There is no separate embedded Dashboard `/chat`. The Papers↔Hermes docking channel is a
loopback seam authenticated with a per-launch shared token (see D-011…D-015 and
`docs/evidence/hermes-batch/`). Backpack interaction does not provide a working directory,
start a conversation, reset a session or limit Hermes context. Hermes owns its own chat,
attachments, models, settings, history and tools.

## Backpack boundary

Papers currently persists Backpack identity and whether real contents exist. New
Backpacks contain only a name. `Enter` checks for genuine contents; when none exist it
shows the required warning rather than creating a fake environment.

The future contents contract is intentionally absent. No folder, canvas, scene or program
runtime may become that contract by implementation accident.

Accepted ownership boundary: Papers is the stable host, while a real Backpack may be an
independently developed project outside `App` and the packaged `app.asar`. Backpack
interfaces and workflow code do not belong in the main binary merely because Papers
displays them. This plugin-like ownership does not yet select a universal project format
or loading architecture.

Papers may eventually contain unique and shared Backpacks, but the architecture does not
define those terms or prescribe storage, synchronization, portability or local bindings
before a real Backpack requires them.

Papers 1.2.2 had a placement error: the exact “As you Go” ID selected a dedicated renderer
and main-process service compiled into Papers. The source correction prepared for the
explicitly authorized 1.2.3 release removes that exact ID, interface, pickup prompt and
action definitions from compiled source.

The concrete host seam now demonstrated by the local project is deliberately small:

```text
machine-local binding (PapersData/backpack-projects.json)
        │ exact Backpack ID → absolute project root; never sent to the renderer
        ▼
Papers main process
  ├── validates the binding, project entry and declared action IDs
  ├── serves only static files under that project's `public/` subtree
  │   on a per-Backpack secure origin
  ├── opens only absolute action targets declared in the external project
  └── offers copy-text and close mediation
        ▼
sandboxed project frame
```

Project files are read again when the Backpack is entered or an action is used. Therefore
ordinary interface, prompt and action changes to the local “As you Go” project do not
require rebuilding, versioning, releasing or restarting Papers. The binding is optional;
an unbound Backpack still receives the honest empty warning.

`project.json`, `actions.json` and their absolute paths are private main-process control
records. They cannot be fetched through the project scheme; real-path containment also
rejects a junction or symbolic-link alias from `public/` back to a private record.

This is current implementation required by one demonstrated project, not a required format
for every Backpack. It does not define plugin installation, discovery, synchronization,
portability or the future architecture of any other Backpack.

## Tool boundary

Basic contains a permanent Tools destination. Only the creator decides what is a Tool.
Its discovery, persistence, configuration, scope and lifecycle are not yet decided. The
Tools screen may therefore be honest and empty, but it must not be replaced with
speculative architecture.

## Fixture boundary

The program sandbox, ACP adapter, Agent Runs and demonstration workflows load only with
`PAPERS_ENABLE_FIXTURES=1`. They are not part of production Papers.

## Evolving synchronization boundary

The installed master folder is outside Syncthing and must not be synchronized as a whole.
Executable files, durable creator work and live machine state are different kinds of
data. Papers does not freeze a speculative schema before real Backpacks exist. Each useful
feature must identify its data owner and sync behavior using
[the data inventory](SYNCTHING_AND_DATA.md).

That feature-by-feature classification is a data-safety practice. It does not define
unique or shared Backpacks in advance.

Durable creator-authored work must be preserved, but preservation does not itself decide
whether it synchronizes. Caches, locks, credentials, browser profiles, live database
journals and installations default toward machine-local state. Ambiguous data is
preserved and documented until real use makes the decision auditable.
