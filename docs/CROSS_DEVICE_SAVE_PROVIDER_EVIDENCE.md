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
