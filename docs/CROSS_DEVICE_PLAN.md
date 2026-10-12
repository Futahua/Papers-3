# Papers across devices: experience, research and delivery plan

Planning document, 2026-10-12. Reference under [AGENTS.md](../AGENTS.md), the sole governing document. This combines the initial architecture report, the subsequent broad discovery pass, and the creator's practical requirements. It replaces their competing provisional recommendations with one plan. Product requirements are stated below; provider choices and numeric performance targets remain proposals until validated. These features are not installed merely because they appear here.

## The experience to deliver

Papers should put the creator's actual computers under their fingers from another PC or Android, with immediate-feeling controls and transfers that make good use of the available connection. Each machine retains its real files, installed applications, credentials and working state. Agents handle architecture, setup, compatibility and recovery; the creator should not need to manage internal services, database copies or protocol choices.

The current desktop, the laptop and the phone are the first acceptance devices. Local Lapdog has been verified as access to the separate laptop. Their availability removes the need to treat a loopback demonstration as two-device acceptance. Native Windows actions, live Backpack access, content transfers and selected data replication are distinct experiences; none defines a mandatory implementation for every Backpack.

### Connect and choose a machine

1. Install Papers and the desired independent Backpacks on another PC. Pair it with an existing trusted machine using a short code or QR flow. Give each device a recognizable name.
2. Open a device from Papers and see the Backpacks, files and operations made available by that owner. Device access, shared resources and remote desktop control remain distinguishable, even if onboarding offers them together.
3. Open the same live experience from the laptop or phone. Desktop controls preserve keyboard/mouse behavior; Android gets deliberate touch navigation, legible controls and a suitable layout. Window streaming is available where the actual native application is needed.
4. Reconnect without repeated setup. Show Online, Reconnecting or Offline accurately. An unavailable machine must not look like an empty workspace or erased files. The creator can revoke a paired device without rebuilding projects.

Public internet exposure is not required for this experience. Pairing does not imply publishing every disk, credential or local service. A newly installed PC receives working software and its own identity, rather than another machine's live profile.

### As you Go: another machine's real files

The creator explicitly wants remote access, not wholesale folder mirroring. Each AYG remains owned by its machine.

| User action or situation | Required result |
| --- | --- |
| Open Desktop's AYG on Laptop | Browse the owner's real files and AYG references in a recognizable remote view. The owner remains visible. Listing and navigation do not download all file contents. |
| Browse, search or preview | Fetch the needed metadata and content on demand. Prefer owner-generated thumbnails or derived previews when they avoid transferring a large original just to inspect it. |
| Create, rename, move or edit while online | The owning PC performs and confirms the actual operation. Local references to that file continue to be governed by their AYG/Papers owners. |
| A move or save takes time | Show activity immediately, then measured progress when available. Distinguish Queued, Waiting for application, Transferring, Verifying and Completed. A request being accepted is not completion. |
| Open a file in a native Windows application | Open/control it on its owner when that is the suitable editor. Existing installed applications remain content owners; do not rebuild their interfaces just to satisfy remote access. |
| Edit using a local working copy while online | Treat this as an explicit edit session. Save back only after checking the owner's current revision; preserve both versions when it has changed. An ordinary download is not implicit writeback. |
| Download / Keep available offline | Retain the complete verified selected file version and needed listing metadata. Keep it in the same remote workspace with its source identity. Expose the destination and actual cache/download state. |
| The owner goes offline | Previously retained content remains readable; unavailable content is clearly marked. Disable live remote mutations. Preserve unsaved work from a disconnected edit session locally without pretending it was saved to the owner. |
| Save an independent local copy | Create local content deliberately and distinguish it from a cached remote version. Do not silently reconnect it as a writer of the original. |
| Remove an offline copy | Remove local cached content only. Deleting the owner's file is a separate operation against that owner. |
| Reconnect after external changes | Refresh affected entries, mark stale cached versions and retrieve new content according to pin/cache policy. Never silently present an old version as current. |

Cached listing structure can be available offline without all its file contents. A preview or a sparse read cache is not proof that an entire file is available offline. AYG owns pinning, eviction, source labels and cache-versus-independent-copy semantics.

### Proxima: own data, view others, copy selected facts

Every PC has its own authoritative Proxima. A remote Proxima view displays the other machine's facts and changes but does not expose ordinary local edit controls against those remote records. Copying imports into the receiving machine's Proxima through that machine's command owner.

| User action or situation | Required result |
| --- | --- |
| Open another PC's Proxima | See its current projects, tasks, calendar and timeline data, with source/availability shown. Viewing does not adopt the other PC's layout. |
| Copy selected entries | Preview exactly which records and relationships will be imported. Preserve their approved domain values and source lineage; create a locally owned import without duplicate retries. |
| Copy all data | Import the complete approved domain projection atomically. This is not copying a live IndexedDB directory, browser profile or machine settings. |
| Make an independent copy | Future source edits do not overwrite this local work. |
| Choose Copy and follow | Recommended opt-in behavior: update an untouched local copy when its source changes. Following is limited to deliberately selected records, never every new record on a machine. |
| Edit a followed copy locally | Keep the local edit. Hold a conflicting source update for a clear Keep mine, Use source or Save both decision; do not silently overwrite it. |
| Source is offline or deletes the record | Keep the local copy. Show source availability or source deletion; deletion does not silently delete local work. |
| Change local zoom, selection or layout | Leave the source and follow/conflict status unaffected. |

Exact copying means fidelity of approved data values. A byte-for-byte raw backup is a separate recovery artifact with a deliberate restore workflow; it must not become ordinary cross-device synchronization. IDs are qualified by origin/lineage so equal record IDs from different machines cannot collide. A copied running interval is not a second timer silently ticking as a new local activity: preserve a source-linked read-time projection while following, or explicitly import a fixed snapshot when independent. Queue imports must include their necessary members/relationships, or clearly preview a standalone snapshot; never leave dangling references.

Follow is a proposed UX choice to expose alongside independent copy. The pasted discussion supports clean-copy following, but does not authorize automatically converting every import into a subscription. Implementation must preserve that distinction.

### Remote control and live data

The creator wants control and data access from other PCs as well as the phone. Provide recognizable access to the existing owner's Windows session, native applications and supported operations. Clipboard, keyboard shortcuts, touch input, multi-monitor selection and session disconnect behavior need actual device acceptance.

Remote desktop control intentionally operates the owning PC; a remote Proxima data view remains read-only. These paths must not be confused. Native control should not implicitly open a separate Windows session, discard attached windows, or steal a local user's input through an invisible background action. Show the active controlled machine and retain explicit local/remote session boundaries.

For ordinary Backpack controls, render hover, scrolling, drag previews and animation locally. Send meaningful commands and receive state changes. Use a stream of a native application where appropriate. No one transport or presentation model is imposed on every Backpack.

## Performance and observable behavior

The creator explicitly values making full use of the internet connection. Optimize useful delivered content and task completion, while preserving responsive interaction. No arbitrary application transfer quota or mandatory cloud-storage hop is part of the design.

- Prefer direct LAN or internet peer connections; use an encrypted relay when direct access is unavailable. Report the route in diagnostics so a relay bottleneck is not mistaken for an application bug.
- Separate interactive commands/events from bulk transfer queues. Bound memory, use backpressure and adapt parallelism. More streams are not automatically faster, and concurrent channels still share the same physical link.
- Time to first usable listing/preview matters separately from completing the full content transfer. Batch metadata and small-file work to avoid paying a round trip per item.
- Preserve verified completed portions across interruptions. Transfer identity includes the source version; resumed ranges from a different version cannot be spliced into one file.
- Display bytes transferred and actual progress immediately. If a native application or external confirmation owns the next stage, say what is being waited for; use indeterminate progress when no total is known.
- A failed operation leaves the original intact and a useful recovery state. Completion comes from the durable owner, not from optimistic UI or a launched external process.

For large incompressible files and sufficient disks/CPU, the proposed target is roughly 90% or better of a same-path network baseline. This is a test target, not an achieved result or guarantee against an advertised ISP tier. Track both MB/s and Mbps with explicit units, plus p50/p95 latency under load. Source upload, destination download, Wi-Fi, relay capacity, disk throughput and CPU all constrain the available rate.

## Current implementation and ownership

The source audit identifies integration seams, not implemented networking:

| Truth or lifecycle | Current owner | Cross-device responsibility |
| --- | --- | --- |
| Backpack bindings, assets and checked opaque state saves | [backpackProjectService.ts](../src/main/backpacks/backpackProjectService.ts) | Serve approved surface assets and dispatch to the real state owner without inventing a universal Backpack schema. Preserve hash/CAS and atomic replacement. |
| Real files, Opus operations, previews and native providers | [fileCapabilityService.ts](../src/main/backpacks/fileCapabilityService.ts) | Reuse the existing capability owners for committed operations. A transfer provider supplies content/staging, not a bypass around revision checks or installed editor behavior. |
| Declared local services and their credentials | [localServiceBridge.ts](../src/main/backpacks/localServiceBridge.ts) | Remain loopback-scoped. A remote gateway gets an explicit contract; do not expose every declaration or widen all Electron IPC to the network. |
| Proxima structured mutations and durable facts | Independent Proxima `public/store.js` and `public/persistence.js` | Commands own imports and edits; current durable facts use IndexedDB. Its historical DATA-PLANE.md service destination is not already deployed. |
| AYG remote view, cache and reference policy | Independent AYG project | Own listing presentation, pinning, source/version metadata, offline restrictions and local-copy behavior. |
| Pairing, device access and remote-operation sessions | Proposed reusable Papers host capability | Own authentication, authorization, protocol lifecycle and dispatch only. Backpack-specific replication belongs in that Backpack. |
| Desktop display/input streaming | Selected existing remote-control provider | Own its actual capture/input/session machinery. Do not make it own Backpack data or file replication. |

Some current file capabilities rely on Directory Opus on the owner. An unavailable dependency is an honest capability limitation, not a reason to invent a silent alternate move/copy implementation. Install and verify the needed provider on each PC.

### Data projection and authority

Proxima exports use an explicit allowlist. Candidate domain fields include project/task names and notes, checked/status values, dates, deadlines, recurrence, relationships, intervals and meaningful queue membership/order/weights. Meaningful content colors can travel; viewport coordinates, pane sizes/splits, row packing, filters, selections, zoom, navigation and runtime process/window IDs stay local. Audit manual row order separately from queue sequence. Do not export queueReturn/enqueueReturn recovery snapshots as shared facts or send local undo history.

Compute a domain-only revision/hash for following. Existing broad revisions may include unrelated presentation edits and must not create false conflicts. Replication metadata records source device/entity, last applied domain version, local divergence and held source deletion/update. Do not infer ordering from different devices' clocks or echo an imported update back as a new source edit.

Backpack imports must be idempotent and atomic at their command owner. Stage an import, resolve dependencies, validate the whole candidate, then commit once. An interrupted import does not create half a queue/project or duplicate records. Local undo follows that local owner's policy and cannot reverse an unrelated remote command.

For file reads, use a stable owner-version token and verify completion. For writes, stage content on the owner, recheck its current revision, then replace through the existing durable operation. External writers can change real files independently; fingerprints, watcher reconciliation and editor/provider locks must account for them. File identities must distinguish renames from replacements; do not promise a Windows file ID survives copy, deletion or movement across volumes.

### Connection and operation contract

Use a small versioned remote-operation boundary, with authenticated device/session identity, opaque resource IDs, request/command IDs, expected revisions, cancellation and structured refusals. Pairing does not transfer provider secrets. A paired client receives only the capabilities granted for that device/resource. Keep provider credentials in their current owning machine/service.

Initial snapshots and change notifications need a coherent checkpoint and monotonically sequenced owner events. On reconnect, resume after the last acknowledged sequence when possible; otherwise retrieve a new snapshot. Avoid the snapshot/subscription gap and deduplicate replayed events. Retry a mutation only with a stable idempotency key; resolve an ambiguous commit before accepting a second fresh act.

Remote-session retirement closes that session's streams and transient leases, preserving other clients and unsaved work. Define whether a live Backpack must remain open or can execute without a visible renderer. The first slice can report an unavailable execution owner honestly. Any later headless Proxima service must migrate through its existing command semantics, with backups and parity evidence; a host-side second IndexedDB writer is not an acceptable shortcut.

## Provider choices to validate

The research supports a hybrid design with interchangeable providers behind concrete seams. It does not establish a universal fastest stack.

| Need | First comparison | Decision rule |
| --- | --- | --- |
| Device connectivity | Existing Tailscale; NetBird if self-hosted coordination is needed | Start on the working route; measure direct and relayed paths separately. Change providers for a demonstrated UX, throughput or operating benefit. |
| File serving and transfer | Copyparty + rclone versus a standard resumable HTTPS baseline; Syncthing/Sushitrain for incremental reuse | Prefer an existing maintained worker/provider if it meets ownership, versioning, progress, verification and throughput requirements. No global folder mirroring by inference. |
| Native desktop control | RustDesk and MeshCentral; Sunshine/Moonlight for graphics-heavy work | Test actual applications, input latency, desktop-session behavior, clipboard and displays. Guacamole is the browser RDP/VNC gateway alternative. |
| Browser-only/direct or deeply integrated networking | WebRTC/libp2p, native iroh, commercial Nabto/RPC components as appropriate | Add when a concrete accepted experience requires it. Browser and native limitations differ; a protocol name or headline benchmark is not a selection result. |
| Proxima copy/follow | Proxima's command owner plus a domain projection | Respect independent per-machine authorities and explicit conflict decisions. Automatic collaborative CRDT merging is not required by the specified behavior. |

Copyparty's file server and rclone's parallel transfer/cache machinery are the leading new reuse candidates from the broad pass. Trial their supported distributions/APIs before copying source or forking a product. Initially serve scoped read content and isolated upload staging; changing arbitrary owner files through an unmediated provider would break the intended commit boundary.

Rclone's full VFS cache can contain only the ranges read from a remote file. It does not itself guarantee a pinned complete offline version or AYG's offline read-only policy. Its Windows mount uses WinFsp; make that a verified optional capability, not a prerequisite for simple browsing/downloads. A cache must have one writer and separate identity for each owner/version.

## Delivery stages and acceptance gates

Stages describe work that can be independently reviewed. Keep existing local behavior working throughout. A stage is complete only when its evidence satisfies the gate.

| Stage | Concrete deliverable | Acceptance gate |
| --- | --- | --- |
| 0. Device readiness and baseline | Identify desktop/laptop/phone, connections and actual available runtimes; isolated measurements | Real two-PC reachability and bounded probes recorded; no creator-data changes. Phone network/client status verified separately. |
| 1. Transfer-provider comparison | Isolated fixtures for Copyparty/rclone, HTTPS and the incremental candidate | Same path/data/disk conditions; large/small/changed files, interruption, integrity, source revision changes and control latency. Choose one practical provider from results. |
| 2. Pairing and remote read access | A device catalog plus one AYG remote location, metadata and preview | Laptop and Android browse actual approved owner content. Offline/reconnect states are honest. Local AYG and its dependencies retain accepted behavior. |
| 3. Downloads, pinning and recovery | Visible jobs, resume and complete offline versions | Cached content is usable in the same remote view offline; unavailable content is distinguished; eviction does not delete owner files; repeated jobs do not duplicate or corrupt content. |
| 4. Remote file mutations and edit sessions | Checked owner-side create/rename/move/save operations and staging | Native asynchronous operations show immediate progress and actual completion; stale saves preserve original/work; disconnection and external edits recover correctly. |
| 5. Proxima remote views and imports | Domain projection, selected/complete import preview and one atomic command path | Remote view remains read-only; approved values/dependencies are preserved; layout/runtime/undo do not travel; retries and interrupted imports remain atomic. |
| 6. Explicit following and conflicts | Per-selection follow choice, lineage and retained incoming changes | Untouched copies follow; local edits remain; Keep mine/Use source/Save both and source deletion have deterministic outcomes; no replication loops. |
| 7. Native remote control | Integrated existing provider and visible control session | Test actual owner Windows applications on Laptop and Android; keyboard/clipboard/touch/display, disconnect and unsaved-work behavior pass. |
| 8. Fresh-machine installation and upgrades | Supported Papers installer, separately versioned Backpack delivery, capability readiness | Fresh laptop setup and upgrade preserve local work/pairing, report dependencies clearly, and recover from interrupted install. Do not transfer live profiles/secrets as substitutes for installation. |

Stage 7 can be evaluated independently while the data path is built; it cannot stand in for file/projection acceptance. Stage 8 starts with a fresh-machine fixture early enough to expose packaging requirements, rather than waiting until the final feature demonstration.

The initial production slice is deliberately concrete: open one remote AYG location from Laptop, see an owner change, preview/download one file, interrupt/resume it, and read its pinned version offline. Follow with one selected Proxima import through its actual command owner. Broader access expands after those owners and recovery paths are proven.

## Benchmark method and initial device evidence

Use generated incompressible content and isolated directories, never the creator's working files. Compare single large files, many small files, and a small edit to an existing large file. Record software versions, route, Wi-Fi/cellular/Ethernet, CPU/memory, storage rates, transferred versus useful bytes, time to first content, total time, p50/p95 control latency, and final verification. Run repeated trials in both directions; preserve raw results. Public evidence excludes device addresses, tokens, private paths and creator content.

Measure a same-path network baseline independently of a candidate transfer engine. Compare LAN/direct internet/forced relay separately. A phone on home Wi-Fi is not a cellular test, and two nearby machines do not establish WAN throughput. Hardware or relay bottlenecks should be diagnosed before increasing parallelism or replacing an engine.

### Preliminary probe on 2026-10-12

Local Lapdog returned the laptop's separate machine identity and working shell. Tailscale, Node, Python and Git were available there. Desktop Node was v24.14.1. A temporary Node HTTP fixture served only generated RAM content, bound to the desktop's private Tailscale interface and allowing the laptop peer. The client consumed 128 MiB per case without writing file content to disk, while checking a small health endpoint every 200 ms. The client exited successfully; the owned desktop listener was then stopped. No app source or creator data was edited on the laptop.

| Case | Received | Time | Transfer rate | Health samples / failures | Health p95 |
| --- | --- | --- | --- | --- | --- |
| One stream | 134,217,728 bytes | 11.141 s | 96.378 Mbps / 11.489 MiB/s | 54 / 0 | 57.948 ms |
| Four streams | 134,217,728 bytes | 10.949 s | 98.065 Mbps / 11.690 MiB/s | 54 / 0 | 54.518 ms |

Active physical links reported desktop Ethernet at 1 Gbps and laptop Wi-Fi at 286.8 Mbps. Those are negotiated link values, not measured end-to-end capacity. Four streams produced about 1.8% more throughput in this single pair of trials. This does not identify the limiting component or prove a benefit from four streams generally. An earlier reachability ping returned a direct response at 3 ms; the transfer's route was not independently sampled throughout, so do not infer its exact path from that ping.

This is a synthetic two-device application probe, not an independent network baseline, disk transfer, candidate comparison, integrity/resume test, remote-control latency measurement or internet/cellular result. The roughly 58 ms p95 health response is not a measured click-to-visible-action time. These distinctions must remain in any future summary of the numbers.

ADB subsequently confirmed one authorized physical Android phone, Android 12 / API 31 / arm64-v8a, with no unauthorized or offline devices. Use this actual device as a compatibility gate: the selected client/provider must support API 31 and arm64, and its real download/background/disconnect behavior must be tested there. ADB/USB access proves a development path, not remote Wi-Fi or cellular connectivity; USB forwarding must not be counted as internet acceptance.

Phone network/product testing and clean installation remain open. The creator has the phone and laptop available and has authorized use of Local Lapdog. Future laptop work should continue through that connector, using isolated fixtures and its applicable project rules. Codex Remote/SSH is an optional agent access route, not a dependency of Papers' own remote product.

## Setup, updates, storage and recovery

Use [the supported Papers update procedure](UPDATING_PAPERS.md) and [the new-machine inventory](NEW_MACHINE_SETUP.md). Inventory current source rather than treating old dependency entries as timeless; the native picker and retired Delegate Wave descriptions in historical material need verification against their present owners. Installing an application alone does not prove that its CLI, COM or preview integration works.

Persist device identity and pairing in a host-owned machine-local store, separate from provider credentials and Backpack data. Cache files/partial transfers are reconstructable; pinned offline content needs a deliberate retention policy and must not be mistaken for expendable preview cache. AYG persists cache manifests and source versions; Proxima persists approved facts and replication metadata under its own durable owner. Project code, browser profiles, runtime HWND/PID state and secrets are different categories.

Version host/provider/Backpack/client contracts independently and negotiate supported capabilities. An unsupported operation or unavailable native editor gets a truthful response rather than silently installing everything or returning an empty result. Upgrade contracts without invalidating pairing or replacing another machine's authored work. Back up before durable-data migration; validate replacements before retiring the old owner, and preserve a recovery path.

## Research: what was searched and what was learned

The first report chose candidates from prior knowledge, then checked primary documentation/code. The creator requested a broader discovery pass. That pass began with problem descriptions, included open-source projects and commercial SDKs, and followed search leads to official documentation/repositories. Its candidate screening checked platform coverage, ownership fit, connection paths, partial transfer/cache behavior and integration cost. Repository age, activity and test/workflow presence are signals, not proof of quality; no upstream test suite was run in this research.

The following representative query list preserves the broad discovery method from the working report. Named-product queries were used afterward to verify the discovered candidates, not as the starting shortlist:

- `open source framework connect devices remote application interface file access peer to peer`
- `open source remote workspace access applications files desktop mobile architecture`
- `open source on demand remote file streaming selective offline cache`
- `embedded peer to peer networking SDK desktop mobile browser`
- `device to device connectivity SDK NAT traversal encrypted embedded application`
- `remote access platform web applications desktop file browser self hosted`
- `remote filesystem on demand cache Windows open source`
- `low latency remote desktop SDK application streaming Windows Android`
- `self hosted peer to peer mesh network remote access alternatives`
- `remote file manager existing directories SFTP WebDAV streaming open source`
- `browser remote desktop terminal file transfer agent open source`
- `peer to peer networking libraries comparison QUIC JavaScript Rust Go`
- `JavaScript peer to peer networking library NAT hole punching`
- `embedded secure device connectivity SDK no VPN client`
- `high throughput file transfer software saturate bandwidth parallel WAN open source`
- `large file transfer high latency network parallel streams benchmark`
- `peer to peer file transfer resumable streaming high speed SDK`
- `file server existing directories REST API SFTP WebDAV Windows`

| Candidate | Verified capability / limitation | Reuse assessment |
| --- | --- | --- |
| [OpenChamber](https://github.com/openchamber/openchamber) | Mobile build reuses web assets; HTTP/WebSocket traffic supplies live data; custom encrypted relay and flow control | Useful pairing/reconnect reference. Its agent-workspace API is not Papers' operation model. Reusing the UI delivery approach does not require importing the whole product. |
| [Tailscale](https://tailscale.com/docs/reference/connection-types) | Encrypted direct connections, peer/DERP fallback; ordinary Android client uses the VPN slot | Existing working connection is the first comparison route. Relay throughput and Android coexistence must be tested. |
| [NetBird](https://docs.netbird.io/about-netbird/how-netbird-works) | Direct WireGuard peers, hosted or self-hosted coordination, signaling and relay | Main additional network candidate where self-hosted coordination has a demonstrated benefit. |
| [Pangolin](https://docs.pangolin.net/about/how-pangolin-works) | Browser resources and installed private clients; private clients attempt direct access and can relay | Candidate for unified browser/private resource access. Do not conflate reverse-proxy traffic with direct private-client paths. |
| [Copyparty](https://github.com/9001/copyparty) | Existing-folder serving, resumable transfers, parallel uploads, HTTP/WebDAV API and Windows distribution | Leading file-server trial. Published peak rates are author reports on different hardware. Use scoped content/staging and preserve the actual commit owner. |
| [rclone](https://rclone.org/docs/) | Parallel transfers; [Windows mount and partial disk cache](https://rclone.org/commands/rclone_mount/); [local control API](https://rclone.org/rc/) | Leading transfer/cache worker trial. Pinning, offline restrictions, cache versioning and ownership remain AYG policy. |
| [Syncthing](https://docs.syncthing.net/specs/bep-v1.html) / [Sushitrain](https://github.com/pixelspark/sushitrain) | Verified blocks, missing-block reuse and temporary-file completion; Sushitrain adds selective on-demand access | Serious incremental-transfer candidate. Normal shared/global folder synchronization differs from owner-based browsing. See code reuse below. |
| [iroh](https://docs.iroh.computer/compatibility) | Native encrypted QUIC, traversal and fallback; [browser clients currently relay](https://docs.iroh.computer/languages/wasm-browser); [public relays are limited](https://docs.iroh.computer/iroh-services/relays/public) | Strong native embedded alternative if finished app-specific networking is needed. Do not promise browser direct connections or unlimited public-relay traffic. |
| [WebRTC](https://webrtc.org/getting-started/peer-connections) / [libp2p](https://libp2p.io/docs/webrtc-browser-connectivity/) | Direct browser-capable connections; signaling/relay setup remains; large messages can delay other channels | Evaluate for an accepted browser-only direct path, not just to add a fashionable transport. |
| [MeshCentral](https://docs.meshcentral.com/design/) / [RustDesk](https://rustdesk.com/docs/en/) | Existing desktop/input/file access; MeshCentral can transition from WebSocket to WebRTC | Native-control trial candidates. Measure current Windows-session behavior and actual interactive UX. |
| [Guacamole](https://guacamole.apache.org/doc/gug/writing-you-own-guacamole-app.html) | Documented browser client/tunnel embedding and gateway to RDP/VNC | Useful browser gateway alternative; additional gateway/session requirements must fit actual Windows use. |
| [Sunshine/Moonlight](https://github.com/moonlight-stream/moonlight-docs/wiki/Setup-Guide) | Existing application/desktop streaming on PC and Android clients | Graphics-heavy interaction candidate; not a substitute for structured data or file transfer. |
| [Nabto](https://www.nabto.com/docs/developer/platforms.html) / [Viam RPC](https://docs.viam.com/build-apps/concepts/how-apps-connect/) | Embedded device SDKs or browser/device RPC, including Windows/Android or direct/WebRTC paths | Commercial/service terms and reusable component scope need evaluation before adoption. A whole robotics platform is not implied. |
| [WDT](https://github.com/facebook/wdt) | Embeddable parallel TCP transfer design | Throughput reference/challenger; verify platform and authentication fit before product adoption. |
| [Thruflux](https://github.com/samsungplay/Thruflux), [Lightning P2P](https://github.com/Kerim-Sabic/lightning-p2p), [ATP](https://github.com/Dicklesworthstone/atp) | Speed-focused transfers; beta status or incomplete Windows/LAN/WAN evidence differs by project | Experimental benchmarks only until verified on these actual devices. QUIC/FEC or a peak number does not establish the fastest usable option. |
| [Reminal](https://github.com/harshalgajjar/reminal), [Filex](https://github.com/BRF-Tech/filex), [PulsarDesk](https://github.com/PulsarDesk), [Anywherelan](https://github.com/anywherelan/awl), [Filestash](https://www.filestash.app/docs/api/) | Broader remote workspace/file/network products found during discovery | Further integration alternatives; platform/release claims and useful narrow components need actual verification. Avoid replacing existing Backpack policy merely to adopt a complete suite. |
| [Automerge](https://automerge.org/docs/hello/) | Offline collaborative document merging | Reconsider for an actual multi-writer collaboration feature; not needed for the specified independent owner/copy/follow model. |

### Syncthing code reuse

The screenshot's 1–70+ MB/s range is not a meaningful comparative benchmark. Syncthing's [own performance guidance](https://docs.syncthing.net/users/faq.html) identifies route, CPU and network effects. Its [synchronization design](https://docs.syncthing.net/users/syncing.html) verifies blocks and retains temporary partial content. Those are useful capabilities, while its global folder version/conflict model is not automatically AYG or Proxima policy.

Source inspection found [protocol callbacks](https://github.com/syncthing/syncthing/blob/main/lib/protocol/protocol.go) for indexes and cluster configuration, with connection/model code depending on configuration, discovery, NAT, events, database and filesystem components. Cutting a few files out is not equivalent to obtaining a maintained standalone download SDK.

Sushitrain is a concrete reuse example: a Go core embeds Syncthing and exposes selective downloads and streaming. Its [mini puller](https://github.com/pixelspark/sushitrain/blob/main/SushitrainCore/src/puller.go) uses Syncthing internals/block downloads and a 64-entry cache with a documented maximum of 1 GiB; its [streaming server](https://github.com/pixelspark/sushitrain/blob/main/SushitrainCore/src/server.go) bridges to HTTP. Review cancellation, cache bytes, parallelism, verification and pinned upstream compatibility before reuse. Retain applicable MPL-2.0 licensing/notices if source is incorporated.

Evaluate a supported engine/adapter against Copyparty/rclone and HTTPS before choosing. Existing explicit folder synchronization can continue independently. No whole Papers profile, live database or AYG machine tree should enter that synchronization by inference.

## Implementation questions to resolve with evidence

These are engineering responsibilities, not framework questions for the creator:

- Choose the transfer and desktop-control providers from repeated real-device measurements, and verify distribution/license/support terms for the selected versions.
- Establish the phone's connection, touch client and Wi-Fi/cellular test paths. A browser demo cannot prove a native Android background-download lifecycle.
- Define which owner operations can run while the visible Papers/Backpack page is closed, without introducing a competing writer or losing unsaved models.
- Audit the exact Proxima export allowlist, queue dependency closure, running-time projection, color/row-order classification and domain-only revision calculation.
- Define cache limits, offline pin retention, source-version fingerprints and identity behavior on rename, replacement and cross-volume moves.
- Verify the selected provider's revision/precondition and atomic-commit integration; a generic WebDAV mount must not become unconditional writeback over newer owner content.
- Confirm install/upgrade/revocation behavior on the laptop, and keep protocol compatibility failures local to the unavailable capability.

## Remote agent handoff

For the authorized laptop agent/Local Lapdog, continue with stage 0 and then isolated stage 1 fixtures. Read the applicable repository's governing document before edits. Report machine/runtime/network readiness, local dirty Git state and capability availability without exposing credentials. Use synthetic fixtures in a dedicated temporary directory; preserve creator files, profiles and running application state. Keep one writer per file and record raw results, route and versions. Do not restart Papers, change native providers, migrate databases or publish unrelated work merely to benchmark transfers. Remove/stop only owned test listeners/processes when complete.

The desktop agent remains responsible for design, comparisons and acceptance. Laptop execution should supply evidence rather than pick an architecture independently. Once both machines receive implementation slices, test owner-to-client behavior in both directions. The planning document and its links are the shared pickup point; agent coordination access is separate from the eventual Papers device access.
