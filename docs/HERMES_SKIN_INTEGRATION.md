# Hermes skin integration — how the Papers skin is applied and kept updateable

This documents how the Papers Light/Dark skin (see [`HERMES_SKIN.md`](HERMES_SKIN.md))
is applied to the real Hermes Desktop and how it survives upstream Hermes updates.
It satisfies creator-reported problems 3 and 4 in [`PROBLEMS.md`](PROBLEMS.md).

## Design: upstream core, small owned overlay

Hermes Desktop already has a clean theme token model (`apps/desktop/src/themes/types.ts`,
`DesktopTheme`) and adding a theme is "add it to `presets.ts` — no other code changes
needed." The Papers skin uses exactly that seam, so the creator-owned skin stays a small
overlay on an unmodified core:

- **The theme is data, not a fork.** The single source of truth is
  [`hermes-skin/papers-theme.json`](../hermes-skin/papers-theme.json) in *this* Papers
  repository — versioned, outside any generated Hermes file. It defines the coordinated
  **Papers Light** (`colors`) and **Papers Dark** (`darkColors`) palettes plus typography.

- **One narrow theme-loading seam.** On the Hermes side the entire integration is:
  1. `apps/desktop/src/themes/papers-theme.json` — a copy of the versioned data above.
  2. Two lines in `apps/desktop/src/themes/presets.ts`: `import papersThemeData from
     './papers-theme.json'` and one `papers: papersTheme` entry in `BUILTIN_THEMES`. The
     theme then appears everywhere a built-in does (Appearance settings, Cmd-K palette,
     `/skin`) with no per-surface wiring.
  3. A small scoped CSS block in `apps/desktop/src/styles.css` under
     `:root[data-hermes-theme='papers']` that nudges undersized interface/conversation
     text up ~1–2px and lifts line-height — the readability half of the same restrained
     change. Colours/contrast come from the theme data.

  Nothing else in Hermes is modified. Chat, sessions, models, approvals, attachments,
  voice and the backend are untouched.

- **Fallback.** If the theme data is malformed the theme registry simply keeps the
  built-ins; Hermes still starts. The skin is never allowed to block Hermes.

## Where things live

| Item | Location |
|---|---|
| Versioned theme data (source of truth) | `hermes-skin/papers-theme.json` (Papers repo) |
| Update / build / verify command | `hermes-skin/update-hermes-skin.mjs` (Papers repo) |
| Maintained Hermes branch with the seam | branch `papers-skin` in the clean Hermes clone |
| Clean Hermes clone (disposable build tree) | `…\HermesAI\hermes-papers-skin` |
| Live Hermes Desktop (never edited in place) | `…\.hermes\hermes-agent\apps\desktop` |
| Rollback copies of previous `dist/` | `…\Programs\_PapersHermesRollback\` |

The `papers-skin` branch has `upstream` set to `https://github.com/NousResearch/hermes-agent`.
It carries **only** the three small changes above on top of upstream `main`, so it rebases
cleanly onto selected upstream releases.

## Updating Hermes without losing the skin

Do **not** trust the stock binary updater to preserve a customized frontend — it can
replace the built files with the stock build. Update through the source path instead:

```
node hermes-skin/update-hermes-skin.mjs --ref upstream/main      # full: build + install
node hermes-skin/update-hermes-skin.mjs --check-only             # build + verify only
```

The script, in the disposable clone (never the live install):

1. Fetches the selected upstream ref and rebases `papers-skin` onto it.
2. Re-copies `papers-theme.json` and re-asserts the loader import, the registry entry and
   the type-bump CSS still apply (it stops with an exact message if upstream changed the
   shape of the files, so the patch can be updated deliberately).
3. Builds the Hermes Desktop renderer (`dist/`).
4. Verifies the Papers theme is present in the built assets.
5. Only then swaps the new `dist/` into the live install, moving the previous `dist/` to a
   timestamped folder under `_PapersHermesRollback\` so the last working build is always
   recoverable.

Hermes sessions (`state.db`), credentials (`.env`), and configuration (`config.yaml`) are
never touched by this process.

## Recovery

- **A build fails:** the live install is left exactly as it was; the script prints the
  failing step. Fix the patch (or the rebase conflict) in the clone and re-run.
- **The new skin misbehaves after install:** restore the previous renderer by copying the
  most recent `_PapersHermesRollback\hermes-dist-*` back over
  `…\apps\desktop\dist`, then restart Hermes.
- **Whole-app rollback:** the pre-integration Hermes Desktop build and Papers app are
  preserved under `_PapersHermesRollback\<stamp>\`.

## What stays patched (and why it isn't upstream yet)

Hermes Desktop does not yet expose a supported *external theme file* loader — user themes
are stored in the renderer's `localStorage` (converted VS Code themes), which is per-machine
state, not versioned data. Until upstream accepts a generic "load a theme from an external
file" seam, the Papers skin is carried as the three-change `papers-skin` branch above. That
branch is deliberately tiny and rebaseable; the preferred long-term step is to contribute
the external-theme-file loader upstream so the Papers skin can travel as pure data.
