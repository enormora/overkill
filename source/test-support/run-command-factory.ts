import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type { BenchmarkOrchestrator, RunCommand, RunExecutionFacts, RunRequest } from '../run/run-types.ts';
import type {
    NormalizedConfig,
    CoveragePolicy,
    HostProcess,
    IntegrationExecution,
    IntegrationProfileConfig,
    MicrotestExecution,
    MicrotestProfileConfig,
    ProfileFiles,
    TestProfileConfig,
    ResourceBudgets,
    ResourceUsagePolicy,
    TimingProfilePolicy,
    TimeoutPolicy,
    WorkDistribution,
    WorkerPoolAssignmentPolicy,
    WorkerPoolDispatchPolicy,
    WorkerPoolHedgingPolicy,
    WorkerLifecycle
} from '../config/types.ts';
import { hostProcessFacts } from '../run/run-host-process.ts';
import { resolveTimingCollection } from '../run/run-profile-facts.ts';

type WorkerPoolExecutionOverrides = Partial<
    Extract<IntegrationExecution, { readonly processModel: 'worker-pool'; }>
>;
const defaultMaxConcurrency = 5;

type ResourceUsageOverrides = {
    readonly budgets?: Partial<ResourceBudgets>;
    readonly measure?: boolean;
    readonly samplingIntervalMilliseconds?: number;
};

type MicrotestProfileOverrides = {
    readonly coverage?: Partial<CoveragePolicy>;
    readonly execution?: Partial<MicrotestExecution>;
    readonly files?: ProfileFiles | null;
    readonly reporters?: readonly DefinedReporter[] | null;
    readonly resourceUsage?: ResourceUsageOverrides;
    readonly timings?: Partial<TimingProfilePolicy>;
    readonly timeouts?: Partial<TimeoutPolicy>;
};

type IntegrationProfileOverrides = {
    readonly execution?: Partial<IntegrationExecution>;
    readonly files?: ProfileFiles;
    readonly reporters?: readonly DefinedReporter[] | null;
    readonly resourceUsage?: ResourceUsageOverrides;
    readonly timings?: Partial<TimingProfilePolicy>;
    readonly timeouts?: Partial<TimeoutPolicy>;
};

const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultCollectionTimeoutMilliseconds = 1000;
const defaultHardTimeoutMilliseconds = 1000;
const defaultSoftTimeoutMilliseconds = 500;
const defaultIntegrationCollectionTimeoutMilliseconds = 5000;
const defaultIntegrationHardTimeoutMilliseconds = 7000;
const defaultIntegrationSoftTimeoutMilliseconds = 5000;

const defaultResourceBudgets: ResourceBudgets = {
    activeResourceCount: null,
    javaScriptEngineHeapBytes: null,
    residentSetBytes: null,
    residentSetGrowthBytesPerSecond: null
};

function defaultRunResourceBudgets(overrides: Partial<ResourceBudgets> = {}): ResourceBudgets {
    return {
        ...defaultResourceBudgets,
        ...overrides
    };
}

function defaultRunResourceUsagePolicy(
    overrides: MicrotestProfileOverrides['resourceUsage'] = {}
): ResourceUsagePolicy {
    return {
        budgets: defaultRunResourceBudgets(overrides.budgets),
        measure: overrides.measure ?? false,
        samplingIntervalMilliseconds: overrides.samplingIntervalMilliseconds ??
            defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function defaultTimingProfilePolicy(overrides: Partial<TimingProfilePolicy> = {}): TimingProfilePolicy {
    return {
        collection: overrides.collection ?? 'summary'
    };
}

function defaultRunTimeoutPolicy(overrides: Partial<TimeoutPolicy> = {}): TimeoutPolicy {
    return {
        collectionMilliseconds: overrides.collectionMilliseconds ?? defaultCollectionTimeoutMilliseconds,
        hardMilliseconds: overrides.hardMilliseconds ?? defaultHardTimeoutMilliseconds,
        softMilliseconds: overrides.softMilliseconds ?? defaultSoftTimeoutMilliseconds
    };
}

function defaultMicrotestExecution(overrides: Partial<MicrotestExecution> = {}): MicrotestExecution {
    return {
        maxConcurrency: overrides.maxConcurrency ?? defaultMaxConcurrency,
        processModel: overrides.processModel ?? 'supervised-process',
        scheduling: overrides.scheduling ?? 'concurrent'
    };
}

function defaultCoveragePolicy(overrides: Partial<CoveragePolicy> = {}): CoveragePolicy {
    return {
        outputDirectory: overrides.outputDirectory ?? null,
        outputs: overrides.outputs ?? [ 'v8', 'lcov' ],
        sources: overrides.sources ?? { exclude: [], mode: 'loaded' },
        thresholds: overrides.thresholds ?? {
            branches: null,
            functions: null,
            lines: null
        }
    };
}

export function testRunExecutionFacts(command: RunCommand, profile: TestProfileConfig): RunExecutionFacts {
    const facts = {
        attachments: profile.testFamily === 'integration' ? profile.attachments : null,
        retries: null,
        baselineUpdateMode: command.request.baselineUpdateMode,
        capture: command.request.capture,
        coverage: command.request.coverage,
        debug: command.request.debug,
        engine: { kind: 'default' as const },
        maxConcurrency: profile.execution.maxConcurrency,
        order: command.request.order,
        placementPlan: null,
        profile: command.request.profile,
        resourceUsagePolicy: profile.resourceUsage,
        scheduling: profile.execution.scheduling,
        testFamily: profile.testFamily,
        timingCollection: resolveTimingCollection(command.request, profile),
        timeoutPolicy: profile.timeouts,
        verbose: command.request.verbose
    };

    if (profile.execution.processModel === 'worker-pool') {
        return {
            ...facts,
            assignmentPolicy: profile.execution.assignmentPolicy,
            dispatchPolicy: profile.execution.dispatchPolicy,
            hedging: profile.execution.hedging,
            hostProcess: hostProcessFacts(profile.execution.hostProcess),
            processModel: profile.execution.processModel,
            workDistribution: profile.execution.workDistribution,
            workerCount: {
                hostMaximum: 1,
                profileMaximum: profile.execution.maxWorkers,
                requested: command.request.workers,
                resolved: 1
            },
            workerLifecycle: profile.execution.workerLifecycle
        };
    }

    return {
        ...facts,
        processModel: profile.execution.processModel
    };
}

function hasWorkerLifecycleOverride(
    overrides: Partial<IntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'workerLifecycle');
}

function defaultWorkerLifecycle(overrides: Partial<IntegrationExecution>): WorkerLifecycle {
    return hasWorkerLifecycleOverride(overrides)
        ? overrides.workerLifecycle ?? 'reuse'
        : 'reuse';
}

function hasAssignmentPolicyOverride(
    overrides: Partial<IntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'assignmentPolicy');
}

function defaultAssignmentPolicy(overrides: Partial<IntegrationExecution>): WorkerPoolAssignmentPolicy {
    return hasAssignmentPolicyOverride(overrides)
        ? overrides.assignmentPolicy ?? 'case-count-balanced'
        : 'case-count-balanced';
}

function hasDispatchPolicyOverride(
    overrides: Partial<IntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'dispatchPolicy');
}

function defaultDispatchPolicy(overrides: Partial<IntegrationExecution>): WorkerPoolDispatchPolicy {
    return hasDispatchPolicyOverride(overrides)
        ? overrides.dispatchPolicy ?? 'dynamic-lease'
        : 'dynamic-lease';
}

function hasWorkDistributionOverride(
    overrides: Partial<IntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'workDistribution');
}

function defaultWorkDistribution(overrides: Partial<IntegrationExecution>): WorkDistribution {
    return hasWorkDistributionOverride(overrides)
        ? overrides.workDistribution ?? { mode: 'file' }
        : { mode: 'file' };
}

function hasHostProcessOverride(
    overrides: Partial<IntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'hostProcess');
}

function defaultHostProcess(overrides: Partial<IntegrationExecution>): HostProcess {
    if (!hasHostProcessOverride(overrides)) {
        return { kind: 'direct' };
    }

    const { hostProcess } = overrides;

    return hostProcess ?? { kind: 'direct' };
}

function defaultHedging(overrides: Partial<IntegrationExecution>): WorkerPoolHedgingPolicy {
    return overrides.processModel === 'worker-pool' && overrides.hedging !== undefined
        ? overrides.hedging
        : { mode: 'off' };
}

function hasMaximumWorkersOverride(
    overrides: Partial<IntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'maxWorkers');
}

function defaultMaximumWorkers(overrides: Partial<IntegrationExecution>): number | null {
    return hasMaximumWorkersOverride(overrides) ? overrides.maxWorkers ?? null : null;
}

function defaultIntegrationExecution(overrides: Partial<IntegrationExecution> = {}): IntegrationExecution {
    const processModel = overrides.processModel ?? 'worker-pool';
    const maxConcurrency = overrides.maxConcurrency ?? defaultMaxConcurrency;
    const scheduling = overrides.scheduling ?? 'concurrent';

    if (processModel === 'worker-pool') {
        return {
            assignmentPolicy: defaultAssignmentPolicy(overrides),
            dispatchPolicy: defaultDispatchPolicy(overrides),
            hedging: defaultHedging(overrides),
            maxConcurrency,
            maxWorkers: defaultMaximumWorkers(overrides),
            processModel,
            scheduling,
            workDistribution: defaultWorkDistribution(overrides),
            hostProcess: defaultHostProcess(overrides),
            workerLifecycle: defaultWorkerLifecycle(overrides)
        };
    }

    return { maxConcurrency, processModel, scheduling };
}

export function defaultMicrotestProfile(
    overrides: MicrotestProfileOverrides = {}
): MicrotestProfileConfig {
    return {
        coverage: defaultCoveragePolicy(overrides.coverage),
        execution: defaultMicrotestExecution(overrides.execution),
        files: overrides.files ?? null,
        reporters: overrides.reporters ?? null,
        resourceUsage: defaultRunResourceUsagePolicy(overrides.resourceUsage),
        testFamily: 'microtest',
        timings: defaultTimingProfilePolicy(overrides.timings),
        timeouts: defaultRunTimeoutPolicy(overrides.timeouts)
    };
}

export function defaultIntegrationProfile(
    overrides: IntegrationProfileOverrides
): IntegrationProfileConfig {
    return {
        attachments: defaultAttachmentLimits,
        retries: null,
        execution: defaultIntegrationExecution(overrides.execution),
        files: overrides.files ?? {
            exclude: [],
            include: [ 'source/**/*.integration.test.ts' ]
        },
        reporters: overrides.reporters ?? null,
        resourceUsage: defaultRunResourceUsagePolicy(overrides.resourceUsage),
        testFamily: 'integration',
        timings: defaultTimingProfilePolicy(overrides.timings),
        timeouts: defaultRunTimeoutPolicy({
            collectionMilliseconds: defaultIntegrationCollectionTimeoutMilliseconds,
            hardMilliseconds: defaultIntegrationHardTimeoutMilliseconds,
            softMilliseconds: defaultIntegrationSoftTimeoutMilliseconds,
            ...overrides.timeouts
        })
    };
}

export function defaultRunConfig(overrides: Partial<NormalizedConfig> = {}): NormalizedConfig {
    const defaultConfig: NormalizedConfig = {
        loader: {
            sourceMaps: false,
            stripMode: 'strip-only'
        },
        outputRenderer: createPlainOutputRenderer(),
        profiles: {
            microtest: defaultMicrotestProfile()
        },
        reporters: [],
        runtimeStateDir: '.overkill'
    };

    return {
        ...defaultConfig,
        ...overrides
    };
}

export function defaultRunRequest(overrides: Partial<RunRequest> = {}): RunRequest {
    const defaultRequest: RunRequest = {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        coverage: false,
        debug: {
            mode: 'off',
            selectors: []
        },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'seeded',
        paths: [],
        profile: 'microtest',
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'all' },
        shard: { index: 1, total: 1 },
        timingCollection: 'profile-default',
        verbose: false,
        workers: null
    };

    return {
        ...defaultRequest,
        ...overrides
    };
}

async function rejectUnexpectedBenchmark(): Promise<never> {
    throw new Error('Unexpected benchmark invocation.');
}

export const unexpectedBenchmarkOrchestrator: BenchmarkOrchestrator = {
    baseline: {
        apply: rejectUnexpectedBenchmark,
        bootstrap: rejectUnexpectedBenchmark,
        diff: rejectUnexpectedBenchmark,
        list: rejectUnexpectedBenchmark,
        update: rejectUnexpectedBenchmark
    },
    list: rejectUnexpectedBenchmark,
    run: rejectUnexpectedBenchmark,
    runWithReporterDelivery: rejectUnexpectedBenchmark
};
