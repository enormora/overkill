import { z } from 'zod/v4';
import { workIdSchema } from '../engine/identity-schema.ts';
import { benchmarkHostAssessmentSchema, benchmarkPlacementFactsSchema } from '../bench/benchmark-host-snapshot.ts';
import { benchmarkNormalizationContextSchema } from '../bench/calibration-evidence.ts';
import { benchmarkCalibrationSchema } from '../bench/calibration-schema.ts';
import type { ReplayPlanningFacts } from './replay-record-types.ts';
import { runSelectionSchema } from './run-selection-schema.ts';
import { runShardHashAlgorithm } from './run-shard-hash-algorithm.ts';
import { replayPlacementPlanSchema } from './replay-placement-schema.ts';

const hostReason = z.enum([
    'benchmark-isolation',
    'debugging',
    'forced-garbage-collection',
    'host-isolation',
    'node-arguments',
    'profiling'
]);
const workerCount = z.strictObject({
    hostMaximum: z.number().int().positive(),
    profileMaximum: z.number().int().positive().nullable(),
    requested: z.number().int().positive().nullable(),
    resolved: z.number().int().positive()
});
const durationObservation = z.strictObject({
    durationMicroseconds: z.number().nonnegative(),
    observedAt: z.string(),
    metadata: z.strictObject({
        processModel: z.enum([ 'in-process', 'supervised-process', 'worker-pool' ]),
        profile: z.string(),
        scheduling: z.enum([ 'concurrent', 'serial' ]),
        testFamily: z.enum([ 'microtest', 'integration', 'benchmark', 'property' ]),
        workerLifecycle: z.enum([ 'fresh-worker-per-unit', 'reuse' ]).nullable()
    })
});
export const replayPlanningSchema: z.ZodType<ReplayPlanningFacts> = z.object({
    reproducibility: z.strictObject({
        selection: runSelectionSchema,
        seed: z.string().regex(/^\d+$/u),
        shard: z.strictObject({ index: z.number().int().positive(), total: z.number().int().positive() }),
        shardHashAlgorithm: z.literal(runShardHashAlgorithm)
    }),
    benchmarkHost: benchmarkHostAssessmentSchema.nullable(),
    benchmarkPlacement: benchmarkPlacementFactsSchema.nullable(),
    benchmarkCalibration: benchmarkCalibrationSchema.nullable(),
    benchmarkNormalization: benchmarkNormalizationContextSchema.nullable(),
    durationHistory: z
        .strictObject({
            generatedAt: z.string(),
            source: z.literal('runtime-state-index'),
            samples: z.array(z.strictObject({
                durationMicroseconds: z.number().nonnegative(),
                observedAt: z.string(),
                observations: z.array(durationObservation),
                sampleCount: z.number().int().nonnegative(),
                work: workIdSchema
            }))
        })
        .nullable(),
    cases: z.array(z.object({ workId: workIdSchema, fileSet: z.string().nullable() })),
    execution: z.object({
        testFamily: z.enum([ 'microtest', 'property', 'integration', 'benchmark' ]),
        processModel: z.enum([ 'in-process', 'supervised-process', 'worker-pool' ]),
        dispatchPolicy: z.enum([ 'dynamic-lease', 'static-assignment' ]).nullable().default(null),
        scheduling: z.enum([ 'concurrent', 'serial' ]),
        placementPlan: replayPlacementPlanSchema.nullable(),
        workerCount: workerCount.nullable().default(null),
        hostProcess: z
            .union([
                z.strictObject({ kind: z.literal('direct') }),
                z.strictObject({
                    kind: z.literal('child'),
                    nodeArguments: z.array(z.string()),
                    reasons: z.tuple([ hostReason ]).rest(hostReason)
                })
            ])
            .nullable()
            .default(null)
    })
});
