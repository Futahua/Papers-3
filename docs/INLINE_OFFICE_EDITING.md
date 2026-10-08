# Inline LibreOffice editing

## Experience

Select a Writer or Calc document in As you Go, expand the right pane, and press its
pencil button. The pane hosts the installed LibreOffice editor, with its native
menus, formatting and document controls. Merely selecting a file still previews it.
The disk button saves to the original document; LibreOffice's own Save also works.

Collapsing the pane hides the existing editor. Reopening it keeps the same document.
Leaving a clean document closes its editor. Leaving a modified document opens a
normal LibreOffice window for the **same unsaved model**, then closes the embedded
frame. There is no implicit save or discard. If that handoff fails, file navigation
and closing Papers stop so the document remains available to save.

Enabled types: DOC, DOCX, ODT, RTF, XLS, XLSX and ODS. Real native checks cover ODT,
DOCX, ODS and XLSX; the older DOC/XLS/RTF filters are supplied by LibreOffice but have
not been individually exercised in this checkpoint. Impress/Draw are deliberately
not enabled: LibreOffice 26.2.4.2 crashes while loading an Impress document into its
Windows system-child frame, including with software rendering and a visible,
pre-sized child. Their existing preview and ordinary application-open paths remain.

## Dependencies and ownership

Install the Windows LibreOffice distribution with its bundled Python/UNO component.
Papers discovers `soffice.exe`, `soffice.bin` and `python.exe` beneath the existing
LibreOffice program directory. No separately installed Python, Java, server,
Collabora service or downloaded editor frontend is required for this feature.
Unavailable dependencies hide the pencil and leave preview behavior usable.

AYG owns the pencil/disk controls, file choice and pane geometry. Papers' file
capability service owns original-path validation and surface-scoped operations.
`libreOfficeEditorBridge.ts` manages the helper handshake and reuses the existing
native-preview rectangle/owner contract. `resources/native/libreoffice-editor.py`
uses LibreOffice's bundled UNO bridge and its official
[system-child factory](https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1awt_1_1XSystemChildFactory.html)
to initialize a Frame inside the Papers-owned HWND. It does not reparent a normal
LibreOffice application window or reconstruct document editing in HTML.

Each runtime uses a unique local profile and named pipe. Document sessions have
fresh IDs, independent of that runtime's identity, so stale commands cannot affect
a later document. The profile is passed both
as a bootstrap argument and in the environment so LibreOffice initialization
restarts retain it. The remote profile is checked before loading a file. Another
LibreOffice session is never accepted as this editor. A Windows job owns startup
and restart descendants; clean termination only affects that job. Modified models
transferred to ordinary windows must outlive the helper.

Profiles live under the existing file-preview cache's `office-editors/<runtime-id>`.
One clean runtime is retained idle after document close and reused by Writer and
Calc; simultaneous panes receive separate leased runtimes. Surplus idle runtimes
and the last idle runtime at Papers shutdown are retired, removing their temporary
profiles. An unsaved handoff retires that runtime from reuse while preserving the
ordinary LibreOffice window. A transferred unsaved engine keeps
its local profile, including any recovery material; it must not be deleted while
the document is open. This is disposable/recovery runtime state, not AYG authored
state or snapshot content, and is not added to source or recovery ZIPs. Document
edits stay at the original path. File locking and save conflicts remain LibreOffice's
native responsibility. At the creator's request, macros are enabled for documents
opened in the inline editor (`ALWAYS_EXECUTE_NO_WARN`); external-data updates remain
disabled on initial load. This applies to the editor's document load, without changing
the ordinary LibreOffice profile. Software rendering and disabled OpenCL keep embedded surfaces independent
of first-run GPU selection. Native document dialogs remain LibreOffice dialogs.

`editorRuntimePool.ts` owns this bounded clean-runtime lifecycle for current and
future editor providers. Providers own safe document close/handoff and determine
whether a released lease is reusable. It starts on explicit use and retains no
document in an idle engine; it does not start every installed editor on app launch.

Loading progress uses LibreOffice's UNO `XStatusIndicator` supplied to the document
loader. Its actual current value/range is shown for that stage, including resets.
Engine startup and stages with no reported total use an indeterminate bar. The
host exposes owner/load-scoped status; AYG polls only during that load and removes
the bar on readiness, cancellation or failure. These are stage percentages, not
an invented estimate for the entire startup and document load. Other providers
can use `EditorLoadProgress` and AYG's shared loading-bar controller.

## Evidence — 2026-10-07

Installed LibreOffice: 26.2.4.2, Windows x64. Real tests used disposable documents
and a separate Windows desktop, never switched to the creator's input desktop.

- Native host: ODT, DOCX, ODS and XLSX loaded in the requested HWND, resized, hid and
  reappeared, accepted edits, saved the original URL, and closed cleanly.
- Writer accepted Windows key messages through its actual focused native window.
- Reopening verified saved Writer content; unsaved handoff retained a modified model
  in one ordinary LibreOffice window. Startup cancellation retired late readiness.
- Bridge unit checks cover surface ownership, geometry, missing runtime, pending
  cancellation and rejection of the unproven presentation path.
- Headless tests load AYG's actual pane module and cover explicit Edit, Save icon
  preservation, collapse/reopen, selection changes, late readiness, and a rejected
  unsaved handoff. They do not substitute for the native checks above.
- A packaged application test opens a disposable Backpack and exercises provider
  discovery, opening, movement, visibility, Save and Close through its real scoped
  project IPC. It runs on an isolated desktop using the packaged Python helper.
- The 2026-10-07 follow-up uses AYG's actual host request wrapper and actual pane
  against the native editor, including pencil, Save, collapse/reopen and return to
  preview. The original smoke test used a custom RPC caller and missed AYG's 15s
  default timeout. Office lifecycle requests now use its existing longer interactive
  request budget, allowing the native owner's bounded startup/close result to arrive.
  A timer regression check verifies delayed office results still resolve after 22s.
- The blank-pane follow-up found a loaded child behind Chromium sibling windows.
  Placement now uses HWND_TOP with NOACTIVATE, matching the native preview host,
  instead of preserving the previous z-order. That alone did not fix painting:
  the live child remained blank above Chromium and its GDI samples were unreadable.
  Adding an opaque layered backing surface and sibling clipping made those samples
  readable and varied; the creator confirmed the visible Writer document in a
  screenshot. Papers' parent uses NOREDIRECTIONBITMAP. The helper gives the VCL
  child its own backing surface without changing the parent or taking focus.
  The placement probe now checks actual painted colors as well as sibling ordering,
  pane hit testing and component size before and after hide/show.
- Reuse tests loaded ODT, ODS, DOCX and XLSX in the same native runtime, with warm
  openings around 0.2–0.5 seconds on this machine. First startup still initializes
  LibreOffice and varies considerably. Native progress callbacks were captured;
  unsaved handoff and cancellation remained successful. Pool/session unit tests
  check stale IDs, concurrent leases, idle retention, unsafe retirement and load
  status ownership. Packaged checks also exercise the real progress bar.

The broader developer-control smoke check passed five checks but timed out waiting
for its main-world renderer failure diagnostics. That separate diagnostic capture
is not established by this office checkpoint; the targeted packaged office test passes.

Native evidence: `docs/evidence/inline-office/native-results.json`. The isolated
placement probe is in `tests/e2e/office-editor-view-probe.py`; other isolated
probe scripts are outside the product checkout. No creator documents were edited.
First use initializes a separate LibreOffice profile and can take several seconds.
