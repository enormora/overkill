import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type {
    RunCommand,
    RunConfig,
    RunExecutionFacts,
    RunIntegrationExecution,
    RunIntegrationProfileConfig,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunProfileFiles,
    RunProfileConfig,
    RunRequest,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    RunTimeoutPolicy,
    RunWorkerLifecycle
} from '../run/run-types.ts';

type WorkerPoolExecutionOverrides = Partial<
    Extract<RunIntegrationExecution, { readonly processModel: 'worker-pool'; }>
>;

type ResourceUsageOverrides = {
    readonly budgets?: Partial<RunResourceBudgets>;
    readonly measure?: boolean;
    readonly samplingIntervalMilliseconds?: number;
};

type MicrotestProfileOverrides = {
    readonly execution?: Partial<RunMicrotestExecution>;
    readonly files?: RunProfileFiles | null;
    readonly reporters?: readonly DefinedReporter[] | null;
    readonly resourceUsage?: ResourceUsageOverrides;
    readonly timeouts?: Partial<RunTimeoutPolicy>;
};

type IntegrationProfileOverrides = {
    readonly execution?: Partial<RunIntegrationExecution>;
    readonly files?: RunProfileFiles;
    readonly reporters?: readonly DefinedReporter[] | null;
    readonly resourceUsage?: ResourceUsageOverrides;
    readonly timeouts?: Partial<RunTimeoutPolicy>;
};

const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultCollectionTimeoutMilliseconds = 1000;
const defaultHardTimeoutMilliseconds = 1000;
const defaultSoftTimeoutMilliseconds = 500;
const defaultIntegrationCollectionTimeoutMilliseconds = 5000;
const defaultIntegrationHardTimeoutMilliseconds = 7000;
const defaultIntegrationSoftTimeoutMilliseconds = 5000;

const defaultResourceBudgets: RunResourceBudgets = {
    activeResourceCount: null,
    javaScriptEngineHeapBytes: null,
    residentSetBytes: null,
    residentSetGrowthBytesPerSecond: null
};

function defaultRunResourceBudgets(overrides: Partial<RunResourceBudgets> = {}): RunResourceBudgets {
    return {
        ...defaultResourceBudgets,
        ...overrides
    };
}

function defaultRunResourceUsagePolicy(
    overrides: MicrotestProfileOverrides['resourceUsage'] = {}
): RunResourceUsagePolicy {
    return {
        budgets: defaultRunResourceBudgets(overrides.budgets),
        measure: overrides.measure ?? false,
        samplingIntervalMilliseconds: overrides.samplingIntervalMilliseconds ??
            defaultResourceUsageSamplingIntervalMilliseconds
    };
}

function defaultRunTimeoutPolicy(overrides: Partial<RunTimeoutPolicy> = {}): RunTimeoutPolicy {
    return {
        collectionMilliseconds: overrides.collectionMilliseconds ?? defaultCollectionTimeoutMilliseconds,
        hardMilliseconds: overrides.hardMilliseconds ?? defaultHardTimeoutMilliseconds,
        softMilliseconds: overrides.softMilliseconds ?? defaultSoftTimeoutMilliseconds
    };
}

function defaultMicrotestExecution(overrides: Partial<RunMicrotestExecution> = {}): RunMicrotestExecution {
    return {
        processModel: overrides.processModel ?? 'supervised-process',
        scheduling: overrides.scheduling ?? 'concurrent'
    };
}

export function testRunExecutionFacts(command: RunCommand, profile: RunProfileConfig): RunExecutionFacts {
    const facts = {
        baselineUpdateMode: command.request.baselineUpdateMode,
        capture: command.request.capture,
        debug: command.request.debug,
        engine: { kind: 'default' as const },
        order: command.request.order,
        profile: command.request.profile,
        resourceUsagePolicy: profile.resourceUsage,
        scheduling: profile.execution.scheduling,
        testFamily: profile.testFamily,
        timeoutPolicy: profile.timeouts,
        verbose: command.request.verbose
    };

    if (profile.execution.processModel === 'worker-pool') {
        return {
            ...facts,
            processModel: profile.execution.processModel,
            workerLifecycle: profile.execution.workerLifecycle
        };
    }

    return {
        ...facts,
        processModel: profile.execution.processModel
    };
}

function hasWorkerLifecycleOverride(
    overrides: Partial<RunIntegrationExecution>
): overrides is WorkerPoolExecutionOverrides {
    return Object.hasOwn(overrides, 'workerLifecycle');
}

function defaultWorkerLifecycle(overrides: Partial<RunIntegrationExecution>): RunWorkerLifecycle {
    return hasWorkerLifecycleOverride(overrides)
        ? overrides.workerLifecycle ?? 'reuse'
        : 'reuse';
}

function defaultIntegrationExecution(overrides: Partial<RunIntegrationExecution> = {}): RunIntegrationExecution {
    const processModel = overrides.processModel ?? 'worker-pool';
    const scheduling = overrides.scheduling ?? 'concurrent';

    if (processModel === 'worker-pool') {
        return {
            processModel,
            scheduling,
            workerLifecycle: defaultWorkerLifecycle(overrides)
        };
    }

    return { processModel, scheduling };
}

export function defaultMicrotestProfile(
    overrides: MicrotestProfileOverrides = {}
): RunMicrotestProfileConfig {
    return {
        execution: defaultMicrotestExecution(overrides.execution),
        files: overrides.files ?? null,
        reporters: overrides.reporters ?? null,
        resourceUsage: defaultRunResourceUsagePolicy(overrides.resourceUsage),
        testFamily: 'microtest',
        timeouts: defaultRunTimeoutPolicy(overrides.timeouts)
    };
}

export function defaultIntegrationProfile(
    overrides: IntegrationProfileOverrides
): RunIntegrationProfileConfig {
    return {
        execution: defaultIntegrationExecution(overrides.execution),
        files: overrides.files ?? {
            exclude: [],
            include: [ 'source/**/*.integration.test.ts' ]
        },
        reporters: overrides.reporters ?? null,
        resourceUsage: defaultRunResourceUsagePolicy(overrides.resourceUsage),
        testFamily: 'integration',
        timeouts: defaultRunTimeoutPolicy({
            collectionMilliseconds: defaultIntegrationCollectionTimeoutMilliseconds,
            hardMilliseconds: defaultIntegrationHardTimeoutMilliseconds,
            softMilliseconds: defaultIntegrationSoftTimeoutMilliseconds,
            ...overrides.timeouts
        })
    };
}

export function defaultRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
    const defaultConfig: RunConfig = {
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
        shard: { index: 0, total: 1 },
        verbose: false
    };

    return {
        ...defaultRequest,
        ...overrides
    };
}
