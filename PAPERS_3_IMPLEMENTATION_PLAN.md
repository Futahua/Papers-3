# Papers 3 — first-Backpack release plan

Status: authoritative after creator review on 2026-07-21. The immediate objective is
not a framework or a demonstration. It is an installed Papers build that lets the
creator make and use the first real Backpack with AI on this Windows machine.

## 1. Release outcome

From a fresh launch, a non-coder can create a Backpack, optionally choose a folder and
cover image, enter it, talk to the existing Hermes interface, attach files or images,
and open Hermes Desktop pointed at the chosen folder. The Backpack persists after a
restart and is recognizable in a visual gallery.

That path is the release. Desktop-scene restoration, trays, plug-ins, program runtimes,
agent orchestration and generalized resource systems cannot delay it.

## 2. Product boundary

- A Backpack is a named, visual working context. It does not require a PowerToys scene,
  folder, canvas, program or conversation.
- Hermes is the AI product. Papers embeds or launches it and does not reproduce it.
- The ordinary interface is: prompt, optional Hermes attachments, reply.
- A folder is the only Papers-level context aid in the first release. It is passed to
  Hermes Desktop with `--cwd`; paths can also be named in prompts.
- Papers may open existing folders, files, URLs and applications through Windows. It
  does not become their editor or file manager.
- PowerToys Workspaces is an optional enhancement, never a dependency or onboarding
  requirement.
- No Papers-owned action catalogue, invocation validation, Runs screen, permissions
  layer, model picker, message store or modular program UI may appear in production.

## 3. Reuse decisions

| Capability | Existing owner | Papers does only |
|---|---|---|
| Chat, attachments, history, settings, tools, approvals | Hermes Dashboard/Desktop | Host `/chat`; launch Desktop |
| Folder-scoped AI work | Hermes Desktop | Pass `--cwd <folder>` |
| Folder/file opening | Windows shell / Directory Opus when registered | Ask the OS to open the path |
| Optional window-scene restoration | PowerToys Workspaces | Read existing scenes; launch one by ID |
| Documents and websites | Existing default applications | Open the target |

Do not vendor or fork these products merely to change their appearance. Prefer their
installed releases and stable command or file boundaries. Reuse source code only when
an installed integration cannot satisfy a release requirement and the copied portion is
small, licensed, attributed and cheaper to maintain.

## 4. Exact first-release experience

### First launch

Show the Backpack gallery immediately. If it is empty, show one dominant action:
`Create your first Backpack`. Hermes remains reachable globally, but the empty state
must not explain architecture or show engineering fixtures.

### Creation

Use one compact flow:

1. name — required;
2. folder — optional, selectable with the native folder picker;
3. cover image — optional, selectable with the native file picker.

Do not add templates, types, programs, capability choices or PowerToys setup. Create
the Backpack immediately. A missing cover receives a restrained generated visual.

### Gallery

Each Backpack is a large, recognizable visual tile using its cover or generated visual.
The primary action is entering it. Rename, change cover/folder and archive are secondary
and visually quiet. The gallery must remain useful with one Backpack.

### Entered Backpack

The surface carries the Backpack's visual identity and only a few clear controls:

- Hermes sidebar, open by default on first entry and remembered thereafter;
- `Open folder` when a folder exists;
- `Hermes window`, which launches `hermes desktop --cwd <folder>` when possible;
- `Backpacks`, which returns to the gallery.

Remove the `(machine wide complex capability)` placeholder from the shipped experience.
Do not turn the entered view into a dashboard of decisions.

### Hermes

The sidebar is the real Hermes Dashboard `/chat` surface. Do not place a Papers prompt
box over it. The pop-out is the real Hermes Desktop application. Display a short, human
error only when Hermes is missing or cannot start, including one actionable recovery.

## 5. Implementation order

Work continuously through these gates. Do not stop after scaffolding or ask the creator
to review code.

### Gate A — complete the first Backpack

- Extend Backpack persistence with an optional cover image and remembered sidebar state.
- Replace the current multi-card creation controls with the compact creation flow.
- Implement native cover-image selection and validation without copying the image.
- Make the gallery and entered view visually coherent at common Windows display scales.
- Add `Open folder` through Electron's safe shell boundary.
- Open Hermes automatically on first Backpack entry and preserve the creator's later
  open/closed preference.
- Keep all legacy programs unavailable unless `PAPERS_ENABLE_FIXTURES=1`.

### Gate B — make AI use undeniable

- Exercise the installed Hermes v0.16.0, not a mock.
- Verify a real prompt and reply in the embedded sidebar.
- Verify Hermes's existing file and image attachment controls manually.
- Verify `Hermes window` launches with the Backpack folder as `--cwd`.
- In a disposable acceptance folder, ask Hermes to modify a named file and verify the
  file actually changes. Never use creator files for destructive tests.
- Confirm Papers shutdown does not kill a Hermes process it did not start.

### Gate C — make it installable and understandable

- Add a real application icon and correct product metadata.
- Package and install the NSIS build on this machine.
- Confirm creator data survives app update/reinstall.
- Validate first launch, Backpack creation, restart persistence and Hermes use from the
  installed build.
- Remove or hide dead product controls and placeholder language encountered during the
  walkthrough.
- Capture screenshots of the empty gallery, creation flow, populated gallery, entered
  Backpack and Hermes sidebar as acceptance evidence.

### Gate D — optional PowerToys enhancement

Only begin this after Gates A–C pass.

- Detect PowerToys without failing when absent.
- Read its existing `%LOCALAPPDATA%\Microsoft\PowerToys\Workspaces\workspaces.json`
  read-only and tolerate missing/corrupt files.
- Let an existing scene be associated with a Backpack through a secondary setting.
- Launch it using `PowerToys.WorkspacesLauncher.exe <workspace-id>`.
- Offer the official Workspaces editor for creating or editing scenes; do not implement
  window capture or placement.
- If no scene exists, hide this feature or explain it in one sentence. The Backpack
  remains fully usable.

The current machine has PowerToys installed but no `workspaces.json`, so the no-scene
path is mandatory and is the default acceptance path.

Verified upstream boundaries:

- [Hermes Desktop source and product surface](https://github.com/NousResearch/hermes-agent/tree/main/apps/desktop)
- [PowerToys workspace storage reader](https://github.com/microsoft/PowerToys/blob/main/src/modules/Workspaces/WorkspacesCsharpLibrary/Data/WorkspacesStorage.cs)
- [PowerToys official launch-by-ID service](https://github.com/microsoft/PowerToys/blob/main/src/modules/Workspaces/Workspaces.ModuleServices/WorkspaceService.cs)

## 6. Release acceptance

The agent, not the creator, establishes the engineering evidence. The creator evaluates
the visible product.

The release is ready only when all of the following are true in the installed build:

1. A first-time user can create a Backpack without documentation.
2. Name, optional folder and optional cover are sufficient; nothing technical is asked.
3. The Backpack is visually recognizable and persists after restart.
4. Entering it presents Hermes immediately without a Papers-owned agent workflow.
5. A real prompt receives a real Hermes reply.
6. A real image and file can be attached using Hermes's existing controls.
7. Hermes Desktop opens against the Backpack folder and can modify a disposable file.
8. The folder can be opened in the user's existing file manager.
9. No programs, Runs, validation flows or Papers agent permissions are visible.
10. Missing PowerToys or missing scenes does not degrade any of the above.
11. The product works at 100%, 125% and 150% display scaling without clipped primary
    controls.
12. An installer, screenshots, test results and a concise non-technical usage guide are
    present in the repository or release evidence.

## 7. Deferred until after first use

- automatic desktop-scene capture or arrangement beyond optional PowerToys association;
- tray/global hotkey switching;
- multiple resource collections and per-object commands;
- canvases, internal programs and plug-in architecture;
- custom agent protocol, orchestration or run visualization;
- synchronized sidebar/pop-out state beyond what Hermes itself provides;
- speculative abstractions for other workspace providers.

These are not rejected forever. They are forbidden from delaying the first useful
Backpack.

## 8. Fixture policy

The historical program sandbox, ACP client, worker lanes, Repository Research, Visual
Dashboard, Kill Test and Logseq flow are engineering fixtures only. Preserve their tests
while cheap, load them only with `PAPERS_ENABLE_FIXTURES=1`, and do not extend them for
product work.
