# Papers 3 — product definition

## One sentence

Papers is a visual switchboard for entering, restoring and switching machine-wide
working environments called Backpacks.

## Backpack

A Backpack is an organizational and restoration boundary, not a canvas, program,
conversation or automatic AI context. It may involve:

- existing application windows across one or more monitors;
- folders, files and browser destinations;
- an optional PowerToys Workspaces desktop scene;
- a Hermes conversation or workspace;
- an optional Papers-owned surface when no existing product fits.

Entering a Backpack activates its environment. Papers should then recede so the
creator works in their actual applications.

## Hermes

Hermes is one universal machine-wide capability. It is reachable from the Backpack
chooser and from every active Backpack as:

- an embedded sidebar using Hermes Dashboard's existing `/chat` interface; or
- the existing Hermes Desktop application in its own window.

The ordinary flow is intentionally unremarkable:

```text
prompt → optionally attach files/images → optionally choose a folder → send → reply
```

Papers does not add an invocation builder, action catalogue, validation ceremony or
second permission system around that flow. The visible attachment/workspace state
inside Hermes is sufficient. A creator can also name paths directly in the prompt.

## Product boundary

Papers owns:

- visual Backpack identity, selection and persistence;
- associations to existing resources and optional workspace scenes;
- entering, leaving, restoring and switching environments;
- hosting or launching existing product surfaces.

Papers does not own:

- chat, session history, attachments, models, tools, approvals or agent settings;
- file browsers, editors, document production or browser automation already supplied
  by installed products;
- optional window capture and arrangement already supplied by PowerToys Workspaces;
- a modular application ecosystem as a prerequisite for ordinary use.

## Visual direction

The furthest-back Papers view is a gallery of Backpacks represented by recognizable
covers or restrained generated identities, not a text-heavy project list. An optional
desktop scene can enrich that identity later, but is not what makes a Backpack real.
Entering one moves into its working context rather than a program launcher.

An empty Backpack is valid. Its first useful form is a recognizable cover, optional
folder and immediate Hermes access. A canvas and desktop scene are optional surfaces,
never the definition of a Backpack.
