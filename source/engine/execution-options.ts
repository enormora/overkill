import type { BenchmarkExecutionEnvironment } from './benchmark-environment.ts';
import { createPlainOutputRenderer, type DefinedOutputRenderer } from './reporter-output.ts';
import { validateReporterRunFacts, type DefinedReporter, type RunFacts } from './reporter.ts';
import type { RunResult } from './run-result.ts';
import type { RunProcessUsageTracker } from './process-usage.ts';
import type {
    ExecuteTimeoutPolicy,
    ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import type { ExecuteProcessBudgets } from './execution-process-budget-breach.ts';
import { assertRetryPolicy, assertRetryFamily, type TestRetryPolicy } from './retry-policy.ts';
import type { PropertyRunContext } from './property-execution-host.ts';
import type { TestPlan } from './test-plan.ts';

export type ExecuteExecution = {
    readonly maxConcurrency: number | 'unlimited';
    readonly mode: 'concurrent-in-process';
} | {
    readonly mode: 'serial-in-process';
};

export type ExecuteResultFinalizer = (result: RunResult) => Promise<RunResult>;

type CommonExecuteOptions = {
    readonly retryPolicy: TestRetryPolicy | null;
    readonly execution: ExecuteExecution;
    readonly finalizeResult?: ExecuteResultFinalizer;
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters: readonly DefinedReporter[];
    readonly processBudgets?: ExecuteProcessBudgets | null;
    readonly processUsageTracker?: RunProcessUsageTracker | null;
    readonly runtimePolicy?: RuntimePolicy | null;
    readonly runFacts: RunFacts;
    readonly startedAt: string;
    readonly timeoutPolicy?: ExecuteTimeoutPolicy | null;
};

type PropertyExecuteOptions = CommonExecuteOptions & { readonly propertyRun: PropertyRunContext; };
export type ExecuteOptions = CommonExecuteOptions | PropertyExecuteOptions;

function hasPropertyRun(options: ExecuteOptions): options is PropertyExecuteOptions {
    return Object.hasOwn(options, 'propertyRun');
}

const defaultPropertySeed = 0n;
const defaultPropertyRun: PropertyRunContext = { seed: defaultPropertySeed, projectRoot: null };

type DefaultedExecuteOptions = CommonExecuteOptions & {
    readonly propertyRun: PropertyRunContext;
    readonly finalizeResult: ExecuteResultFinalizer;
    readonly outputRenderer: DefinedOutputRenderer;
    readonly runtimePolicy: RuntimePolicy | null;
};

export type NormalizedExecuteOptions = DefaultedExecuteOptions & {
    readonly benchmarkEnvironment: BenchmarkExecutionEnvironment | null;
};

type RuntimePolicy = NonNullable<ExecutionSupervisionDependencies['runtimePolicy']>;

const epoch = new Date(0);
const keepResult: ExecuteResultFinalizer = async function keepResult(result) {
    return result;
};

function defaultExecuteOptions(): DefaultedExecuteOptions {
    return {
        propertyRun: defaultPropertyRun,
        execution: { mode: 'serial-in-process' },
        finalizeResult: keepResult,
        outputRenderer: createPlainOutputRenderer(),
        reporters: [],
        retryPolicy: null,
        processBudgets: null,
        processUsageTracker: null,
        runtimePolicy: null,
        runFacts: {},
        startedAt: epoch.toISOString(),
        timeoutPolicy: null
    };
}

function propertyRun(options: ExecuteOptions): PropertyRunContext {
    return hasPropertyRun(options) ? options.propertyRun : defaultPropertyRun;
}

function executeOptionsWithProvidedDefaults(options: ExecuteOptions): DefaultedExecuteOptions {
    assertRetryPolicy(options.retryPolicy);
    return {
        ...options,
        propertyRun: propertyRun(options),
        finalizeResult: options.finalizeResult ?? keepResult,
        outputRenderer: options.outputRenderer ?? createPlainOutputRenderer(),
        processBudgets: options.processBudgets ?? null,
        runtimePolicy: options.runtimePolicy ?? null,
        timeoutPolicy: options.timeoutPolicy ?? null
    };
}

export function executeOptionsWithDefaults(
    options: ExecuteOptions | undefined,
    testPlan: TestPlan,
    benchmarkEnvironment: BenchmarkExecutionEnvironment | null
): NormalizedExecuteOptions {
    const normalized = options === undefined ? defaultExecuteOptions() : executeOptionsWithProvidedDefaults(options);
    assertRetryFamily(normalized.retryPolicy, testPlan);
    for (const reporter of normalized.reporters) {
        validateReporterRunFacts(reporter, normalized.runFacts);
    }
    return { ...normalized, benchmarkEnvironment };
}
