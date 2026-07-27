# How Papers updates itself

**Papers now updates itself (2026-07-27, v1.1.1).** The investigation that led here is kept
below, because it records why the shape is what it is.

## How it works now

A packaged Papers checks its GitHub releases shortly after launch, downloads a newer version
in the background, and shows **Restart and update** in Settings when one is ready.

- It **never restarts on its own.** `autoInstallOnAppQuit` is off, so closing Papers can
  never swap the application underneath a live Hermes. The creator chooses the moment.
- It **never interrupts.** Offline, rate-limited, or no release yet all resolve quietly to
  "up to date". Only a genuine downloaded update surfaces. The reason is still kept, so a
  direct "Check for updates" can explain itself.
- The repository is public, so the feed is read anonymously and **no token ships inside the
  application**.

### Publishing a new version

On the desktop:

1. Bump `version` in `package.json`.
2. `npm run release` — builds the installer and uploads it with the update feed.
3. **Publish the draft release**, which `electron-builder` leaves as a draft. Do this only
   *after* the uploads finish; publishing early yields a release missing `latest.yml`, and
   an installed Papers then silently finds nothing.

Both machines pick it up on their next launch.

### The install must be installer-made

Papers resolves its profile relative to its own executable (`src/main/index.ts`:
`<exe folder>\..\Data`), so `App` and `Data` must stay siblings. The installer is therefore
pointed at the existing `App` folder:

```
Papers-Setup-<version>.exe /S /D=<full path to App>
```

`deleteAppDataOnUninstall: false` keeps an update from removing the profile.

A hand-copied install has no Windows record, so an updater would create a *second* Papers
rather than upgrade. Each machine needs the real installer run once; after that, updating is
automatic.

---

# Original findings (2026-07-27, before the above was built)

Investigated 2026-07-27 against commit `67c4597`. **Everything from here down describes the
state before the updater above was built, and is kept only as the record of why.** For how
updating works now, read the section above.

Hermes updating is a separate, working mechanism documented in
`HERMES_SKIN_INTEGRATION.md` and PROBLEMS.md 4.

## The finding in one line (as of `67c4597`)

**Papers had no self-update mechanism of any kind.** Nothing was broken or
half-wired; the capability had never been built.

## What was checked

| Question | Answer |
| --- | --- |
| Is `electron-updater` a dependency? | No — absent from `package.json`. |
| Any `autoUpdater`, feed URL or update check in the source? | None. The only matches for "update" in `src/main` are the Hermes updater. |
| Does `electron-builder.yml` have a `publish:` block? | No. Without one, no `latest.yml` update feed is produced even when packaging. |
| Are there GitHub releases to update from? | Zero releases, and no git tags. |
| Is there a CI release workflow? | No `.github/` folder at all. |
| Does the app read or display its own version? | No. `app.getVersion()` is never called; nothing in the interface shows a version. |
| Is `papers3-updater` an updater that once existed? | **No — this was a false lead.** See below. |

### The `papers3-updater` residue is not Papers 3's

The migration residue (`Local-papers3-updater`, `Local-Papers`, `Roaming-papers3`)
belongs to an **earlier, different product**. The Windows uninstall registry still
lists `PAPERS ARE PAPERS 0.2.0` installed at `D:\PAPERS ARE PAPERS` — Papers 1, the
app D-009 takes the visual theme from. That older build shipped an updater; Papers 3
never did. No `papers3-updater` folder survives in the current user profile.

## How the installed build actually gets updated today

Entirely by hand, and the version number does not participate:

1. A developer runs `npm run package` on the machine holding the source.
2. `electron-builder` writes `release\Papers-Setup-1.0.0.exe`.
3. That build is copied or installed over `Papers\App\`.

`Data\` (the runtime profile, including `hermes-backend-token`) is a sibling of
`App\` and is untouched by this, which is why hand-replacing `App\` has been safe
so far.

## What is weak

**1. The version number is frozen and unused.** ~~`package.json` has said `1.0.0`
since the beginning~~ — **addressed 2026-07-27, see below.** `package.json` still
says `1.0.0` and there is still no tagging discipline, but the build now carries
the commit it was made from and shows it in Settings, so a machine can say which
build it is running. Bumping the version on real releases remains worth doing;
it is no longer load-bearing for telling two machines apart.

**2. The install location breaks the normal update-in-place assumption.** The
NSIS installer is `perMachine: false` with `allowToChangeInstallationDirectory:
true`, so it records where it installed. But `Papers\App\` was placed by a
migration, not by that installer. The registry confirms the mismatch: two
uninstall entries (`Papers 3` and `Papers`, both `1.0.0`) have an **empty
InstallLocation**, and neither points at `Papers\App`. So:

- Running `Papers-Setup-*.exe` would install to its *own* default location, not
  over `Papers\App\`, silently producing a second copy rather than an upgrade.
- `electron-updater`, if added now, would inherit the same confusion — it
  relaunches the installer and assumes the recorded location is the live one.

Any real updater work must therefore start by making the installed location and
the installer's belief about it agree — either by reinstalling Papers properly
once through the NSIS installer, or by deciding that `App\`-replacement is the
supported shape and never using NSIS to upgrade.

**3. A packaged build carries no way to check for a newer one.** No feed, no
release, no check. This is a consequence of the above, not a separate problem.

## Step 1 is now done — builds are identifiable

Implemented 2026-07-27. Settings now opens with a **This build** card reporting
version, commit, branch, build time, machine name, install folder and data
folder, plus a **Copy build details** button.

The commit is the part that actually answers "same build?". The version alone
never could — it has been `1.0.0` on every build ever made, so two machines
comparing versions would always agree even when running completely different
code. The commit is stamped in at package time by `electron.vite.config.ts`;
the paths and machine name are read at run time, because those are per-machine
facts (the same distinction D-016 draws for Hermes).

Marks worth knowing:

- **`+local`** — the build included edits that were not committed, so it matches
  no other machine exactly. Expected during development; a release build should
  never show it.
- **`unknown`** — the build predates this stamping, or was made without git.

To compare two machines: open Settings on each and read the middle line. Same
commit, no `+local` on either → same Papers. Anything else → different, and the
folders show which copy is which.

## Remaining order, smallest useful step first

These are proposals; neither is implemented.

1. **Decide the supported install shape** (NSIS-managed vs. `App\`-replacement)
   and make the machines match it. Until this is settled, adding an updater
   would build on an assumption known to be false.
3. **Only then consider automatic updating**, if manual updating turns out to
   actually hurt in daily use. Per D-001 and the HERMES.md invariant against
   speculative architecture, an auto-updater is not obviously warranted for a
   two-machine personal product where the creator controls both machines — a
   documented one-command rebuild-and-install may be the honest answer.
