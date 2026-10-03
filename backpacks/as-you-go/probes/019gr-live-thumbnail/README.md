# 019GR isolated native-thumbnail proof

This is a new acceptance probe; it does not change or weaken `019e-live-proof`.

It launches an isolated Papers profile/project copy and two uniquely titled,
solid-color WinForms fixtures. All page actions are renderer-internal DOM
events. The only native mutations are exact-title minimize, restore, and close
against those fixture processes. It never sends global cursor/keyboard input,
activates a creator window, switches a release, or writes creator data.

The probe verifies:

- a real `PrintWindow` PNG reaches the AYG hover card and its center pixel
  matches the intended native fixture color;
- bounded PNG dimensions and exact page request/result traffic;
- typed minimized and missing fallbacks render no fabricated image;
- leave-before-debounce cancellation and rapid A-to-B latest scheduling;
- the 750 ms duplicate shield returns the old validated colored capture, then
  expires and recaptures the recolored same HWND;
- no thumbnail/data-PNG/imageUrl enters durable state;
- exact fixture, isolated descendant, creator Papers, and foreign-helper
  cleanup/identity receipts.

The intentionally delayed-response latest-only race is not manufactured in a
live host. Its deterministic unit test remains the decisive oracle; this probe
adds the observable rapid-hover scheduling half without changing production.

Run:

```powershell
node probes/019gr-live-thumbnail/run-019gr-live-thumbnail.mjs
```

Artifacts are `proof-019gr-transcript.txt` and `proof-019gr-app.log` in this
directory. The temporary isolated data path is printed in the transcript.
