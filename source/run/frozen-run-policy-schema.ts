import { z } from 'zod/v4';
import { loaderSchema } from '../config/schema.ts';
import {
    normalizedMicrotestProfileSchema,
    normalizedResourceBudgetsSchema
} from '../config/normalized-microtest-schema.ts';
import type { FrozenMicrotestPolicy } from './run-types.ts';
import { executionCommandFields } from './run-command-schema.ts';
import { runSelectionSchema } from './run-selection-schema.ts';
import { fileModuleBoundarySchema } from './file-module-boundary.ts';

const fileSchema = z.strictObject({
    file: z.string().min(1),
    fileSet: z.string().nullable(),
    href: z.url(),
    path: z.string().min(1)
});

export const frozenMicrotestPolicySchema: z.ZodType<FrozenMicrotestPolicy> = z.strictObject({
    moduleBoundary: fileModuleBoundarySchema.nullable().default(null),
    source: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('memory') }),
        z.strictObject({
            kind: z.literal('config-file'),
            request: z.strictObject({ cwd: z.string().min(1), configPath: z.string().min(1).nullable() }),
            resolvedPath: z.string().min(1).nullable()
        })
    ]),
    cwd: z.string().min(1),
    projectRoot: z.string().min(1),
    files: z.tuple([ fileSchema ]).rest(fileSchema),
    loader: loaderSchema,
    profile: normalizedMicrotestProfileSchema,
    request: z.strictObject({
        baselineUpdateMode: z.literal('none'),
        capabilityRestrictions: z.strictObject({ mode: z.enum([ 'disabled', 'enabled' ]) }),
        capture: z.literal('buffered'),
        coverage: z.boolean(),
        debug: z.strictObject({ mode: z.literal('off'), selectors: z.tuple([]) }),
        execution: z.discriminatedUnion('mode', [
            z.strictObject({ mode: z.literal('profile-default') }),
            z.strictObject({ mode: z.literal('serial') })
        ]),
        measureResourceUsage: z.boolean().nullable(),
        order: z.enum([ 'lexical', 'plan', 'seeded' ]),
        paths: z.array(z.string()),
        profile: z.string().min(1),
        resourceBudgetOverrides: normalizedResourceBudgetsSchema.nullable(),
        resourceUsageSamplingIntervalMilliseconds: z.number().int().positive().nullable(),
        selection: runSelectionSchema,
        shard: z.strictObject({ index: z.number().int().positive(), total: z.number().int().positive() }),
        timingCollection: z.enum([ 'precise', 'profile-default' ]),
        verbose: z.literal(false),
        workers: z.null()
    }),
    engine: executionCommandFields.engine,
    runtimeStateDir: z.string().min(1)
});
