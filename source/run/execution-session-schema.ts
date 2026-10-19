import { z } from 'zod/v4';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import { frozenMicrotestPolicySchema } from './frozen-run-policy-schema.ts';
import { runResultSchema } from './run-result-schema.ts';
import { runExecutionFailureSchema } from './execution-failure-schema.ts';
import { runSelectionSchema } from './run-selection-schema.ts';
import { parseFrozenMicrotestPolicy } from './frozen-run-policy.ts';
import { RunResolutionError } from './run-errors.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';

export function normalizeExecutionSessionOptions(
    supplied: RunExecutionSessionOptions,
    createSeed: () => bigint
): RunExecutionSessionOptions {
    if (supplied.command.policy.request.coverage || supplied.command.policy.request.baselineUpdateMode !== 'none') {
        throw new RunResolutionError(
            'Memory execution sessions do not support recorded coverage or baseline updates.',
            undefined,
            'unsupported-request'
        );
    }
    return {
        ...supplied,
        lifecycle: { ...supplied.lifecycle },
        command: {
            ...supplied.command,
            policy: parseFrozenMicrotestPolicy(supplied.command.policy),
            invocation: {
                seed: { value: supplied.command.invocation.seed.value ?? createSeed() },
                selection: runSelectionSchema.parse(supplied.command.invocation.selection)
            },
            reporting: { outputRenderer: createPlainOutputRenderer(), reporters: [] }
        }
    };
}

export const executionTransportSchema = z.strictObject({
    lifecycle: z.strictObject({ moduleUrl: z.url(), exportName: z.string().min(1) }),
    data: z.json()
});
export const executionReplySchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('result'),
        result: runResultSchema,
        data: z.json(),
        deadlineExceeded: z.boolean()
    }),
    z.strictObject({ kind: z.literal('failure'), failure: runExecutionFailureSchema, data: z.json() }),
    z.strictObject({ kind: z.literal('timeout'), data: z.json() })
]);
const executionCheckpointSchema = z.strictObject({ kind: z.literal('execution-checkpoint'), data: z.json() });
export const executionHostMessageSchema = z.union([ executionReplySchema, executionCheckpointSchema ]);
export const executionHostRequestSchema = z.strictObject({
    policy: frozenMicrotestPolicySchema,
    seed: z.strictObject({ value: z.bigint().nonnegative() }),
    selection: runSelectionSchema,
    transport: executionTransportSchema,
    timeoutMilliseconds: z.number().positive()
});
