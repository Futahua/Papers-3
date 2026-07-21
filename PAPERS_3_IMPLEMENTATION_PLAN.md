# Papers 3 — current product truth and next build

This is the plain-language source of truth. If the application does something not
described here, it is not justified by this plan.

## What Papers is

Papers is a personal layer across the whole Windows machine.

It always has:

- **Basic** — the permanent menu containing Backpacks, Tools and Settings;
- **Hermes** — one global AI interface available everywhere;
- **Backpacks** — named environments that can eventually present different ways of
  working with the same machine, files, knowledge and Tools;
- **Tools** — reusable machine-wide capabilities.

Papers is not a collection of project folders or boxed mini-applications.

## Exactly what the visible controls do

### Add Backpack

1. The creator clicks `Add Backpack`.
2. Papers asks only for a name.
3. Papers adds that name to the Backpack list.
4. Papers does not create a folder, choose a cover, start an application, change Hermes,
   create a canvas or invent contents.

Adding the name reserves an environment that can be shaped later through actual use.

### Enter an empty Backpack

Until something has genuinely been created under that Backpack's name, `Enter` displays:

> Nothing here yet. Create something under “Backpack name”.

Dismissing the warning returns to the existing Papers shell. It does not pretend that an
empty page is a working Backpack.

### Enter a non-empty Backpack

This is deliberately not specified yet. A future Backpack may contain several pages,
views, features and uses of global Tools, and may reach across other Windows programs.
The behavior will be defined when the creator makes the first real one through use.

It must never be reduced to opening one folder, one canvas, one application or one
PowerToys scene.

### Hermes

Hermes is the same global AI before, during and after any Backpack interaction.

Papers must not automatically:

- give Hermes a Backpack folder;
- change Hermes's working directory;
- start a separate Backpack conversation;
- limit Hermes to the active Backpack;
- inject all Backpack contents into a prompt;
- reset Hermes when Backpacks change.

The ordinary flow remains prompt, optional attachments, reply. If the creator wants
Hermes to work on a folder or file, they can attach it, name its path or explicitly ask
for that context. Papers does not infer it from a Backpack name.

Hermes may use its own installed file, terminal, browser, computer-use and coding tools
under ordinary Windows permissions. Papers does not add a special self-edit, delegation,
validation, rebuild or relaunch system around those actions. They remain normal Hermes
work, including when the creator explicitly asks Hermes to change Papers itself.

### Tools

A Tool is a capability available across the system. Known examples include installed
programs, shortcuts, scripts, automation helpers, mounted locations, synchronization and
machine utilities.

Tools are not owned by one Backpack. Several Backpacks may use the same Tool. A Tool may
be enabled or disabled independently of Backpacks.

The exact Tool contract is still undecided. The next build must restore the permanent
`Tools` destination and describe an empty state honestly. It must not fabricate a tool
marketplace, registry format or Backpack-specific permission system to fill the space.

## What is confirmed

- Basic is permanent and contains Backpacks, Tools and Settings.
- Hermes is global and uses the existing Hermes product.
- Backpacks are machine-wide environments or lenses, not data silos or project folders.
- Backpacks may overlap and use the same files and Tools.
- Adding a Backpack asks for its name and creates no contents.
- Entering an empty Backpack shows the explicit warning above.
- Tools are reusable machine capabilities and are not unnecessarily locked to Backpacks.
- The creator will shape Backpacks and Tools incrementally while using Papers.

## What is not decided

- What the first real Backpack contains.
- What data structure represents Backpack contents.
- What entering a non-empty Backpack changes visibly across the machine.
- The exact Tool contract, discovery rules and enable/disable behavior.
- The exact Data Source contract.

These are open product questions, not implementation tasks. An agent must not silently
answer them by building familiar project, folder, canvas or plug-in abstractions.

## Next build — the usable base

The next implementation is complete when the installed product provides:

1. a stable permanent Basic control with Backpacks, Tools and Settings;
2. the real existing Hermes interface globally as a sidebar, with optional separate
   Hermes window;
3. a Backpack list with `Add Backpack`, name-only creation and the exact empty warning;
4. an honest Tools destination that preserves the global definition without pretending
   the undecided Tool contract exists;
5. persistent Backpack names and normal application settings;
6. no folder picker, cover picker, working-directory change or fake Backpack canvas;
7. no production Programs, Agent Runs, invocation validation or Papers-owned Hermes UI;
8. a packaged and installed build that the creator can change incrementally through use.

## Required visual language

Reuse Papers 1's theme from `Futahua/papers-are-papers`, especially `src/styles.css` and
the permanent shell in `src/App.tsx`. This is an explicit creator preference, not a loose
reference.

Keep its warm paper colors, faint grid, translucent top bar, fine borders, rounded menus
and pills, restrained shadow, muted green accent, Segoe UI Variable body text and compact
monospaced labels. Adapt those primitives to the corrected Papers 3 screens.

Do not copy Papers 1's agent workbench behavior, Work rail, provider setup, Inspect,
self-edit or approval UI. The reuse is visual only. The existing Hermes surface retains
its own interface and styling.

## Implementation instructions

- Remove the folder/cover-centered first-Backpack flow from production plans and UI.
- Stop passing Backpack state or a Backpack-derived `--cwd` to Hermes Desktop. A manually
  chosen Hermes context belongs to Hermes, not to Backpack entry.
- Keep the real Hermes Dashboard `/chat` sidebar and plain `hermes desktop` pop-out.
- Add or restore the permanent Basic navigation: Backpacks, Tools, Settings.
- Make Backpack creation name-only and persist the name safely.
- Track whether genuine Backpack contents exist. Until a real content contract is later
  confirmed, every newly created Backpack is empty and `Enter` shows the warning.
- Do not create placeholder content merely to bypass the warning.
- Show Tools as a real permanent destination with an honest empty/undecided state. Do not
  implement speculative Tool internals.
- Keep historical program/ACP demonstrations behind `PAPERS_ENABLE_FIXTURES=1` and out
  of all production screens.
- Keep PowerToys optional and out of this build. It is neither a Backpack definition nor
  a readiness requirement.
- Reuse Hermes rather than recreating its chat, attachments, history, models, settings,
  permissions or tools.

## Human acceptance

In the installed build, the creator can verify every current promise without reading
source code:

1. Basic is always reachable and visibly contains Backpacks, Tools and Settings.
2. Hermes can open from the general shell and remains the same global product.
3. Creating a Backpack asks only for a name.
4. Creation does not ask for or create a folder, cover, canvas, Tool or conversation.
5. Entering the new Backpack shows `Nothing here yet. Create something under “name”.`
6. Entering it does not change Hermes's conversation or working directory.
7. Tools is reachable globally and does not imply it belongs to a Backpack.
8. No Programs, Runs, validation workflow or hardcoded demonstration buttons appear.
9. Restarting Papers preserves the Backpack name.
10. The creator can continue using global Hermes and request changes as real needs emerge.
11. Basic, Backpacks, Tools, Settings and warnings visibly use the Papers 1 theme rather
    than the current Papers 3 styling or an unrelated redesign.

## Deferred on purpose

- first Backpack contents;
- automatic folder context;
- visual covers and scene previews;
- PowerToys integration;
- Tool registry and lifecycle;
- Data Source contract;
- canvases, pages and generated Backpack features;
- self-edit and specialized agent workflows beyond existing product integration.
- Papers-owned orchestration around Hermes or coding agents.

The absence of these is honest. Inventing them before use would make the product less
auditable, not more finished.
