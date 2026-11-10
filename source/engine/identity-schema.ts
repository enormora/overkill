import { z } from 'zod/v4';

export const caseIdSchema = z.strictObject({
    file: z.string().nullable(),
    params: z.string().nullable(),
    suite: z.array(z.string()),
    title: z.string()
});
export const runtimeIdSchema = z.strictObject({
    dimensions: z.record(z.string(), z.string()),
    name: z.string(),
    scenarios: z.record(z.string(), z.string()),
    variantId: z.string().nullable()
});
export const workloadIdSchema = z.strictObject({ name: z.string(), params: z.record(z.string(), z.string()) });
export const familyVariantSchema = z.strictObject({ family: z.string().min(1), key: z.string().min(1) }).nullable();
const currentWorkIdSchema = z.strictObject({
    case: caseIdSchema,
    runtimes: z.array(runtimeIdSchema),
    workload: workloadIdSchema.nullable(),
    familyVariant: familyVariantSchema.default(null)
});
export const workIdSchema = z.union([
    currentWorkIdSchema,
    z
        .strictObject({
            case: caseIdSchema,
            runtimes: z.array(runtimeIdSchema),
            workload: workloadIdSchema.nullable(),
            compiler: z.strictObject({ name: z.literal('typescript'), version: z.string().min(1) })
        })
        .transform(function migrateCompilerIdentity(work) {
            const { compiler, ...identity } = work;
            return {
                ...identity,
                familyVariant: { family: '@overkill-dev/type-test', key: `typescript@${compiler.version}` }
            };
        })
]);
export const attemptIdSchema = z.strictObject({ index: z.number().int().nonnegative() });
export const sourceLocationSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('unknown') }),
    z.strictObject({
        column: z.number().nullable(),
        file: z.string(),
        kind: z.literal('known'),
        line: z.number().nullable()
    })
]);
export const sourceLocationsSchema = z.tuple([ sourceLocationSchema ]).rest(sourceLocationSchema);
export const annotationsSchema = z.strictObject({ ownership: z.array(z.string()), tags: z.array(z.string()) });
export const controlsSchema = z.strictObject({
    capture: z.enum([ 'buffered', 'live' ]).nullable(),
    duplicateExecution: z.enum([ 'forbidden', 'idempotent' ]).nullable(),
    timeoutMilliseconds: z.number().nullable()
});
export const suitePathSchema = z.array(
    z.strictObject({ definitionLocations: sourceLocationsSchema, title: z.string() })
);
