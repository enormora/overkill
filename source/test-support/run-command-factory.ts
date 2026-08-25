import type { Reporter } from '../engine/reporter.ts';
import type {
    RunConfig,
    RunMicrotestExecution,
    RunMicrotestProfileConfig,
    RunRequest,
    RunResourceBudgets,
    RunResourceUsagePolicy,
    RunTimeoutPolicy
} from '../run/run-types.ts';

type PlainOutputIntent = {
    readonly text: string;
};

type ResourceUsageOverrides = {
    readonly budgets?: Partial<RunResourceBudgets>;
    readonly measure?: boolean;
    readonly samplingIntervalMilliseconds?: number;
};

type MicrotestProfileOverrides = {
    readonly execution?: Partial<RunMicrotestExecution>;
    readonly reporters?: readonly Reporter[] | null;
    readonly resourceUsage?: ResourceUsageOverrides;
    readonly timeouts?: Partial<RunTimeoutPolicy>;
};

const defaultResourceUsageSamplingIntervalMilliseconds = 100;
const defaultHardTimeoutMilliseconds = 1000;
const defaultSoftTimeoutMilliseconds = 500;

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

export function defaultMicrotestProfile(
    overrides: MicrotestProfileOverrides = {}
): RunMicrotestProfileConfig {
    return {
        execution: defaultMicrotestExecution(overrides.execution),
        reporters: overrides.reporters ?? null,
        resourceUsage: defaultRunResourceUsagePolicy(overrides.resourceUsage),
        testFamily: 'microtest',
        timeouts: defaultRunTimeoutPolicy(overrides.timeouts)
    };
}

export function defaultRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
    const defaultConfig: RunConfig = {
        loader: {
            sourceMaps: false,
            stripMode: 'strip-only'
        },
        outputRenderer: {
            render(intent: PlainOutputIntent) {
                return intent.text;
            }
        },
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
        order: 'plan',
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
