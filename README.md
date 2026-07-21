# Papers 3

Papers is a visual switchboard for machine-wide working environments called
**Backpacks**. Entering a Backpack can bring together existing applications,
folders, documents, browser destinations and an optional Hermes workspace across
the Windows desktop. Papers coordinates those products; it does not rebuild them.

Hermes is universal rather than a Backpack-specific program. Papers embeds the
existing Hermes Dashboard `/chat` surface in a sidebar and can launch the existing
Hermes Desktop application as a separate window. Hermes continues to own chat,
attachments, sessions, history, models, settings, tools and approvals.

The older Repository Research, Visual Dashboard and Kill Test programs are retained
only as opt-in integration fixtures. They are not visible in the production app.

## Current status

The aligned shell now provides visual Backpack selection, neutral machine-wide
environment entry, optional folder association, the official Hermes chat sidebar,
and Hermes Desktop pop-out. Desktop-scene capture/launch is the next slice and will
delegate to Microsoft PowerToys Workspaces rather than implement window management.

- [Product definition](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [User guide](docs/USER_GUIDE.md)
- [Implementation plan](PAPERS_3_IMPLEMENTATION_PLAN.md)
- [Acceptance status](docs/ACCEPTANCE.md)

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Set `PAPERS_ENABLE_FIXTURES=1` only when exercising the historical program and ACP
integration suites.
