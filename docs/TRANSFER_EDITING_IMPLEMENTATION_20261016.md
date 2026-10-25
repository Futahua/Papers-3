# Transfer and deliberate editing implementation — 16 October 2026

The implementation uses official tus engines for resumable HTTP bytes: `@tus/server` 2.4.5 and `@tus/file-store` 2.1.1 on Windows, `tus-java-server` 1.0.0-3.3 on Android, `tus-js-client` 4.3.1 and `tus-java-client` 0.5.1 for sending. Android dependency URLs and SHA-256 hashes are pinned in `clients/android/lib/dependencies.json`. Existing pairing, scoped shares, transfer controls and checked disk publication remain their owners. No directory synchronization or deletion propagation is introduced.

Windows persists upload URLs and receiver publication receipts. An interrupted attempt asks the receiver for its offset; a repeated publication request returns its prior receipt. Destination reuse first filters the requested filename/collision family and size, then compares actual SHA-256 bytes. Different content preserves keep-both naming. File completion and AYG linking remain distinct; a failed AYG save must not delete a successfully received physical file.

The existing edit sessions, immutable snapshots, save receipts and working-copy journal now carry owner-held assignments. **Edit on…**, next to Reveal, chooses an authorized paired editor. The original owner serializes assignment, checked publication and stop. Each save checks the assignment generation and actual source version. Windows uses Chokidar with replacement-save handling; Android uses its existing foreground peer service and editable content provider. Further confirmed revisions retain the same editor working path. Stop retains the last owner-accepted file and preserves unsent local edits. A controller can assign a different editor and can stop it.

Default preview artwork comes from the physical owner's bounded preview/app-icon service. Rendered document thumbnails carry a small actual file/application icon badge; plain application icons do not receive redundant badges. Authored artwork retains precedence.

## Verification

- Full Papers suite: 1,555 passed, four skipped, before the final two-line dormant-presentation correction. The extended native executable regression subsequently passes last-window closure, all-dormant remount and explicit-minimization preservation.
- Full AYG suite: 2,086 passed after UI integration.
- Real HTTP engine checks cover partial upload restart, offset disagreement, final response loss, receiver restart, repeated publication, revocation and official JS-client upload/reuse.
- Actual HTTP editing fixture covers a third controller assigning an editor, two successive automatic write-backs, stop and retained unsent changes.
- Seven checks pass on the Samsung Android 12 handset, including Java tus partial persistence/restart, checked publication, repeated save receipt and third-device stop. The Android build preserves servlet ResourceBundle properties required at runtime.
- JVM interoperability checks exercise the official JS client against the Android servlet bridge/Java engine.

These checks do not prove arbitrary sudden power loss, every disk-full/permission failure, whole-folder atomicity or all combinations of independent application writers. Android cannot enforce a mandatory lock against unrelated native applications; actual target/hash checks and retained snapshots remain necessary. The Android sending client retains the resumable URL for retry; continuous automatic foreground retry across every disconnect is not claimed. Legacy peers retain the previous compatible transport until updated.

Installation receipts are kept under the temporary `tus-20261016` recovery folders on each PC; these verify the installer/app hashes and unchanged profile/Backpack bytes. The Android APK was installed and instrumented on the reconnected handset. Final PC deployment status belongs in the delivery evidence, not an assumption inferred from source tests.

## Verified deployment

Both PCs were updated through the supported installer after normal, flushed shutdown. Installed app.asar SHA-256 on SlopTop and LapDog: `f8bf73149bdb934df73dfd4880ce42cd744beecefc685f45acd4eacfc13e88aa`. Installer SHA-256: `9b00a6a3d8f8e31ebc4d1f4119f66c287d013f485885eb06dc4edb99a5b1c800`. Recovery receipts confirm unchanged profile/Backpack bytes (SlopTop roots: 15561/1808/15670/786/469 files; LapDog: 6141/175/31). Three AYG public assets were separately backed up, installed and hash checked on each PC. Retained Workspace pages were reopened; the installed SlopTop host returned editing status and authorized device choices, and its AYG rendered Edit on. The handset's updated APK was reopened after all seven instrumentation checks passed.

Dormant native-group preservation is included in this PC build: last-peer closure and remount retain authored presentation. Missing app windows remain dormant tabs. This does not relaunch arbitrary native applications or guess whether an earlier saved minimized state was automatic or deliberate.
LapDog installed verification also returned editing=true with authorized device choices and one Edit on control in its retained Workspace.
