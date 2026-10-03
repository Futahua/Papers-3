# Hermes skin for Papers

## Creator correction

The original Hermes Desktop interface is already close to the desired result. Its real
problems are modest:

- much of the interface type is slightly too small;
- some secondary and inactive text is too gray and faint to read comfortably.

The AI-generated “Prismatic Fintech Editorial” preview is rejected. It is visually loud,
dense, overly bordered and unlike Hermes. Do not use it as a target. The supplied
prismatic reference was interpreted too literally.

## Scope

Create one subtle Hermes skin with coordinated **Papers Light** and **Papers Dark**
modes. Preserve the original Hermes layout, proportions, navigation, panel positions,
spacing character, information hierarchy, component shapes and behavior.

This is refinement, not redesign. A successful comparison should immediately look like
Hermes, only easier to read and slightly more at home beside Papers.

The same skin must appear when Hermes is docked in Papers or detached as a window.

## Primary changes

### Typography

- Increase undersized interface and conversation text by approximately one or two pixels,
  then judge it at normal Windows display scaling.
- Prioritize conversation text, sidebar labels, session titles, composer text, tool-call
  labels and settings descriptions.
- Preserve the existing typeface and hierarchy unless a direct readability test shows a
  specific failure.
- Keep metadata visually secondary, but large enough to read without leaning in.
- Do not replace the interface with conspicuous editorial display typography.

### Contrast

- Raise the contrast of text that currently disappears into the dark background.
- Secondary labels, timestamps, inactive navigation, tool metadata and placeholder text
  should remain subordinate without looking disabled.
- Reserve the faintest tone for genuinely disabled or unavailable content.
- Keep clear separation between primary, secondary, tertiary and disabled text; do not
  make everything equally bright.

## Papers Dark

Papers Dark should remain extremely close to original Hermes Dark:

- retain the deep navy-black canvas and quiet panel separation;
- keep the existing restrained lavender/blue character where useful;
- use warmer, clearer off-white for primary conversation text;
- lift muted gray-violet text enough for comfortable reading;
- preserve the subtle background and low-chrome atmosphere;
- use thin, quiet borders only where Hermes already needs structure.

No large gradients, colored card outlines, neon terminal aesthetic, glowing buttons,
rainbow controls or decorative color strips.

## Papers Light

Papers Light is the calm light counterpart of the original Hermes interface:

- pale warm-neutral canvas rather than stark white;
- gently distinct sidebars and raised surfaces;
- dark charcoal/navy primary text;
- readable neutral secondary text;
- fine low-contrast borders and restrained shadows;
- a small amount of the existing Hermes lavender/blue accent for focus and selection.

It should relate to Papers through its neutral surface, restraint and readability—not by
covering Hermes with Papers branding or decoration.

## Theme coverage

Apply the same restrained typography and contrast corrections across:

- title bar and window controls;
- navigation and conversation sidebar;
- conversation text, thinking and tool calls;
- composer, attachments and model controls;
- settings, menus, dialogs and forms;
- file browser, preview, artifacts and terminal;
- hover, focus, active, disabled, warning, error and loading states.

The theme must not leave isolated text at the old unreadable size or contrast.

## Explicitly rejected

- the AI-generated component-dashboard preview supplied by the creator;
- a “fintech dashboard” appearance;
- pervasive orange, pink, violet or blue gradients;
- gradient primary buttons;
- excessive one-pixel boxes around every item;
- cramming every feature onscreen simultaneously;
- changing Hermes's established layout or density to demonstrate a skin;
- monospaced body text or tiny technical labels;
- turning muted text into nearly invisible text;
- making the interface look like a different product.

## Acceptance

At normal desktop size, the creator should recognize original Hermes immediately. The
improvements should be noticeable mainly as reduced eye strain: text is comfortably
larger, important content is clearer, secondary content remains readable, and neither
mode calls attention to the theme itself.
