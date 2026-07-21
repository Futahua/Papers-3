# Papers 3 — current acceptance status

The earlier “final acceptance” applied to a technical prototype whose workflows the creator
does not use. Its machine-readable evidence remains under `docs/evidence/` as fixture proof,
not proof of product usefulness.

## Aligned production shell

| Criterion | Status | Evidence |
|---|---|---|
| Backpacks are presented as machine-wide environments | Passed | Production E2E and visible shell |
| Entering a Backpack does not require choosing a program | Passed | Production catalog is empty unless fixture flag is set |
| Empty environment displays `(machine wide complex capability)` | Passed | Production E2E exact assertion |
| Hermes is available from chooser and active Backpack | Passed | Host controls on both surfaces |
| Sidebar uses Hermes's own interface | Passed | E2E verifies loaded URL is `http://127.0.0.1:9119/chat` |
| Hermes can open as its existing native window | Implemented | `hermes desktop` launch, with optional `--cwd` |
| Optional Backpack folder persists | Passed | Registry unit test |
| Programs/Runs/Papers agent permissions absent from production | Passed | Production E2E assertions |
| Type safety and unit suite | Passed | `npm run typecheck`; 60 unit tests |
| Packaged Windows application preserves the aligned shell | Passed | Product E2E against `release/win-unpacked/Papers 3.exe` |
| Legacy technical fixtures still work when explicitly enabled | Passed | Kill/restart and repository-workflow E2E suites |

## Required before calling the product ready

- Complete the compact name/folder/cover creation flow.
- Replace schematic previews and placeholder text with useful Backpack identity.
- Open Hermes automatically on first entry and remember its later visibility.
- Exercise file and image attachment in the embedded Hermes surface manually.
- Exercise a real file modification in a selected folder through Hermes Desktop.
- Add safe `Open folder` behavior, a real application icon and final product metadata.
- Install the package and complete the plan's non-coder human acceptance script.

PowerToys scene association and tray/global switching are optional post-release work.
Their absence must not block the first useful Backpack.

No source-code review by the creator is required for acceptance.
