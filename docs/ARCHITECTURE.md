# Papers — current architecture boundary

The production shell has four concepts:

```text
Papers  (slim theme-matched title bar; native window controls only)
├── Basic
│   ├── Backpacks
│   ├── Tools
│   └── Settings
├── Global Hermes — the real Hermes Desktop, docked or detached (two SVG toggles)
├── Backpack names and future contents
└── Global Tools (contract still open)
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

## Tool boundary

Tools are global reusable capabilities. Their exact discovery, persistence, configuration
and enable/disable contract is not yet decided. The permanent Tools screen may therefore
be honest and empty, but it must not be replaced with speculative architecture.

## Fixture boundary

The program sandbox, ACP adapter, Agent Runs and demonstration workflows load only with
`PAPERS_ENABLE_FIXTURES=1`. They are not part of production Papers.

## Evolving synchronization boundary

The installed master folder may be carried by Syncthing, but executable files, durable
creator work and live machine state are different kinds of data. Papers does not freeze
a speculative schema before real Backpacks exist. Each useful feature must identify its
data owner and sync behavior using [the data inventory](SYNCTHING_AND_DATA.md).

Durable creator-authored work defaults toward survival. Caches, locks, credentials,
browser profiles, live database journals and installations default toward machine-local
state. Ambiguous data is preserved and documented until real use makes the decision
auditable.
