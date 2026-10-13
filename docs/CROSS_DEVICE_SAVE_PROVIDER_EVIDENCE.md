# Conditional save provider feasibility, 2026-10-13

Remote save-back must preserve the source and edited copy when the source changes.
This checkpoint tests an optional Windows provider only. No remote endpoint, client
edit session, or installed save-back feature calls it yet.

## Provider choice and limits

An actual generated-file probe of `StorageFile.OpenTransactedWriteAsync` allowed
delete/recreate while its transaction was open, and its successful commit replaced
the recreated file. Therefore that API alone does not satisfy checked save-back.
Ordinary atomic replacement also does not supply a revision comparison.

The prototype in `resources/native/conditional-file-save.cs` uses Transactional
NTFS, checks SHA-256 while holding the transacted source handle, freezes the
uploaded working copy, pins parent directories against rename, rejects reparse
points and multiple hard links, and closes the source handle before committing.
Cancellation rolls back. There is no ordinary overwrite fallback.

Microsoft [recommends alternatives to TxF](https://learn.microsoft.com/en-us/windows/win32/fileio/deprecation-of-txf)
and warns that it may not remain available. This is a capability-gated candidate,
not a settled universal provider. Unsupported volumes must refuse checked overwrite
and retain both versions. Other providers remain possible if they satisfy the same
concurrency and recovery requirements.

## Actual machine evidence

`powershell.exe -NoProfile -MTA -File tools/probeConditionalFileSave.ps1` compiles
the actual C# source and operates only on generated files under the machine's
temporary directory. Fourteen checks passed on SLOPTOP's D: NTFS volume and LAPDOG's
C: NTFS volume: exact commit, source mismatch refusal, upload mismatch refusal,
cancel rollback, concurrent write/delete-and-recreate/rename/replace/parent-rename
fencing, truncation, empty replacement, outside-root refusal, same-file refusal,
and hard-link refusal. Each verifies source bytes and retained working-copy presence.

The first laptop harness run failed because its PowerShell could not discover
Get-FileHash. The harness now uses .NET SHA-256 directly; subsequent checks passed.
The installed laptop Papers process 44076 remained responsive and was not restarted
for these probes. The provider is not installed into that running build.

Follow-up: `tools/probeConditionalSaveCrash.ps1` kills its own generated child
process after the replacement bytes have been flushed and verified, immediately
before transaction commit. On both actual machines, the original hash and working
copy hash remained unchanged after process death, and the next checked save succeeded.
This proves rollback and released locks at that checkpoint, not every interruption
point or the durable acknowledgement path.

`remoteFileEditSessions.ts` adds owner-side durable receipts, with serialized
dispatch and peer isolation. Focused tests prove journal-before-dispatch,
successful receipt reuse after restart, no replay of conflicts or uncertain saves,
interrupted `saving` recovery to `uncertain`, revoked/other-peer refusal, and
rejection of a provider receipt whose saved hash differs from the edited copy.
The class is not yet wired to a gateway or uploaded working-copy owner. Its provider
is injected; tests of receipts do not prove native provider integration.

`remoteFileEditUploads.ts` provides owner-private, session-bound streamed staging.
Working copies remain separate from original files and immutable read caches.
Chunks have a fixed upper bound; confirmed prefixes have SHA-256 status and survive
restart. Stale offsets cannot truncate an earlier confirmed prefix. A failed chunk
rolls back only its own append; abrupt process death instead leaves an actual prefix
that the receiver must verify before resuming. Sealing requires the exact declared
length and complete SHA-256; sealed copies reject further appends. Peer access,
session matching, revocation, interrupted chunks, corrupt/incomplete retention,
bounded chunk rollback, restart/resume, and empty files have focused tests.
There is no remote route for staging yet, and no claim of an Android upload test.

## Remaining gates before remote use

- Additional interruption points, unsupported-volume behavior, and explicit
  reparse/namespace race fixtures.
- Full file identity/stat revision comparison under the same protected operation;
  content hash alone does not prove the previously observed revision is unchanged.
- Authenticated, owner-resolved sessions; immutable original receipt plus separate
  editable copy; bounded streaming upload; cancellation and revoke behavior.
- Durable save receipts and uncertain-restart handling without blind redispatch.
- Client UX for changed source, retention/recovery of both versions, local editor
  opening, and actual PC/Android end-to-end verification.

These checks advance the full [cross-device plan](CROSS_DEVICE_PLAN.md). They do
not establish that remote editing or the complete cross-device objective is ready.

## Native revision follow-up

The checked entry point now requires a native revision token, captured by `Inspect`
under a read handle that excludes writers and renames. The token covers volume/file
identity, size, creation and write times, attributes, and link count. `SaveChecked`
compares it inside the same transacted source handle used for the digest and write.
Generated unchanged, timestamp-only change, and identical-content replacement cases
passed on desktop D: and laptop C:. The latter two retained the original and upload.
Node's source version must still be bound to this native token when sessions begin;
this native evidence does not yet establish that binding or a remote save route.

Correction: the initial concurrent `File.Replace` fixture passed a null backup
argument which this PowerShell/.NET combination rejected before attempting replacement.
That initial case did not prove replacement fencing. The fixture now supplies a valid
backup path, and passed on both machines. The separate identical-content replacement
probe confirms the same replacement call succeeds outside the helper's protected save.

## Edit owner binding checkpoint

`remoteFileEditOwner.ts` now combines the catalog, durable session receipts, and
private uploads. Beginning a session captures the provider revision, rechecks the
catalog version, and compares its checked digest before retaining the session.
Saving resolves the original again through the current approved catalog, requires
a sealed upload for that same session, supplies only captured native/source revisions
to the provider, and verifies the resulting catalog version and complete digest.
Revocation closes access to sessions and uploads. Restarts require reattaching the
current approved grant; a retained session alone does not authorize its old path.

Focused owner tests use real generated files and the real catalog/upload/receipt
owners with an injected file-writing provider. They prove routing, session binding,
external-edit refusal before dispatch, retained originals/uploads, successful receipt
recovery without a second write, cross-session refusal, and revocation. They do not
prove native concurrency: the native provider adapter, remote gateway routes, client
working-copy UX, and actual device end-to-end path remain to be implemented.

## Authenticated HTTP routes

The gateway accepts an optional edit owner. Without it, or without the peer's
existing write grant, edit routes refuse access. Routes cover session creation/list,
upload creation/status, bounded streamed append, verified sealing, and save receipts.
Request bodies are bounded, client paths are ignored, and errors do not return owner
OS paths. Edit responses participate in the gateway's revoke cancellation; revocation
also reaches the session and upload owners. This remains filesystem-only machinery.

An actual loopback HTTP fixture with generated files and an injected provider passed
the full session/upload/seal/save path, digest status, duplicate receipt without a
second write, unauthenticated and read-only refusal, and post-revoke refusal. Together
with existing gateway and focused edit tests, 17 checks pass; typecheck passes.
This is HTTP contract evidence, not the native save or phone implementation. The
production gateway does not supply an edit owner yet, so this feature is unavailable
in the installed applications until that integration and client work are verified.

## Actual native adapter and HTTP save

`remoteFileEditNativeProvider.ts` invokes a fixed local PowerShell script with
paths and captured revisions carried as JSON on stdin rather than shell text.
The helper requests owner authorization after locking/checking the source and
again after flushing the transaction, immediately before commit. A denied handshake
terminates the owned child and rolls back its uncommitted transaction. Structured
native errors distinguish a changed source without exposing OS paths.

An actual Windows adapter test passed: withdrawn precommit permission retained the
original/upload, an authorized save committed, and the old source revision refused
another save. The HTTP fixture now uses this actual native adapter on Windows
(injected portable provider elsewhere). Its full authenticated session/upload/seal/save
and duplicate receipt path passed through the real native transaction on desktop D:.
Six focused suites total 18 passed tests; typecheck passes. Native tests are explicitly
skipped off Windows, so a cross-platform green run alone cannot prove this provider.

The installed runtime still does not supply this owner. Runtime lifecycle wiring,
capability negotiation, laptop adapter/HTTP verification, client editing and actual
PC/phone acceptance remain. Existing file-read and mutation installations are intact.

## Runtime wiring checkpoint

Papers now initializes the edit journal before the device gateway starts on Windows,
supplies the native-backed owner, and closes it through the existing shutdown stages.
Pending source inspections are awaited; a session finishing after shutdown begins
is refused. A focused shutdown fixture proves this behavior. A journal requiring
recovery leaves editing unavailable while preserving ordinary device/file services.
The gateway advertises `capabilities.edits` only with an edit owner and the peer's
write grant. The approved installer already includes the native resources directory,
so the fixed script and C# source use its existing packaging contract.

The full source test run passed 1,494 tests with four skips before the additional
shutdown fixture; typecheck and production build passed. These are source/build
checks. The current installed build is still the earlier overview checkpoint;
new client controls and device verification are required before installing this slice.

## Receiving PC working-copy checkpoint

The desktop client can begin an owner edit session, await its verified download,
and retain a local edit journal with separate original and working files. It reuses
the existing checked/resumable transfer owner; it does not mutate the read cache or
original remote file. Local files preserve a safe extension for installed editors.
Source-copy digest checks precede retaining a ready journal, and retained originals
are verified before recovery access. Shutdown tracks in-flight edit openings and
prevents late downloads from starting after the client begins closing.

Generated-file tests prove edited working bytes remain separate from the original
and download cache, survive recreation of the working-copy owner, remain isolated
by owner identity, and reject traversal/damaged originals/mismatched source content.
Existing client checks and typecheck pass. Save/upload orchestration and the actual
AYG editing controls are still absent; no new edit feature is installed on PC or phone.

## Receiving save-back checkpoint

The receiving PC now retains a verified, flushed save snapshot distinct from its
still-editable working file. Its save identity and upload identity are journaled.
Save-back uses bounded four-MiB chunks, verifies the owner's actual retained prefix
before resuming, seals the uploaded digest, and submits the same save identity on
retry. Conflict and uncertain receipts retain local original/working/save files.
Shutdown waits for tracked saves, while a closing client stops before another chunk
or commit is dispatched. The trusted local file capability exposes begin/list/open
working copy/save operations; opening uses the receiving machine's installed editor,
not a remote owner application.

The actual receiving client test paired with the HTTP owner and Windows native
provider, downloaded a generated source, saved a five-MiB changed working copy across
multiple upload chunks, verified owner bytes, retained local working bytes and the
unchanged download cache, then recreated the client and checked its retained saved
receipt without another save. Six client/working-copy checks passed; typecheck passes.
This loopback test is not two-machine or Android evidence. AYG controls, phone native
editing/export machinery, disconnected upload acceptance, and installation remain.

## AYG editing controls

AYG now offers Edit local copy, Open local editor, explicit Save back, and a
Working copies view with retained editing/saved/conflict/unconfirmed states.
Conflicts keep the local copy accessible and direct the user to the owner's current
file for a new session. Controls require both owner editing permission and receiving
client editing support, so older clients and the currently unsupported phone native
client do not advertise an operation they cannot execute. Preparing a copy after
navigation does not reopen an editor or replace the new location's presentation.

The existing AYG suite passed 2,028 tests plus eight preflight checks. A separate
real headless Chrome fixture exercised the actual view module with generated RPC
facts: prepare/open, explicit save, retained conflict recovery, offline view switching,
read-only control suppression, and unsupported receiving-client suppression all
passed. Its screenshot was visually inspected. This rendered fixture uses RPC stubs;
it is not installed AYG/native-editor/device evidence. `probeRemoteEditView.mjs`
accepts the actual AYG checkout path and reproduces the checks without creator data.
AYG source commit: `59a5603`; installed copies remain unchanged pending acceptance.

## Android local editing foundation

The Android source now has private edit journals, verified retained originals, and
separate working bytes. Native session creation reuses the checked download owner,
awaits its actual worker/completion, and verifies cached content before making copies.
The existing content provider keeps cached downloads read-only. An explicit edit URI
grants read/write access only to a journaled working copy and launches a receiving
phone editor through ACTION_EDIT; it exposes neither original bytes nor arbitrary paths.
Journal writes use Android AtomicFile, and copied content is flushed before ready state.

The unsigned Android build compiles successfully. No real phone editor/URI permission
or save-back acceptance has been established yet. Client editing capability remains
absent, so AYG hides these controls until Android save orchestration and device evidence
are complete. The installed signed package remains the earlier verified build.

## Android checked save and actual device evidence

Android now retains a flushed save snapshot and durable save/upload identities,
verifies the owner's retained prefix, streams bounded chunks, seals the whole digest,
and requests checked save-back with the same identity on retry. Per-edit locking
does not hold the unrelated pairing/download lock during an upload. Unconfirmed and
conflicting results retain originals, working copies, and save snapshots.

The signed package was updated in place on the USB-connected phone without a data
wipe (APK SHA-256 `b29fffc422a42e6a414ced5c9c87212e7e7f16dbc89d46a0c5e6bf9b1e2e698b`).
A generated-only gateway on the desktop's private device interface used the actual
Windows native provider. Instrumentation passed native pairing/session, working-copy
URI write, unchanged retained original, checked HTTP save, duplicate receipt,
re-download of the owner's changed bytes matching the local working digest, and
reopening the local receipt journal. This is actual Android-to-PC save evidence,
not a browser stub. The test runs under target instrumentation permissions; it does
not prove an external editor's URI grant or its own save behavior.

Client editing capability remains hidden pending external-editor and complete UX
acceptance. The generated listener was stopped and the separate test package removed;
the signed main package and creator app data remain. No laptop edit install occurred.
Remaining checks include external-editor grants, interrupted/restarted phone upload,
external source conflict, rendered phone UX, laptop end-to-end path, and the full plan.

## Actual phone interruption and conflict checks

The generated fixture can now drop the connection after durably accepting the first
upload chunk, or modify only its generated source after an upload. On the actual phone,
a five-MiB working copy hit the dropped acknowledgement and retained an uncertain save,
snapshot, upload identity, and save identity. After the completed instrumentation run,
the target app was explicitly stopped. A fresh instrumentation/app process resumed the
retained prefix with the same identities and received a saved receipt. The desktop
owner's actual file SHA-256 matched the retained edited digest, independently inspected.

A separate generated source-change fixture passed: the phone received a conflict,
retained its local original/working/save records, and the desktop file still contained
the external fixture edit. No overwrite fallback was used. Both owned listeners were
stopped, the port was checked absent, and the test package was removed after terminal
instrumentation results. The main app's data was not wiped.

These checks establish interrupted-upload/app-process recovery and source conflict
for this native phone path. They do not establish a production external editor's grant,
background-transfer lifetime, every crash point, laptop editing, or full goal completion.

## Separate-UID editor grant evidence

The phone's package manager reports two text EDIT handlers (iA Writer and Noteshelf).
Intent registration alone does not establish in-place URI save behavior. A separate
test-package Activity now checks the actual permission boundary: it asserts its UID
differs from Papers, receives an exact read/write grant to the generated working URI,
and edits it through ContentResolver. A separately read-granted cache URI refuses
writing, and its original hash remains unchanged. The target instrumentation then
verifies exact generated edited bytes and receives the separate app's UID result.

This actual-phone check passed. Test grants were revoked, exact generated scratch
cache/source files were removed, the test package was removed, and Papers reopened.
The production provider remains non-exported with explicit URI grants; the test
Activity exists only in the separate device-check APK. Android build includes all
test Java sources without adding that activity to the main package.

This proves a separate editor app can access only its granted working bytes through
the tested contract. The installed production editors' import/save behavior and
complete user flow are still unverified; phone editing controls remain hidden.

## Local recovery isolation repair

Inspection found that an incomplete preparation folder or one malformed edit journal
could stop the whole PC working-copy list. Preparation now durably records its phase
before copying bytes. Inventory isolates incomplete/invalid records from healthy
copies, retains their files, and reports a bounded recovery entry instead of guessing
their save state. AYG displays these entries alongside healthy copies with Open
retained files through the receiving PC's file owner. Incomplete working files cannot
be opened as ready edit copies. Older/phone clients do not receive unsupported controls.

Generated tests prove healthy copies remain visible beside a failed source-copy check
and malformed journal, loose unsaved bytes remain retained, traversal is rejected,
and recovery folders can be accessed without trusting a damaged journal. The actual
rendered AYG fixture proves a recovery entry and healthy conflict entry coexist and
the correct recovery identity reaches the local owner. Typecheck and focused tests
pass. This source repair is not yet installed on the laptop; Android recovery inventory
and production editor behavior remain acceptance work.

## Actual laptop receiving-client and native provider evidence

`buildRemoteEditLaptopProbe.mjs` bundles the actual current receiving client and
native adapter into an isolated laptop fixture. The tracked laptop job exited zero:
it paired with a generated desktop owner over the private device network, created an
edit session, saved five MiB across bounded chunks, re-downloaded and verified owner
bytes, preserved the earlier source cache and local working bytes, then recreated
the receiving client and retained its completed receipt. Its independent laptop C:
native adapter also rolled back withdrawn precommit permission, committed an authorized
save, and refused the old source revision. The installed Papers app stayed responsive
and was not restarted for the fixture. This is real two-PC filesystem evidence.

The full source suite now passes 1,499 tests with four skips; typecheck and production
build pass. An unpublished supported NSIS package is being prepared for the authorized
laptop update. Backup, actual installed host/AYG checks and production editor UX remain;
the fixture alone does not establish installed behavior or full goal completion.

## Supported laptop installation, 2026-10-13

After real two-PC acceptance, the unpublished Papers 1.3.11 installer and AYG editing
view were transferred to the laptop and verified by complete SHA-256 before closing
Papers. Its one app window closed through normal WindowPattern.Close; no Papers
process remained. A laptop-local backup of the quiesced profile and complete AYG tree
was copied and independently hashed before installation. The previous supported
installer and ASAR were retained for recovery.

Recovery: `C:\Users\admin\Documents\Papers-Recovery\20261013-file-edits`.
The installer ran against the existing sibling App/Data layout, not a raw copied app.
The checked update job exited zero. All 3,205 profile files retained their bytes before
startup; the 160-file AYG tree changed only `public/app/remote-file-view.js`. Its
binding and unrelated files, including creator state, were preserved. Proxima was not
overlaid by this update. Normal Papers reopened from its installed path and responded.

Installed ASAR: `294cb37017d3c987d5471256b19a7fed6d135b47170891aed0f049b8f91fd1f6`.
Installer: `fecbde0649f5b71c4ae8fe588928678411ad74e67de689b68a78268ad0464550`.
Installed AYG view: `85fb953d85cc816f51285cf81bae356cbd48838173ecfaf00975f9697dd03519`.
The artifact contains runtime source at `3d35de6`; later checkpoint commits add tools
and evidence. The host version was not bumped and no GitHub release was published.

This establishes supported installation, matching code and quiesced-data preservation.
Actual installed AYG interaction with a production peer and production phone editor
behavior remain acceptance checks. Full cross-device onboarding, persistent background
transfers, remaining file UX/performance gates and complete plan audit remain open.

## Unchanged-copy and later-edit safeguard

Save preparation now refuses a working copy whose digest still equals its retained
original, before allocating a save identity or uploading bytes. This prevents an
editor that imported/saved another file from presenting an unchanged source as a
successful save-back. The error tells the user to retain that separate edited file.
The signed phone app was updated in place and the actual separate-UID grant check
also proved unchanged preparation refuses without acquiring a save identity.

PC tests additionally prove that later edits do not replace an already prepared save
snapshot. Source now compares saved snapshots with current working bytes and reports
newer local edits separately; AYG labels an earlier saved snapshot without implying
those later edits were saved. The current laptop install predates these follow-ups.
Android source for the newer-edit status compiles but predates a new signed acceptance
run; its no-change safeguard is installed. External-editor import/reintegration and
continuing a saved edit session remain implementation/acceptance work, not completion.

## Continuing saved local edits

PC and Android can now continue a saved working copy through a new edit session.
The owner stat must still match the previous confirmed saved version; otherwise
continuation refuses and retains local edits for comparison. The new session captures
the current saved source independently, then carries newer local bytes through a
verified retained copy. The old working/original/save files remain. Copy preparation
is hidden from ready editing until the carried bytes verify and flush. PC shutdown
tracks the complete continuation operation. AYG's Continue newer edits action is
gated by receiving-client support and opens the new local copy before explicit save.

The actual PC client/Windows HTTP test passed second save and subsequent external-owner
change refusal with both local and external bytes retained. The real phone passed
session/save, writing newer local bytes, continuation into a distinct checked session,
second save, and preservation of both copies; the desktop fixture file independently
contained the expected continued edit. The phone was updated in place with signed APK
SHA-256 `820df4241c7c7616a3dd669309b4c61e95cd5c6506c7b1e87c10222783179d48`.
The listener and separate test package were retired after terminal results, and the
main app reopened. Its edit UI remains hidden pending the production external-editor
import/save workflow. Laptop installation predates continuation source changes.

The rendered AYG fixture passed the newer-edits label and continuation/open request,
alongside recovery/conflict and unsupported-client checks. Typecheck passes. This does
not complete external-editor reintegration, actual installed peer UX, or the full plan.

## Imported editor copies

Android has an explicit ACTION_OPEN_DOCUMENT route for an editor that exported or
imported another file. The chosen stream is bounded and written to a new private
working-copy record, with a verified copy of the original source. It does not replace
an existing editable URI: previous working bytes remain available, and that previous
record is marked with the new imported-copy identity so it cannot submit another save.
The imported copy retains the captured source revision, so ordinary checked save-back
still refuses a changed owner. Incomplete imports retain files in preparing state.
Cancellation leaves prior work unchanged. The chooser refuses prepared/superseded
copies and does not open after the Activity has been destroyed.

Actual phone instrumentation imported generated editor bytes through the native copy
owner, verified previous working bytes remained unchanged and became non-saveable,
saved the imported copy through the Windows owner, re-downloaded verified owner bytes,
and reopened its journal. The desktop generated file independently contained the
expected imported text. Signed main APK installed during this check:
`8ca694c4d2d0875b015fe9e2e79289b091be203380ea56bb65f76e888f91421d`.
The listener and test package were retired after completion; main Papers reopened.

AYG has capability-gated Import edited copy and Edit again actions. The rendered view
fixture passed import identity routing, previous-copy status and exactly one saveable
imported record, together with continuation/recovery checks. Android build passes.
The native instrumentation supplies the chosen stream directly; it does not prove
the real system chooser/bridge return or an installed editor's export flow. The last
Activity request guard change is compiled source, not signed installed evidence.
Phone editing remains hidden until that full UI path is verified; this checkpoint is
not the full cross-device objective.

## Real chooser and enabled installed phone controls

The real system-picker acceptance initially failed to find a shell-pushed file in
its starting provider. A later run reused the preceding picker task and was explicitly
stopped; its process-crash result is not counted as a pass. The harness now creates a
generated document through Android's Downloads MediaStore API, launches a fresh owned
activity, reports view IDs, and searches only for the unique generated filename.
That actual-phone run passed: the system chooser selected the file, supplied its
document URI, MainActivity's bridge returned the imported-copy record, exact chosen
bytes were retained, and the previous working copy remained unchanged. This tests
the real chooser/return path rather than directly supplying an InputStream.

Phone editing capabilities are now enabled for the tested native edit/import/continue
operations. Interactive file choice is not subject to the ordinary 45-second RPC timer.
An unavailable editor returns a plain instruction to import a separately edited copy.
The signed main package was updated in place without wiping data.

A further installed WebView/AYG test paired with a generated live owner and exercised
visible Browse, Open folder, Edit local copy and Save back buttons through the real
native bridge. It retained the working copy and saved receipt; independent inspection
of the owner's actual file found the expected UI-edited bytes. Only external ACTION_EDIT
launch was intercepted in that test; separate-UID URI editing and real picker behavior
have their own passed device checks. All generated listeners/test packages were retired,
and Papers reopened normally. The raw shell-generated test file and UI dump were removed.

This enables actual phone controls, but does not finish production peer/resource
onboarding, installed-editor-specific export behavior, background transfer lifetime,
mobile recovery inventory, later laptop source upgrades or the complete plan audit.

## Production owner readiness audit

The current desktop's installed ASAR was inspected directly: its main module lacks
the device-management and edit-lifecycle routes. Its actual bound AYG also lacks the
remote file view; its Proxima manifest does not declare remote domain sharing. Thus
passed generated-owner tests and receiving-device installation do not establish a
usable production desktop owner. Production onboarding is still incomplete.

The original desktop source is at `74229e9`, the ancestor used by this isolated
cross-device branch. It has no tracked local edits; unrelated untracked inline-office
evidence remains untouched. Actual active AYG/Proxima project bindings were read and
their manifest identities match the independently developed Backpacks. No creator
files, grants, or model records were changed by this inspection.

The complete current source suite passed 1,500 tests with four skips, typecheck passed,
and the supported unpublished owner installer finished successfully. Installer SHA-256:
`36e5f6219447c8df0732757ff6108bdc199875e4b04ee768511cf033baaf7816`.
ASAR SHA-256: `9c268106288d6fe6b3984021814916d7fa69bd8f9286ef3f4e6aa8de5f71ea25`.
It contains runtime source at `34ce0da`. Production desktop backup/install, approved
real resources, pairing, live Backpack source acceptance and the full plan gates remain.
The desktop app remains running; its profile and bound code were not replaced here.
