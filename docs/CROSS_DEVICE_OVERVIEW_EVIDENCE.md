# Remote overview and device installation checkpoint

Evidence reference under AGENTS.md and CROSS_DEVICE_PLAN.md, verified 2026-10-13. This records one delivery stage; it does not close the full cross-device goal.

Proxima now offers Calendar and timeline alongside its source record list. A separate local presentation frame loads no Store or persistence owner. It reuses the exact timeline geometry, shared queue projection and the calendar recurrence projection. Month, week, day and year navigation, source event details, timeline panning and zooming remain local. Remote edit controls are hidden and its command adapter refuses mutations; edit shortcuts are ignored. Source clocks interpolate only while online and freeze with cached data while offline. Source views do not adopt the receiving Proxima's layout or change its facts.

Papers permits frames from the same bound Backpack origin while retaining denial of remote and unrelated origins. The source-view leaf additionally forbids networking and nested frames. Android admits only the packaged source-view subframe, keeps its WebView network/file/content access disabled, and obtains approved snapshots through its native bridge.

## Verification

- Proxima: 46 tests passed across exact timeline, domain import/follow and shared recurrence projection. Cases include moved/cancelled occurrences, missing monthly dates, unchanged source records and ordinary calendar colours.
- Papers build and typecheck passed. The focused CSP, Backpack runtime and remote Backpack gateway checks passed 30 tests.
- `node tools/probeProximaCrossDevice.mjs --overview --phone` used two isolated real Papers processes, real data-only pairing, source calendar/week geometry/details and rendered timeline navigation. It checked the absence of a source Store and mutation controls and confirmed that source browsing did not write receiving facts. Generated evidence: `D:\Programs\evTEMP\papers-proxima-devices-prOzFZ`.
- Actual Android 12 phone: signed in-place update retained pairing and verified live approved facts plus calendar/timeline controls. After retiring the fixture owner, cached facts and the source overview remained available. Native visual-state synchronization and PixelCopy verified an actually displayed offline timeline, not merely DOM nodes in a hidden frame. Image: `phone-offline-overview.png` under that generated fixture directory. The separate test package was removed; the main app remains installed.

## Installed laptop

The supported NSIS installer installed Papers source build `83106bb`, public version `1.3.11`; no release/version was published. ASAR SHA-256: `0c2a642794c96aa9dfa2831f20f269eacc3d7dcd307b2a94a3b4665ce74dbf27`.

Proxima source `fc08ce4` was installed in its existing bound runtime folder. The prior five code files were retained in recovery; the new code archive and final keyboard guard were individually hash-checked. Unrelated files were retained. AYG remains source `657768c`.

Recovery is local to the laptop: `C:\Users\admin\Documents\Papers-Recovery\20261013-proxima-overview`. All 3,199 profile files and the old Proxima code were copied and SHA-256 verified while Papers was quiesced. The installer and code update left profile bytes unchanged before startup. The previous main process 80376 closed through its normal save lifecycle, with shutdown complete and no remaining windows.

Installed diagnostic main 34368 verified packaged build identity, the new owner API, IndexedDB readiness and full UI startup. The loaded origin had no legacy `proxima.store.v1` document, so no pre-existing board records were available for a record-by-record comparison. Do not interpret the initially empty early snapshot as preservation evidence. Full startup loaded the software's reference calendar: one project and 24 calendar entries, no tasks/intervals and no dropped records. The entire pre-upgrade profile remains in recovery.

Diagnostic main 34368 then closed normally; its descriptor was removed. Normal installed main 44076 is responding from `C:\Users\admin\Documents\Papers\App\Papers.exe`, launched without diagnostic flags. Its tracked launcher is intentionally still live; it must not be killed as fixture cleanup.

## Remaining delivery gates

This stage installs and verifies software, not the complete requested experience. Actual creator-resource onboarding and production device pairing, real two-PC copy/follow acceptance, checked file edit staging/save-back and external changes, persistent background transfer/process-death handling, search/preview/local export/cache removal, and remaining provider/bandwidth checks remain open. Temporary device-fixture connections/caches must not be mistaken for production onboarding. Keep the full goal active until those requirements and the completion audit are proven.
