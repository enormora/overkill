import { z } from 'zod/v4';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { isOutputRenderer, type DefinedOutputRenderer } from '../engine/reporter-output.ts';
import { isReporter, type DefinedReporter } from '../engine/reporter.ts';
import {
    coveragePolicySchema,
    type ProjectCoverageOutput as CoverageOutput,
    type ProjectCoveragePolicy as CoveragePolicy,
    type ProjectCoverageSources as CoverageSources,
    type ProjectCoverageThresholds as CoverageThresholds
} from './coverage-schema.ts';

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

const maxConcurrencySchema = z.union([ positiveSafeIntegerSchema, z.literal('unlimited') ]);

const integrationRetryPolicySchema = z
    .strictObject({
        artifacts: z.optional(z.enum([ 'first-failure-and-final', 'last-failure-and-final', 'all' ])),
        maxAttempts: positiveSafeIntegerSchema
    })
    .readonly();

export type ProjectIntegrationRetryPolicy = z.infer<typeof integrationRetryPolicySchema>;

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

const timingCollectionModeSchema = z.union([
    z.literal('precise'),
    z.literal('summary')
]);

export const timingProfilePolicySchema = z
    .strictObject({
        collection: timingCollectionModeSchema
    })
    .readonly();

export const microtestExecutionSchema = z.discriminatedUnion('processModel', [
    z
        .strictObject({
            maxConcurrency: z.optional(maxConcurrencySchema),
            processModel: z.literal('in-process'),
            scheduling: z.optional(z.union([ z.literal('concurrent'), z.literal('serial') ]))
        })
        .readonly(),
    z
        .strictObject({
            maxConcurrency: z.optional(maxConcurrencySchema),
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
    z.literal('duration-history-balanced'),
    z.literal('stable')
]);

const workerPoolDispatchPolicySchema = z.union([
    z.literal('dynamic-lease'),
    z.literal('static-assignment')
]);

const workerPoolHedgingSchema = z.discriminatedUnion('mode', [
    z
        .strictObject({
            mode: z.literal('off')
        })
        .readonly(),
    z
        .strictObject({
            durationMultiplier: z.number().min(1).refine(Number.isFinite),
            minimumDelayMilliseconds: positiveSafeIntegerSchema,
            mode: z.literal('on')
        })
        .readonly()
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

const workerPoolExecutionFields = {
    assignmentPolicy: z.optional(workerPoolAssignmentPolicySchema),
    dispatchPolicy: z.optional(workerPoolDispatchPolicySchema),
    hedging: z.optional(workerPoolHedgingSchema),
    maxConcurrency: z.optional(maxConcurrencySchema),
    maxWorkers: z.optional(positiveSafeIntegerSchema),
    processModel: z.literal('worker-pool'),
    scheduling: z.optional(z.enum([ 'concurrent', 'serial' ])),
    workDistribution: z.optional(workDistributionSchema),
    workerLifecycle: z.optional(workerLifecycleSchema)
};

export const integrationExecutionSchema = z.discriminatedUnion('processModel', [
    z
        .strictObject({
            maxConcurrency: z.optional(maxConcurrencySchema),
            processModel: z.literal('supervised-process'),
            scheduling: z.optional(z.enum([ 'concurrent', 'serial' ]))
        })
        .readonly(),
    z.strictObject(workerPoolExecutionFields).readonly()
]);

const benchmarkAdmissionFields = {
    maxConcurrency: z.optional(z.literal(1)),
    scheduling: z.optional(z.literal('serial'))
};

const benchmarkExecutionSchema = z.discriminatedUnion('processModel', [
    z.strictObject({ ...benchmarkAdmissionFields, processModel: z.literal('supervised-process') }).readonly(),
    z
        .strictObject({
            ...workerPoolExecutionFields,
            ...benchmarkAdmissionFields,
            hedging: z.optional(z.strictObject({ mode: z.literal('off') }).readonly())
        })
        .readonly()
]);

export const microtestProfileSchema = z
    .strictObject({
        coverage: z.optional(coveragePolicySchema),
        execution: z.optional(microtestExecutionSchema),
        files: z.optional(profileFilesSchema),
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('microtest'),
        timings: z.optional(timingProfilePolicySchema),
        timeouts: z.optional(timeoutSchema)
    })
    .readonly();

export const attachmentLimitsSchema = z
    .strictObject({
        maxInlineBytes: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxInlineBytes),
        maxArtifactBytes: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxArtifactBytes),
        maxScopeBytes: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxScopeBytes),
        maxScopeAttachments: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxScopeAttachments)
    })
    .readonly()
    .default(defaultAttachmentLimits);

export type ProjectAttachmentLimits = z.input<typeof attachmentLimitsSchema>;

export const integrationProfileSchema = z
    .strictObject({
        attachments: attachmentLimitsSchema,
        execution: z.optional(integrationExecutionSchema),
        files: profileFilesSchema,
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        retries: z.optional(integrationRetryPolicySchema),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('integration'),
        timings: z.optional(timingProfilePolicySchema),
        timeouts: z.optional(timeoutSchema)
    })
    .readonly();

const benchmarkProfileSchema = z
    .strictObject({
        attachments: attachmentLimitsSchema,
        execution: z.optional(benchmarkExecutionSchema),
        files: profileFilesSchema,
        reporters: z.optional(z.tuple([ reporterSchema ]).rest(reporterSchema).readonly()),
        resourceUsage: z.optional(resourceUsageSchema),
        testFamily: z.literal('benchmark'),
        timings: z.optional(timingProfilePolicySchema),
        timeouts: z.optional(timeoutSchema)
    })
    .readonly();

export type ProjectBenchmarkProfileConfig = z.input<typeof benchmarkProfileSchema>;

const profileSchema = z.discriminatedUnion('testFamily', [
    benchmarkProfileSchema,
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

export type ProjectResourceBudgets = z.infer<typeof resourceBudgetsSchema>;
export type ProjectCoverageOutput = CoverageOutput;
export type ProjectCoveragePolicy = CoveragePolicy;
export type ProjectCoverageSources = CoverageSources;
export type ProjectCoverageThresholds = CoverageThresholds;
export type ProjectProfileFiles = z.infer<typeof profileFilesSchema>;
export type ProjectMeasuredResourceUsage = z.infer<typeof measuredResourceUsageSchema>;
export type ProjectUnmeasuredResourceUsage = z.infer<typeof unmeasuredResourceUsageSchema>;
export type ProjectResourceUsageConfig = z.infer<typeof resourceUsageSchema>;
export type ProjectTimingProfilePolicy = z.infer<typeof timingProfilePolicySchema>;
export type ProjectTimeoutConfig = z.infer<typeof timeoutSchema>;
export type ProjectIntegrationExecution = z.infer<typeof integrationExecutionSchema>;
export type ProjectWorkerPoolExecution = Extract<
    ProjectIntegrationExecution,
    { readonly processModel: 'worker-pool'; }
>;

export function workerPoolProjectExecution(
    execution: ProjectIntegrationExecution | undefined
): ProjectWorkerPoolExecution | null {
    return execution?.processModel === 'worker-pool' ? execution : null;
}
export type ProjectIntegrationProfileConfig = z.infer<typeof integrationProfileSchema>;
export type ProjectMicrotestExecution = z.infer<typeof microtestExecutionSchema>;
export type ProjectMicrotestProfileConfig = z.infer<typeof microtestProfileSchema>;
export type Config = z.infer<typeof projectConfigSchema>;
