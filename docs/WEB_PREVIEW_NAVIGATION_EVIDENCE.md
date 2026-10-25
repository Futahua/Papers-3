# Web Preview replacement navigation — 2026-10-14

Creator's remote LapDog Files link reached the existing workspace Preview, but
the first ChatGPT navigation was rejected with ERR_ABORTED during a replacement
navigation. loadPreviewDocument previously raced DOM readiness against loadURL;
the initial load's cancellation retired the entire preview session.

The owner now waits for a usable document when that initial navigation is aborted.
Main-frame load failures, view destruction and a 20-second navigation deadline
still fail the open. Readiness removes all temporary listeners and the timer.
It does not repeatedly reload the link, suppress unrelated errors or change the
shared persistent browser profile.

- 19 browser-owner tests passed, including abort then DOM readiness, abort then
  real DNS failure, and abort without a replacement document timing out.
- Host typecheck passed.
- Real Electron/Chromium fixture: immediate JavaScript replacement rendered the
  replacement document's expected title and text. The same owner then opened
  https://chatgpt.com/ and reported success with its ChatGPT page title. This used
  a disposable profile; it did not verify a signed-in conversation or login flow.
- Supported installer installed on LapDog and SlopTop with exit 0. Desktop closed
  gracefully and restored three workspace IDs; laptop restored one. No desktop
  window was force-closed. No Android update or Backpack restyle.
- Both host app.asar hashes:
  `D705299B8E4ED4F4093FA7D4E047CC968AD400077DAB9AC865CF3BB19C7B1F88`.

Electron's loadURL promise reports failure for an individual navigation, while
did-fail-provisional-load includes cancelled navigation. Reference:
https://www.electronjs.org/docs/latest/api/web-contents

Real fixture source/result live in D:\Programs\evTEMP\preview-navigation-real-check.ts
and preview-navigation-real-result.json. Source changes remain uncommitted alongside
the existing cross-device work.
