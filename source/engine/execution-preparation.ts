import type { Clock } from '@enormora/clock';
import {
    createExecutionAsyncLeakMonitor,
    type AsyncLeakDependencies,
    type AsyncLeakDiagnostics
} from './execution-async-leak-policy.ts';
import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from './execution-global-error-observer.ts';
import { withExecutionObservation } from './execution-observation.ts';
import {
    executeOptionsWithDefaults,
    type ExecuteOptions as ExecuteOptionsDefinition,
    type NormalizedExecuteOptions
} from './execution-options.ts';
import type { ReporterDispatcher } from './reporter-dispatcher.ts';
import type { TestPlan } from './test-plan.ts';

export type ExecuteDependencies = {
    readonly benchmarkEnvironment: NormalizedExecuteOptions['benchmarkEnvironment'];
    readonly asyncLeakDiagnostics: AsyncLeakDiagnostics;
    readonly readActiveResourceTypes: () => readonly string[];
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: Clock;
};

type ExecutionDependencies = AsyncLeakDependencies & {
    readonly benchmarkEnvironment: NormalizedExecuteOptions['benchmarkEnvironment'];
    readonly globalErrorObserver: ExecutionGlobalErrorObserver;
    readonly runtimePolicy: NormalizedExecuteOptions['runtimePolicy'];
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: Clock;
};

export type PreparedExecution = {
    readonly asyncLeakMonitor: AsyncLeakDependencies['asyncLeakMonitor'];
    readonly dependencies: ExecutionDependencies;
    readonly globalErrorObserver: ExecutionGlobalErrorObserver;
    readonly options: NormalizedExecuteOptions;
};

function prepareExecution(
    dependencies: ExecuteDependencies,
    options: ExecuteOptionsDefinition | undefined,
    testPlan: TestPlan
): PreparedExecution {
    const executeOptions = executeOptionsWithDefaults(options, testPlan, dependencies.benchmarkEnvironment);
    const asyncLeakMonitor = createExecutionAsyncLeakMonitor(dependencies.asyncLeakDiagnostics);
    const globalErrorObserver = createExecutionGlobalErrorObserver('in-process');

    return {
        asyncLeakMonitor,
        dependencies: {
            asyncLeakMonitor,
            globalErrorObserver,
            ...dependencies,
            benchmarkEnvironment: executeOptions.benchmarkEnvironment,
            runtimePolicy: executeOptions.runtimePolicy
        },
        globalErrorObserver,
        options: executeOptions
    };
}

export async function withPreparedExecution<Value>(
    dependencies: ExecuteDependencies,
    options: ExecuteOptionsDefinition | undefined,
    testPlan: TestPlan,
    execute: (prepared: PreparedExecution) => Promise<Value>
): Promise<Value> {
    return await withExecutionObservation(async function observeEngineExecution() {
        const prepared = prepareExecution(dependencies, options, testPlan);
        try {
            return await execute(prepared);
        } finally {
            prepared.asyncLeakMonitor.stop();
            prepared.globalErrorObserver.stop();
        }
    });
}
