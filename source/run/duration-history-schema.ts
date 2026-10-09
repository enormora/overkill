import { z } from 'zod';

export const durationHistoryIndexVersion = 2;
const legacyDurationHistoryIndexVersion = 1;
const microsecondsPerMillisecond = 1000;
const stringRecordSchema = z.record(z.string(), z.string()).readonly();
const caseIdSchema = z
    .strictObject({
        file: z.string().nullable(),
        params: z.string().nullable(),
        suite: z.array(z.string()).readonly(),
        title: z.string()
    })
    .readonly();
const runtimeIdSchema = z
    .strictObject({
        dimensions: stringRecordSchema,
        name: z.string(),
        scenarios: stringRecordSchema,
        variantId: z.string().nullable()
    })
    .readonly();
const legacyRuntimeIdSchema = z
    .strictObject({
        dimensions: stringRecordSchema,
        name: z.string(),
        variantId: z.string().nullable()
    })
    .readonly()
    .transform(function addScenarioBindings(runtime) {
        return { ...runtime, scenarios: {} };
    });
const workloadIdSchema = z
    .strictObject({
        name: z.string(),
        params: stringRecordSchema
    })
    .readonly();
const metadataSchema = z
    .strictObject({
        processModel: z.union([
            z.literal('in-process'),
            z.literal('supervised-process'),
            z.literal('worker-pool')
        ]),
        profile: z.string(),
        scheduling: z.union([ z.literal('concurrent'), z.literal('serial') ]),
        testFamily: z.enum([ 'benchmark', 'integration', 'microtest' ]),
        workerLifecycle: z.union([ z.literal('fresh-worker-per-unit'), z.literal('reuse') ]).nullable()
    })
    .readonly();
const currentObservationSchema = z
    .strictObject({
        durationMicroseconds: z.number().check(z.nonnegative()),
        metadata: metadataSchema,
        observedAt: z.iso.datetime({ offset: true })
    })
    .readonly();
const legacyObservationSchema = z
    .strictObject({
        durationMilliseconds: z.number().check(z.nonnegative()),
        metadata: metadataSchema,
        observedAt: z.iso.datetime({ offset: true })
    })
    .readonly()
    .transform(function toMicrosecondObservation(observation) {
        return {
            durationMicroseconds: observation.durationMilliseconds * microsecondsPerMillisecond,
            metadata: observation.metadata,
            observedAt: observation.observedAt
        };
    });
const observationSchema = z.union([ currentObservationSchema, legacyObservationSchema ]);

const workIdSchema = z
    .strictObject({
        case: caseIdSchema,
        runtimes: z.array(runtimeIdSchema).readonly(),
        workload: workloadIdSchema.nullable()
    })
    .readonly();
const legacyWorkIdSchema = z
    .strictObject({
        case: caseIdSchema,
        runtimes: z.array(legacyRuntimeIdSchema).readonly(),
        workload: workloadIdSchema.nullable()
    })
    .readonly();
const entrySchema = z
    .strictObject({
        observations: z.array(observationSchema).readonly(),
        work: workIdSchema
    })
    .readonly();
const legacyEntrySchema = z
    .strictObject({
        observations: z.array(observationSchema).readonly(),
        work: legacyWorkIdSchema
    })
    .readonly();
type CurrentDurationHistoryIndex = {
    readonly entries: readonly z.output<typeof entrySchema>[];
    readonly updatedAt: string;
    readonly version: typeof durationHistoryIndexVersion;
};

const currentIndexSchema = z
    .strictObject({
        entries: z.array(entrySchema).readonly(),
        updatedAt: z.iso.datetime({ offset: true }),
        version: z.literal(durationHistoryIndexVersion)
    })
    .readonly();
const legacyIndexSchema = z
    .strictObject({
        entries: z.array(legacyEntrySchema).readonly(),
        updatedAt: z.iso.datetime({ offset: true }),
        version: z.literal(legacyDurationHistoryIndexVersion)
    })
    .readonly()
    .transform(function migrateIndex(index): CurrentDurationHistoryIndex {
        return {
            entries: index.entries,
            updatedAt: index.updatedAt,
            version: durationHistoryIndexVersion
        };
    });

export const durationHistoryIndexSchema = z.union([ currentIndexSchema, legacyIndexSchema ]);
