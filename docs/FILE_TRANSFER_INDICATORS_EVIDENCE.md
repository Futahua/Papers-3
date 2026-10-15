# File download and transfer indicators — 2026-10-14

Creator-directed scope: phone lens replacement downloads selected real files/folders into a phone directory explicitly chosen through Android's folder picker. Invalid/unwritable destinations refuse download. Preserve folder structure, including empty folders. The destination is editable from the device popup and by clicking the destination name in the progress panel. Active/paused batches retain their original destination. Also show PC indicators for local copy/move and between-device downloads. Android app uses Papers' own icon.

## Implemented and installed

- AYG phone-downloads.js replaces only the phone lens. Compact panel shows filename, overall size/progress, speed, destination, pause/resume, and hide. Destination chooser row stays horizontal without broad button restyling.
- Phone host resolves selected PC paths and recursively lists selected folders, deduplicating resources. No remote file is changed by download.
- PhoneDownloads.java stores durable batch state, saves verified transfers into the user-granted SAF tree, creates subfolders, preserves empty folders, and keeps both on filename collisions. Partial export is removed on failure; only finished exports advance the batch. Process restart marks unfinished batches paused; resume retains the original directory. The existing downloader checks source version, exact content range on resumed requests, length and SHA-256.
- Cache writers are serialized per owner/resource/version to avoid cancel/retry races writing the same partial file.
- PC transfer-indicators.js observes existing local/remote copy/move operations. It dispatches each operation once. Local byte progress/speed is sampled from destination file sizes; known pre-existing targets are not counted as newly transferred without an observable change. Inaccessible/unmeasurable paths show an indeterminate indicator rather than fabricated bytes. Between-device downloads use native job received-byte counts. No transfer is retried by the indicator.
- Both PC Backpack copies deployed through comparison against prior installed files (line endings ignored), backups, graceful shutdown and window restore; no Papers host installer was rerun. Desktop restored 3 workspaces, laptop 1.
- Android compiled, signed using existing key, installed with adb -r. Manifest now references res/drawable/papers.png, copied from the host's assets/icon.png; aapt2 badging confirms application icon.

## Verification

- tools/probeTransferIndicators.mjs passes: real browser local-copy indicator reaches Copied from increasing destination sizes, issues one copy call; phone lens replacement, invalid-folder refusal and destination-picker route pass.
- Real phone: recursively downloaded 16,777,251 bytes (16 MB file, nested note and empty folder) into the creator-selected Download/Test tree. Saw transferring/saving/completed phases and increasing bytes. Destination large.bin SHA-256 080acf35a507ac9849cfcba47dc2ad83e01b75663a516279c8b9d243b719643e matches PC original. Nested and empty directories present.
- Real phone: 64 MB download paused, remained paused, resumed and completed. Export SHA-256 3b6a07d0d404fab4e23b6d34bc6696a6a312dd92821332385e5af7c01c421351 matches PC original.
- Test exports were removed from Download/Test; the creator's folder setting and other files retained. Temporary adb forwarding and delivery server stopped.
- AYG icon-asset tests 4/4; main module and navigator syntax checks pass.

Limit of evidence: PC indicators were browser-tested with isolated byte growth and installed on both PCs. A real local Opus transfer and a real PC-to-PC download were not triggered in the creator's desktop windows. Local overwrite/collision cases whose file size/timestamp cannot establish completion remain waiting for confirmation rather than falsely reporting completion.

Source changes remain uncommitted alongside earlier PC control and concurrent mobile work.
