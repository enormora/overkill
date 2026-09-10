import { createPlainOutputRenderer, type DefinedOutputRenderer } from './reporter-output.ts';
import type { DefinedReporter, RunFacts } from './reporter.ts';
import type { RunResourceUsageTracker } from './run-result.ts';
import type {
    ExecuteResourceBudgets,
    ExecuteTimeoutPolicy,
    ExecutionSupervisionDependencies
} from './execution-supervision.ts';

export type ExecuteExecution = {
    readonly mode: 'concurrent-in-process' | 'serial-in-process';
};

export type ExecuteOptions = {
    readonly execution: ExecuteExecution;
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
    readonly outputRenderer: DefinedOutputRenderer;
    readonly runtimePolicy: RuntimePolicy | null;
};

type RuntimePolicy = NonNullable<ExecutionSupervisionDependencies['runtimePolicy']>;

const epoch = new Date(0);

export function executeOptionsWithDefaults(options: ExecuteOptions | undefined): NormalizedExecuteOptions {
    if (options !== undefined) {
        return {
            ...options,
            outputRenderer: options.outputRenderer ?? createPlainOutputRenderer(),
            resourceBudgets: options.resourceBudgets ?? null,
            runtimePolicy: options.runtimePolicy ?? null,
            timeoutPolicy: options.timeoutPolicy ?? null
        };
    }

    return {
        execution: { mode: 'serial-in-process' },
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
