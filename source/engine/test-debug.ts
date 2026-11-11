import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import { serializedValueSchema } from '../compare/serialized-value-schema.ts';
import { sourceLocationSchema, workIdSchema } from './identity-schema.ts';
import type { WorkId } from './identity.ts';

export const executeDebugSelectionSchema = z.union([
    z.strictObject({ mode: z.enum([ 'off', 'all' ]) }),
    z.strictObject({ mode: z.literal('selected'), work: z.array(workIdSchema) })
]);
export type ExecuteDebugSelection = { readonly mode: 'all' | 'off'; } | {
    readonly mode: 'selected';
    readonly work: readonly WorkId[];
};
export type DebugRecordingProvider = {
    readonly name: string;
    readonly recorded: () => readonly unknown[];
};
export type TestDebugScope = {
    readonly includeRecording: (provider: DebugRecordingProvider) => void;
};
const debugWorkIdSchema: z.ZodType<WorkId> = workIdSchema;
const unavailable = z.strictObject({ availability: z.literal('unavailable'), reason: z.string() });
const measurement = z.union([
    unavailable,
    z.strictObject({
        availability: z.literal('available'),
        value: z.number(),
        scope: z.enum([ 'thread', 'process' ]),
        method: z.string(),
        overlappingWork: z.array(debugWorkIdSchema)
    })
]);
const timelineEntrySchema = z.strictObject({
    kind: z.enum([ 'body-start', 'assert', 'require', 'plan', 'body-end', 'rejection' ]),
    atNanoseconds: z.string().regex(/^\d+$/u),
    declared: z.number().nullable(),
    label: z.string().nullable(),
    sourceLocations: z.array(sourceLocationSchema),
    reason: serializedValueSchema.nullable()
});
export type TimelineEntry = ReadonlyDeep<z.infer<typeof timelineEntrySchema>>;
export const testDebugPayloadSchema = z.strictObject({
    kind: z.literal('debug'),
    schemaVersion: z.literal(1),
    verdict: z.enum([ 'pass', 'fail', 'skip', 'inconclusive', 'crashed', 'process-exhausted', 'runtime-policy' ]),
    outcome: z.enum([ 'pass', 'fail', 'skip', 'inconclusive' ]).nullable(),
    durationMicroseconds: z.number(),
    timeline: z.array(timelineEntrySchema),
    recordings: z.array(
        z.strictObject({
            name: z.string(),
            events: z.array(serializedValueSchema),
            error: serializedValueSchema.nullable()
        })
    ),
    moduleLoads: z.array(z.strictObject({
        phase: z.enum([ 'resolve', 'load' ]),
        specifier: z.string(),
        resolvedUrl: z.string().nullable(),
        atNanoseconds: z.string(),
        durationMicroseconds: z.number()
    })),
    cpuTimeMs: measurement,
    heapBeforeBytes: measurement,
    heapAfterBytes: measurement,
    sampledHeapPeakBytes: measurement,
    activeHandlesDelta: measurement,
    stats: z.strictObject({
        assertCount: z.number(),
        requireCount: z.number(),
        handleCallCount: z.number(),
        moduleLoadCount: z.number(),
        uncachedModuleLoadCount: unavailable,
        unaccountedGapMs: unavailable,
        heapGrowthBytes: z.number().nullable(),
        handleLeakCount: z.number().nullable(),
        softTimeoutHeadroomMs: z.number().nullable()
    }),
    plan: z.strictObject({ declared: z.number(), recorded: z.number() }).nullable(),
    completeness: z.enum([ 'complete', 'truncated', 'incomplete' ]),
    droppedEntries: z.number()
});
export type DebugStats = ReadonlyDeep<z.infer<typeof testDebugPayloadSchema>['stats']>;
export type TestDebugPayload = ReadonlyDeep<z.infer<typeof testDebugPayloadSchema>>;
