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

const fileGlobSchema = z.string();

const profileFilePatternsSchema = z
    .strictObject({
        exclude: z.optional(z.array(fileGlobSchema).readonly()),
        include: z.tuple([ fileGlobSchema ]).rest(fileGlobSchema).readonly(),
        sets: z.optional(z.never())
    })
    .readonly();

const profileFileSetSchema = z
    .strictObject({
        exclude: z.optional(z.array(fileGlobSchema).readonly()),
        include: z.tuple([ fileGlobSchema ]).rest(fileGlobSchema).readonly()
    })
    .readonly();

const profileFileSetsSchema = z
    .strictObject({
        exclude: z.optional(z.never()),
        include: z.optional(z.never()),
        sets: z.record(z.string(), profileFileSetSchema).readonly()
    })
    .readonly();

const profileFilesSchema = z.union([ profileFilePatternsSchema, profileFileSetsSchema ]).readonly();

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

const workerLifecycleSchema = z.union([
    z.literal('fresh-worker-per-unit'),
    z.literal('reuse')
]);

const workerPoolAssignmentPolicySchema = z.union([
    z.literal('case-count-balanced'),
    z.literal('stable')
]);

const workGroupGranularitySchema = z.union([
    z.literal('case'),
    z.literal('file'),
    z.literal('group')
]);

const workGroupOrderSchema = z.union([
    z.literal('lexical'),
    z.literal('plan'),
    z.literal('profile-default'),
    z.literal('seeded')
]);

const workGroupSchedulingSchema = z.union([
    z.literal('concurrent'),
    z.literal('profile-default'),
    z.literal('serial')
]);

const workGroupWorkerLifecycleSchema = z.union([
    z.literal('fresh-worker-per-unit'),
    z.literal('profile-default'),
    z.literal('reuse')
]);

const workGroupSchema = z
    .strictObject({
        fileSets: z.tuple([ z.string() ]).rest(z.string()).readonly(),
        granularity: z.optional(workGroupGranularitySchema),
        name: z.string(),
        order: z.optional(workGroupOrderSchema),
        scheduling: z.optional(workGroupSchedulingSchema),
        workerLifecycle: z.optional(workGroupWorkerLifecycleSchema)
    })
    .readonly();

const workDistributionSchema = z.discriminatedUnion('mode', [
    z
        .strictObject({
            mode: z.literal('file')
        })
        .readonly(),
    z
        .strictObject({
            mode: z.literal('case')
        })
        .readonly(),
    z
        .strictObject({
            groups: z.tuple([ workGroupSchema ]).rest(workGroupSchema).readonly(),
            mode: z.literal('group'),
            unmatched: z.optional(z.union([ z.literal('file'), z.literal('reject') ]))
        })
        .readonly()
]);

export const integrationExecutionSchema = z.discriminatedUnion('processModel', [
    z
        .strictObject({
            processModel: z.literal('supervised-process'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
        })
        .readonly(),
    z
        .strictObject({
            assignmentPolicy: z.optional(workerPoolAssignmentPolicySchema),
            processModel: z.literal('worker-pool'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ])),
            workDistribution: z.optional(workDistributionSchema),
            workerLifecycle: z.optional(workerLifecycleSchema)
        })
        .readonly()
]);

export const microtestProfileSchema = z
    .strictObject({
        execution: z.optional(microtestExecutionSchema),
        files: z.optional(profileFilesSchema),
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('microtest'),
        timeouts: z.optional(timeoutSchema)
    })
    .readonly();

export const integrationProfileSchema = z
    .strictObject({
        execution: z.optional(integrationExecutionSchema),
        files: profileFilesSchema,
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('integration'),
        timeouts: z.optional(timeoutSchema)
    })
    .readonly();

const profileSchema = z.discriminatedUnion('testFamily', [
    integrationProfileSchema,
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
export type RunProjectProfileFiles = z.infer<typeof profileFilesSchema>;
export type RunProjectMeasuredResourceUsage = z.infer<typeof measuredResourceUsageSchema>;
export type RunProjectUnmeasuredResourceUsage = z.infer<typeof unmeasuredResourceUsageSchema>;
export type RunProjectResourceUsageConfig = z.infer<typeof resourceUsageSchema>;
export type RunProjectTimeoutConfig = z.infer<typeof timeoutSchema>;
export type RunProjectIntegrationExecution = z.infer<typeof integrationExecutionSchema>;
export type RunProjectIntegrationProfileConfig = z.infer<typeof integrationProfileSchema>;
export type RunProjectMicrotestExecution = z.infer<typeof microtestExecutionSchema>;
export type RunProjectMicrotestProfileConfig = z.infer<typeof microtestProfileSchema>;
export type RunProjectConfig = z.infer<typeof projectConfigSchema>;
