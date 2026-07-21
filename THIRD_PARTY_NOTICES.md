# Third-party notices

Every dependency and reused asset with provenance and license.

## Runtime dependencies (npm, exact-pinned in package.json / package-lock.json)

| Package | Version | License | Role |
|---|---|---|---|
| react | 19.2.7 | MIT | Host renderer UI |
| react-dom | 19.2.7 | MIT | Host renderer UI |
| zod | 4.4.3 | MIT | Boundary schema validation |

## Development / build dependencies

| Package | Version | License | Role |
|---|---|---|---|
| electron | 43.1.1 | MIT | Application runtime |
| electron-vite | 5.0.0 | MIT | Build tooling |
| vite | 7.3.6 | MIT | Build tooling |
| electron-builder | 26.15.3 | MIT | Windows packaging |
| typescript | 5.9.3 | Apache-2.0 | Type checking |
| vitest | 4.1.10 | MIT | Automated tests |
| @types/node, @types/react, @types/react-dom | pinned | MIT | Type definitions |

## External products used through supported interfaces (not bundled, not vendored)

| Product | Version observed | Interface | Boundary |
|---|---|---|---|
| Hermes Agent | 0.16.0 (2026.6.5) | Global existing Dashboard `/chat` and plain Hermes Desktop; ACP fixtures only | Never Backpack-scoped or vendored; Hermes owns chat, sessions, configuration, tools and updates |
| Microsoft PowerToys Workspaces | installed with PowerToys | Optional read-only scene discovery and official launcher by ID | Never required or bundled; PowerToys owns capture, application launch and window arrangement |
| Codex CLI | 0.145.0-alpha.18 (Desktop-bundled) | CLI, invoked by Hermes | Not bundled; user's config untouched |
| OpenCode CLI | 1.14.28 | CLI, invoked by Hermes | Not bundled |
| Git | 2.53.0.windows.2 | `git` CLI via execFile, structured args | Not bundled |
| LibreOffice | installed at `C:\Program Files\LibreOffice` | `soffice.exe` launch with validated path arguments | Not bundled |

## External demonstration fixture (never part of Papers)

| Repository | Pin | License | Rule |
|---|---|---|---|
| `logseq/logseq` | commit `a4963dca579f42817135d8473166a03fa7ea2409` | AGPL-3.0 | Disposable checkout outside the Papers tree; read/analyze/build only; no code copied into Papers; never pushed to |

## Copied assets

None so far. Any future copied asset or utility must be recorded here with source commit, license, and reason.
