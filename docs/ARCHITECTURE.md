# Papers 3 — architecture

## Production path

```text
Papers Electron shell
├── BackpackRegistry
│   └── identity, archive state, optional folder/cover, Hermes visibility
├── visual Backpack chooser / entered environment
├── HermesSurface (thin adapter)
│   ├── sidebar → existing `hermes dashboard` at http://127.0.0.1:9119/chat
│   └── pop-out → existing `hermes desktop [--cwd <folder>]`
└── optional desktop scene adapter
    └── read PowerToys scenes; launch selected scene by ID
```

Papers hosts Hermes Dashboard in a sandboxed `WebContentsView`. It does not parse,
translate or persist Hermes messages. The pop-out command launches Hermes Desktop,
which shares Hermes's own configuration, sessions, skills and memory.

The optional folder stored on a Backpack is passed to Hermes Desktop as its initial
working directory. It is an association, not an implicit dump of Backpack content.

PowerToys is not part of the production critical path. When present, Papers may read
`%LOCALAPPDATA%\Microsoft\PowerToys\Workspaces\workspaces.json` without modifying it
and launch `PowerToys.WorkspacesLauncher.exe <workspace-id>`. Missing PowerToys, a
missing scene file or no saved scenes leaves the Backpack fully functional.

## Existing-product rule

Before implementing a capability in Papers:

1. Determine whether Hermes, Windows, PowerToys, Directory Opus, the default browser,
   LibreOffice or another installed product already provides it.
2. Prefer launch, focus, deep link, documented CLI or local supported surface.
3. Store only the association Papers needs to restore the environment.
4. Implement a Papers-owned surface only when no suitable product exists.

## Fixture boundary

The earlier program sandbox, capability broker, ACP adapter, AgentRunService and
Repository Research workflow remain in the source tree solely as integration evidence.
They are loaded only with `PAPERS_ENABLE_FIXTURES=1`. Production does not start ACP,
show programs, display Agent Runs, or mediate Hermes permissions.

This boundary keeps proven experiments available without allowing sunk implementation
effort to determine the product.

## Persistence

Creator-owned Papers metadata remains under `%APPDATA%\papers3\PapersData`. Cover paths
refer to creator-owned images; Papers does not copy them. Hermes data remains in Hermes's
own home. PowerToys scene definitions remain owned by PowerToys. Papers stores references,
not duplicate databases or imported copies.
