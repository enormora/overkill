import { z } from 'zod/v4';

export const hostProcessSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('direct') }),
    z.strictObject({ kind: z.literal('child'), nodeArguments: z.array(z.string()) })
]);
export const executionCommandFields = {
    retryPolicy: z
        .strictObject({
            artifacts: z.enum([ 'first-failure-and-final', 'last-failure-and-final', 'all' ]),
            maxAttempts: z.number().int().positive()
        })
        .nullable(),
    collectionTimeoutMilliseconds: z.number(),
    cwd: z.string(),
    definitionLocationCapture: z.enum([ 'disabled', 'enabled' ]),
    engine: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('default') }),
        z.strictObject({
            exportKind: z.enum([ 'getter', 'value' ]),
            exportName: z.string(),
            kind: z.literal('module'),
            moduleUrl: z.string()
        })
    ]),
    paths: z.array(z.string()),
    hardTimeoutMilliseconds: z.number(),
    maxConcurrency: z.union([ z.number().int().positive(), z.literal('unlimited') ]),
    resourceBudgets: z.strictObject({
        activeResourceCount: z.number().nullable(),
        javaScriptEngineHeapBytes: z.number().nullable(),
        residentSetBytes: z.number().nullable(),
        residentSetGrowthBytesPerSecond: z.number().nullable()
    }),
    resourceUsageSamplingIntervalMilliseconds: z.number(),
    root: z.strictObject({
        annotations: z
            .strictObject({ ownership: z.array(z.string()).optional(), tags: z.array(z.string()).optional() })
            .transform(function omitAbsentAnnotations({ ownership, tags }) {
                return { ...ownership === undefined ? {} : { ownership }, ...tags === undefined ? {} : { tags } };
            }),
        controls: z
            .strictObject({
                capture: z.enum([ 'buffered', 'live' ]).optional(),
                duplicateExecution: z.enum([ 'forbidden', 'idempotent' ]).optional(),
                timeoutMilliseconds: z.number().optional()
            })
            .transform(function omitAbsentControls({ capture, duplicateExecution, timeoutMilliseconds }) {
                return {
                    ...capture === undefined ? {} : { capture },
                    ...duplicateExecution === undefined ? {} : { duplicateExecution },
                    ...timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }
                };
            }),
        title: z.string()
    }),
    scheduling: z.enum([ 'concurrent', 'serial' ]),
    testFamily: z.enum([ 'benchmark', 'integration', 'microtest' ]),
    timeoutMilliseconds: z.number()
};
