/**
 * Thin wrappers around window.papers. Every privileged call flows through
 * requestCapability so identity fields and error parsing are uniform.
 */
export const papers = window.papers;

let identityCache = null;

export async function identity() {
  if (!identityCache) identityCache = await papers.identity();
  return identityCache;
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Parse a capability error. Errors from privileged calls are Error objects
 * whose message starts with `capability-error:{json}`.
 */
export function parseCapabilityError(err) {
  const raw = String(err && err.message != null ? err.message : err);
  if (raw.startsWith('capability-error:')) {
    try {
      const info = JSON.parse(raw.slice('capability-error:'.length));
      return {
        code: info.code || 'failed',
        message: info.message || 'The capability call failed.',
        capability: info.capability,
      };
    } catch {
      /* fall through to generic */
    }
  }
  return { code: 'failed', message: raw };
}

export function isDenied(err) {
  const code = parseCapabilityError(err).code;
  return code === 'denied' || code === 'not-granted';
}

export async function requestCapability(capability, args, reason) {
  const id = await identity();
  return papers.capabilities.request({
    invocationId: crypto.randomUUID(),
    backpackId: id.backpackId,
    programId: id.programId,
    capability,
    arguments: args,
    reason,
  });
}

// ---- resources ---------------------------------------------------------

export const repo = {
  register(path, name) {
    const args = { type: 'git-repository', path };
    if (name) args.name = name;
    return requestCapability('resources.register', args,
      'Register this local Git repository as research material for reading only');
  },
  info(resourceId) {
    return requestCapability('resources.read-granted', { operation: 'repo-info', resourceId },
      'Show repository branch and status in the Overview');
  },
  listFiles(resourceId, subdir) {
    const args = { operation: 'list-files', resourceId };
    if (subdir) args.subdir = subdir;
    return requestCapability('resources.read-granted', args,
      'List repository files in the Explorer');
  },
  readFile(resourceId, filePath) {
    return requestCapability('resources.read-granted', { operation: 'read-file', resourceId, filePath },
      'Read a repository file in the Explorer');
  },
  search(resourceId, pattern) {
    return requestCapability('resources.read-granted', { operation: 'search', resourceId, pattern },
      'Search the repository for the given pattern');
  },
  worktreeDiff(resourceId) {
    return requestCapability('resources.read-granted', { operation: 'worktree-diff', resourceId },
      'Show the diff produced inside the task worktree');
  },
};

export const create = {
  worktree(resourceId, name) {
    return requestCapability('resources.create', { kind: 'git-worktree', resourceId, name },
      'Create an isolated disposable worktree for a delegated coding task');
  },
  removeWorktree(resourceId) {
    return requestCapability('resources.create', { kind: 'remove-worktree', resourceId },
      'Remove the worktree of a rejected coding task');
  },
  artifactFile(title, fileName, content) {
    return requestCapability('resources.create', { kind: 'artifact-file', title, fileName, content },
      'Write the generated report into the program artifacts directory');
  },
};

export const external = {
  showInFolder(resourceId) {
    return requestCapability('external.open', { target: 'show-in-folder', resourceId },
      'Reveal the artifact file in its folder');
  },
  openResource(resourceId) {
    return requestCapability('external.open', { target: 'resource', resourceId },
      'Open the artifact with its default application');
  },
  launchWriter(resourceId) {
    return requestCapability('external.launch-approved', { application: 'libreoffice-writer', resourceId },
      'Open the generated report in LibreOffice Writer');
  },
};

export function clipboardWrite(text) {
  return requestCapability('clipboard.write', { text },
    'Copy the selected text to the clipboard');
}
