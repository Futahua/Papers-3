# Papers

Papers is a personal layer across the Windows machine. Its permanent Basic control
contains Backpacks, Tools and Settings. Backpacks are named machine-wide environments
or lenses, not project folders or boxed applications. Tools are reusable capabilities
across the system.

Hermes is global rather than Backpack-specific. Papers runs one Hermes backend and shows
the real Hermes Desktop in two placements — docked beside Papers or as a detached window —
using the two symbol toggles in the top bar (D-011, D-012). Backpack activity does not
change Hermes's working directory, conversation or context automatically.

The installed product is self-contained beneath one master folder: `Papers/App`
contains the application, `Papers/Data` contains its machine-local runtime state, and
`Papers/Shared` contains durable creator-authored Backpack button definitions.
The master folder also contains `HERMES.md`, the native Hermes pickup instruction for
building Backpacks without making Hermes Backpack-scoped.

The older Repository Research, Visual Dashboard and Kill Test programs are retained
only as opt-in integration fixtures. They are not visible in the production app.

## Current status

The installed shell provides Basic, name-only Backpack creation, Backpack buttons that
launch existing Windows targets, a global Tools destination and the existing global Hermes
interface. Further contents will be shaped by real Backpack use rather than speculative
framework screens.

- [Product definition](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Consequential decisions](docs/DECISIONS.md)
- [How Papers updates itself](docs/UPDATING_PAPERS.md)
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

Papers updates itself from its GitHub releases. To publish a new version, bump `version`
in `package.json`, run `npm run release`, then publish the draft release GitHub creates —
only after its uploads finish. See [How Papers updates itself](docs/UPDATING_PAPERS.md).

Set `PAPERS_ENABLE_FIXTURES=1` only when exercising the historical program and ACP
integration suites.
