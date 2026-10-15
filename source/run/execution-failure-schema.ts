import { z } from 'zod/v4';
import { parseRunnerError } from './run-result-schema.ts';
import type { RunExecutionFailure as ExecutionFailure } from './execution-session-types.ts';

const failureFields = { name: z.string(), message: z.string(), cause: z.unknown(), stack: z.string().nullable() };
const runnerError = z.unknown().transform(parseRunnerError);

export const runExecutionFailureSchema = z
    .discriminatedUnion('kind', [
        z.strictObject({ ...failureFields, kind: z.literal('config-error') }),
        z.strictObject({
            ...failureFields,
            kind: z.literal('resolution-error'),
            code: z.enum([ 'invalid-request', 'no-tests-collected', 'unsupported-request' ])
        }),
        z.strictObject({
            ...failureFields,
            kind: z.literal('collection-error'),
            errors: z.tuple([ runnerError ]).rest(runnerError)
        }),
        z.strictObject({ ...failureFields, kind: z.literal('error') })
    ])
    .readonly();

export type RunExecutionFailure = ExecutionFailure;
export function parseRunExecutionFailure(value: unknown): RunExecutionFailure {
    return runExecutionFailureSchema.parse(value);
}
