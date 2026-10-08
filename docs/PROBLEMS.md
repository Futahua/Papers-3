# Papers — creator-reported problems

This is the plain-language work list, in creator priority order. A problem stays here
until the creator can use and judge the correction in the installed product.

## Corrected for authorized 1.2.4 — Papers forgot the active Backpack on restart

The production external-project path did not update the registry's existing
`lastActiveBackpackId`, and the production shell did not restore that ID at startup.
Closing Papers while working in “As you Go” therefore returned to the Backpack list.

Papers now records successful Backpack entry, restores that Backpack after restart, and
clears the resumable selection only when the creator chooses **Back to Papers**. This
does not define or capture a future project's internal state; richer state remains owned
by that independent Backpack.

## Corrected in source for authorized 1.2.3 — Local “As you Go” was compiled into universal Papers

**Creator-rejected placement; correction authorized (2026-07-30).** Papers 1.2.2 restored
the visible four-action workflow without restoring the universal editor from 1.2.0, but it
still hard-coded the exact local Backpack ID, renderer and service into Papers. Every
“As you Go” interface change would therefore require a Papers release delivered to every
machine. Calling only its manifest local concealed the real distribution boundary.

The creator clarified that Backpacks are closest to plugins in ownership and development.
They may be projects of their own, and development belongs outside Papers' main binaries
unless something explicitly requires host support. Local includes experience, behavior,
implementation and data.

Correction: “As you Go” now lives at
`Papers/Backpack projects/As you Go` as its own machine-local project. Its exact ID,
interface, pickup prompt and four action definitions are absent from Papers compiled
source. Papers 1.2.3 supplies only the narrow host support demonstrated by the project:
serve its bound static files without exposing their path, mediate its declared action IDs,
copy text after its button is used, and return to Papers.

The binding is stored separately in machine-local Papers data. Project files are re-read
without a Papers rebuild or restart, so ordinary “As you Go” changes stay on this machine
and do not publish updates to the others. This does not authorize a marketplace, generic
editor, Tool definition or fixed universal Backpack schema.

For this correction, the creator explicitly authorized pushing the source, building and
publishing 1.2.3, and automatically installing and restarting Papers on the primary
machine. That is delivery authorization for this correction; it does not generalize a
Backpack project into product-wide meaning or authorize updating another machine.

## Unscheduled — The Tools screen defines Tools without creator authority

**Documented, not corrected (2026-07-30).** The current Tools screen calls Tools global,
reusable machine capabilities; lists programs, shortcuts, scripts, locations and
utilities as examples; says Tools are shared between Backpacks; and proposes independent
enablement.

The creator has now made the actual boundary explicit: only the creator decides what is a
Tool, spontaneously or deliberately. Normal use and a request concerning one Backpack do
not authorize a Tool definition. The current screen copy is therefore implementation
evidence, not accepted product truth.

This documentation consolidation does not authorize a source or UI correction. Until a
separate creator request does, the mismatch must remain visible here and must not be cited
as an accepted Tool contract.

**Corrected in source; needs a rebuild before the creator can judge it (2026-07-27).**

**Corrected in source; needs a rebuild before the creator can judge it (2026-07-27).**

## 0b — You cannot tell whether both machines are running the same Papers

**Corrected in source; needs a rebuild before the creator can judge it (2026-07-27).**

Every copy of Papers ever built reported version `1.0.0`. So if the two machines started
behaving differently, there was no way to check whether they were even running the same
build — and comparing the version numbers actively misled, because they always matched.

Correction: Settings now opens with a **This build** card. It shows the version, the exact
code the build was made from, when it was built, which computer it is running on, and the
folders it uses. A **Copy build details** button puts all of it on the clipboard.

To compare the two machines: open Settings on each and read the middle line, e.g.
`1.0.0 · 67c4597 · SlopTop`. If the middle part matches, both machines are running the same
Papers. If it differs, they are not, and the folder lines show which copy is which.

Two marks worth knowing: **`+local`** means that build included edits that were not saved to
the project, so it matches no other machine exactly; **`unknown`** means the build is older
than this feature.

Note on `+local`: builds made on 2026-07-27 before commit `3af4591` showed this mark even
from a clean checkout, for two unrelated reasons that both looked like real edits (a
temporary file the build tool writes into the project, and a dependency list that rewrote
itself during install). Both are fixed. If a build still shows `+local` now, it means what
it says.

Demonstrated in the running app: the card renders in Settings and correctly reported
`1.0.0 · 67c4597+local · SlopTop` for a build made from commit `67c4597` with edits in
progress. Five automated checks cover it, including the case that matters most — two
different builds that both call themselves `1.0.0` are correctly reported as different.

Remaining for the creator: **Papers must be rebuilt and reinstalled on both machines** for
this to appear. After that, confirm the two machines report the same commit — and if they
do not, that is the real answer to any "it works here but not there" difference.

Remaining for the creator: confirm the toggles feel natural in use.

The original open notes, kept for context:

The available levels are:

The original open notes, kept for context:

Desired architecture:

  overlay.
  installation files, under version control in a stable location.
  `desktop-plugins/papers-theme/plugin.js` survives upstream source updates and appears
- When a component contains a hard-coded default color, convert that component to use a
  theme token through a small isolated patch. Avoid accumulating a second frontend.
- Keep any later layout experiments as separate, named patches so a skin change never

Update workflow:

### Tools placeholder resolution — 2026-10-07

The creator authorized replacing the built-in Tools placeholder with the Pencilcase Backpack.
The previously unauthorized mismatch above is superseded by this accepted boundary.
