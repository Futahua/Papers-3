# Papers 3 — product definition

The authoritative plain-language behavior is in
[`PAPERS_3_IMPLEMENTATION_PLAN.md`](../PAPERS_3_IMPLEMENTATION_PLAN.md). This document
only summarizes the vocabulary.

## Basic

Basic is the permanent Papers control. It contains Backpacks, Tools and Settings and
remains available regardless of what a Backpack later displays.

## Hermes

Hermes is one global machine-wide AI interface. It is not owned by a Backpack and is not
automatically scoped when a Backpack is selected. Papers reuses the existing Hermes
interface rather than rebuilding chat, attachments, history, settings or tools.

## Backpack

A Backpack is a named environment or lens for a way of working with the machine. It may
eventually span multiple pages, views, features, programs, files and Tools. Backpacks may
overlap and use the same real information.

A Backpack is not a folder, project, canvas, sealed application, data silo, conversation
or PowerToys scene. Creating one currently reserves its name only. Entering an empty one
truthfully warns that nothing has been created under that name.

## Tool

A Tool is a reusable capability across the system. Examples may include programs,
shortcuts, scripts, automation helpers, mounted locations, synchronization and machine
utilities. Tools are not unnecessarily locked to Backpacks.

The exact Tool contract remains an open question. Papers must preserve the concept and
the permanent Tools destination without pretending its internals have been decided.
