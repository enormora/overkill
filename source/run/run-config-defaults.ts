import type {
    RunMicrotestExecution,
    RunResourceUsagePolicy,
    TimingProfilePolicy,
    RunTimeoutPolicy,
    RunWorkerPoolAssignmentPolicy,
    RunWorkerPoolDispatchPolicy,
    RunWorkerPoolHedgingPolicy,
    RunWorkerLifecycle
} from './run-types.ts';

export const defaultConfigFileNames = [ 'overkill.config.ts', 'overkill.config.js' ];
export const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultMicrotestCollectionTimeoutMilliseconds = 1000;
const defaultMicrotestHardTimeoutMilliseconds = 1000;
const defaultMicrotestTimeoutMilliseconds = 500;
const defaultIntegrationCollectionTimeoutMilliseconds = 5000;
const defaultIntegrationHardTimeoutMilliseconds = 7000;
const defaultIntegrationTimeoutMilliseconds = 5000;

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

export const defaultMicrotestExecution: RunMicrotestExecution = {
    processModel: 'supervised-process',
    scheduling: 'concurrent'
};

export const defaultIntegrationProcessModel = 'worker-pool';
export const defaultIntegrationScheduling = 'concurrent';
export const defaultWorkerPoolAssignmentPolicy: RunWorkerPoolAssignmentPolicy = 'case-count-balanced';
export const defaultWorkerPoolDispatchPolicy: RunWorkerPoolDispatchPolicy = 'dynamic-lease';
export const defaultWorkerPoolHedgingPolicy: RunWorkerPoolHedgingPolicy = { mode: 'off' };
export const defaultWorkerLifecycle: RunWorkerLifecycle = 'reuse';
export const defaultWorkDistribution = { mode: 'file' } as const;
