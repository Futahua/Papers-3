# Hermes integration and updates

Papers launches the real Hermes Desktop and one Hermes backend. It does not
recreate chat, sessions, attachments, tools, approvals, models, settings or the
agent loop.

## What Papers owns

Only two small additions sit around upstream Hermes:

1. `hermes-skin/papers-integration.patch` adds the native-window docking channel
   and lets Hermes hand an update request to Papers.
2. `hermes-skin/papers-theme-plugin.js` is a normal Hermes disk plugin. It
   contributes Papers Light and Papers Dark through Hermes' official Desktop
   Plugin SDK and adds the restrained readability CSS requested by the creator.

The theme plugin is installed under
`<HERMES_HOME>/desktop-plugins/papers-theme/plugin.js`. It is outside the Hermes
source checkout, so an upstream update does not overwrite it.

## Normal update experience

Use **Settings → Updates** inside Hermes as usual. When Hermes is running through
Papers, the button follows this sequence:

1. Hermes sends an authenticated update request to Papers.
2. Papers opens a small visible update window and closes Papers, Hermes Desktop
   and the Papers-owned Hermes backend so Windows releases their files.
3. The helper runs Hermes' existing `hermes update --yes` command. Papers does
   not implement or imitate the Hermes updater.
4. The helper reapplies the small integration patch, reinstalls the official
   disk-theme plugin and asks Hermes to rebuild its Desktop package.
5. Papers reopens. Success produces a native notification; failure produces a
   visible Papers error with the log location.

Hermes conversations, `state.db`, credentials, configuration and Papers data are
not modified by the Papers handoff.

The update log lives at `<Papers>/Data/hermes-update.log`.

## Manual recovery

If the machine shuts down during an update, close Papers and Hermes, then run
from the Papers source repository:

```text
node hermes-skin/update-hermes-skin.mjs --check-only
node hermes-skin/update-hermes-skin.mjs --repair --build
```

The first command only checks. The second reapplies the Papers integration and
rebuilds Hermes without touching user data. If upstream changed the exact source
around the small patch, it fails clearly instead of producing a partially
patched application.

## Files that must remain versioned

- `hermes-skin/papers-integration.patch`
- `hermes-skin/papers-theme-plugin.js`
- `src/main/hermes/hermesUpdater.ts`

These files are bundled into every packaged Papers build. No local tracking
clone or unpublished Hermes branch is required anymore.
