# Papers on a new Windows machine

Reference under [AGENTS.md](../AGENTS.md). Audited 2026-10-07 against the current working
trees of Papers 1.3.11, As you Go, Proxima 0.1 and Delegate Wave. This is a source audit
and recovery kit, not a successful clean-machine installation test. It includes current
uncommitted work. The Craft apps discussed in the conversation are not integrated and
are not current dependencies.

## What to obtain first

The local recovery kit is at:
`D:\Letters\MatTroiSeConMoc\Products\Papers\Backups\Dependency kit\2026-10-07`.
The kit contains 12 ZIPs (size recorded in manifest.json); most space is the external Playwright
browser runtime. Its manifest records source paths, contents, size and SHA-256. ZIP integrity
is checked; this does not prove every restored application works on a new machine.

## Runtime dependency inventory

| Need | Download / recover | What the code actually requires; behavior without it | Source evidence |
|---|---|---|---|
| Papers shell | [Papers installer](https://github.com/Futahua/Papers-3/releases), or kit's local installer | Windows x64 target. Run the installer into an App directory with writable sibling Data. The archived installer is a local unpublished 1.3.11 build, not a claim that a public release has these edits. | [packaging](../electron-builder.yml), [startup](../src/main/index.ts) |
| Native focus, window tracking, input hooks, thumbnails and preview helpers | Windows PowerShell and .NET Framework C# compiler | Helpers ship as source and compile on demand using `%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. Windows PowerShell is resolved under System32. Verify these OS components; missing compiler/runtime disables affected native capabilities. A modern dotnet SDK alone does not satisfy the exact compiler lookup. | [compiler lookup](../src/main/windows/foregroundBridge.ts), [window helper](../src/main/windows/windowHelperSpawn.ts), [packaged resources](../electron-builder.yml) |
| AYG real-file copy/move/rename/recycle, including file-backed snapshot creation | [Directory Opus](https://www.gpsoft.com.au/) | Actual installation must register dopus.exe under HKLM or HKCU App Paths, with dopusrt.exe beside it. No generic fallback implements these four operations: absent Opus returns DOPUS_UNAVAILABLE. Folder listing/read/create-folder do not themselves need Opus. Do not restore a licence by copying another machine's files. | [file operations and discovery](../src/main/backpacks/fileCapabilityService.ts), AYG public/app/state-snapshots.js |
| Everything global search | [Everything 1.4 x64](https://www.voidtools.com/downloads/) | Run Everything and let it build its index. Papers ships Everything64.dll and compiles its query helper; the DLL is not the search application or index. Absent/unreachable running Everything produces IPC failure. Configure service/permissions on this machine; kit excludes previous index/config/history. | [search bridge](../src/main/backpacks/everythingSearchBridge.ts), [SDK helper](../resources/native/everything-search.cs) |
| Direct onscreen window picking / SlopTop actions | [AutoHotkey v2](https://www.autohotkey.com/) plus kit SlopTop script/runtime/assets | Papers writes signals and waits for an already-running SlopTop engine; it does not install or start that engine for Direct Pick. Current script auto-elevates. Start it deliberately and configure startup if wanted. Cursor assets must stay relative to the script. Host uses `%PUBLIC%\Documents\PapersNativeBridgeReceipts`; script currently hard-codes C:\Users\Public there, so nonstandard Public paths need reconciliation. | [pick wiring](../src/main/index.ts), [protocol](../src/main/windows/slopTopPickerProtocol.ts), [script source](../tools/sloptop/sloptop_engine.ahk) |
| Office/text-document PDF conversion; inline Writer/Calc editing | [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) | Install LibreOffice including its bundled Python/UNO component. Looks for soffice.exe in Program Files/LibreOffice/program (and x86 equivalent); inline editing also requires python.exe and soffice.bin. Conversion/editing is unavailable without the appropriate installed components. Copying an executable alone is insufficient. | [conversion](../src/main/backpacks/fileCapabilityService.ts), [inline editing and tested limits](INLINE_OFFICE_EDITING.md), [legacy editor](../src/main/external/externalBridge.ts) |
| Presentation PDF conversion | Microsoft PowerPoint desktop, properly installed/licensed | Looks for Microsoft Office/root/Office16/POWERPNT.EXE and uses PowerPoint.Application COM to open/save PDF. A web Office subscription page alone does not supply COM. Other preview/fallback routes may still apply. | [PowerPoint bridge](../src/main/backpacks/powerPointPreviewBridge.ts) |
| E-book conversion/reading preview | [Calibre](https://calibre-ebook.com/download_windows) | Discovers ebook-convert.exe and calibre-debug.exe under Program Files/Calibre2. Calibre is not bundled. | [Calibre bridge](../src/main/backpacks/calibrePreviewBridge.ts) |
| DWG/DXF interactive HTML preview | [Node.js](https://nodejs.org/en/download) (or kit Node 24.14.1 runtime) + @mlightcad/cad-simple-viewer-cli + matching Playwright Chromium | Existing kit carries CLI 1.7.3 and installed dependencies. Set PAPERS_MLIGHTCAD_PREVIEW_ROOT to extracted runtime root, PAPERS_NODE_EXE if Node is not discoverable, and PLAYWRIGHT_BROWSERS_PATH to extracted browser cache. Default root is D:\Programs\MLightCADPreview. The embedded Papers Chromium is not the external Playwright installation this CLI expects. | [MLightCAD bridge](../src/main/backpacks/mlightCadPreviewBridge.ts) |
| AutoCAD drawing thumbnail fallback | AutoCAD desktop with accoreconsole.exe | Scans Program Files/Autodesk/AutoCAD <year> and chooses newest matching core console. Optional; MLightCAD and other providers are separate paths. Respect vendor installation/licensing. | [AutoCAD bridge](../src/main/backpacks/autoCadPreviewBridge.ts) |
| Windows shell preview handlers / shell thumbnails | The application or extension registering the desired format's handler | Uses installed Windows COM handlers. There is no universal package providing every format; coverage depends on installed programs. Revit embedded-preview extraction itself ships as C# and reads structured storage, so a full Revit install is not an intrinsic dependency for that extraction. | [preview handlers](../src/main/backpacks/windowsPreviewHandlerBridge.ts), [Revit extractor](../resources/native/revit-preview.cs), [thumbnails](../src/main/backpacks/shellThumbnailBridge.ts) |
| Obsidian markdown preview integration | [Obsidian](https://obsidian.md/download) and its functioning CLI/eval command | Finds OBSIDIAN_PATH, usual local/program install, or obsidian protocol registry; invokes eval. Installing Obsidian alone is not proof the CLI works. | [Obsidian path/eval](../src/main/backpacks/fileCapabilityService.ts) |
| Delegate Wave Backpack | Independently running compatible delegate-wave service | UI source/generated public assets alone do not supply its operational backend. Current host default is loopback port 47321; machine-local config can override it. It reads local operator config/DPAPI credential, which must be recreated on the new machine. Service source/install is not present in this kit; do not assume old 3001 journal instructions match current code. | [relay/config](../src/main/delegateWave/delegateWaveRelay.ts), Delegate Wave README.md |
| Optional declared Backpack services | Each service named by the project's local-service.json | Papers bridges declared loopback services but does not install them. Inspect each declaration and restore its service independently. | [local service bridge](../src/main/backpacks/localServiceBridge.ts) |
| USB phone mirroring action | [scrcpy](https://github.com/Genymobile/scrcpy) with ADB (kit version 3.3.4) | usb.bat runs scrcpy --select-usb --turn-screen-off. Phone must enable/authorize USB debugging; device driver may be needed. This is one prepared action, not required to launch Papers. | AYG actions.json and existing usb.bat |
| Other prepared actions and saved shortcuts | Their actual programs/scripts/files | AYG actions.json references CLIPS.bat, SLOPTOP MODE.bat, SlopTop and usb.bat at this machine's absolute paths. Restore/create their intended targets and remap paths; do not download every linked application as a Papers prerequisite. CLIP STUDIO PAINT launcher and SLOPTOP MODE wrapper are machine-specific and are not certified portable packages here. | AYG actions.json; [action owner](../src/main/backpacks/backpackProjectService.ts) |

## Already carried by the application or projects

AYG serves its public/ directly, including local D3/Anime vendor modules; no npm install
is required merely to display that project. Proxima's current public/ is also static;
there is no root package.json or delivered SQLite service in this checkout. Its
DATA-PLANE.md destination must not be mistaken for an installed dependency.
Delegate Wave public/ is generated, served output; its src/ is source. A production
bundle does not need a separately installed React runtime, but its backend is separate.

## Network services and incomplete portability

MLightCAD CLI defaults to a CDN cad-data base for fonts/templates. The Papers bridge
does not pass a local base-url, so archived CLI/browser files do not prove fully offline
CAD preview. Web pages, Lens/Google search, favicon retrieval, adblock list refresh,
updates, package installation and AI providers may also need network access. These are
service/resource dependencies, not installed-app requirements.

Pencilcase hosts the ChatGPT local coder view migrated from the retired Delegate Wave
Backpack. That entry still requires the existing dedicated relay/backend; retirement
of the Backpack does not remove the companion service. No current backend source was positively
identified for packaging; its machine data folders contain runtime state, not a certified
server installer. No secret files or live databases were copied as substitutes.

Verification on the existing machine: Windows csc.exe and registered-location dopusrt.exe
exist; Node reports v24.14.1; MLightCAD CLI --help exits successfully without desktop input.
Those checks prove presence/basic loading, not a fresh-machine feature acceptance run.

## Building from source instead of running an installer

Obtain Node.js with npm and Git. Papers uses Vite 7; the installed toolchain's engine
requirements apply (Node 20.19+ or 22.12+ for that Vite generation). Run npm ci from the
Papers source using package-lock.json, then npm run typecheck, npm test and npm run
package as appropriate. electron-builder fetches its packaging tools/Electron runtime.
Do not classify these build downloads as prerequisites for the packaged user runtime.

## Restore order and what a ZIP cannot replace

No .git history, machine activation/licence, auth, live Electron/browser profile, Everything
index, worker database or Python venv is being silently transported. Installed Opus,
Office, AutoCAD, Calibre and LibreOffice require proper installers, not copied executables.
The kit intentionally contains separate source and runtime archives rather than copies
of multiple old builds. Windows feature readiness, licences and provider/API accounts
remain new-machine setup tasks. No application was installed or restarted to produce it.

## Current removal checkpoint

The retired AI integration is absent from Papers source, packaging and this kit.
The installer still supplies normal Chromium, file/window helpers and independent
Backpack hosting. No separate AI application or account is needed for Papers to run.

## Pencilcase checkpoint — 2026-10-07

Restore `pencilcase-project.zip` as an independent project and bind its project.json
to the newly created Pencilcase Backpack id. Its built public files run without Node
or npm. Building the coder view requires the declared npm packages. The host-client
build uses the sibling As you Go source, and is checked into public/host.js. LibreOffice
startup/warm policies live under PapersData/native/capability-runtimes; optional live
usage recordings are separate JSONL files and are excluded from source archives.
The retired Delegate Wave project archive remains for recovery.

## Shortcut ownership — 2026-10-07

Alt+A opens Papers when closed and brings its existing window forward when running.
The resident native launcher owns this chord and remains alive when Papers exits.
Papers owns Alt+S for the focused Backpack's Quick Run command surface. It does not
register Alt+A, so the two owners do not compete. Alt+Shift+A is no longer used.

Install the resident launcher with `tools/hotkeys/install-launcher-hotkey.ps1`, passing
`-PapersExe`, an optional existing `-Launcher` script and a `-HelperDirectory` on D:.
It compiles using Windows' bundled C# compiler, installs the Papers Launcher Hotkey
Startup shortcut and starts the helper. Registration success/failure is recorded in
`launcher-hotkey.log` in that directory. No AutoHotkey dependency is needed.
The disabled old helper remains archived for recovery; do not re-enable it.
