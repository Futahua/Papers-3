# Syncthing and evolving Papers data

## Current answer

**The Papers master folder is not synchronized (verified 2026-07-27).** The only folder
shared by Syncthing on the primary machine is `D:\WORK brotherhood`; `Papers/` sits outside
it. An earlier version of this document assumed the master folder lived inside a Syncthing
folder — it does not, and the caution below is therefore about what must *stay* true rather
than a situation to unwind.

This is the right boundary, and it should be kept:

- `Papers/Data` is a mixed Electron profile holding caches, locks, browser state, a live
  SQLite journal and the Hermes session token. It is not a safe multi-machine,
  simultaneous-write data model, and syncing it would risk corrupting live state.
- `Papers/App` is a running application binary. Sync propagates files as they finish, so a
  mid-sync `App` is a half-replaced application; Windows also locks the executable while
  Papers runs, which turns an attempted sync into a retry loop.

**Papers is distributed by its own updater instead** (D-019): each machine installs from the
published GitHub release, so the application arrives complete or not at all. See
[UPDATING_PAPERS.md](UPDATING_PAPERS.md).

Hermes is likewise a local runtime, not a folder of portable files. A synchronized copy
does not reproduce Python runtimes, an editable pip install, services or an available local
port. Its live credentials, sessions and databases must not be treated as ordinary shared
documents. Papers locates Hermes at run time on each machine (D-016) rather than carrying a
path between them.

## Policy for features built later

Papers must classify data when a real feature introduces it, not invent a complete data
platform in advance.

“Unique” and “shared” remain creator language, not data classifications defined by this
document. The policies below do not establish a Backpack scope field, shared schema,
synchronization mechanism, portability rule or machine-binding model.

1. **Creator work must be preserved.** Documents, authored Backpack material, layouts and
   irreplaceable results must survive change and migration. Whether they synchronize,
   where they live and how they appear on another machine are decided from the real
   feature and creator request, not from a general Backpack rule.
2. **Operational state defaults local.** Caches, logs, lockfiles, temporary downloads,
   process metadata, browser profiles, live database journals, credentials, absolute
   machine paths and installation state should be reproducible or machine-specific.
3. **Ambiguous data defaults preserved.** Until its value is known through use, retain
   it, document it and use reversible migrations. Do not add it to an ignore rule merely
   because its purpose is unclear.
4. **Synchronization is not database merging.** A feature using SQLite, WAL files or a
   browser profile must not let two machines write the same live files. Use an existing
   product's supported synchronization, exported artifacts, or a future explicit shared
   representation.
5. **Secrets are not creator documents.** Provider tokens and authentication material
   require a deliberate trusted-device decision and should normally be configured per
   machine through the product that owns them.

## Intended direction, not a frozen schema

```text
Papers/
├── App/                 installed application; replaced by the updater, not by hand
├── Data/                mixed local runtime; machine-local, not multi-writer safe
└── HERMES.md            pickup instructions for building Backpacks
```

`Migration Backup/` appeared in an earlier version of this diagram. It does not exist on
the primary machine (verified 2026-07-27) and is not created by anything; the migration it
referred to is long finished.

There is no reserved `Shared/` location or generic shared-data framework. A real feature
may introduce a synchronized location only when its creator-requested behavior requires
one; that feature must define the smallest safe location and migration without turning it
into a rule for other Backpacks.

## Data inventory

Update this table whenever a real feature creates persistent data.

| Data set | Current location | Owner | Sync expectation | Secrets | Concurrent writers | Recovery |
|---|---|---|---|---|---|---|
| Packaged Papers application | `Papers/App` | Papers release | Copyable fixed version | No | Do not replace while running | Reinstall/rebuild |
| Electron runtime profile | `Papers/Data` | Electron/Papers host | Machine-local direction | May contain web state | No | Recreated; preserve unknown files during migration |
| Backpack registry and records | `Papers/Data/PapersData` when created | Papers | Undecided until first useful Backpack contents | No by design | Current JSON store is not conflict-mergeable | Atomic backups; deleted Backpack records move to `Papers/Data/PapersData/recovery/deleted-backpacks` |
| Migration material | `Papers/Migration Backup` | Creator | Archive; no runtime dependency | Possibly | No | Original moved material |
| Hermes runtime and state | Resolved per machine by `hermesLocation.ts` (D-016); the backend runs from `<hermesRoot>\venv\Scripts\hermes.exe` (D-018) | Hermes | Install/configure per machine unless Hermes provides supported sync | Yes | No raw multi-machine writers | Hermes-owned recovery/export mechanisms |
| Hermes session token | `Papers/Data/hermes-backend-token` | Papers | **Machine-local. Never sync** | **Yes** | One Papers per machine | Regenerated on next launch; delete freely |
| Resolved Hermes location | `Papers/Data/hermes-location.json` | Papers | **Machine-local. Never sync** — it names one machine's folders | No | No | Rewritten automatically on next successful resolution; delete freely |
| Downloaded Papers updates | `Papers/Data/papers-updater` (electron-updater cache) | electron-updater | Machine-local cache | No | No | Re-downloaded from the GitHub release |

## Current Syncthing caution

The Papers master folder is outside Syncthing today, so nothing needs unwinding. **Keep it
that way**: do not add `Papers/` to a synchronized folder, and in particular never sync
`Papers/Data` (live SQLite state and the Hermes token) or `Papers/App` (a running binary
that Windows locks). Papers is distributed by its updater instead.

Syncthing ignore patterns are relative to the Syncthing root and `.stignore` is local to
each device, so an exclusion added on one machine does not protect another. Any future
decision to bring part of `Papers/` into sync must be made deliberately on every trusted
device, and must name what is included rather than relying on an ignore rule to exclude the
dangerous parts.

Earlier revisions of this section referenced a Hermes install under
`Programs/Assistant/HermesAI/...`. That path is obsolete — Hermes has moved, and Papers no
longer depends on any recorded path (D-016).

Do not open Papers or Hermes concurrently against the same live data on two machines.
