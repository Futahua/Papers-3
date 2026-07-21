# Papers 3 — aligned implementation plan

Status: authoritative after the creator review of 2026-07-21. This plan supersedes the
Canvas/program-centric plan retained in Git history.

## 1. Product outcome

Papers will be a visual Windows switchboard for machine-wide working environments
called Backpacks. It coordinates existing products across the desktop and otherwise
gets out of the way.

The product succeeds when a non-coder can:

1. recognize and enter a Backpack visually;
2. have its existing applications, folders and windows restored across the desktop;
3. open the same Hermes experience from anywhere as a sidebar or separate window;
4. prompt Hermes, attach files/images or name paths, and receive replies normally;
5. return later without learning a Papers-specific agent workflow.

## 2. Non-negotiable constraints

- A Backpack is an environment, not a canvas or program.
- A canvas is optional.
- Workflows may span existing applications and multiple monitors.
- Hermes is universal and identical across Backpacks.
- Papers must not reimplement an existing product capability.
- Normal Hermes use has no Papers-owned action catalogue, invocation validation flow,
  prompt-preview modal, run database, event renderer or permission system.
- Attachments, history, models, tools, settings and approvals remain owned by Hermes.
- Papers stores associations and restoration metadata, not copies of product data.
- The creator is not expected to review source code to accept the product.

## 3. Reuse map

| Need | Existing owner | Papers integration |
|---|---|---|
| Chat, attachments, history, tools, approvals, settings | Hermes Dashboard/Desktop | Embed `/chat`; launch `hermes desktop` |
| Optional Hermes folder | Hermes Desktop | Launch with `--cwd <folder>` |
| Desktop app capture, launch and arrangement | Microsoft PowerToys Workspaces | Associate and invoke its saved workspace |
| File management | Directory Opus / Explorer | Open or focus the existing application/path |
| Documents | LibreOffice / default application | Open the real file externally |
| Web destinations | Default browser | Open existing URLs/tabs where supported |

This table is a veto: Papers code for a row is limited to discovery, association,
launch/focus and honest error reporting.

## 4. Visible product

### Furthest-back view

A visual gallery of Backpack desktop scenes. Each tile eventually uses the PowerToys
scene thumbnail or a Papers-generated neutral composition preview. Text remains minimal.

### Entered Backpack

Entering activates the associated desktop scene. Papers may remain as a small switcher,
collapse to the tray, or show an optional blank surface. It does not force work into a
Canvas page.

### Hermes

A universal toggle is present at the chooser and inside an active Backpack:

- sidebar: official Hermes Dashboard `/chat` in a `WebContentsView`;
- pop-out: official Hermes Desktop;
- folder: optional Backpack association passed through as `--cwd` on pop-out.

## 5. Implementation sequence

### Slice A — product boundary (complete)

- Replace Canvas language with machine-wide environment language.
- Hide legacy programs and ACP workflows unless `PAPERS_ENABLE_FIXTURES=1`.
- Keep old data readable.
- Rewrite product, architecture and user guidance.

### Slice B — existing Hermes product (complete)

- Start or reuse local `hermes dashboard` on loopback.
- Embed its existing `/chat` surface without parsing its messages.
- Add close and pop-out controls only.
- Launch `hermes desktop --cwd <folder>` when a folder is associated.
- Verify the real Hermes URL is hosted by the production shell.

### Slice C — PowerToys Workspaces (next)

- Discover the installed PowerToys Workspaces editor/launcher.
- Open the official editor for scene creation; do not implement capture UI.
- List existing saved PowerToys scenes through a documented/stable surface where
  available. If no stable enumeration surface exists, associate its generated shortcut.
- Associate one scene with a Backpack.
- Use the official launcher/shortcut when entering the Backpack.
- Report missing applications or PowerToys errors without attempting window placement.

### Slice D — visual Backpack gallery

- Show scene thumbnails or restrained schematic previews.
- Preserve fast keyboard and mouse switching.
- Add optional monitor-aware preview metadata supplied by PowerToys.
- Keep rename/archive/create secondary to entering environments.

### Slice E — desktop presence

- Add a small global switcher/tray presence so Papers need not occupy a desktop window.
- Support leave/switch/restore without closing creator applications implicitly.
- Never terminate or move unrelated windows.

### Slice F — release acceptance

- Package and install on the creator's actual Windows machine.
- Run the human acceptance script below.
- Keep automated tests for persistence, integration discovery and fixture regressions.

## 6. Human acceptance script

The release is not “ready” merely because tests pass. A non-coder must be able to:

1. launch Papers and understand the Backpack gallery without documentation;
2. enter a Backpack and see its real desktop scene restored;
3. open Hermes in the sidebar and send a normal prompt;
4. attach an image and a file using Hermes's existing controls;
5. pop the same product out into Hermes Desktop;
6. select a folder, ask Hermes to modify a named file, and inspect the result;
7. switch Backpacks and restore a visibly different desktop environment;
8. restart Papers without losing associations;
9. use Hermes history/settings without encountering a Papers duplicate;
10. complete all of the above without seeing programs, agent runs or validation flows.

## 7. Fixture policy

The old program sandbox, capability broker, ACP client, worker lanes and Logseq workflow
are retained only because they are proven technical experiments. They must remain hidden
from production, must not influence ordinary UI, and must not receive new product work.
They may be deleted once equivalent external-product integration confidence exists.
