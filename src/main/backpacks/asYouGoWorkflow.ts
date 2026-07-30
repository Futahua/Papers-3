/**
 * The concrete local workflow for the creator's "As you Go" Backpack.
 *
 * It reads the four actions that survived the reverted 1.2.0 implementation,
 * but never edits them and never accepts a filesystem path from the renderer.
 * This is deliberately not a general Backpack button store.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { AS_YOU_GO_ACTIONS, type AsYouGoAction } from '@shared/asYouGo';

interface LocalAction extends AsYouGoAction {
  target: string;
}

const actionIdPattern =
  /^button-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseManifest(raw: string): LocalAction[] {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null) throw new Error('not an object');
  const state = value as Record<string, unknown>;
  if (state['schemaVersion'] !== 1 || !Array.isArray(state['buttons'])) {
    throw new Error('unsupported local action manifest');
  }

  const seen = new Set<string>();
  const actions = state['buttons'].map((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) throw new Error('invalid action');
    const action = candidate as Record<string, unknown>;
    const id = action['id'];
    const label = action['label'];
    const target = action['target'];
    if (
      typeof id !== 'string' ||
      !actionIdPattern.test(id) ||
      seen.has(id) ||
      typeof label !== 'string' ||
      !label.trim() ||
      label.trim().length > 120 ||
      typeof target !== 'string' ||
      !path.isAbsolute(target)
    ) {
      throw new Error('invalid action');
    }
    seen.add(id);
    return { id, label: label.trim(), target: path.resolve(target) };
  });

  if (
    actions.length !== AS_YOU_GO_ACTIONS.length ||
    actions.some((action, index) => {
      const expected = AS_YOU_GO_ACTIONS[index];
      return !expected || action.id !== expected.id || action.label !== expected.label;
    })
  ) {
    throw new Error('the prepared local actions changed');
  }

  return actions;
}

export class AsYouGoWorkflow {
  constructor(
    private readonly manifestFile: string,
    private readonly openTarget?: (target: string) => Promise<string>,
  ) {}

  private async readActions(): Promise<LocalAction[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.manifestFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('As you Go local actions could not be read.');
    }

    try {
      return parseManifest(raw);
    } catch {
      throw new Error('As you Go local actions could not be read.');
    }
  }

  async listActions(): Promise<AsYouGoAction[]> {
    return (await this.readActions()).map(({ id, label }) => ({ id, label }));
  }

  async launchAction(actionId: string): Promise<void> {
    const action = (await this.readActions()).find((candidate) => candidate.id === actionId);
    if (!action) throw new Error(`As you Go action ${actionId} not found`);

    try {
      await fs.access(action.target);
    } catch {
      throw new Error(`“${action.label}” is unavailable on this machine.`);
    }
    if (!this.openTarget) throw new Error('As you Go launching is unavailable.');

    const detail = await this.openTarget(action.target);
    if (detail) throw new Error(`“${action.label}” could not be opened: ${detail}`);
  }
}
