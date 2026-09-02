import { z } from 'zod';

import { visualDiagnosticRecordSchema, type VisualDiagnosticRecord, type VisualDiagnosticPayload } from './visualDiagnostics';

export const VISUAL_TIMELINE_MAX_AGE_MS = 10_000;
export const VISUAL_TIMELINE_MAX_EVENTS = 256;

const timelineContextSchema = z.object({
  renderCycleId: z.string().uuid().nullable(),
  documentStateRevision: z.string().max(256).nullable(),
  layoutEpoch: z.number().int().nonnegative().nullable(),
  workspaceTopologyRevision: z.number().int().nonnegative(),
}).strict();

export const visualTimelineEntrySchema = z.object({
  eventSeq: z.number().int().positive(),
  observedAt: z.string().datetime(),
  target: z.object({ windowId: z.number().int(), surfaceId: z.string().min(1).max(128) }).strict(),
  payload: visualDiagnosticRecordSchema.shape.payload,
  renderCycleId: z.string().uuid().nullable(),
  documentStateRevision: z.string().max(256).nullable(),
  layoutEpoch: z.number().int().nonnegative().nullable(),
  workspaceTopologyRevision: z.number().int().nonnegative(),
}).strict();

export type VisualTimelineContext = z.infer<typeof timelineContextSchema>;
export type VisualTimelineEntry = z.infer<typeof visualTimelineEntrySchema>;

/** Stamp lifecycle transitions with the exact value accepted by that event.
 * Diagnostic-buffer publication happens before the observation tracker is
 * mutated, so reading the tracker alone would attach the previous revision or
 * epoch to state-hydrated/layout-epoch entries. */
export function visualTimelineContextForRecord(
  record: VisualDiagnosticRecord,
  context: VisualTimelineContext,
): VisualTimelineContext {
  const payload = record.payload;
  if (payload.kind !== 'lifecycle') return context;
  if (payload.phase === 'state-hydrated') {
    return { ...context, documentStateRevision: payload.revision ?? null };
  }
  if (payload.phase === 'layout-epoch') {
    return { ...context, layoutEpoch: payload.epoch ?? null };
  }
  return context;
}

export interface VisualTimeline {
  append(record: VisualDiagnosticRecord, context: VisualTimelineContext): void;
  snapshot(beforeMs?: number): VisualTimelineEntry[];
  clear(): void;
}

export function createVisualTimeline(options: { now?: () => Date; maxAgeMs?: number; maxEvents?: number } = {}): VisualTimeline {
  const now = options.now ?? (() => new Date());
  const maxAgeMs = options.maxAgeMs ?? VISUAL_TIMELINE_MAX_AGE_MS;
  const maxEvents = options.maxEvents ?? VISUAL_TIMELINE_MAX_EVENTS;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > VISUAL_TIMELINE_MAX_AGE_MS) throw new Error('timeline age bound is invalid');
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > VISUAL_TIMELINE_MAX_EVENTS) throw new Error('timeline event bound is invalid');
  const entries: VisualTimelineEntry[] = [];
  const prune = (cutoff: number): void => {
    while (entries.length > 0 && Date.parse(entries[0]!.observedAt) < cutoff) entries.shift();
    while (entries.length > maxEvents) entries.shift();
  };
  return {
    append(record, context) {
      const parsedRecord = visualDiagnosticRecordSchema.parse(record);
      const parsedContext = timelineContextSchema.parse(context);
      if (!parsedRecord.target.surfaceId) return;
      const target = { windowId: parsedRecord.target.windowId, surfaceId: parsedRecord.target.surfaceId };
      entries.push(visualTimelineEntrySchema.parse({
        eventSeq: parsedRecord.sequence,
        observedAt: parsedRecord.observedAt,
        target,
        payload: parsedRecord.payload,
        ...parsedContext,
      }));
      prune(now().getTime() - maxAgeMs);
    },
    snapshot(beforeMs = maxAgeMs) {
      if (!Number.isSafeInteger(beforeMs) || beforeMs < 0 || beforeMs > maxAgeMs) throw new Error('timeline lookback bound is invalid');
      prune(now().getTime() - maxAgeMs);
      const cutoff = now().getTime() - beforeMs;
      return entries.filter((entry) => Date.parse(entry.observedAt) >= cutoff).map((entry) => ({
        ...entry,
        target: { ...entry.target },
        payload: { ...entry.payload } as VisualDiagnosticPayload,
      }));
    },
    clear() { entries.length = 0; },
  };
}
