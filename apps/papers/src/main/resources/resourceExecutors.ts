/**
 * Capability executors for granted resources:
 *
 * - resources.register  — register a local Git repository (prompted; never
 *   copies the repository into Papers data);
 * - resources.read-granted — bounded read operations on granted resources;
 * - resources.create   — derived resources: disposable Git worktrees beside
 *   the base repository, and artifact files in the program's artifacts dir.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

import type { CapabilityBroker } from '../capabilities/capabilityBroker';
import type { GitService } from '../git/gitService';
import type { ResourceService } from './resourceService';
import { programArtifactsDir, type PapersPaths } from '../persistence/paths';

const registerArgs = z
  .object({
    type: z.literal('git-repository'),
    path: z.string().min(2).max(500),
    name: z.string().min(1).max(120).optional(),
  })
  .strict();

const readArgs = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('list') }).strict(),
  z.object({ operation: z.literal('repo-info'), resourceId: z.string().max(128) }).strict(),
  z
    .object({
      operation: z.literal('list-files'),
      resourceId: z.string().max(128),
      subdir: z.string().max(400).optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('read-file'),
      resourceId: z.string().max(128),
      filePath: z.string().min(1).max(500),
    })
    .strict(),
  z
    .object({
      operation: z.literal('search'),
      resourceId: z.string().max(128),
      pattern: z.string().min(2).max(200),
    })
    .strict(),
  z
    .object({ operation: z.literal('worktree-diff'), resourceId: z.string().max(128) })
    .strict(),
  z
    .object({ operation: z.literal('read-artifact'), resourceId: z.string().max(128) })
    .strict(),
]);

const createArgs = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('git-worktree'),
      resourceId: z.string().max(128),
      name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('artifact-file'),
      title: z.string().min(1).max(200),
      fileName: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,120}\.(md|txt|json|fodt|odt|csv)$/),
      content: z.string().max(4_000_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('remove-worktree'),
      resourceId: z.string().max(128),
    })
    .strict(),
]);

/**
 * Structural verification of generated documents: a
 * malformed document must fail here, not when the creator opens it.
 */
export function validateArtifactContent(fileName: string, content: string): void {
  if (fileName.toLowerCase().endsWith('.fodt')) {
    if (!content.trimStart().startsWith('<?xml')) {
      throw new Error('generated .fodt is not XML');
    }
    if (!content.includes('office:document') || !content.includes('office:body')) {
      throw new Error('generated .fodt is missing required OpenDocument elements');
    }
    for (const tag of ['office:document', 'office:body', 'office:text']) {
      const opens = content.split(`<${tag}`).length - 1;
      const closes = content.split(`</${tag}>`).length - 1;
      if (opens !== closes) {
        throw new Error(`generated .fodt has unbalanced <${tag}> elements`);
      }
    }
    // Interpolated text must be escaped: raw ampersands break the XML.
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(content)) {
      throw new Error('generated .fodt contains unescaped ampersands');
    }
  }
  if (fileName.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(content);
    } catch (err) {
      throw new Error(`generated .json is invalid: ${String(err)}`);
    }
  }
}

export interface ResourceExecutorDeps {
  broker: CapabilityBroker;
  resources: ResourceService;
  git: GitService;
  paths: PapersPaths;
}

export function registerResourceExecutors(deps: ResourceExecutorDeps): void {
  const { broker, resources, git, paths } = deps;

  broker.register({
    capability: 'resources.register',
    policy: 'prompt',
    argumentsSchema: registerArgs,
    summarize: (args) => {
      const a = args as z.infer<typeof registerArgs>;
      return `Register the local Git repository at "${a.path}" and let this program read it (identity, files, search). Nothing is copied or modified.`;
    },
    execute: async (args, identity) => {
      const a = args as z.infer<typeof registerArgs>;
      const repoPath = path.resolve(a.path);
      if (!(await git.isRepository(repoPath))) {
        throw new Error(`"${repoPath}" is not a Git repository`);
      }
      const entry = await resources.register(identity.backpackId, {
        type: 'git-repository',
        name: a.name ?? path.basename(repoPath),
        path: repoPath,
        grants: [identity.programId],
        meta: {},
      });
      return { resourceId: entry.id, name: entry.name, path: entry.path };
    },
  });

  broker.register({
    capability: 'resources.read-granted',
    policy: 'implicit',
    argumentsSchema: readArgs,
    summarize: (args) => `Read granted resource (${(args as { operation: string }).operation})`,
    execute: async (args, identity) => {
      const a = args as z.infer<typeof readArgs>;
      if (a.operation === 'list') {
        const granted = await resources.listGranted(identity.backpackId, identity.programId);
        return granted.map((r) => ({
          resourceId: r.id,
          type: r.type,
          name: r.name,
          path: r.path,
          meta: r.meta,
        }));
      }
      const entry = await resources.requireGranted(
        identity.backpackId,
        identity.programId,
        a.resourceId,
      );
      switch (a.operation) {
        case 'repo-info':
          return git.info(entry.path);
        case 'list-files':
          return git.listFiles(entry.path, a.subdir);
        case 'read-file':
          return git.readFile(entry.path, a.filePath);
        case 'search':
          return git.search(entry.path, a.pattern);
        case 'worktree-diff': {
          if (entry.type !== 'git-worktree') throw new Error('resource is not a worktree');
          return git.worktreeDiff(entry.path);
        }
        case 'read-artifact': {
          if (entry.type !== 'artifact') throw new Error('resource is not an artifact');
          const content = await fs.readFile(entry.path, 'utf8');
          return { path: entry.path, content: content.slice(0, 2_000_000) };
        }
      }
    },
  });

  broker.register({
    capability: 'resources.create',
    policy: 'prompt',
    argumentsSchema: createArgs,
    summarize: (args) => {
      const a = args as z.infer<typeof createArgs>;
      if (a.kind === 'git-worktree') {
        return `Create a disposable Git worktree "${a.name}" (new branch papers/${a.name}) beside the granted repository. The base checkout is not modified.`;
      }
      if (a.kind === 'remove-worktree') {
        return `Remove a disposable worktree and its papers/ branch. The base repository is untouched.`;
      }
      return `Create the artifact file "${a.fileName}" inside this program's own artifacts directory.`;
    },
    execute: async (args, identity) => {
      const a = args as z.infer<typeof createArgs>;

      if (a.kind === 'git-worktree') {
        const base = await resources.requireGranted(
          identity.backpackId,
          identity.programId,
          a.resourceId,
        );
        if (base.type !== 'git-repository') throw new Error('resource is not a repository');
        const worktreesRoot = `${base.path}-papers-worktrees`;
        const info = await git.createWorktree(base.path, worktreesRoot, a.name);
        const entry = await resources.register(identity.backpackId, {
          type: 'git-worktree',
          name: `${base.name} worktree ${a.name}`,
          path: info.worktreePath,
          grants: [identity.programId],
          meta: {
            baseResourceId: base.id,
            baseRepositoryPath: base.path,
            branch: info.branch,
            baseCommit: info.baseCommit,
          },
        });
        return {
          resourceId: entry.id,
          worktreePath: info.worktreePath,
          branch: info.branch,
          baseCommit: info.baseCommit,
        };
      }

      if (a.kind === 'remove-worktree') {
        const entry = await resources.requireGranted(
          identity.backpackId,
          identity.programId,
          a.resourceId,
        );
        if (entry.type !== 'git-worktree') throw new Error('resource is not a worktree');
        const basePath = String(entry.meta['baseRepositoryPath'] ?? '');
        const branch = String(entry.meta['branch'] ?? '');
        if (!basePath) throw new Error('worktree resource is missing its base repository');
        await git.removeWorktree(basePath, entry.path, branch);
        await resources.remove(identity.backpackId, entry.id);
        return { removed: true };
      }

      // artifact-file
      validateArtifactContent(a.fileName, a.content);
      const dir = programArtifactsDir(paths, identity.backpackId, identity.programId);
      await fs.mkdir(dir, { recursive: true });
      const target = path.join(dir, a.fileName);
      const relative = path.relative(dir, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('artifact path escapes the artifacts directory');
      }
      // Preserve earlier drafts: never overwrite silently.
      let finalTarget = target;
      try {
        await fs.access(finalTarget);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = path.extname(a.fileName);
        finalTarget = path.join(dir, `${path.basename(a.fileName, ext)}-${stamp}${ext}`);
      } catch {
        // Target does not exist; use as-is.
      }
      await fs.writeFile(finalTarget, a.content, 'utf8');
      const entry = await resources.register(identity.backpackId, {
        type: 'artifact',
        name: a.title,
        path: finalTarget,
        grants: [identity.programId],
        meta: { fileName: path.basename(finalTarget) },
      });
      return { resourceId: entry.id, path: finalTarget };
    },
  });
}
