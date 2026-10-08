import type {
    CoveragePolicy,
    MaxConcurrency,
    MicrotestExecution,
    ResourceUsagePolicy,
    TimingProfilePolicy,
    TimeoutPolicy,
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerPoolHedgingPolicy,
    WorkerLifecycle
} from './types.ts';
import type { ProjectMicrotestExecution } from './schema.ts';

const defaultMaxConcurrency = 5;

export function normalizedMaxConcurrency(
    execution: { readonly maxConcurrency?: MaxConcurrency | undefined; } | null | undefined
): MaxConcurrency {
    return execution?.maxConcurrency ?? defaultMaxConcurrency;
}

export const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];
export const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultMicrotestCollectionTimeoutMilliseconds = 1000;
const defaultMicrotestHardTimeoutMilliseconds = 1000;
const defaultMicrotestTimeoutMilliseconds = 500;
const defaultIntegrationCollectionTimeoutMilliseconds = 5000;
const defaultIntegrationHardTimeoutMilliseconds = 7000;
const defaultIntegrationTimeoutMilliseconds = 5000;
const defaultMicrotestProcessModel = 'supervised-process';
const defaultMicrotestScheduling = 'concurrent';

export const defaultLoader = {
    sourceMaps: false,
    stripMode: 'strip-only'
} as const;

export const defaultResourceUsagePolicy: ResourceUsagePolicy = {
    budgets: {
        activeResourceCount: null,
        javaScriptEngineHeapBytes: null,
        residentSetBytes: null,
        residentSetGrowthBytesPerSecond: null
    },
    measure: false,
    samplingIntervalMilliseconds: defaultResourceUsageSamplingIntervalMilliseconds
};

export const defaultTimingProfilePolicy: TimingProfilePolicy = {
    collection: 'summary'
};

export const defaultCoveragePolicy: CoveragePolicy = {
    outputDirectory: null,
    outputs: [ 'v8', 'lcov' ],
    sources: {
        exclude: [],
        mode: 'loaded'
    },
    thresholds: {
        branches: null,
        functions: null,
        lines: null
    }
};

export const defaultTimeoutPolicy: TimeoutPolicy = {
    collectionMilliseconds: defaultMicrotestCollectionTimeoutMilliseconds,
    hardMilliseconds: defaultMicrotestHardTimeoutMilliseconds,
    softMilliseconds: defaultMicrotestTimeoutMilliseconds
};

export const defaultIntegrationTimeoutPolicy: TimeoutPolicy = {
    collectionMilliseconds: defaultIntegrationCollectionTimeoutMilliseconds,
    hardMilliseconds: defaultIntegrationHardTimeoutMilliseconds,
    softMilliseconds: defaultIntegrationTimeoutMilliseconds
};

export function normalizeMicrotestExecution(
    execution: ProjectMicrotestExecution | undefined
): MicrotestExecution {
    return {
        maxConcurrency: normalizedMaxConcurrency(execution),
        processModel: execution?.processModel ?? defaultMicrotestProcessModel,
        scheduling: execution?.scheduling ?? defaultMicrotestScheduling
    };
}

export const defaultIntegrationProcessModel = 'worker-pool';
export const defaultIntegrationScheduling = 'concurrent';
export const defaultWorkerPoolAssignmentPolicy: WorkerPoolAssignmentPolicy = 'case-count-balanced';
export const defaultWorkerPoolDispatchPolicy: WorkerPoolDispatchPolicy = 'dynamic-lease';
export const defaultWorkerPoolHedgingPolicy: WorkerPoolHedgingPolicy = { mode: 'off' };
export const defaultWorkerLifecycle: WorkerLifecycle = 'reuse';
export const defaultWorkDistribution = { mode: 'file' } as const;
