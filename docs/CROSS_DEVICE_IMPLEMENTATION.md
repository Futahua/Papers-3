# Cross-device implementation checkpoint

2026-10-12. The complete requested experience remains defined by
[CROSS_DEVICE_PLAN.md](CROSS_DEVICE_PLAN.md). This checkpoint records implemented
source and evidence; it does not claim deployment or completion.

## Current source

- `src/main/backpacks/remoteFileResources.ts`: approved directories, opaque
  session resource identities, paginated listings, containment checks including
  external junctions, source-version checks and streamed SHA-256 digests.
- `src/main/backpacks/remoteFileGateway.ts`: narrow authenticated read protocol,
  separate device grants, immediate revocation, listing/stat/digest/content
  endpoints and checked byte ranges. No native application/control endpoint.
- `src/main/backpacks/remoteDeviceStore.ts`: persistent owner identity and
  per-device folder grants; five-minute single-use pairing invitations with
  bounded guesses. Bearer tokens are returned once and only their hashes are
  stored. Revocation persists. Corrupt identity/grant files fail closed instead
  of automatically restoring a backup that might resurrect revoked access.
- `remoteDeviceService.ts` owns startup/restart/shutdown for the gateway. It
  binds only to the active Tailscale IPv4 interface after explicit pairing.
  The trusted host Settings card chooses shared folders, issues an invitation,
  lists paired devices and persists revocation. Backpack pages cannot call the
  device-management IPC. The HTTP pairing handshake creates a persistent grant.
- This source is built but not installed. AYG/client UI, Android installation,
  transfer job persistence and broader ownership gates are still outstanding.
  The listener must never be bound to a public plaintext interface. Tailscale
  currently provides connection encryption; no public HTTPS deployment is claimed.
- Tests use real temporary files and HTTP requests. Eleven focused tests pass; Papers
  type checking passes. HTTP completion alone must never mark content verified:
  clients compare the full downloaded digest against the checked owner version.
- Production build passes. Full host suite: 1,459 passed, four skipped. The
  isolated checkout initially lacked the Electron runtime; concurrent test
  imports raced its installer. A serial runtime installation and full rerun
  passed. This was dependency setup, not a changed product test expectation.
- The actual Android phone is online in Tailscale and responded over a direct
  private-network route at 8 ms. This proves connectivity only, not installed
  client, file transfer, cellular performance or offline retention.

## Receiving clients and Android device checks

`remoteFileClient.ts` now owns saved receiving connections (Windows-protected
credentials in the production composition), cached listings, streamed download
jobs, checked range continuation, complete SHA-256 verification and local cache
opening. Corrupt content is refused. Shutdown aborts transfers and waits for
their handles. AYG's independent `remote-file-view.js` presents device choice,
remote navigation, live job progress and offline copies through its existing
file-capability bridge. It does not widen the page's network policy.

The Android client under `clients/android/` packages that same AYG view and uses
native HTTP/disk transfer machinery and Android Keystore protection. WebView
loads packaged assets only; remote content cannot navigate its native bridge.
Read-only content grants open verified cached files in receiving applications.
Signing identity lives in the creator's private local signing directory, outside
Git, and is reused for upgrades. Build artifacts and keys are ignored.

The signed Android 0.1.0 development client is installed on the actual API 31
phone. Native pairing, real private-network listings, a fully verified 1 MiB
download, offline metadata and the shared AYG UI passed device instrumentation.
Updating the APK preserved the pairing. An initial UI failure exposed Windows
aapt2's incorrect nested asset ZIP separators; assets now use portable JDK ZIP
paths and the device UI check passes. This is an isolated generated-file
acceptance fixture, not delivery of the complete creator workspace.
With the fixture listener stopped, another phone check passed cached listing
fallback, an independent full hash of the retained file bytes, pairing retention
through APK updates and the shared UI. The separate test APK was then removed;
the signed development client remains installed. The fixture listener is retired.

Current full suites: Papers 1,463 passed / four skipped; AYG 2,028 passed, plus
eight visual preflight checks. Fifteen focused host checks cover pairing,
authorization, versions, digest/ranges, receiver resume, offline bytes and
identity stability across gateway restarts. Phone process-death/background
recovery, cellular throughput, actual creator locations, remote mutations,
Proxima projection/follow and laptop installation still need acceptance.

## Real laptop file trials

Generated incompressible 128 MiB file, isolated desktop directory, authenticated
read-only Copyparty v1.20.25, desktop-to-laptop over the existing Tailscale path.
The laptop wrote real files and checked complete SHA-256 content. No creator
files participated. Official Copyparty and rclone release hashes were verified.

| Client | Streams | Time (seconds) | Mbps | Integrity |
| --- | --- | --- | --- | --- |
| Node HTTP to disk | 1 | 13.481 | 79.650 | SHA-256 passed |
| Node HTTP to disk | 1 | 13.688 | 78.444 | SHA-256 passed |
| Node HTTP to disk | 1 | 14.149 | 75.888 | SHA-256 passed |
| rclone v1.75.2 HTTP | 1 | 13.517 | 79.435 | SHA-256 passed |
| rclone v1.75.2 HTTP | 4 | 12.428 | 86.396 | SHA-256 passed |
| rclone v1.75.2 HTTP | 4 | 13.896 | 77.272 | SHA-256 passed |

A separate supported-range test retained the first 32 MiB, requested the
remaining bytes, appended them and verified the complete file (13.424 seconds
total). This demonstrates range continuation, not crash/background recovery,
automatic job persistence or protection against a changed source. Those need
the checked source-version protocol and client persistence tests.

These small trials do not establish a winning provider, WAN/cellular speed,
same-path independent network capacity, bidirectional performance or control
latency under load. The earlier RAM-only probe is not a directly comparable
disk baseline. Increased concurrency has not shown a consistent advantage.

## Next required work

Verify the built host pairing UI on an isolated installed-runtime fixture.
Integrate AYG's remote-location client, verified resumable downloads,
offline manifests and owner-side checked mutations. Implement Proxima's domain
projection/import/follow at its existing command owner. Verify real phone
connectivity, build the Android client and use the supported Papers installer
on the laptop with state-preservation checks. Complete the plan's device,
transfer, recovery, ownership and installation gates before calling it done.

## Laptop installation checkpoint

The actual laptop now runs the supported NSIS installation of packaged commit
`91dfc30` (Papers 1.3.11). The delivered installer passed its complete SHA-256
check, and the installed `app.asar` exactly matched the tested package. A live
semantic inspection confirmed the packaged build, restored authoritative window
and retained project surfaces. Normal launch subsequently produced a responsive
Papers window with the developer endpoint absent.

The old laptop build used a portable profile. Its own profile was migrated on
the same laptop after a graceful close, with recovery copies and byte-for-byte
SHA-256 verification of 3,183 files. No desktop profile, browser credentials or
live database was copied to the laptop. The old build and original profile stay
available for recovery. The first NSIS attempt misread forward-slash destination
separators; verification refused success. Native Windows separators corrected
the destination, and the actual uninstall record now points to the intended app.

AYG public code from `7b34f1d` was delivered separately. The laptop's real document
passed model compatibility checks retaining both groups and all six shortcut
identities. Its state hash remained unchanged during code delivery; project
configuration, actions and existing icon assets were retained. Original project
copies are preserved in the local recovery directory. Other Backpacks have not
yet received their upcoming cross-device domain features.

An actual shutdown regression remains open: the diagnostic run completed every
window save/finalization and service shutdown stage, removed its endpoint and
retired all renderers, yet left its idle main/GPU/network processes alive. The
quiesced main was retired only after those conditions were verified, and normal
Papers was reopened. This must be reproduced and repaired before calling the
installation/upgrade lifecycle complete. Temporary transfer listeners are closed.

Follow-up source evidence: a minimal Electron fixture and a full isolated Papers
fixture with a synthetic AYG workspace both exit normally. The latter opens the
workspace through the semantic control contract, closes the main window, observes
process exit and records an empty remaining-window list. This does not reproduce
or explain the laptop incident. New shutdown diagnostics record remaining owned
window IDs/visibility after service retirement to make the next incident decisive.

Close-time save failures previously reached terminal teardown even after a
refused flush. Source now preflights every live project writer before retirement,
persists the window's pages, and requires strict successful teardown. A rejected
save keeps the window open and permits retry, with a visible error. Focused tests
cover retained authenticated views, failure across multiple surfaces and retry.
These source changes are not yet installed on the laptop.
The focused save/lifecycle checks pass (43 tests), type checking passes and the
production build passes. The subsequent full suite reports 1,466 passed, four
skipped and one failure: the unchanged native pane-discard geometry fixture
throws `Native peer refused requested geometry`. An isolated rerun fails too;
do not attribute it to parallel load or claim a green release gate. Its cause
still needs decisive native geometry evidence. No native production code or
geometry fixture was changed by the save-safety work.
