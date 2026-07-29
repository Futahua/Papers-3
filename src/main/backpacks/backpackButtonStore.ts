/** Durable creator-authored launch buttons for a Backpack. */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { BackpackButton, BackpackButtonsState } from '@shared/types';
import { AtomicJsonStore } from '../persistence/atomicStore';

export interface BackpackButtonStorePaths {
  /** Papers' machine-local Electron profile directory. */
  dataDir: string;
  /** Papers' durable creator-authored data directory. */
  sharedDir: string;
}

const emptyState = (): BackpackButtonsState => ({ schemaVersion: 1, buttons: [] });

function validate(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'not an object';
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1) return 'unsupported schemaVersion';
  if (!Array.isArray(state.buttons)) return 'buttons is not an array';
  for (const button of state.buttons) {
    if (typeof button !== 'object' || button === null) return 'button is not an object';
    const item = button as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.target !== 'string' ||
      typeof item.createdAt !== 'string'
    ) {
      return 'button is missing required fields';
    }
  }
  return null;
}

export class BackpackButtonStore {
  constructor(
    private readonly paths: BackpackButtonStorePaths,
    private readonly openTarget?: (target: string) => Promise<string>,
  ) {}

  private store(backpackId: string): AtomicJsonStore {
    return new AtomicJsonStore(
      path.join(this.paths.sharedDir, 'backpacks', backpackId, 'buttons.json'),
      {
        recoveryDir: path.join(this.paths.dataDir, 'PapersData', 'recovery', backpackId),
        validate,
      },
    );
  }

  async list(backpackId: string): Promise<BackpackButton[]> {
    const report = await this.store(backpackId).load<BackpackButtonsState>();
    return (report.value ?? emptyState()).buttons.map((button) => ({ ...button }));
  }

  async create(backpackId: string, label: string, target: string): Promise<BackpackButton> {
    const trimmedLabel = label.trim();
    if (!trimmedLabel) throw new Error('Button name must not be empty');
    if (trimmedLabel.length > 120) throw new Error('Button name is too long');
    if (!path.isAbsolute(target)) throw new Error('Button target must be an absolute path');

    const resolvedTarget = path.resolve(target);
    await fs.access(resolvedTarget);

    const store = this.store(backpackId);
    const report = await store.load<BackpackButtonsState>();
    const state = report.value ?? emptyState();
    const button: BackpackButton = {
      id: `button-${randomUUID()}`,
      label: trimmedLabel,
      target: resolvedTarget,
      createdAt: new Date().toISOString(),
    };
    state.buttons.push(button);
    await store.save(state);
    return { ...button };
  }

  async remove(backpackId: string, buttonId: string): Promise<void> {
    const store = this.store(backpackId);
    const report = await store.load<BackpackButtonsState>();
    const state = report.value ?? emptyState();
    const next = state.buttons.filter((button) => button.id !== buttonId);
    if (next.length === state.buttons.length) throw new Error(`Button ${buttonId} not found`);
    await store.save({ ...state, buttons: next });
  }

  async launch(backpackId: string, buttonId: string): Promise<void> {
    const button = (await this.list(backpackId)).find((item) => item.id === buttonId);
    if (!button) throw new Error(`Button ${buttonId} not found`);
    await fs.access(button.target);
    if (!this.openTarget) throw new Error('Button launching is unavailable');
    const error = await this.openTarget(button.target);
    if (error) throw new Error(error);
  }
}
