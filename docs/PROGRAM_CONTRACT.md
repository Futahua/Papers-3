# Papers 3 — Program contract (API version 1)

A program is a bounded first-party package under `programs/<id>/` loaded into a sandboxed
`WebContentsView` at `papers-program://<id>/<entry>`. It has no Node, no Electron, no raw IPC,
no network (`connect-src 'none'`), and no filesystem. Everything flows through `window.papers`.

## Package layout

```text
programs/<id>/
├── manifest.json     required
├── index.html        entry (relative path, no traversal)
└── *.js / *.css …    plain ES modules and assets (js, css, json, svg, png, woff2)
```

`manifest.json` (strict schema — unknown fields rejected):

```json
{
  "id": "repository-research",          // must equal directory name, [a-z0-9-]
  "name": "Repository Research",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.html",
  "stateSchemaVersion": 1,
  "capabilities": ["storage.read-own"],
  "description": "optional",
  "accentColor": "#aabbcc"
}
```

Only declared capabilities can ever be requested; undeclared requests fail with `not-declared`.

## window.papers

```ts
interface PapersProgramBridge {
  identity(): Promise<{ backpackId, programId, programName, programVersion, apiVersion }>;

  state: {
    load(): Promise<unknown>;            // null when no state exists yet
    save(value: unknown): Promise<void>; // atomic; requires storage.write-own
  };

  shelf: {
    contribute(items: { id, label, commandId, title? }[]): Promise<void>; // max 8
    clear(): Promise<void>;
  };

  commands: {
    register(commands: { id, label, description? }[]): Promise<void>;
  };

  capabilities: {
    request(request: CapabilityRequest): Promise<unknown>;
  };

  agent: {
    invoke(invocation: AgentInvocation): Promise<{ runId, sessionId }>;
    cancel(runId: string): Promise<void>;  // own runs only
  };

  events: {
    onCommand(cb): unsubscribe;          // { commandId } — shelf/host asked to run a command
    onRunUpdate(cb): unsubscribe;        // { runId, state, sessionId } for own runs
    onResultProposal(cb): unsubscribe;   // AgentResultProposal for own invocations
  };
}
```

Errors from privileged calls are `Error` objects whose message begins with
`capability-error:{json}` where json is `{ code, message, capability? }`;
codes: `denied | not-declared | invalid-arguments | invalid-sender | unavailable | failed | not-granted`.

## CapabilityRequest

```ts
{
  invocationId: string,       // any unique id (uuid)
  backpackId: string,         // must equal identity().backpackId
  programId: string,          // must equal identity().programId
  capability: string,         // one of the declared names
  arguments: unknown,         // per-capability schema below
  reason: string              // shown to the creator in prompts
}
```

Permission prompts offer **Allow once / Allow for this program / Deny**. Standing grants are
visible and revocable in the host Permissions panel.

## Capability argument schemas

### clipboard.write (prompted)
`{ text: string /* ≤1MB */ }` → `{ ok: true }`

### resources.register (prompted)
`{ type: 'git-repository', path: string, name?: string }` → `{ resourceId, name, path }`
Fails if the path is not a Git repository. Never copies the repository.

### resources.read-granted (no prompt; per-resource grant enforced)
- `{ operation: 'list' }` → `[{ resourceId, type, name, path, meta }]`
- `{ operation: 'repo-info', resourceId }` → `{ branch, headCommit, headSubject, headAuthor, headDate, clean, changedFiles, remoteUrl, path }`
- `{ operation: 'list-files', resourceId, subdir? }` → `{ files: string[], truncated }`
- `{ operation: 'read-file', resourceId, filePath }` → `{ path, commit, content, truncated, byteLength }`
- `{ operation: 'search', resourceId, pattern }` → `{ matches: [{ path, line, text }], truncated }`
- `{ operation: 'worktree-diff', resourceId }` → `{ diff, stat, truncated }` (worktree resources)
- `{ operation: 'read-artifact', resourceId }` → `{ path, content }` (artifact resources)

### resources.create (prompted)
- `{ kind: 'git-worktree', resourceId, name /* [a-z0-9-] */ }` →
  `{ resourceId, worktreePath, branch: 'papers/<name>', baseCommit }`
  Worktrees live beside the base repository in `<repo>-papers-worktrees/`; the base checkout is never modified.
- `{ kind: 'remove-worktree', resourceId }` → `{ removed: true }`
- `{ kind: 'artifact-file', title, fileName /* .md .txt .json .fodt .odt .csv */, content }` →
  `{ resourceId, path }` — written into the program's own artifacts directory; existing files are
  never overwritten (a timestamped name is used instead), preserving earlier drafts.

### external.open (prompted)
- `{ target: 'url', url }` (http/https only)
- `{ target: 'resource', resourceId }` — open granted file with default app
- `{ target: 'show-in-folder', resourceId }`

### external.launch-approved (prompted)
`{ application: 'libreoffice-writer' | 'libreoffice-calc', resourceId }` →
`{ launched: true, executable }`. Papers does not track external edits; register final files explicitly.

## AgentInvocation (exact, inspectable)

See `src/shared/types.ts` / plan §13. Requirements enforced by Papers:

- `origin.backpackId/programId` must match the sender;
- every `sharedMaterial[i].content` must SHA-256-hash to `contentHash` (hex);
- total shared content ≤ 1.5 MB; per-item ≤ 512 kB (mark `truncated: true` and set
  `originalByteLength` when you cut content — the preview discloses it);
- `destination.programId` must exist;
- `permissions` ⊆ declared capabilities.

The host shows the creator a preview (action, selection, exact shared content, disclosures,
destination, capabilities, exact composed prompt) before anything reaches Hermes. `invoke()`
resolves with `{ runId }` after the creator confirms; it rejects with `invocation was not
confirmed` if they cancel.

The composed prompt asks Hermes to put any structured result in a single ```json fenced block;
it arrives parsed in `AgentResultProposal.structuredOutput`.

## AgentResultProposal handling (program-owned)

`onResultProposal` delivers `{ invocationId /* = runId */, sessionId, summary, structuredOutput? }`.
The program must: validate shape → verify its destination still exists → compare current
selection hashes with the invocation's hashes and mark stale results instead of applying →
preview → require confirmation for destructive replacement → apply through its own code →
save atomically → snapshot before applying for undo.

## Run states

`queued → running → (waiting-approval) → completed | failed | cancelled`. The host Agent Runs
panel owns approval prompts, Stop, retry, inspect-in-Hermes, and return-to-origin.
