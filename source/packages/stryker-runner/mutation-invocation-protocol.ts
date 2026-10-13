import { z } from 'zod/v4';
import {
    parseFrozenMicrotestPolicy,
    parseRunSelection,
    parseRunResult,
    parseRunnerError
} from '../run/run.entry-point.ts';

const failureFields = { message: z.string(), cause: z.unknown(), stack: z.string().nullable() };
const runnerError = z.unknown().transform(parseRunnerError);

export const mutationInvocationFailureSchema = z
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

export const mutationInvocationRequestSchema = z
    .strictObject({
        kind: z.literal('run'),
        policy: z.unknown().transform(parseFrozenMicrotestPolicy),
        seed: z.strictObject({ value: z.bigint().nonnegative() }),
        selection: z.unknown().transform(parseRunSelection)
    })
    .readonly();

export const mutationInvocationResponseSchema = z
    .discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('result'), result: z.unknown().transform(parseRunResult) }),
        z.strictObject({ kind: z.literal('failure'), failure: mutationInvocationFailureSchema })
    ])
    .readonly();

export type MutationInvocationFailure = z.output<typeof mutationInvocationFailureSchema>;
export type MutationInvocationRequest = z.output<typeof mutationInvocationRequestSchema>;
export type MutationInvocationResponse = z.output<typeof mutationInvocationResponseSchema>;
