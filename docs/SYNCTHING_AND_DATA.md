# Syncthing and evolving Papers data

## Current answer

The installed Papers master folder lives inside a Syncthing folder. The fixed Windows
application under `Papers/App` can be copied, but the current `Papers/Data` directory is
a mixed Electron profile containing caches, locks, browser state and eventually Papers
domain data. It is not yet a safe multi-machine, simultaneous-write data model.

Hermes is also a local runtime, not merely a folder of portable files. A synchronized
copy does not reproduce machine PATH entries, Python runtimes, services or an available
local port. Its live credentials, sessions and databases must not be treated as ordinary
shared documents.

This limitation is recorded rather than hidden. Papers remains usable on this machine
while its sync boundary is shaped by real Backpack features.

## Policy for features built later

Papers must classify data when a real feature introduces it, not invent a complete data
platform in advance.

1. **Creator work defaults durable and syncable.** Documents, authored Backpack
   definitions, layouts and irreplaceable results should survive machine replacement and
   appear on another trusted machine unless the creator decides otherwise.
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
├── App/                 fixed installed application; copyable
├── Shared/              future durable creator work, introduced only when needed
├── Data/                current mixed local runtime; not multi-writer safe
├── Migration Backup/    recoverable retired material
└── HERMES.md            synced pickup instructions for building Backpacks
```

`Shared` is a reserved direction, not a requirement to build an empty framework now.
The first feature that produces genuinely durable creator data should establish its
smallest useful contents and migration from any earlier location.

## Data inventory

Update this table whenever a real feature creates persistent data.

| Data set | Current location | Owner | Sync expectation | Secrets | Concurrent writers | Recovery |
|---|---|---|---|---|---|---|
| Packaged Papers application | `Papers/App` | Papers release | Copyable fixed version | No | Do not replace while running | Reinstall/rebuild |
| Electron runtime profile | `Papers/Data` | Electron/Papers host | Machine-local direction | May contain web state | No | Recreated; preserve unknown files during migration |
| Backpack registry and records | `Papers/Data/PapersData` when created | Papers | Undecided until first useful Backpack contents | No by design | Current JSON store is not conflict-mergeable | Atomic backups and recovery directory |
| Migration material | `Papers/Migration Backup` | Creator | Archive; no runtime dependency | Possibly | No | Original moved material |
| Hermes runtime and state | Discovered from the local `hermes` command | Hermes | Install/configure per machine unless Hermes provides supported sync | Yes | No raw multi-machine writers | Hermes-owned recovery/export mechanisms |

## Current Syncthing caution

Syncthing ignore patterns are relative to the Syncthing root and its `.stignore` file is
local to each device. On the primary machine, the observed active `hermes` command is
under `Programs/Assistant/HermesAI/...`; older ignore rules aimed at
`Programs/HermesAI/...` do not cover that active location. Correcting exclusions must be
done deliberately on every trusted device after deciding which Hermes-owned information
should survive and by what supported mechanism.

Do not open Papers or Hermes concurrently on a second synced machine until the live data
paths have been separated or excluded there.
