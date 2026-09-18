import { createPlainOutputRenderer, type DefinedOutputRenderer } from './reporter-output.ts';
import type { DefinedReporter, RunFacts } from './reporter.ts';
import type { RunResourceUsageTracker, RunResult } from './run-result.ts';
import type {
    ExecuteTimeoutPolicy,
    ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import type { ExecuteResourceBudgets } from './execution-resource-budget-breach.ts';

export type ExecuteExecution = {
    readonly mode: 'concurrent-in-process' | 'serial-in-process';
};

export type ExecuteResultFinalizer = (result: RunResult) => Promise<RunResult>;

export type ExecuteOptions = {
    readonly execution: ExecuteExecution;
    readonly finalizeResult?: ExecuteResultFinalizer;
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters: readonly DefinedReporter[];
    readonly resourceBudgets?: ExecuteResourceBudgets | null;
    readonly resourceUsageTracker?: RunResourceUsageTracker | null;
    readonly runtimePolicy?: RuntimePolicy | null;
    readonly runFacts: RunFacts;
    readonly startedAt: string;
    readonly timeoutPolicy?: ExecuteTimeoutPolicy | null;
};

export type NormalizedExecuteOptions = ExecuteOptions & {
    readonly finalizeResult: ExecuteResultFinalizer;
    readonly outputRenderer: DefinedOutputRenderer;
    readonly runtimePolicy: RuntimePolicy | null;
};

type RuntimePolicy = NonNullable<ExecutionSupervisionDependencies['runtimePolicy']>;

const epoch = new Date(0);
const keepResult: ExecuteResultFinalizer = async function keepResult(result) {
    return result;
};

function defaultExecuteOptions(): NormalizedExecuteOptions {
    return {
        execution: { mode: 'serial-in-process' },
        finalizeResult: keepResult,
        outputRenderer: createPlainOutputRenderer(),
        reporters: [],
        resourceBudgets: null,
        resourceUsageTracker: null,
        runtimePolicy: null,
        runFacts: {},
        startedAt: epoch.toISOString(),
        timeoutPolicy: null
    };
}

function executeOptionsWithProvidedDefaults(options: ExecuteOptions): NormalizedExecuteOptions {
    return {
        ...options,
        finalizeResult: options.finalizeResult ?? keepResult,
        outputRenderer: options.outputRenderer ?? createPlainOutputRenderer(),
        resourceBudgets: options.resourceBudgets ?? null,
        runtimePolicy: options.runtimePolicy ?? null,
        timeoutPolicy: options.timeoutPolicy ?? null
    };
}

export function executeOptionsWithDefaults(options: ExecuteOptions | undefined): NormalizedExecuteOptions {
    return options === undefined ? defaultExecuteOptions() : executeOptionsWithProvidedDefaults(options);
}
