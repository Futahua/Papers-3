/**
 * WHICH PROJECT THE LAUNCHER LAUNCHES.
 *
 * THE DEFECT THIS MODULE EXISTS TO FIX
 * The launcher overlay used to render whatever project happened to be the
 * ACTIVE TAB of the first live Papers window. That is invisible to the creator
 * by construction: the whole point of the chord is that they are NOT in Papers
 * when they press it, so whichever tab they left in front hours ago is
 * effectively random. It showed Proxima's task board - a project with no command
 * surface of any kind - squeezed into the launcher's 640x220 letterbox.
 *
 * Alt+A has ONE meaning: show me my command surface. A chord whose meaning
 * depended on an invisible tab could not hold one.
 *
 * THE RULE
 *   1. If the creator has NOMINATED an available project, and it declares a
 *      command surface, that one. The nomination outranks everything, so the
 *      chord means the same thing every time it is pressed.
 *   2. Otherwise, if exactly ONE available project declares one, that one. With a
 *      single candidate the rule needs no explaining and no configuring.
 *   3. Otherwise, REFUSE - visibly, naming what it looked at. Never render a
 *      project that does not declare a command surface, and never silently do
 *      nothing.
 *
 * Why the several-declare case refuses instead of picking one: every way of
 * picking would be a rule the creator has to know in order to predict the chord,
 * and the two obvious ones are both wrong. "The front one" is the defect. "The
 * most recently used one" changes a different time - switching tabs between two
 * presses would make one chord two features. A refusal is not a dead end: it
 * names the candidates, and one press settles it permanently by nominating.
 *
 * THE BOUNDARY, UNCHANGED
 * The host still does not know what a command surface IS. It does not know what
 * "Quick Run" means, or that a project called Proxima exists. A project STATES
 * that it has one, in its own private control record, by naming the surface
 * marker the host should append to the entry URL - the same opaque-marker
 * mechanism the compact widget already uses. The host carries the string; the
 * project gives it meaning. Nothing about any particular Backpack appears here.
 *
 * WHAT THE HOST DOES *NOT* DO
 * It never infers a declaration from a project's name, title, route, icon or
 * running page. An unreadable declaration is no declaration - it can never make
 * a project launchable by accident, and can never fail one open.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { ProjectManifest } from './backpackProjectService';

/**
 * The manifest field a project uses to state that it has a command surface.
 *
 * The field name describes the host's role - "this is the surface the launcher
 * loads" - while its value stays entirely the project's: the opaque mode marker
 * appended to the entry URL. The compact widget already works this way
 * (`?papers-surface=compact-widget`), so a project reads the marker it declared
 * and renders that surface, and the host never learns what it means.
 */
export const LAUNCHER_SURFACE_FIELD = 'launcherSurface';

/** A project's statement that it has a command surface. */
export interface ProjectLauncherDeclaration {
  schemaVersion: 1;
  /** The opaque mode marker the project understands. Never interpreted here. */
  surface: string;
}

/** A project currently presented in some Papers window. */
export interface AvailableProject {
  projectId: string;
  /** The project root, where its private control records live. */
  root: string;
}

export interface LauncherTarget {
  projectId: string;
  surfaceId: string;
}

export type LauncherRefusalReason =
  /** Nothing is open, so there is nothing that could have declared one. */
  | 'no-project-available'
  /** Projects are open; none of them states it has a command surface. */
  | 'none-declare-a-command-surface'
  /** More than one does, so any pick would be a rule the creator must know. */
  | 'several-declare-a-command-surface'
  /** The creator nominated one, and it is not currently open. */
  | 'nominated-project-not-available'
  /** The creator nominated one, and it no longer declares a command surface. */
  | 'nominated-project-declares-nothing';

export type LauncherRefusal = {
  ok: false;
  reason: LauncherRefusalReason;
  detail: string;
  /** The projects that DID declare one, so the creator can nominate by name. */
  candidates: string[];
};

export type LauncherResolution = { ok: true; target: LauncherTarget } | LauncherRefusal;

export interface CommandSurfaceRegistryDependencies {
  /** Every non-archived Backpack project available to Papers. */
  availableProjects(): AvailableProject[];
  /** Read a project's own declaration from its control record, or null. */
  readDeclaration(projectId: string, root: string): Promise<ProjectLauncherDeclaration | null>;
  /** The project the creator nominated, or null. */
  nominatedProjectId(): string | null;
  /** Record the creator's choice. `null` clears it. */
  nominate(projectId: string | null): void;
}

export interface CommandSurfaceRegistry {
  resolve(): Promise<LauncherResolution>;
  nominate(projectId: string | null): void;
  nominatedProjectId(): string | null;
}

/**
 * A marker is an opaque token: no spaces, no URL-shaped value. This is not the
 * host interpreting the surface - it is keeping the value usable as a query
 * parameter, so a malformed declaration becomes "declares nothing" rather than
 * a URL that quietly means something else.
 */
const MARKER_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/;

/**
 * Read a declaration out of a project manifest. Fail-closed in every direction:
 * anything unexpected is "this project declares no command surface", never a
 * launchable surface. A malformed declaration must not be able to widen what the
 * launcher will render.
 */
export function declarationFromManifest(manifest: unknown): ProjectLauncherDeclaration | null {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return null;
  const record = manifest as Record<string, unknown>;
  if (record['schemaVersion'] !== 1) return null;
  const surface = record[LAUNCHER_SURFACE_FIELD];
  if (typeof surface !== 'string' || !MARKER_PATTERN.test(surface)) return null;
  return { schemaVersion: 1, surface };
}

/**
 * Read a project's control record from its root. Deliberately NOT the project
 * service's own reader: that one enforces the entry-path rules, and failing
 * those must make a project un-openable, not silently un-launchable. Here a
 * record that cannot be read is simply "declares nothing".
 */
export async function readProjectControlRecord(root: string): Promise<ProjectManifest | null> {
  try {
    const raw = await fs.readFile(path.join(root, 'project.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as ProjectManifest) : null;
  } catch {
    return null;
  }
}

/**
 * The production reader for `readDeclaration`. It reads the project's own
 * control record and nothing else - no name, no title, no running page.
 * Memoized: a declaration changes only when the project does, and this runs on
 * the path of a keypress.
 */
export function createManifestDeclarationReader(
  rootFor: (projectId: string) => Promise<string | null>,
  readManifest: (root: string) => Promise<ProjectManifest | null>,
): (projectId: string, root: string) => Promise<ProjectLauncherDeclaration | null> {
  const cache = new Map<string, ProjectLauncherDeclaration | null>();
  return async (projectId, root) => {
    if (cache.has(projectId)) return cache.get(projectId) ?? null;
    let declaration: ProjectLauncherDeclaration | null = null;
    try {
      const resolvedRoot = root || (await rootFor(projectId)) || '';
      if (resolvedRoot) declaration = declarationFromManifest(await readManifest(resolvedRoot));
    } catch {
      declaration = null;
    }
    cache.set(projectId, declaration);
    return declaration;
  };
}

/** Ordered for a stable message: the caller's order may follow window z-order. */
function listed(candidates: string[]): string {
  return [...candidates].sort().join(', ');
}

export function createCommandSurfaceRegistry(
  dependencies: CommandSurfaceRegistryDependencies,
): CommandSurfaceRegistry {
  /**
   * Read every open project's declaration. A project presented in two windows is
   * one project, so it is counted once.
   */
  const declaredProjects = async (): Promise<Array<AvailableProject & { declaration: ProjectLauncherDeclaration }>> => {
    const seen = new Set<string>();
    const found: Array<AvailableProject & { declaration: ProjectLauncherDeclaration }> = [];
    for (const project of dependencies.availableProjects()) {
      if (seen.has(project.projectId)) continue;
      seen.add(project.projectId);
      // A declaration that cannot be read is no declaration. It must never make
      // a project launchable by accident, and must never fail the chord open
      // either: an unreadable record on an unrelated project cannot be allowed to
      // take the launcher down with it.
      let declaration: ProjectLauncherDeclaration | null = null;
      try {
        declaration = await dependencies.readDeclaration(project.projectId, project.root);
      } catch {
        declaration = null;
      }
      if (declaration) found.push({ ...project, declaration });    }
    return found;
  };

  return {
    async resolve(): Promise<LauncherResolution> {
      const available = dependencies.availableProjects();

      if (available.length === 0) {
        return {
          ok: false,
          reason: 'no-project-available',
          candidates: [],
          detail:
            'no Backpack project is available in Papers, so there is nothing for the command surface '
            + 'shortcut to launch. Bind a Backpack project, then press it again.',
        };
      }

      const declared = await declaredProjects();
      const nominated = dependencies.nominatedProjectId();

      if (nominated !== null) {
        const match = declared.find((project) => project.projectId === nominated);
        if (match) {
          return { ok: true, target: { projectId: match.projectId, surfaceId: match.declaration.surface } };
        }
        // A nomination is a statement about the creator's setup, so it is not
        // quietly ignored: falling through to a different project would make the
        // chord mean something they did not choose.
        const isAvailable = available.some((project) => project.projectId === nominated);
        return isAvailable
          ? {
            ok: false,
            reason: 'nominated-project-declares-nothing',
            candidates: declared.map((project) => project.projectId),
            detail:
              `the project you nominated for the command surface shortcut (${nominated}) is available but `
              + 'does not declare a command surface, so the shortcut will not launch it or anything else. '
              + 'Nominate a project that declares one.',
          }
          : {
            ok: false,
            reason: 'nominated-project-not-available',
            candidates: declared.map((project) => project.projectId),
            detail:
              `the project you nominated for the command surface shortcut (${nominated}) is not available in `
              + 'Papers. Bind it, or nominate an available project.',
          };
      }

      if (declared.length === 1) {
        const only = declared[0]!;
        return { ok: true, target: { projectId: only.projectId, surfaceId: only.declaration.surface } };
      }

      if (declared.length === 0) {
        const names = available.map((project) => project.projectId).sort();
        // Named rather than counted: the creator cannot see the front tab, so
        // "which Backpack is it talking about" is exactly what they cannot check.
        const subject = names.length === 1
          ? `the Backpack ${names[0]} is available, but it does not`
          : `the Backpacks ${listed(names)} are available, but none of them`;
        return {
          ok: false,
          reason: 'none-declare-a-command-surface',
          candidates: [],
          detail:
            `${subject} declare a command surface. The command surface shortcut launches a project that `
            + 'declares one; it does not show whichever project happens to be in front.',
        };
      }

      return {
        ok: false,
        reason: 'several-declare-a-command-surface',
        candidates: declared.map((project) => project.projectId),
        detail:
          `${declared.length} available projects declare a command surface (${listed(declared.map((project) => project.projectId))}), `
          + 'so the shortcut cannot tell which one you mean. Nominate one and this chord will always launch it.',
      };
    },

    nominate(projectId: string | null): void {
      dependencies.nominate(projectId);
    },

    nominatedProjectId(): string | null {
      return dependencies.nominatedProjectId();
    },
  };
}
