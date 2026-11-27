import { z } from 'zod/v4';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { serializedValueSchema } from '../compare/serialized-value-schema.ts';
import type { TestOutcome } from './run-result.ts';
import { workIdSchema, sourceLocationsSchema } from './identity-schema.ts';
import { diffPathSchema, diffSchema } from './diff-schema.ts';
import { runArtifactIdSchema } from './artifact-schema.ts';

const thrownErrorSchema = z.strictObject({
    message: z.string(),
    name: z.string(),
    stack: z.string().nullable(),
    thrown: z.unknown()
});
const foreignErrorSchema = z.union([
    thrownErrorSchema.extend({ thrown: serializedValueSchema, thrownEncoding: z.literal('serialized') }),
    thrownErrorSchema
]);
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
        z.strictObject({ ...base, kind: z.literal('foreign'), error: foreignErrorSchema, label: z.string() })
    ]);
});
export const resourceCheckOwnerSchema = z.strictObject({
    run: z.string(),
    id: z.string(),
    scope: z.enum([ 'per-run', 'per-file', 'per-suite', 'per-case', 'shared-per-worker' ])
});
export const resourceCheckIntervalSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('lifetime') }),
    z.strictObject({
        kind: z.literal('attempt'),
        work: workIdSchema,
        attempt: z.strictObject({ index: z.number().int().nonnegative() })
    })
]);
export const resourceCheckSnapshotSchema = z.strictObject({
    owner: resourceCheckOwnerSchema,
    revision: z.number().int().nonnegative(),
    resource: z.string(),
    interval: resourceCheckIntervalSchema,
    passing: z.number().int().nonnegative(),
    failures: z.array(z.strictObject({ target: z.string().nullable(), check: failedCheckSchema })),
    errors: z.array(
        z.strictObject({ interval: resourceCheckIntervalSchema, target: z.string().nullable(), cause: z.unknown() })
    ),
    status: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('open') }),
        z.strictObject({ kind: z.literal('complete') }),
        z.strictObject({ kind: z.literal('incomplete'), reasons: z.array(z.string()) })
    ])
});
const failureSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('resource-check'),
        owner: resourceCheckOwnerSchema,
        resource: z.string(),
        interval: z.strictObject({
            kind: z.literal('attempt'),
            work: workIdSchema,
            attempt: z.strictObject({ index: z.number().int().nonnegative() })
        }),
        failures: z.tuple([ z.strictObject({ target: z.string().nullable(), check: failedCheckSchema }) ]).rest(
            z.strictObject({ target: z.string().nullable(), check: failedCheckSchema })
        )
    }),
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
            'invalid-assertion-context',
            'invalid-assertion-protocol',
            'invalid-assertion-reference',
            'invalid-composite-result',
            'invalid-deep-assertion-operand',
            'invalid-plan',
            'invalid-timeout-control',
            'invalid-require-reference',
            'invalid-returned-builder-assertion',
            'late-assertion-activity',
            'no-assertions',
            'property-scope',
            'property-observation',
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
