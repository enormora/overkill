import { z } from 'zod/v4';
import type { RunResult, RunnerError } from '../engine/run-result.ts';
import { attemptIdSchema, caseIdSchema, sourceLocationsSchema, workIdSchema } from '../engine/identity-schema.ts';
import { testOutcomeSchema } from './assertion-result-schema.ts';
import { runArtifactSchema, testAttemptSchema, verdictSchema } from './run-artifact-schema.ts';
import { resourceUsageSchema, runTimingsSchema } from './run-runtime-schema.ts';

export const runnerErrorSchema: z.ZodType<RunnerError> = z.strictObject({
    attributedToAttempt: attemptIdSchema.nullable(),
    attributedTo: caseIdSchema.nullable(),
    attributedToWork: workIdSchema.nullable().default(null),
    cause: z.unknown(),
    diagnostics: z.array(z.strictObject({ label: z.string(), value: z.string() })),
    message: z.string(),
    subtype: z.enum([
        'artifact',
        'attribution-drift',
        'coverage',
        'crash',
        'fixture',
        'loader',
        'permission',
        'reporter',
        'resource-exhaustion',
        'runtime-state',
        'runtime-policy',
        'uncaught-exception',
        'unhandled-rejection'
    ])
});
export const runResultSchema: z.ZodType<RunResult> = z.strictObject({
    artifacts: z.array(runArtifactSchema),
    bySuite: z.record(
        z.string(),
        z.strictObject({ discovered: z.number(), executed: z.number(), planned: z.number() })
    ),
    orphans: z.array(
        z.strictObject({
            definitionLocations: sourceLocationsSchema,
            file: z.string().nullable(),
            kind: z.enum([ 'suite', 'table', 'test' ]),
            title: z.string()
        })
    ),
    perTest: z.array(z.strictObject({
        attempts: z.tuple([ testAttemptSchema ]).rest(testAttemptSchema),
        retried: z.strictObject({ attempts: z.number(), finalVerdict: verdictSchema }).nullable(),
        definitionLocations: sourceLocationsSchema,
        id: caseIdSchema,
        outcome: testOutcomeSchema.nullable(),
        verdict: verdictSchema,
        workId: workIdSchema,
        durationMicroseconds: z.number()
    })),
    planStatus: z.enum([ 'empty-selection', 'empty-shard', 'planned' ]),
    resourceUsage: resourceUsageSchema.nullable(),
    runnerErrors: z.array(runnerErrorSchema),
    status: z.enum([ 'failed', 'passed' ]),
    summary: z.strictObject({
        crashed: z.number(),
        defined: z.number(),
        discovered: z.number(),
        failed: z.number(),
        inconclusive: z.number(),
        passed: z.number(),
        planned: z.number(),
        resourceExhausted: z.number(),
        runtimePolicy: z.number(),
        skipped: z.number()
    }),
    timings: runTimingsSchema
});
