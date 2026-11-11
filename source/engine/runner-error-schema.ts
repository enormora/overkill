import { z } from 'zod/v4';
import { attemptIdSchema, caseIdSchema, workIdSchema } from './identity-schema.ts';
import type { RunnerError } from './run-result.ts';

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
        'measurement',
        'merge',
        'permission',
        'reporter',
        'process-exhaustion',
        'runtime-state',
        'witness-replay',
        'runtime-policy',
        'uncaught-exception',
        'unhandled-rejection'
    ])
});
