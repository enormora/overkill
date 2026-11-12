import { z } from 'zod/v4';
import { workIdSchema, runtimeIdSchema } from '../engine/identity-schema.ts';
import { currentRunRecordVersion } from './run-record-format.ts';
import { mergeFactsSchema } from './merge-facts-schema.ts';
import { runResultSchema } from './run-result-schema.ts';
import { parseSerializedRunDiagnostics } from './run-record-result.ts';

export const mergeRecordSchema = z.object({
    version: z.union([ z.literal(1), z.literal(currentRunRecordVersion) ]),
    kind: z.literal('single'),
    status: z.literal('completed'),
    id: z.string().min(1),
    facts: mergeFactsSchema,
    identities: z.array(workIdSchema),
    runtime: z
        .object({
            id: runtimeIdSchema,
            adapters: z.array(z.object({ name: z.string(), version: z.string() })),
            machineClass: z.string().nullable(),
            nodeVersion: z.string().nullable(),
            os: z.string().nullable()
        })
        .nullable(),
    versions: z.object({ engine: z.string().nullable(), node: z.string(), packages: z.record(z.string(), z.string()) }),
    result: runResultSchema.transform(function recorded(result) {
        return {
            ...result,
            ...parseSerializedRunDiagnostics({
                artifacts: result.artifacts,
                perTest: result.perTest,
                runnerErrors: result.runnerErrors
            })
        };
    })
});
export type MergeRecord = Readonly<z.output<typeof mergeRecordSchema>>;
