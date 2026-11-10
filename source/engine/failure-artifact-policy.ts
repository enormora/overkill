import { z } from 'zod/v4';
import { defaultSerializationBudget, type SerializationBudget } from '../compare/serialized-value-shape.ts';

export type FailureArtifactPolicy = {
    readonly capturedOutputBytes: number;
    readonly serialization: SerializationBudget;
    readonly rendering: {
        readonly diffLines: number;
        readonly valueBytes: number;
    };
};

export const defaultFailureArtifactPolicy: FailureArtifactPolicy = {
    capturedOutputBytes: 1_048_576,
    serialization: defaultSerializationBudget,
    rendering: { diffLines: 100, valueBytes: 8192 }
};

const limit = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const resolvedFailureArtifactPolicySchema = z.strictObject({
    capturedOutputBytes: limit,
    serialization: z.strictObject({
        arrayEntries: limit,
        depth: limit,
        objectEntries: limit,
        operandBytes: limit,
        stringBytes: limit,
        visitedNodes: limit
    }),
    rendering: z.strictObject({ diffLines: limit, valueBytes: limit })
});

export const executionArtifactPolicySchema = resolvedFailureArtifactPolicySchema.prefault(defaultFailureArtifactPolicy);
