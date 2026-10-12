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
