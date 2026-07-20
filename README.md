# Papers 3

Papers 3 is a local Windows workbench for persistent project spaces called
**Backpacks**. Programs run as isolated, independently styled surfaces inside a
stable Canvas frame. They can invoke Hermes only from exact workflow actions with
an inspectable selection, permission boundary, and declared result destination.

The first complete workflow is **Repository Research**: register a repository,
capture hash-provenanced evidence, ask Hermes for structured work, delegate coding
tasks to isolated Codex or OpenCode workers, build an editable FODT report, and
open it in LibreOffice Writer. **Visual Dashboard** demonstrates that another
program sees only an explicitly published summary.

## Use and verify

- [User guide](docs/USER_GUIDE.md)
- [Final acceptance report](docs/ACCEPTANCE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Program contract](docs/PROGRAM_CONTRACT.md)
- [Implementation plan](PAPERS_3_IMPLEMENTATION_PLAN.md)

```powershell
npm install
npm run typecheck
npm test
npm run test:e2e
npm run package
```

The Windows installer is written to `release/Papers3-Setup-1.0.0.exe`.
