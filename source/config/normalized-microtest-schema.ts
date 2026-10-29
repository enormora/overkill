import { z } from 'zod/v4';
import { coveragePolicySchema } from './coverage-schema.ts';
import {
    microtestExecutionSchema,
    profileFilesSchema,
    processBudgetsSchema,
    timeoutSchema,
    timingProfilePolicySchema
} from './schema.ts';

const [ patterns, sets ] = profileFilesSchema.unwrap().options;
const filePatterns = patterns.unwrap().omit({ sets: true }).required();
const files = z.union([
    filePatterns,
    sets.unwrap().omit({ exclude: true, include: true }).extend({ sets: z.record(z.string(), filePatterns) })
]);
const [ loadedSources, allSources ] = coveragePolicySchema.unwrap().shape.sources.unwrap().options;
const thresholds = coveragePolicySchema.unwrap().shape.thresholds.unwrap().unwrap().shape;

export const normalizedProcessBudgetsSchema = processBudgetsSchema.unwrap().required();

export const normalizedMicrotestProfileSchema = z.strictObject({
    coverage: z.strictObject({
        outputDirectory: coveragePolicySchema.unwrap().shape.outputDir.unwrap().nullable(),
        outputs: coveragePolicySchema.unwrap().shape.outputs.unwrap(),
        sources: z.union([ loadedSources.unwrap().required(), allSources.unwrap().required() ]),
        thresholds: z.strictObject({
            branches: thresholds.branches.unwrap().nullable(),
            functions: thresholds.functions.unwrap().nullable(),
            lines: thresholds.lines.unwrap().nullable()
        })
    }),
    execution: z.union([
        microtestExecutionSchema.options[0].unwrap().required(),
        microtestExecutionSchema.options[1].unwrap().required()
    ]),
    files: files.nullable(),
    processUsage: z.strictObject({
        budgets: normalizedProcessBudgetsSchema,
        measure: z.boolean(),
        samplingIntervalMilliseconds: z.number().int().positive()
    }),
    testFamily: z.literal('microtest'),
    runRecords: z.strictObject({ persist: z.enum([ 'on-demand', 'always' ]) }),
    timings: timingProfilePolicySchema,
    timeouts: timeoutSchema.unwrap().required()
});
