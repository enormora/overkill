import { z } from 'zod/v4';
import { attemptIdSchema, caseIdSchema, runtimeIdSchema, workloadIdSchema } from './run-identity-schema.ts';

export const artifactIdentityFields = {
    runtimes: z.array(runtimeIdSchema),
    sequence: z.number(),
    workload: workloadIdSchema.nullable()
};
export const runArtifactIdSchema = z.union([
    z.strictObject({
        ...artifactIdentityFields,
        subtype: z.enum([ 'coverage', 'hedged-conflict', 'log-capture' ]),
        attempt: z.null(),
        scope: z.strictObject({ kind: z.literal('run') })
    }),
    z.strictObject({
        ...artifactIdentityFields,
        subtype: z.enum([ 'coverage', 'hedged-conflict', 'log-capture' ]),
        attempt: attemptIdSchema,
        scope: z.strictObject({
            activeCases: z.array(caseIdSchema),
            case: caseIdSchema,
            confidence: z.enum([ 'active-case', 'concurrent-active' ]),
            kind: z.literal('case')
        })
    })
]);
