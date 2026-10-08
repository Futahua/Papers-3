# Papers

> **Coding agents:** start with [`AGENTS.md`](AGENTS.md) and read it completely before
> changing Papers or proposing product behavior.

Papers is a personal layer across Windows. Its governing document is
[`AGENTS.md`](AGENTS.md); [`docs/PRODUCT.md`](docs/PRODUCT.md) is the product reference.

## Documentation map

### Start here

- [Single governing document and product north star](AGENTS.md)

### Product reference

- [Product reference](docs/PRODUCT.md)
- [Chronological creator-accepted decisions](docs/DECISIONS.md)

### Current use, work and acceptance

- [User guide](docs/USER_GUIDE.md)
- [Acceptance status](docs/ACCEPTANCE.md)
- [Creator-reported problems](docs/PROBLEMS.md)

### Current implementation, data and releases

- [Architecture boundary](docs/ARCHITECTURE.md)
- [Projects created for Papers use](docs/PROJECTS.md)
- [Syncthing and evolving data](docs/SYNCTHING_AND_DATA.md)
- [How Papers updates itself](docs/UPDATING_PAPERS.md)

### Historical evidence and engineering fixtures

- [Legacy program fixture contract](docs/PROGRAM_CONTRACT.md)

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

- [New-machine dependency and recovery checklist](docs/NEW_MACHINE_SETUP.md).
