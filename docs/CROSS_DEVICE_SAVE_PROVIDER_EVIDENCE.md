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
