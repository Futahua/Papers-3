# Papers — product definition

This is the authoritative plain-language definition of Papers. [`HERMES.md`](../HERMES.md)
is the mandatory agent contract for continuing from creator feedback.

## Accepted product truth

Papers is a personal layer across Windows, shaped by the creator through real use. The
creator describes desired experiences and uses finished workflows; coding agents construct,
test and explain those workflows. Current implementation is evidence, not permission to
turn an implementation detail into product ontology.

### Basic

Basic is the permanent Papers control. It contains Backpacks, Tools and Settings and
remains available regardless of what a Backpack later displays.

### Hermes

Hermes is one global machine-wide AI interface. It is not owned by a Backpack and is not
automatically scoped when a Backpack is selected. Papers reuses the existing Hermes
interface rather than rebuilding chat, attachments, history, settings or tools.

The ordinary flow is prompt, optional file or image attachments, and reply. The creator
may explicitly name a folder or path when it is useful. Selecting or entering a Backpack
must not silently change Hermes's conversation, working directory or context.

### Backpacks

A Backpack is a named environment or lens for a way of working with the machine. It may
eventually span multiple pages, views, features, programs, files and Tools. Backpacks may
overlap and use the same real information.

A Backpack is not inherently a folder, project, canvas, sealed application, data silo,
conversation or PowerToys scene. It has no required contents, interface, lifecycle,
storage model or common architecture. The contents and controls of one Backpack do not
define any other Backpack.

“Machine-wide” describes how far a Backpack may reach within a machine. It does not mean
that every Backpack is machine-only, shared, portable, synchronized or structurally alike.
Papers supports both machine-specific and universal ways of working. Some Backpacks will
be unique and some shared. Their meaning and implementation emerge from real Backpack
requests and must not be standardized beforehand.

The creator has identified “As you Go” as local to the current machine. That statement
applies only to “As you Go” and does not define a general Backpack scope system.

### Tools

Tools is a permanent destination within Basic. Only the creator decides what is a Tool,
either spontaneously or deliberately. A Backpack request, implementation detail, program,
shortcut or script does not become a Tool unless the creator makes that decision. The
Tool contract remains open.

### Existing products and visual character

Papers reuses existing applications and products, associating, launching, embedding,
restoring or coordinating them instead of rebuilding their interfaces and agent systems.
Papers keeps the warm-paper visual character inherited from Papers 1 without restoring
Papers 1's custom agent workbench.

## Current behavior

- Basic remains reachable and contains Backpacks, Tools and Settings.
- Backpack creation asks only for a name and creates no folder, cover, canvas, Tool,
  conversation or invented contents.
- Entering an empty Backpack truthfully displays
  `Nothing here yet. Create something under “name”.`
- Implemented in source and awaiting an authorized release: entering the protected local
  “As you Go” Backpack shows its prepared actions on this machine. The creator uses those
  actions directly; Papers exposes no action editor, filesystem picker or generic
  Backpack-button system.
- Archived Backpacks can be deleted only after explicit confirmation naming that exact
  Backpack. External files, applications, scripts and folders remain untouched; Papers
  retains its internal record for recovery.
- Hermes remains one existing global product with its own interface and capabilities.
- The Tools destination is present and may honestly contain no configured Tools.
- Production contains no Programs, Agent Runs, invocation-validation workflow or seeded
  demonstration Backpack.

This section describes the present product. It does not establish a required future
Backpack shape.

## Deliberately open

The contents and behavior of each real Backpack, what unique and shared mean, the exact
Tool contract, the Data Source contract, PowerToys integration and the behavior of
entering a non-empty Backpack will be decided through real creator use.

No storage location, synchronization policy, portability rule, local binding, scope
selector, editor, framework or shared Backpack schema is implied by those open questions.
An agent must not silently settle them through implementation.
