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
| Microsoft PowerToys Workspaces | installed with PowerToys | Optional read-only scene discovery and official launcher by ID | Never required or bundled; PowerToys owns capture, application launch and window arrangement |
| Git | 2.53.0.windows.2 | `git` CLI via execFile, structured args | Not bundled |
| LibreOffice | installed at `C:\Program Files\LibreOffice` | `soffice.exe` launch with validated path arguments | Not bundled |
| Everything | 1.4.1.1032 observed | Official local IPC/SDK query interface | Everything owns the live file index; the application itself is not bundled |
| Directory Opus | 13.23 observed | Supported `dopusrt.exe /cmd` command interface | Not bundled; Directory Opus owns copy/move/rename/delete behavior |

## Bundled native SDK components

| Component | License | Role | Provenance |
|---|---|---|---|
| Everything SDK x64 DLL (`resources/native/everything/Everything64.dll`) | MIT | Local IPC client used by the bounded Everything search helper | Official voidtools Everything SDK download; SHA-256 `81B5BE18126ACD2C2B913F8F4A821E476B18393CDD3DEBD03387C50AFD8DB88F`; license text beside the DLL |
| Revit embedded-preview extraction reference (`resources/native/revit-preview.cs`) | MIT reference | Read-only extraction of the PNG stored in the `RevitPreview4.0` OLE stream for RVT/RFA/RTE/RFT previews | Format/extraction behavior referenced from `CodeCavePro/revitless-toolkit` commit `56e26d1186031fc65cd67260975f675abf2547fd`; upstream copyright/license preserved in `resources/native/revit-preview.LICENSE.txt` |

## External demonstration fixture (never part of Papers)

| Repository | Pin | License | Rule |
|---|---|---|---|
| `logseq/logseq` | commit `a4963dca579f42817135d8473166a03fa7ea2409` | AGPL-3.0 | Disposable checkout outside the Papers tree; read/analyze/build only; no code copied into Papers; never pushed to |

## Copied assets

The Everything SDK DLL above is the only bundled third-party native component currently recorded here. Any future copied asset or utility must be recorded with source, license, and reason.
