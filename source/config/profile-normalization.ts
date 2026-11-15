import path from 'node:path';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type {
    ProjectCoveragePolicy,
    ProjectCoverageSources,
    ProjectCoverageThresholds
} from './coverage-schema.ts';
import {
    invalidProfileFileGlobConfigMessage,
    invalidProfileFileSetNameMessage,
    invalidProfileNameMessage
} from './profile-patterns.ts';
import {
    integrationProfileSchema,
    type ProjectProcessBudgets,
    type ProjectMeasuredProcessUsage,
    type ProjectProcessUsageConfig,
    type ProjectIntegrationExecution,
    type ProjectProfileFiles,
    type ProjectTimeoutConfig,
    type ProjectDefinedFamilyProfile,
    type ProjectTimingProfilePolicy,
    workerPoolProjectExecution
} from './schema.ts';
import {
    defaultProcessUsagePolicy,
    defaultProcessUsageSamplingIntervalMilliseconds,
    defaultCoveragePolicy,
    defaultTimingProfilePolicy,
    defaultWorkDistribution,
    defaultIntegrationProcessModel,
    defaultIntegrationScheduling,
    defaultWorkerLifecycle,
    defaultWorkerPoolAssignmentPolicy,
    defaultWorkerPoolDispatchPolicy,
    defaultWorkerPoolHedgingPolicy,
    normalizedMaxConcurrency
} from './defaults.ts';
import { ConfigError } from './config-error.ts';
import type {
    ProcessBudgets,
    ProcessUsagePolicy,
    ProfileConfig,
    CoveragePolicy,
    CoverageSourcePolicy,
    CoverageThresholds,
    IntegrationExecution,
    ProfileFileSet,
    ProfileFiles,
    TimeoutPolicy,
    TimingProfilePolicy,
    WorkerLifecycle,
    WorkerPoolAssignmentPolicy,
    WorkerPoolHedgingPolicy
} from './types.ts';
import {
    invalidWorkDistributionConfigMessage,
    normalizeWorkDistribution
} from './work-distribution.ts';

type ProjectProfileFilePatterns = {
    readonly exclude?: readonly string[] | undefined;
    readonly include: NonEmptyReadonlyArray<string>;
};

type ProjectProfileFileSets = {
    readonly sets: Readonly<Record<string, ProjectProfileFilePatterns>>;
};

function assertValidProfileGlob(field: string, pattern: string): void {
    const message = invalidProfileFileGlobConfigMessage(field, pattern);

    if (message !== null) {
        throw new ConfigError(message);
    }
}

function normalizeCoverageOutputs(
    outputs: ProjectCoveragePolicy['outputs']
): CoveragePolicy['outputs'] {
    return Array.from(new Set(outputs ?? defaultCoveragePolicy.outputs));
}

function normalizeCoverageExclude(exclude: readonly string[] | undefined): readonly string[] {
    const patterns = exclude ?? [];

    for (const pattern of patterns) {
        assertValidProfileGlob('coverage.sources.exclude', pattern);
    }

    return Array.from(patterns);
}

function normalizeCoverageSources(
    sources: ProjectCoverageSources | undefined
): CoverageSourcePolicy {
    if (sources === undefined) {
        return {
            exclude: Array.from(defaultCoveragePolicy.sources.exclude),
            mode: 'loaded'
        };
    }

    const exclude = normalizeCoverageExclude(sources.exclude);

    if (sources.mode === 'loaded') {
        return { exclude, mode: 'loaded' };
    }

    for (const pattern of sources.include) {
        assertValidProfileGlob('coverage.sources.include', pattern);
    }

    return {
        exclude,
        include: [ sources.include[0], ...sources.include.slice(1) ],
        mode: 'all'
    };
}

function thresholdValue(value: number | undefined): number | null {
    return value ?? null;
}

function normalizeCoverageThresholds(
    thresholds: ProjectCoverageThresholds | undefined
): CoverageThresholds {
    return {
        branches: thresholdValue(thresholds?.branches),
        functions: thresholdValue(thresholds?.functions),
        lines: thresholdValue(thresholds?.lines)
    };
}

function normalizeCoverageOutputDirectory(
    outputDirectory: string | undefined,
    configPath: string | null
): string | null {
    if (outputDirectory === undefined) {
        return null;
    }

    if (configPath === null) {
        throw new ConfigError('Coverage outputDir requires a loaded config file.');
    }

    return path.isAbsolute(outputDirectory)
        ? path.resolve(outputDirectory)
        : path.resolve(path.dirname(configPath), outputDirectory);
}

export function normalizeCoveragePolicy(
    policy: ProjectCoveragePolicy | undefined,
    configPath: string | null
): CoveragePolicy {
    return {
        outputDirectory: normalizeCoverageOutputDirectory(policy?.outputDir, configPath),
        outputs: normalizeCoverageOutputs(policy?.outputs),
        sources: normalizeCoverageSources(policy?.sources),
        thresholds: normalizeCoverageThresholds(policy?.thresholds)
    };
}

function profileFileGlobField(fieldPrefix: string | null, field: 'exclude' | 'include'): string {
    return fieldPrefix === null ? field : `${fieldPrefix}.${field}`;
}

function normalizeProfileFilePatterns(
    files: ProjectProfileFilePatterns,
    fieldPrefix: string | null
): ProfileFileSet {
    for (const pattern of files.include) {
        assertValidProfileGlob(profileFileGlobField(fieldPrefix, 'include'), pattern);
    }

    const excludePatterns = files.exclude ?? [];

    for (const pattern of excludePatterns) {
        assertValidProfileGlob(profileFileGlobField(fieldPrefix, 'exclude'), pattern);
    }

    return {
        exclude: Array.from(excludePatterns),
        include: [ files.include[0], ...files.include.slice(1) ]
    };
}

function assertValidProfileFileSetName(name: string): void {
    const message = invalidProfileFileSetNameMessage(name);

    if (message !== null) {
        throw new ConfigError(message);
    }
}

function normalizeProfileFileSets(files: ProjectProfileFileSets): ProfileFiles {
    const entries = Object.entries(files.sets);

    if (entries.length === 0) {
        throw new ConfigError('Invalid profile files.sets: at least one file set is required.');
    }

    return {
        sets: Object.fromEntries(entries.map(function normalizeProfileFileSet([ name, set ]) {
            assertValidProfileFileSetName(name);

            return [ name, normalizeProfileFilePatterns(set, `sets.${name}`) ];
        }))
    };
}

function hasProfileFileSets(files: ProjectProfileFiles): files is ProjectProfileFileSets {
    return files.sets !== undefined;
}

export function normalizeProfileFiles(files: ProjectProfileFiles | undefined): ProfileFiles | null {
    if (files === undefined) {
        return null;
    }

    return hasProfileFileSets(files)
        ? normalizeProfileFileSets(files)
        : normalizeProfileFilePatterns(files, null);
}

export function normalizeRequiredProfileFiles(files: ProjectProfileFiles): ProfileFiles {
    return hasProfileFileSets(files)
        ? normalizeProfileFileSets(files)
        : normalizeProfileFilePatterns(files, null);
}

export function assertValidProfileName(profileName: string): void {
    const message = invalidProfileNameMessage(profileName);

    if (message !== null) {
        throw new ConfigError(message);
    }
}

export function assertValidWorkDistribution(
    execution: IntegrationExecution,
    files: ProfileFiles
): void {
    const message = invalidWorkDistributionConfigMessage(execution, files);

    if (message !== null) {
        throw new ConfigError(message);
    }
}

function normalizedWorkDistribution(
    execution: ProjectIntegrationExecution | undefined
): Extract<IntegrationExecution, { readonly processModel: 'worker-pool'; }>['workDistribution'] {
    return normalizeWorkDistribution(execution, defaultWorkDistribution);
}

function normalizeTimings(timings: ProjectTimingProfilePolicy | undefined): TimingProfilePolicy {
    return { collection: timings?.collection ?? defaultTimingProfilePolicy.collection };
}

function timeoutValue(value: number | undefined, fallback: number): number {
    return value ?? fallback;
}

function assertValidTimeouts(timeouts: TimeoutPolicy): void {
    if (timeouts.softMilliseconds > timeouts.hardMilliseconds) {
        throw new ConfigError(
            'Invalid profile timeouts: softMilliseconds must be less than or equal to hardMilliseconds.'
        );
    }
}

function normalizeTimeouts(
    timeouts: ProjectTimeoutConfig | undefined,
    defaultPolicy: TimeoutPolicy
): TimeoutPolicy {
    const policy = {
        collectionMilliseconds: timeoutValue(timeouts?.collectionMilliseconds, defaultPolicy.collectionMilliseconds),
        hardMilliseconds: timeoutValue(timeouts?.hardMilliseconds, defaultPolicy.hardMilliseconds),
        softMilliseconds: timeoutValue(timeouts?.softMilliseconds, defaultPolicy.softMilliseconds)
    };
    assertValidTimeouts(policy);
    return policy;
}

function normalizeBudgetValue(value: number | null | undefined): number | null {
    return value ?? null;
}

function normalizeProcessBudgets(processBudgets: ProjectProcessBudgets | undefined): ProcessBudgets {
    return {
        activeResourceCount: normalizeBudgetValue(processBudgets?.activeResourceCount),
        javaScriptEngineHeapBytes: normalizeBudgetValue(processBudgets?.javaScriptEngineHeapBytes),
        residentSetBytes: normalizeBudgetValue(processBudgets?.residentSetBytes),
        residentSetGrowthBytesPerSecond: normalizeBudgetValue(processBudgets?.residentSetGrowthBytesPerSecond)
    };
}

function disabledProcessBudgets(): ProcessBudgets {
    return {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    };
}

function copyProcessBudgets(processBudgets: ProcessBudgets): ProcessBudgets {
    return {
        activeResourceCount: processBudgets.activeResourceCount,
        javaScriptEngineHeapBytes: processBudgets.javaScriptEngineHeapBytes,
        residentSetBytes: processBudgets.residentSetBytes,
        residentSetGrowthBytesPerSecond: processBudgets.residentSetGrowthBytesPerSecond
    };
}

function copyProcessUsagePolicy(policy: ProcessUsagePolicy): ProcessUsagePolicy {
    return {
        budgets: copyProcessBudgets(policy.budgets),
        measure: policy.measure,
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    };
}

function normalizeUnmeasuredProcessUsage(): ProcessUsagePolicy {
    return {
        budgets: disabledProcessBudgets(),
        measure: false,
        samplingIntervalMilliseconds: defaultProcessUsageSamplingIntervalMilliseconds
    };
}

function normalizeMeasuredProcessUsage(profile: ProjectMeasuredProcessUsage): ProcessUsagePolicy {
    return {
        budgets: normalizeProcessBudgets(profile.budgets),
        measure: true,
        samplingIntervalMilliseconds: profile.samplingIntervalMilliseconds ??
            defaultProcessUsageSamplingIntervalMilliseconds
    };
}

function normalizeProcessUsage(
    profile: ProjectProcessUsageConfig | undefined
): ProcessUsagePolicy {
    if (profile === undefined) {
        return copyProcessUsagePolicy(defaultProcessUsagePolicy);
    }

    if (profile.measure !== true) {
        return normalizeUnmeasuredProcessUsage();
    }

    return normalizeMeasuredProcessUsage(profile);
}

export function normalizeProfilePolicy(
    profile: Pick<
        ProjectDefinedFamilyProfile,
        'failureArtifacts' | 'processUsage' | 'reporters' | 'runRecords' | 'timeouts' | 'timings'
    >,
    defaults: TimeoutPolicy
): Pick<ProfileConfig, 'failureArtifacts' | 'processUsage' | 'reporters' | 'runRecords' | 'timeouts' | 'timings'> {
    const timeouts = normalizeTimeouts(profile.timeouts, defaults);
    return {
        reporters: profile.reporters ?? null,
        processUsage: normalizeProcessUsage(profile.processUsage),
        runRecords: { persist: profile.runRecords?.persist ?? 'on-demand' },
        failureArtifacts: integrationProfileSchema.unwrap().shape.failureArtifacts.parse(profile.failureArtifacts),
        timings: normalizeTimings(profile.timings),
        timeouts
    };
}

function normalizeWorkerLifecycle(execution: ProjectIntegrationExecution | undefined): WorkerLifecycle {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerLifecycle;
    }

    return execution.workerLifecycle ?? defaultWorkerLifecycle;
}

function normalizeWorkerPoolAssignmentPolicy(
    execution: ProjectIntegrationExecution | undefined
): WorkerPoolAssignmentPolicy {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerPoolAssignmentPolicy;
    }

    return execution.assignmentPolicy ?? defaultWorkerPoolAssignmentPolicy;
}

function normalizeWorkerPoolHedgingPolicy(
    execution: ProjectIntegrationExecution | undefined
): WorkerPoolHedgingPolicy {
    if (execution?.processModel !== 'worker-pool') {
        return defaultWorkerPoolHedgingPolicy;
    }

    return execution.hedging ?? defaultWorkerPoolHedgingPolicy;
}

function normalizeWorkerPoolExecution(
    execution: ProjectIntegrationExecution | undefined,
    scheduling: IntegrationExecution['scheduling']
): IntegrationExecution {
    const workerPoolExecution = workerPoolProjectExecution(execution);

    return {
        assignmentPolicy: normalizeWorkerPoolAssignmentPolicy(execution),
        dispatchPolicy: workerPoolExecution?.dispatchPolicy ?? defaultWorkerPoolDispatchPolicy,
        hedging: normalizeWorkerPoolHedgingPolicy(execution),
        hostProcess: { kind: 'direct' },
        maxConcurrency: normalizedMaxConcurrency(workerPoolExecution),
        maxWorkers: workerPoolExecution?.maxWorkers ?? null,
        processModel: 'worker-pool',
        scheduling,
        workDistribution: normalizedWorkDistribution(execution),
        workerLifecycle: normalizeWorkerLifecycle(execution)
    };
}

export function normalizeIntegrationExecution(
    execution: ProjectIntegrationExecution | undefined
): IntegrationExecution {
    const processModel = execution?.processModel ?? defaultIntegrationProcessModel;
    const scheduling = execution?.scheduling ?? defaultIntegrationScheduling;

    if (processModel === 'worker-pool') {
        return normalizeWorkerPoolExecution(execution, scheduling);
    }

    return {
        maxConcurrency: normalizedMaxConcurrency(execution),
        processModel,
        scheduling
    };
}
