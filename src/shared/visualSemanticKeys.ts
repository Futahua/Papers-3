import { z } from 'zod';
import {
  VISUAL_SEMANTIC_KEY_MAX_COUNT,
  VISUAL_SEMANTIC_KEY_MAX_LENGTH,
  VISUAL_SEMANTIC_KEYS_CHANNEL,
  VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL,
} from './visualSemanticKeyConstants';

export {
  VISUAL_SEMANTIC_KEY_MAX_COUNT,
  VISUAL_SEMANTIC_KEY_MAX_LENGTH,
  VISUAL_SEMANTIC_KEYS_CHANNEL,
  VISUAL_SEMANTIC_KEYS_REFRESH_CHANNEL,
} from './visualSemanticKeyConstants';

/** Semantic keys are opaque project identifiers, not DOM selectors. */
export const visualSemanticKeySchema = z.string()
  .min(1)
  .max(VISUAL_SEMANTIC_KEY_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/);

export const visualSemanticKeyListSchema = z.array(visualSemanticKeySchema)
  .max(VISUAL_SEMANTIC_KEY_MAX_COUNT)
  .superRefine((keys, context) => {
    const seen = new Set<string>();
    keys.forEach((key, index) => {
      if (seen.has(key)) {
        context.addIssue({ code: 'custom', path: [index], message: 'semantic key is duplicated within one surface' });
      }
      seen.add(key);
    });
  });

export type VisualSemanticKey = z.infer<typeof visualSemanticKeySchema>;

export interface VisualSemanticKeyRegistry {
  /** Replace one surface's observed set atomically after strict validation. */
  replaceObserved(rawKeys: unknown): readonly VisualSemanticKey[];
  /** Return all keys or a bounded requested subset, never a selector lookup. */
  snapshot(rawKeys?: unknown): VisualSemanticKey[];
  clear(): void;
}

export function createVisualSemanticKeyRegistry(): VisualSemanticKeyRegistry {
  let observed = new Set<VisualSemanticKey>();

  return {
    replaceObserved(rawKeys) {
      const keys = visualSemanticKeyListSchema.parse(rawKeys);
      observed = new Set(keys);
      return [...observed];
    },
    snapshot(rawKeys) {
      if (rawKeys === undefined) return [...observed];
      const requested = visualSemanticKeyListSchema.parse(rawKeys);
      return requested.filter((key) => observed.has(key));
    },
    clear() {
      observed.clear();
    },
  };
}
