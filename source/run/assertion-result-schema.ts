import { z } from 'zod/v4';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestOutcome } from '../engine/run-result.ts';
import { diffPathSchema, diffSchema } from './diff-schema.ts';
import { serializedValueSchema } from './serialized-value-schema.ts';
import { runArtifactIdSchema } from './run-artifact-id-schema.ts';
import { sourceLocationsSchema } from './run-identity-schema.ts';

const thrownErrorSchema = z.strictObject({
    message: z.string(),
    name: z.string(),
    stack: z.string().nullable(),
    thrown: z.unknown()
});
const failedCheckSchema: z.ZodType<FailedCheck> = z.lazy(function () {
    const base = {
        actual: serializedValueSchema,
        expected: serializedValueSchema,
        diff: diffSchema.nullable(),
        id: z.string(),
        path: diffPathSchema,
        source: z.enum([ 'assert', 'require' ]),
        sourceLocations: sourceLocationsSchema,
        summary: z.string()
    };
    return z.discriminatedUnion('kind', [
        z.strictObject({ ...base, kind: z.literal('leaf') }),
        z.strictObject({
            ...base,
            kind: z.literal('composite'),
            children: z.tuple([ failedCheckSchema ]).rest(failedCheckSchema)
        }),
        z.strictObject({ ...base, kind: z.literal('foreign'), error: thrownErrorSchema, label: z.string() })
    ]);
});
const failureSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('assertion'), checks: z.tuple([ failedCheckSchema ]).rest(failedCheckSchema) }),
    z.strictObject({ kind: z.literal('body-error'), error: thrownErrorSchema }),
    z.strictObject({ kind: z.literal('cleanup-error'), error: thrownErrorSchema }),
    z.strictObject({
        kind: z.literal('hedged-duplicate-conflict'),
        artifact: runArtifactIdSchema,
        summary: z.string()
    }),
    z.strictObject({ kind: z.literal('timeout'), deadlineMilliseconds: z.number(), elapsedMilliseconds: z.number() }),
    z.strictObject({
        kind: z.literal('test-contract'),
        actual: z.unknown(),
        code: z.enum([
            'dead-builder-assertion',
            'invalid-assertion-reference',
            'invalid-composite-result',
            'invalid-deep-assertion-operand',
            'invalid-plan',
            'invalid-timeout-control',
            'invalid-require-reference',
            'no-assertions',
            'pending-in-flight-task',
            'pending-async-assertion',
            'plan-mismatch',
            'unobserved-in-flight-task'
        ]),
        expected: z.string(),
        summary: z.string()
    })
]);
export const testOutcomeSchema: z.ZodType<TestOutcome> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pass') }),
    z.strictObject({ kind: z.enum([ 'skip', 'inconclusive' ]), reason: z.string() }),
    z.strictObject({ kind: z.literal('fail'), failures: z.tuple([ failureSchema ]).rest(failureSchema) })
]);
