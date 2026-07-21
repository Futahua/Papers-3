# Papers

Papers is a personal layer across the Windows machine. Its permanent Basic control
contains Backpacks, Tools and Settings. Backpacks are named machine-wide environments
or lenses, not project folders or boxed applications. Tools are reusable capabilities
across the system.

Hermes is global rather than Backpack-specific. Papers embeds the existing Hermes
Dashboard `/chat` surface and can launch Hermes Desktop separately. Backpack activity
does not change Hermes's working directory, conversation or context automatically.

The installed product is self-contained beneath one master folder: `Papers/App`
contains the application and `Papers/Data` contains its persistent runtime state.
The master folder also contains `HERMES.md`, the native Hermes pickup instruction for
building Backpacks without making Hermes Backpack-scoped.

The older Repository Research, Visual Dashboard and Kill Test programs are retained
only as opt-in integration fixtures. They are not visible in the production app.

## Current status

The installed shell provides Basic, name-only Backpack creation, the honest empty
Backpack warning, a global Tools destination and the existing global Hermes interface.
The next useful features will be shaped by the creator's first real Backpack rather than
by adding speculative framework screens.

- [Product definition](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Syncthing and evolving data](docs/SYNCTHING_AND_DATA.md)
- [Hermes pickup instructions](HERMES.md)
- [User guide](docs/USER_GUIDE.md)
- [Acceptance status](docs/ACCEPTANCE.md)
- [Creator-reported problems](docs/PROBLEMS.md)
- [Hermes skin specification](docs/HERMES_SKIN.md)
- [Hermes batch implementation handoff](docs/HERMES_BATCH_HANDOFF.md)

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Set `PAPERS_ENABLE_FIXTURES=1` only when exercising the historical program and ACP
integration suites.
