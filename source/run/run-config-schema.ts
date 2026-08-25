import { z } from 'zod/v4';
import { isOutputRenderer, type DefinedOutputRenderer } from '../engine/reporter-output.ts';
import { isReporter, type DefinedReporter } from '../engine/reporter.ts';

const reporterSchema = z.custom<DefinedReporter>(isReporter, 'must be created with defineReporter(...)');

const outputRendererSchema = z.custom<DefinedOutputRenderer>(
    isOutputRenderer,
    'must be created with defineOutputRenderer(...)'
);

const loaderSchema = z
    .strictObject({
        sourceMaps: z.boolean(),
        stripMode: z.literal('strip-only')
    })
    .readonly();

const positiveSafeIntegerSchema = z.number().refine(function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}, 'must be a positive safe integer');

export const resourceBudgetsSchema = z
    .strictObject({
        activeResourceCount: z.optional(z.nullable(positiveSafeIntegerSchema)),
        javaScriptEngineHeapBytes: z.optional(z.nullable(positiveSafeIntegerSchema)),
        residentSetBytes: z.optional(z.nullable(positiveSafeIntegerSchema)),
        residentSetGrowthBytesPerSecond: z.optional(z.nullable(positiveSafeIntegerSchema))
    })
    .readonly();

const measuredResourceUsageSchema = z
    .strictObject({
        budgets: z.optional(resourceBudgetsSchema),
        measure: z.literal(true),
        samplingIntervalMilliseconds: z.optional(positiveSafeIntegerSchema)
    })
    .readonly();

const unmeasuredResourceUsageSchema = z
    .strictObject({
        measure: z.optional(z.literal(false))
    })
    .readonly();

export const resourceUsageSchema = z.union([ measuredResourceUsageSchema, unmeasuredResourceUsageSchema ]);

export const timeoutSchema = z
    .strictObject({
        collectionMilliseconds: z.optional(positiveSafeIntegerSchema),
        hardMilliseconds: z.optional(positiveSafeIntegerSchema),
        softMilliseconds: z.optional(positiveSafeIntegerSchema)
    })
    .readonly();

export const microtestExecutionSchema = z.discriminatedUnion('processModel', [
    z
        .strictObject({
            processModel: z.literal('in-process'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
        })
        .readonly(),
    z
        .strictObject({
            processModel: z.literal('supervised-process'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
        })
        .readonly()
]);

export const microtestProfileSchema = z
    .strictObject({
        execution: z.optional(microtestExecutionSchema),
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('microtest'),
        timeouts: z.optional(timeoutSchema)
    })
    .readonly();

const profileSchema = z.discriminatedUnion('testFamily', [
    microtestProfileSchema
]);

const profilesSchema = z.record(z.string(), profileSchema).readonly();

export const projectConfigSchema = z
    .strictObject({
        loader: z.optional(loaderSchema),
        outputRenderer: z.optional(outputRendererSchema),
        profiles: z.optional(profilesSchema),
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        runtimeStateDir: z.optional(z.string().min(1))
    })
    .readonly();

export type RunProjectResourceBudgets = z.infer<typeof resourceBudgetsSchema>;
export type RunProjectMeasuredResourceUsage = z.infer<typeof measuredResourceUsageSchema>;
export type RunProjectUnmeasuredResourceUsage = z.infer<typeof unmeasuredResourceUsageSchema>;
export type RunProjectResourceUsageConfig = z.infer<typeof resourceUsageSchema>;
export type RunProjectTimeoutConfig = z.infer<typeof timeoutSchema>;
export type RunProjectMicrotestExecution = z.infer<typeof microtestExecutionSchema>;
export type RunProjectMicrotestProfileConfig = z.infer<typeof microtestProfileSchema>;
export type RunProjectProfileConfig = z.infer<typeof profileSchema>;
export type RunProjectProfilesConfig = z.infer<typeof profilesSchema>;
export type RunProjectConfig = z.infer<typeof projectConfigSchema>;
