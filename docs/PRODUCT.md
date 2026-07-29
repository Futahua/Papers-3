# Papers — product definition

This is the authoritative plain-language definition of the current product. Product
changes must also remain consistent with `DECISIONS.md`, while `HERMES.md` tells Hermes
how to continue building from creator feedback.

## Basic

Basic is the permanent Papers control. It contains Backpacks, Tools and Settings and
remains available regardless of what a Backpack later displays.

## Hermes

Hermes is one global machine-wide AI interface. It is not owned by a Backpack and is not
automatically scoped when a Backpack is selected. Papers reuses the existing Hermes
interface rather than rebuilding chat, attachments, history, settings or tools.

The ordinary flow is prompt, optional file or image attachments, and reply. The creator
may explicitly name a folder or path when it is useful. Selecting or entering a Backpack
must not silently change Hermes's conversation, working directory or context.

## Backpack

A Backpack is a named environment or lens for a way of working with the machine. It may
eventually span multiple pages, views, features, programs, files and Tools. Backpacks may
overlap and use the same real information.

A Backpack is not a folder, project, canvas, sealed application, data silo, conversation
or PowerToys scene. Creating one currently reserves its name only. Entering an empty one
truthfully displays `Nothing here yet. Create something under “name”.` and returns to the
shell when dismissed.

## Tool

A Tool is a reusable capability across the system. Examples may include programs,
shortcuts, scripts, automation helpers, mounted locations, synchronization and machine
utilities. Tools are not unnecessarily locked to Backpacks.

The exact Tool contract remains an open question. Papers must preserve the concept and
the permanent Tools destination without pretending its internals have been decided.

## Current product boundary

- Basic remains reachable and contains Backpacks, Tools and Settings.
- Backpack creation asks only for a name and creates no folder, cover, canvas, Tool,
  conversation or invented contents.
- Backpacks may eventually span applications, windows, files, pages and shared Tools.
- Hermes remains one existing global product with its own interface and capabilities.
- Production contains no Programs, Agent Runs, invocation-validation workflow or seeded
  demonstration Backpack.
- Papers uses the warm-paper visual character inherited from Papers 1 without restoring
  Papers 1's custom agent workbench.

## Deliberately open

The first useful Backpack contents, the exact Tool lifecycle, the Data Source contract,
PowerToys integration and the behavior of entering a non-empty Backpack will be decided
through real creator use. They are product questions, not permission to silently impose
a familiar folder, canvas, plug-in or project abstraction.
