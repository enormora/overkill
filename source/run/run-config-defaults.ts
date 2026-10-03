import type {
    RunCoveragePolicy,
    RunMaxConcurrency,
    RunMicrotestExecution,
    RunResourceUsagePolicy,
    TimingProfilePolicy,
    RunTimeoutPolicy,
    RunWorkerPoolAssignmentPolicy,
    RunWorkerPoolDispatchPolicy,
    RunWorkerPoolHedgingPolicy,
    RunWorkerLifecycle
} from './run-types.ts';
import type { RunProjectMicrotestExecution } from './run-config-schema.ts';

const defaultMaxConcurrency = 5;

export function normalizedMaxConcurrency(
    execution: { readonly maxConcurrency?: RunMaxConcurrency | undefined; } | null | undefined
): RunMaxConcurrency {
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

export const defaultResourceUsagePolicy: RunResourceUsagePolicy = {
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

export const defaultCoveragePolicy: RunCoveragePolicy = {
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

export const defaultTimeoutPolicy: RunTimeoutPolicy = {
    collectionMilliseconds: defaultMicrotestCollectionTimeoutMilliseconds,
    hardMilliseconds: defaultMicrotestHardTimeoutMilliseconds,
    softMilliseconds: defaultMicrotestTimeoutMilliseconds
};

export const defaultIntegrationTimeoutPolicy: RunTimeoutPolicy = {
    collectionMilliseconds: defaultIntegrationCollectionTimeoutMilliseconds,
    hardMilliseconds: defaultIntegrationHardTimeoutMilliseconds,
    softMilliseconds: defaultIntegrationTimeoutMilliseconds
};

export function normalizeMicrotestExecution(
    execution: RunProjectMicrotestExecution | undefined
): RunMicrotestExecution {
    return {
        maxConcurrency: normalizedMaxConcurrency(execution),
        processModel: execution?.processModel ?? defaultMicrotestProcessModel,
        scheduling: execution?.scheduling ?? defaultMicrotestScheduling
    };
}

export const defaultIntegrationProcessModel = 'worker-pool';
export const defaultIntegrationScheduling = 'concurrent';
export const defaultWorkerPoolAssignmentPolicy: RunWorkerPoolAssignmentPolicy = 'case-count-balanced';
export const defaultWorkerPoolDispatchPolicy: RunWorkerPoolDispatchPolicy = 'dynamic-lease';
export const defaultWorkerPoolHedgingPolicy: RunWorkerPoolHedgingPolicy = { mode: 'off' };
export const defaultWorkerLifecycle: RunWorkerLifecycle = 'reuse';
export const defaultWorkDistribution = { mode: 'file' } as const;
