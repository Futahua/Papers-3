# Papers

> **Coding agents:** start with [`HERMES.md`](HERMES.md) and read it completely before
> changing Papers or proposing product behavior.

Papers is a personal layer across Windows. Its authoritative product definition is
[`docs/PRODUCT.md`](docs/PRODUCT.md); current implementation and historical projects are
not substitutes for that definition.

## Documentation map

### Start here

- [Mandatory agent pickup and creator contract](HERMES.md)

### Product authority

- [Product definition](docs/PRODUCT.md)
- [Chronological creator-accepted decisions](docs/DECISIONS.md)

### Current use, work and acceptance

- [User guide](docs/USER_GUIDE.md)
- [Acceptance status](docs/ACCEPTANCE.md)
- [Creator-reported problems](docs/PROBLEMS.md)

### Current implementation, data and releases

- [Architecture boundary](docs/ARCHITECTURE.md)
- [Syncthing and evolving data](docs/SYNCTHING_AND_DATA.md)
- [How Papers updates itself](docs/UPDATING_PAPERS.md)
- [Hermes skin integration and updates](docs/HERMES_SKIN_INTEGRATION.md)
- [Hermes skin specification](docs/HERMES_SKIN.md)

### Historical evidence and engineering fixtures

- [Hermes batch implementation handoff](docs/HERMES_BATCH_HANDOFF.md)
- [Legacy program fixture contract](docs/PROGRAM_CONTRACT.md)
- [Hermes batch evidence](docs/evidence/hermes-batch/README.md)

Historical material records what happened. It does not define future Backpack contents
or authorize the return of superseded product architecture.

## Repository checks

```powershell
npm install
npm run typecheck
npm test
npm run build
```

Release, installation, termination and restart require separate creator authorization.
When a release is explicitly requested, follow
[How Papers updates itself](docs/UPDATING_PAPERS.md).

Set `PAPERS_ENABLE_FIXTURES=1` only when exercising the historical program and ACP
integration suites.
