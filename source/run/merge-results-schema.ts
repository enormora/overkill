import { z } from 'zod/v4';
import { workIdSchema, runtimeIdSchema } from '../engine/identity-schema.ts';
import {
    currentRunRecordVersion,
    previousRunRecordVersion,
    familyRunRecordVersion,
    validateImplementationRecord
} from './run-record-format.ts';
import { mergeFactsSchema } from './merge-facts-schema.ts';
import { runResultSchema } from './run-result-schema.ts';
import { parseSerializedRunDiagnostics } from './run-record-result.ts';

const mergeRecordData = z.object({
    version: z.union([
        z.literal(1),
        z.literal(previousRunRecordVersion),
        z.literal(familyRunRecordVersion),
        z.literal(currentRunRecordVersion)
    ]),
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
export const mergeRecordSchema = z.unknown().superRefine(validateImplementationRecord).pipe(mergeRecordData);
export type MergeRecord = Readonly<z.output<typeof mergeRecordSchema>>;

const mergedRecordData = mergeRecordData.omit({ status: true, runtime: true, versions: true }).extend({
    version: z.union([
        z.literal(previousRunRecordVersion),
        z.literal(familyRunRecordVersion),
        z.literal(currentRunRecordVersion)
    ]),
    kind: z.literal('merged'),
    status: z.enum([ 'started', 'completed', 'interrupted' ]),
    startedAt: z.iso.datetime({ offset: true }),
    lineage: z
        .tuple([ z.object({ id: z.string().min(1), path: z.string() }) ])
        .rest(z.object({ id: z.string().min(1), path: z.string() })),
    runtime: z.tuple([ mergeRecordData.shape.runtime ]).rest(mergeRecordData.shape.runtime),
    versions: mergeRecordData.shape.versions.omit({ node: true })
});

export const mergedRecordSchema = z.unknown().superRefine(validateImplementationRecord).pipe(mergedRecordData);
