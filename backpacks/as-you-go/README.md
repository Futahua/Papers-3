# As you Go

This is the creator's machine-local “As you Go” Backpack project.

Its interface, prompt and prepared actions are owned here, outside the Papers application
binary and the Papers source repository. Ordinary changes to this project must not bump,
build or release Papers.

Only static interface files under `public/` are displayable. `project.json`, `actions.json`
and `state.json` remain private project control records. The explorer state belongs to this
project; Papers only provides the narrow persistence, target-picker, Windows-icon and launch
seams needed for this explicitly requested local workflow. `state.json` is local creator
data and is intentionally ignored by Git.

Papers supplies only the demonstrated host seam:

- display this static project inside the Backpack;
- copy text after a project interaction;
- run an action already declared in `actions.json`;
- persist the As you Go explorer state in this project;
- choose and launch a local shortcut target through the host seam;
- return to Papers.

The As you Go workspace behaves like a file explorer:

- single left-click selects; right-click opens a contextual menu;
- dragging across blank space draws a selection rectangle and selects every visible item
  it crosses; Ctrl-drag adds those items to the existing selection;
- double-click opens folders or launches shortcuts;
- folder chevrons expand nested contents without leaving the current location;
- Shift/Ctrl selection, Ctrl+C/X/V, Delete-to-Bin and drag move/Ctrl-drag copy work as
  their Windows equivalents;
- blank-space right-click offers creation and paste actions;
- blank-space right-click can add an `http` or `https` web link; opening it uses the
  machine's default browser and its default icon comes from the website's own favicon;
- files and folders dragged in from Windows Explorer become quick shortcuts in the
  visible folder, or inside an As you Go folder when dropped directly onto it; the
  external file or folder is referenced and never copied, moved or changed;
- Ctrl+mouse-wheel changes the persistent icon size;
- each Papers tab restores its own last-opened folder after leaving, closing or
  reopening Papers; expanded folders, selected items and Bin view remain local
  to the live tab;
- the Bin supports restore and separately confirmed permanent deletion.

Shortcut descriptions are optional. Shortcut icons use the target's Windows icon by
default or a project-owned image chosen by the creator. Folder icons use the normal folder
art by default and may also use a project-owned image. Oversized chosen images are
automatically resized and compressed by the existing browser image pipeline; the source
image is untouched. External targets are never copied or changed.

The local binding from the protected Backpack ID to this folder is stored in
`Papers/Data/PapersData/backpack-projects.json`. Do not modify the protected Backpack
record to establish or change that binding.

Before changing this project, read the canonical Papers repository's `AGENTS.md` and
`HERMES.md` completely. A change here applies only to “As you Go.”

Read `ARCHITECTURE.md` before editing code: it maps each change type to the module that owns
it and lists the interaction behavior, store and compatibility rules that must be preserved.

Run `npm test` here after a change. The test is self-contained and does not launch any
prepared action or modify Papers data.

## Native SlopTop bridge source

The exact AutoHotkey v2 engine used by this Backpack's native window picker is backed up at
`native/sloptop_engine.ahk`. The creator's live copy remains
`D:\333\SlopTop\sloptop_engine.ahk`; the repository copy is source backup, not an automatic
installer or launcher. When intentionally synchronizing the two, compare their SHA-256 hashes
before restarting the elevated live process. The script expects its existing cursor assets
relative to its live SlopTop directory.
