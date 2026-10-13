# Cross-device machinery verified on real devices, 2026-10-13

Creator decisions recorded the same day (they supersede conflicting lines in
[CROSS_DEVICE_PLAN.md](CROSS_DEVICE_PLAN.md), which the creator did not author):

- Pairing has no codes. Any device signed into the creator's own Tailscale account is trusted.
- Every drive is shared, with changes allowed, to those devices. No block list is wanted.
- Each machine owns its Proxima and edits only its own. Others' Proxima can be viewed and copied, either everything or selected entries, and a copy can follow its authoritative source.
- Remote desktop control will not be built.
- UX is decided by the creator after the machinery is proven, not before.

## What ran

All checks used throwaway fixture folders and generated content. Proxima writes happened only
on the laptop (which the creator declared disposable) and in an isolated receiver instance;
this desktop's real Proxima was only read.

| Path | Tool | Result |
| --- | --- | --- |
| Laptop client → desktop owner | `tools/buildDeviceCheck.mjs` | 11/11 |
| Desktop client → laptop owner | `tools/buildDeviceCheck.mjs` | 11/11 |
| Phone (Android Java client) → desktop owner | `tools/phoneDeviceCheck.mjs` | 10/10 |
| Laptop Proxima → isolated receiver here | `tools/probeProximaRealDevice.mjs` | 10/10 |
| Phone, laptop owner taken offline and back | scratch script (same harness) | 3/3 |

Checks cover:
- joining with no code
- listing every drive root
- 64 MiB download with SHA-256 verification
- interrupt and resume
- create folder, copy, rename, move and delete
- a retried command applied once
- stale versions refused
- edit save-back
- a conflicting second save refused with the local work kept
- Proxima read
- selected and full copy
- follow updates
- conflicts with Use source and Save both
- reload retention
- offline listing

## Defects found and fixed by this pass

- A second client on one machine replaced the first's grant, and the revoked client never reconnected. Grants are now keyed by node + client name, and clients rejoin after a 401.
- Drive roots failed with 500 on protected entries (Config.Msi, DumpStack.log.tmp). The first fix then hid real files that antivirus had briefly locked (16 of 20 entries once). A locked or protected ordinary entry is now listed from lstat; only vanished entries and unverifiable links are skipped.
- As you Go could not save any workspace that embeds an icon but has no snapshot folder ("The workspace asset destination is unavailable"). It silently stopped saving, and Papers refused to close the window. Icons now stay embedded in that case (AYG `4916b66`). Refused closes now record their reason in `diagnostics/shutdown.ndjson`.
- Claude desktop held Papers' `app.asar` open, which made the installer exit 2. Avoid touching installed Papers files from Claude, or install when the lock is gone.

## Measured facts that bear on UX

- Throughput is bounded by the laptop's 2.4 GHz Wi-Fi (65–88 Mbps). Tailscale and the app add no measurable cost; the phone reached 108–159 Mbps.
- Deciding that an owner is offline takes 15 s, the client connect timeout. Until then a request looks pending.
- When the owner is offline, the phone serves the last listing, marked `online: false`. The desktop client behaves likewise for listings.
