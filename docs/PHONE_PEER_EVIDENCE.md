# Native phone peer — 2026-10-14

Installed on SlopTop, LapDog and poordroid. Both PCs use the supported installer from
`release-phone-peer-20261014-final`; app.asar SHA256
`DA60F997E023D0D03D5545EE7600715E46973CA239A02A805EF3FA05EDAF93AB`.
Installer SHA256 `BDD1AED271FEC84E2B22EDB5FF9867FB89CF38004C65778DF05F1FC0987141E6`.
Desktop restarted gracefully with all three windows restored; laptop restored its one
window. Four Proxima modules and AYG remote-workspace-host were compared with installed
files ignoring line endings, reviewed, backed up and installed. Laptop originals match
the desktop originals. Source includes unrelated existing dirty work; nothing committed.

PhonePeerService owns a native, foreground connectedDevice server on 48240 and a low
importance sharing notification. It starts with the app and after boot. Reverse access
is derived from existing phone-to-PC grants; an authenticated announcement is checked
again against the creator's Tailscale account on the PC. Caller IP determines its
address. No supplied address is trusted. Android all-files access was granted with adb.
App private data and Android-protected directories remain governed by Android access.

Phone storage supports paging, stat, version-checked SHA256/content/ranges, verified
resumable uploads and keep-both publication receipts. Copy/move stage and verify before
publishing; delete retains a verified recycle copy before removing source. Durable
command identities are never automatically replayed after an ambiguous restart.
Interrupted mutation recovery is marked uncertain. Resource catalog persists IDs across
normal server restarts. Hidden transfer staging files are not listed.

The phone's existing IndexedDB and Proxima Store.command remain the facts owner. A
headless local WebView can execute that owner without the UI. Commands carry expectedSeq
and commandId and resolve after persistence. Replace backs up prior facts before writing
under the origin's write lock. PC-to-phone replacements are direct requests; the phone
no longer collects pending replacements from a PC. Previously queued files are retained
but not automatically applied. Proxima change notifications use an authenticated SSE
connection. Reconnecting that stream never queues or redelivers writes.

The desktop device service discovers an Android peer by asking a previously paired
phone to announce itself; this is discovery, not replacement polling. The new phone
peer appears in normal device listings, and its obsolete view-only published entry is
suppressed. Its Proxima opens through the existing full remote interface with control.
Phone As you Go uses revision-checked local state; shared-storage document references
are translated to share-relative paths on PCs and restored on save.

## Evidence

- Host typecheck passed. 17 focused gateway/store/client and phone trust tests passed.
- Real SlopTop-to-phone protocol/client check: 13/13 passed, including unauthenticated
  refusal, actual storage browse, native folder creation, truncated 8 MB upload with
  hidden partial, upload resume, lost-reply deduplication, ETag/range, verified phone-to-PC
  download, UI-independent Proxima snapshot, persisted command, stale refusal, push
  notification and fixture recycling. Repeated after concurrency/storage hardening.
- Isolated Android owner origin: 4/4 passed for command, replacement, stale replacement
  refusal and a durable backup containing the prior checkpoint. Creator facts were not
  overwritten for the replacement test.
- Desktop native phone discovery confirmed in its installed connection store.
- Follow-up host installation on both PCs includes inline As you Go device tabs;
  current app.asar is `B8110C3146FFFC92324BE0F675408D1B88926B956C1692E971FE8F37F2DBB371`.
  See `INLINE_DEVICE_TABS_EVIDENCE.md` for real-device restoration/closure checks.
- LapDog rendered the native Poordroid As you Go view inside its existing Files
  group. Native discovery was verified through the installed client's device IPC.

## Still to verify / limitations

Broader installed UI interaction on both PCs, laptop reverse file operations, phone cold restart recovery,
locked-screen/Doze reachability and actual battery cost require separate evidence.
No claim of zero battery cost or uninterrupted Android background availability is made.
In-place remote file editing sessions are not advertised by the phone; ordinary file
mutations and copy/transfer are available. Transfers can occupy additional staging/cache
space. SAF public download publication crash recovery remains separate unfinished work.
Search on phone-owned files is not implemented. Research and real-device catalogue
benchmarks are recorded in `C:\Users\admin\Documents\ChatGPT\Proximate\PHONE_SEARCH_ENGINE_RESEARCH.md`.
Ordinary native SQLite substring count queries measured 7.2–9.6 ms for 22,212 rows;
this is an engine benchmark, not end-to-end UI latency. Disposable research databases
and private fixture credential copies were removed after testing.

Test helpers: Android PeerCheck and PeerOwnerCheck; scratch protocol client at
`D:\Programs\evTEMP\probe-phone-peer.ts`. Private fixture credentials must not be logged.
