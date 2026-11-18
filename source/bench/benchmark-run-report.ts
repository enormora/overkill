import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import { benchmarkNormalizationContextSchema } from './calibration-evidence.ts';
import { benchmarkCalibrationSchema } from './calibration-schema.ts';
import { benchmarkPlacementFactsSchema, benchmarkHostAssessmentSchema } from './benchmark-host-snapshot.ts';

export const benchmarkRunFactsSchema = z.object({
    environment: z.object({ node: z.object({ arch: z.string(), platform: z.string(), version: z.string() }) }),
    execution: z.object({
        testFamily: z.literal('benchmark'),
        profile: z.string(),
        processModel: z.string(),
        scheduling: z.string(),
        maxConcurrency: z.union([ z.number(), z.literal('unlimited') ]),
        workerCount: z.object({ resolved: z.number() }).nullable().default(null),
        workerLifecycle: z.string().nullable().default(null)
    }),
    benchmarkCalibration: benchmarkCalibrationSchema.nullable(),
    benchmarkHost: benchmarkHostAssessmentSchema.nullable(),
    benchmarkPlacement: benchmarkPlacementFactsSchema.nullable(),
    benchmarkNormalization: benchmarkNormalizationContextSchema.nullable()
});
export type BenchmarkRunMetadata = ReadonlyDeep<{
    readonly node: z.output<typeof benchmarkRunFactsSchema>['environment']['node'];
    readonly execution: {
        readonly profile: string;
        readonly processModel: string;
        readonly scheduling: string;
        readonly maxConcurrency: number | 'unlimited';
        readonly workerCount: number | null;
        readonly workerLifecycle: string | null;
    };
    readonly calibration: z.output<typeof benchmarkRunFactsSchema>['benchmarkCalibration'];
    readonly host: z.output<typeof benchmarkRunFactsSchema>['benchmarkHost'];
    readonly placement: z.output<typeof benchmarkRunFactsSchema>['benchmarkPlacement'];
    readonly normalization: z.output<typeof benchmarkRunFactsSchema>['benchmarkNormalization'];
}>;
export function readBenchmarkRunMetadata(facts: Readonly<Record<string, unknown>> | null): BenchmarkRunMetadata | null {
    const parsed = benchmarkRunFactsSchema.safeParse(facts);
    if (!parsed.success) {
        return null;
    }
    const value = parsed.data;
    const { execution } = value;
    return {
        node: value.environment.node,
        execution: {
            profile: execution.profile,
            processModel: execution.processModel,
            scheduling: execution.scheduling,
            maxConcurrency: execution.maxConcurrency,
            workerCount: execution.workerCount?.resolved ?? null,
            workerLifecycle: execution.workerLifecycle
        },
        calibration: value.benchmarkCalibration,
        host: value.benchmarkHost,
        placement: value.benchmarkPlacement,
        normalization: value.benchmarkNormalization
    };
}
