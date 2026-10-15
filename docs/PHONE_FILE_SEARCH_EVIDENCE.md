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
