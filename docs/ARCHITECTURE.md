# Papers 3 — current architecture boundary

The production shell has four concepts:

```text
Papers
├── Basic
│   ├── Backpacks
│   ├── Tools
│   └── Settings
├── Global Hermes sidebar / Hermes window
├── Backpack names and future contents
└── Global Tools (contract still open)
```

## Global Hermes boundary

Papers hosts the existing Hermes Dashboard `/chat` and may open plain Hermes Desktop.
Backpack interaction does not provide a working directory, start a conversation, reset a
session or limit Hermes context. Hermes owns its own chat, attachments, models, settings,
history and tools.

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
