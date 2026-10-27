# Papers Android client

This is the filesystem receiving client. It packages AYG's independent remote
file view and keeps credentials and downloaded bytes on the phone. It does not
control the owning PC's Windows applications. The host gateway remains the
authenticated file authority.

Build with `node clients/android/build.mjs`. Configure `PAPERS_ANDROID_SDK`,
`PAPERS_ANDROID_JDK` and `PAPERS_AYG_SOURCE` for other development machines.
The default tool locations describe this creator's current Windows setup.

`clients/android/sign-local.ps1` creates/reuses a private signing identity under
the current user's local application data in `PapersMobileSigning`. Its password
is protected for that Windows user. Keep this identity for future APK upgrades;
never commit it or copy another user's app data as installation. Use
`-DeviceChecks` to build the separate signed instrumentation APK as well.

The packaged app targets Android API 36 and supports API 26 or later. This is
source/build compatibility; real device acceptance currently covers Android 12
API 31. Native credentials use Android Keystore AES/GCM. The WebView loads only
packaged first-party content and blocks network navigation. See the official
[WebView guide](https://developer.android.com/develop/ui/views/layout/webapps/webview)
and [cryptography guidance](https://developer.android.com/privacy-and-security/cryptography).

The current transport requires both devices to be connected to Tailscale. HTTP
requests accept only private Tailscale IPv4 addresses and refuse redirects.
Connection encryption is provided by that private network; do not publish the
host's plaintext listener onto the internet.

For generated-file device checks, start `tools/remoteDeviceFixture.mjs` with an
isolated absolute directory and private bind address. It writes a private
fixture description there; do not publish pairing codes, addresses or metadata.
Run the separate instrumentation against that fixture. Retire its owned listener
after checking offline behavior. A passed fixture is not complete product
acceptance; outstanding gates are tracked in the cross-device implementation doc.

## Flow embeds on the phone

`FlowEmbedServer` lets native Flow on this phone open files embedded in Flow pages and keep
interactive embed data. It listens on `127.0.0.1:47812` only (bound to IPv4 explicitly; some
phones resolve the loopback address to `::1`), and every request needs the pairing token: a
loopback port is reachable by every app on the phone. Pairing is creator-approved: Flow opens
`papers-mobile://pair-flow`, Papers asks for confirmation, then sends
`appflowy-flutter://papers-embeds?port=…&token=…` to Flow's package (`io.appflowy.appflowy`)
only. Routes: `POST /flow-embeds/exchange` (wants/docs, answered by the owner page's
`flow-embed-bridge.js`), `GET /flow-embeds/file` (managed working copy, `X-Embed-Hash`), and
`POST /flow-embeds/import` (bytes of a phone file Flow embeds, received into `flow-embeds`).
The server stores no content or sync state. The peer service now also restarts after this app
is updated (`MY_PACKAGE_REPLACED`); previously an update left sharing stopped until Papers was
opened. Build with `PAPERS_PROXIMA_SOURCE` pointing at the live Proxima project so the owner
page includes the bridge.
The owner engine starts with the peer service (not on the first request), because it also
fetches embedded Flow files as soon as they sync: the owner page runs the bridge's
`prefetch()` every 20 s, downloading any `flow-embeds` file not yet on the phone.
