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

The older Repository Research, Visual Dashboard and Kill Test programs are retained
only as opt-in integration fixtures. They are not visible in the production app.

## Current status

The existing shell proves Hermes hosting and Backpack persistence, but still contains
incorrect folder-oriented and simulated-environment assumptions. The next build restores
Basic, makes creation name-only, shows an honest warning for empty Backpacks, restores the
global Tools destination and removes all automatic Backpack context from Hermes.

- [Product definition](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [User guide](docs/USER_GUIDE.md)
- [Implementation plan](PAPERS_3_IMPLEMENTATION_PLAN.md)
- [Implementation-agent pickup prompt](AGENT_PICKUP_PROMPT.md)
- [Acceptance status](docs/ACCEPTANCE.md)

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Set `PAPERS_ENABLE_FIXTURES=1` only when exercising the historical program and ACP
integration suites.
