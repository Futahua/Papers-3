# Phone files: research and installed evidence — 2026-10-15

Continued Claude session a828f405-d982-464f-8885-6ec1213464cf. Authorized scope: search the phone's own files, link real folders/files into its AYG, open files in Android apps, then wire existing file controls. No global search or toolbar redesign.

## Research conclusion

A native, durable filename catalogue is the correct boundary. MediaStore is an optional seed/change hint, not a complete census: prior poordroid measurements found 5,654 readable entries absent from it. The unfinished PhoneIndex used serialized in-memory folder snapshots and only directory mtimes; editing file contents can leave its directory mtime unchanged, making size/date filters stale. It also lacked observers. That implementation was not installed by Claude.

Use system SQLite with WAL, parameterized substring/filter queries, a phone-owned scan and strongly retained directory watchers. No FTS/native library dependency is justified at this catalogue size. Queries never walk the filesystem. Names fold case and Vietnamese diacritics; original names/paths remain intact. Tokens and common ext/size/dm/file/folder filters are supported, not all Everything syntax.

An initial census and 30-minute reconciliation preserve the last committed SQLite snapshot; bounded/failed scans roll back, and unlistable directories do not count as deletions. Watchers cover each directory, handle close-write/attributes as well as create/move/delete, and debounce updates. Watchers cannot guarantee lossless notifications or expose Android-protected storage.

Sources: [Android all-files access](https://developer.android.com/training/data-storage/manage-all-files), [FileObserver](https://developer.android.com/reference/android/os/FileObserver), [SQLite WAL](https://www.sqlite.org/wal.html), [FTS5 substring semantics](https://sqlite.org/fts5.html). Prior engine comparisons and raw measurements remain in C:\Users\admin\Documents\ChatGPT\Proximate\PHONE_SEARCH_ENGINE_RESEARCH.md.

## Installed behavior

- Phone search answers the existing Everything field locally.
- Hierarchical phone paths retain exact encoded identity while breadcrumbs/pills display readable names. Root shows Internal storage and provider Poordroid. Legacy picked-file paths remain accepted.
- Stat/list expose real folders, child entries and navigable parents. Phone file drags and copy/paste can make AYG links through its existing durable document owner.
- Explicit file open routes to Android ACTION_VIEW via the existing grant-bearing file provider; unavailable handlers report a local error. Selection still uses the existing preview behavior.
- Existing new-folder, rename, copy, move and batch-delete controls now use PhonePeerServer's local owner route, shared mutation queue, version checks and journal. Copy keeps both on name collision; move conflicts refuse. Deletes retain verified copies under shared storage .PapersRecycle/<commandId> before removing originals.
- Phone references map to storage aliases for PC views and back to phone addresses when received from PCs.

## Actual evidence

Signed with the existing key and installed on poordroid. Search instrumentation: 12/12 checks, including .nomedia coverage, diacritic/path/extension matching, URI identity, real folders, in-place edit with unchanged parent mtime, nested creation, rename, deletion, invalid filters and escaped paths. Final recorded census: 22,245 entries, 41.9 seconds. Native returned-result queries: pdf 54.2 ms, download 26.8 ms, 2026 37.3 ms, q 41.3 ms, dien thoai 24.5 ms. These are native query/serialization timings, not input-to-visible-frame latency.

File owner instrumentation: 20/20 checks on generated fixtures, including verified bytes, recursive structure, source retention on conflict, recoverable deletion and PC/phone reference round trips. JavaScript bridge: 5 checks. AYG focused navigator/drop/label checks: 37 passed. Actual installed WebView/AYG host bridge completed create-folder, rename, two copies, list, create-folder, move and stat; copies had the expected keep-both names. Temporary real files were removed; failed early census fixtures were cleaned explicitly. Test view restored.

The first census exceeded its bound; duplicate scheduling/root discovery were fixed. Per-row Android storage lookup and date formatting initially dominated queries; caching labels and sending numeric dates produced the final timings. Do not cite earlier slower/failed runs as final performance.

## Practical limits

No locked-screen battery benchmark, SD removal/remount test, observer overflow test, crash injection or large catalogue scaling test yet. A first complete census is background work; restored catalogues are searchable during refresh. Existing local copy UI confirms phases rather than measured byte speed. External-app opening is wired and bridge-tested; no creator document was opened/edited for validation. No Windows install was performed for these phone changes. Shared AYG source now includes phone-specific handling; do not overwrite mixed work.

## Phone touch/open completion — 2026-10-15

Creator requested double-tap external opening (fetch PC files first), hold-to-select, tap toggles and checkboxes. Phone-only delegated gestures now use the existing row selection/activation owners; ordinary scrolling cancels a pending hold. Selection mode displays checked state on all visible rows and survives rerender. Blank-space tap leaves it. Generated activation suppresses duplicate browser dblclick, and the old phone-specific second-tap Preview opener was removed.

PC file open resolves the live source, starts/reuses the existing verified native download, waits for completed receipt, then calls open-cache, whose native owner revalidates the cached SHA-256 before granting Android access. File links use the same phone open path. The host's phone-open timeout allows larger fetches to settle; Windows behavior is unchanged. Download's selection getter remains the existing full selection, with an explicit test confirming the entire array is submitted as one batch.

Validation: full AYG suite 2,051 passed before final blank-selection cleanup/status wording; focused gesture/navigator tests passed afterward. Gesture unit checks cover hold, checkbox state, add/remove, scroll cancellation, mode exit and duplicate-doubletap suppression. Phone bridge checks: 7 passed, including fetch-before-open and refused-fetch-never-opens. Batch Download selection test passed. Actual installed WebView touch input verified hold checkbox visibility and tap add/remove on two files. An isolated PC PNG was fetched through the installed bridge; Android's chooser opened, Gallery was selected without changing an Always/default setting, and its actual GalleryActivity reported Filmstrip 1 of 1. Desktop fixture and chooser scratch XML removed; phone cache remains a normal verified cache entry. Papers returned to Test view.

No Windows reinstall for these phone-specific source changes. No real multi-file public download was repeated in this completion: batch selection forwarding is a controller test; the existing native downloader/recursive expansion were reused.

## Mobile pills, cursor modifiers and icons — 2026-10-15

Creator-directed changes reuse the saved-pill height owner, AYG checked document store, native phone file mutation queue, and existing selected-icon compression/batch replacement path. The Android foreground bridge reads clipboard image URIs only on explicit button requests; image reads are bounded to 8 MiB and sampled to at most 512px before the existing icon compressor. No clipboard watcher was added.

- Invisible pill resize hit region widened to 20px on phone; same saved height key.
- Hold rows exposes up-arrow to pin the current selection. Hold pills exposes plain checkmarks, down-arrow (retain pills), and separate down-times (clear only after successful destination operation and durable pill removal). Tapping outside cancels pill selection; pill text is not selectable.
- Phone hold/release testing caught compatibility clicks unchecking the held pill. Suppression now survives pill DOM replacement. Selection identity also survives durable hydration and property normalization.
- Creator's reported down failure reproduced: a retained pill referred to an existing shortcut with only binned placements. Generic movement saved a no-op. The phone action now creates a fresh link with its saved name/icon in that case and verifies visible destination membership before reporting success. Existing bin history remains intact.
- Live phone down test on the existing requested “Dù khóc ướt làn mi” pill produced one active root AYG link, retained the pill, and survived process restart (native durable-state read confirmed both).
- Phone touch checks: hold retains checkmark; no text selection; down/clear/icon buttons visible; outside cancellation hides checks/actions; touch resize changes height and is restored after test; Shift tap latches a 34px control. Shift hold is temporary; modifiers are carried in synthesized input and cleared on leaving cursor mode.
- Proxima reorder now ignores pointer moves/releases from any pointer other than the initiating one. This prevents native L-button finger events from taking over a synthetic mouse drag. Isolated regression exercises foreign move/up/cancel and the valid cursor move without changing creator intervals. Timeline suite plus regression: 20 passed. No live creator-blob drag was used as a test.
- Clipboard-image button is beside the paperclip during supported hold selection. Uses existing AYG icon persistence; filesystem rows have no new metadata sidecar. Common file types get SVG fallback artwork; authored/native artwork retains priority.
- AYG integration suite: 2,055 passed; focused icon, pill hydration/hold-click, failed-save retention and retargeted clear regressions passed. Native PhoneFileInteractionCheck: 23 passed, including 3 image conversion/size/nonimage checks; owned filesystem fixtures and shared-view registration removed in finally.
- Signed APK installed with existing key on RF8M73S4NEM. No PC installation, creator desktop restart, Proxima data mutation or new commit in this task. Clipboard image decoding and existing icon persistence were checked separately; a live pasted image was not applied to a creator entry merely for testing.


## 2026-10-15 phone controls and shared folder options
- Android graph fallback uses the shared extension/folder icon resolver, including filename fallback for opaque content IDs; custom icons retain priority. Live SVG image decoding verified.
- Pill-only removal has a red X action; copy/cut exits hold selection and cut records dim until clipboard replacement/consumption. Toolbar and floating control pinch scales persist separately. Pill-box lock blocks all element resize gestures, including thumbnail and graph zoom. Quick Search has X; phone rename uses a dialog with the existing rename owner.
- Native Reveal opened Android DocumentsUI FilesActivity on the actual phone. Shared-storage canonicalization maps MediaStore/document addresses to checked native movement paths. PhoneFileInteractionCheck: 27 passed, including resolving a scanned image, verified move bytes and owned-fixture cleanup; bridge checks: 8 passed.
- Sort/filter projects existing rows without rewriting authored data: name/type/date/size, stable sort, inclusive dates, validated ranges, graph filtering without position sorting. The same public code was backed up, installed and hash-verified on SlopTop and LapDog; open AYG pages flushed before renderer-only reload. Normal and device Files views render the single Sort/filter control; compact widget and command launcher omit it.
- Hold-selection swipe paints each crossed item once; starting selected erases. Intermediate hit tests cover fast pointer samples. Graph drag is cancelled before hold takes ownership. Six gesture regressions pass. Actual phone touch injection passed select-all/deselect-all in AYG thumbnails and native-folder thumbnails, without moving files. Delete/View/Devices computed colors verified red/blue/green. Final signed APK installed using the existing identity.
- Full AYG integration checkpoint: 2,065 passed before the final intermediate-hit-test refinement; all six focused gesture checks passed after it. Existing ResizeObserver loop warnings remain observable; no new gesture exception occurred in the live acceptance check.


## 2026-10-15 bounded PC thumbnails and desktop toolbar scaling
- Dedicated authenticated GET /v1/files/<issued-id>/thumbnail resolves through the device grant, checks revocation after rendering, returns bounded JPEG only, and never opens a preview app or transfers source bytes. Existing preview routes are unchanged.
- Owner reuses Windows shell derived-thumbnail cache. New provider coalesces matching path/size/mtime/ctime requests, limits generation to two workers plus bounded waiting, retains at most 128 entries, checks source stability, and caps encoded output to 256px / 128KiB. Unsupported shell handlers return none; file type icons remain.
- Android requests this route through its existing authenticated native transport; mobile visible-tile loader asks for thumbnail rather than preview, including PDFs/CLIP. Local Android image URI rendering stays with its existing owner. Queue remains three visible/near-visible tiles; no thumbnail request starts a full download.
- Actual RF8M73S4NEM -> SlopTop owned PNG fixture: 256x192 JPEG, 2634 bytes; first request 314ms, repeated request 254ms including transport, same payload and successful WebView decode. Fixture removed after acceptance. PDF/CLIP artwork depends on installed Windows shell thumbnail handlers; those formats were not asserted to have handlers merely from the route test.
- Desktop controls had only phone pinch wiring. New desktop Ctrl+wheel listener on navigator toolbar prevents default zoom, uses shared .65..1.7 bounds and a local saved scale; plain scrolling and content thumbnail sizing retain their own handlers. Live installed DOM wheel checks on SlopTop and LapDog enlarged 1 -> 1.08 -> 1 and preserved prior saved values (including a non-default SlopTop view).
- Host typecheck passed. Thumbnail provider + authenticated gateway: 7 checks passed; Android bridge: 9 passed; AYG integration: 2067 passed. Signed existing-key APK installed. Supported Windows installer applied to both PCs with verified quiescent profile/App backups and matching app.asar f97d91433aa8aadc73ce7d0f3edba66da74c4e421460c9f22ab08d3e51fe201d. SlopTop profile 14308 files and LapDog 4870 files preserved byte-for-byte through installation. Four AYG public files separately backed up and verified; normal workspace windows restored with one-use reload intent. No release published or version incremented.
