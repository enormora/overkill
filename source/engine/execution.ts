import type { OverkillClock } from '../clock/overkill-clock.ts';
import {
    createExecutionAsyncLeakMonitor,
    type AsyncLeakDependencies,
    type AsyncLeakDiagnostics
} from './execution-async-leak-policy.ts';
import {
    createExecutionGlobalErrorObserver,
    type ExecutionGlobalErrorObserver
} from './execution-global-error-observer.ts';
import {
    executeOptionsWithDefaults,
    type ExecuteExecution as ExecuteExecutionDefinition,
    type ExecuteOptions as ExecuteOptionsDefinition,
    type NormalizedExecuteOptions
} from './execution-options.ts';
import { appendRunnerErrors, createRunResult, throwWithCleanupErrors } from './execution-result.ts';
import { executeTestPlanCasesAndMeasureResourceUsage } from './execution-test-plan-resource-usage.ts';
import {
    createReporterDisposal,
    type ReporterDelivery,
    type ReporterDispatcher,
    type ReporterDisposal
} from './reporter-dispatcher.ts';
import { reportRunnerErrors } from './runner-error-reporting.ts';
import type { RunResult } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';

export type ExecuteExecution = ExecuteExecutionDefinition;
export type ExecuteOptions = ExecuteOptionsDefinition;

export type ExecuteDependencies = {
    readonly asyncLeakDiagnostics: AsyncLeakDiagnostics;
    readonly readActiveResourceTypes: () => readonly string[];
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: OverkillClock;
};

type ExecuteRunInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reporterDisposal: ReporterDisposal;
    readonly testPlan: TestPlan;
};

type ExecutionDependencies = AsyncLeakDependencies & {
    readonly globalErrorObserver: ExecutionGlobalErrorObserver;
    readonly runtimePolicy: NormalizedExecuteOptions['runtimePolicy'];
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: OverkillClock;
};

type ExecutionReportingContext = {
    readonly dependencies: ExecutionDependencies;
    readonly reporterDelivery: ReporterDelivery;
};

type PreparedExecution = {
    readonly asyncLeakMonitor: AsyncLeakDependencies['asyncLeakMonitor'];
    readonly dependencies: ExecutionDependencies;
    readonly globalErrorObserver: ExecutionGlobalErrorObserver;
    readonly options: NormalizedExecuteOptions;
};

async function createRunResultBeforeRunEnd(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    reporterDelivery: ReporterDelivery
): Promise<RunResult> {
    const startedAtMicroseconds = dependencies.wallClock.currentMonotonicMicroseconds;
    const startErrors = await reporterDelivery.reportEvent({
        facts: options.runFacts,
        kind: 'run-start',
        root: testPlan.root,
        startedAt: options.startedAt
    });
    const loadRuntimePolicyErrors = await reportRunnerErrors(
        reporterDelivery,
        options.runtimePolicy?.takePendingRunErrors() ?? []
    );
    const { executedTestPlan, resourceUsage } = await executeTestPlanCasesAndMeasureResourceUsage(
        testPlan,
        options,
        dependencies,
        reporterDelivery
    );
    const finalRuntimePolicyErrors = await reportRunnerErrors(
        reporterDelivery,
        options.runtimePolicy?.takeRunErrors() ?? []
    );
    const finalGlobalErrorObserverErrors = await reportRunnerErrors(
        reporterDelivery,
        dependencies.globalErrorObserver.takeErrors()
    );
    const reporterErrors = [
        ...startErrors,
        ...loadRuntimePolicyErrors,
        ...executedTestPlan.reporterErrors,
        ...finalRuntimePolicyErrors,
        ...finalGlobalErrorObserverErrors
    ];

    return createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        completedAtMicroseconds: dependencies.wallClock.currentMonotonicMicroseconds,
        planStatus: 'planned',
        resourceUsage,
        startedAtMicroseconds,
        testExecutionWallTimeMicroseconds: executedTestPlan.testExecutionWallTimeMicroseconds
    });
}

async function executeRun(input: ExecuteRunInput): Promise<RunResult> {
    const result = await createRunResultBeforeRunEnd(
        input.testPlan,
        input.options,
        input.context.dependencies,
        input.context.reporterDelivery
    );

    input.context.dependencies.globalErrorObserver.stop();

    const finalizedResult = await input.options.finalizeResult(result);
    const runEndErrors = await input.context.reporterDelivery.reportEvent({
        kind: 'run-end',
        result: finalizedResult
    });
    const resultForFinalReporting = appendRunnerErrors(finalizedResult, runEndErrors);
    const finalReporterErrors = await input.context.reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await input.reporterDisposal.disposeOnce();

    return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
}

export type Execute = (testPlan: TestPlan, options?: ExecuteOptions) => Promise<RunResult>;

function prepareExecution(
    dependencies: ExecuteDependencies,
    options: ExecuteOptions | undefined
): PreparedExecution {
    const executeOptions = executeOptionsWithDefaults(options);
    const asyncLeakMonitor = createExecutionAsyncLeakMonitor(dependencies.asyncLeakDiagnostics);
    const globalErrorObserver = createExecutionGlobalErrorObserver('in-process');

    return {
        asyncLeakMonitor,
        dependencies: {
            asyncLeakMonitor,
            globalErrorObserver,
            ...dependencies,
            runtimePolicy: executeOptions.runtimePolicy
        },
        globalErrorObserver,
        options: executeOptions
    };
}

export function createExecute(dependencies: ExecuteDependencies): Execute {
    return async function execute(testPlan, options) {
        const prepared = prepareExecution(dependencies, options);
        const reporterDelivery = await dependencies.reporterDispatcher.createDelivery(
            prepared.options.reporters,
            prepared.options.outputRenderer
        );
        const reporterDisposal = createReporterDisposal(reporterDelivery.disposeReporters);

        try {
            return await prepared.globalErrorObserver.runBoundary(async function runObservedExecution() {
                return await executeRun({
                    context: {
                        dependencies: prepared.dependencies,
                        reporterDelivery
                    },
                    options: prepared.options,
                    reporterDisposal,
                    testPlan
                });
            });
        } catch (error: unknown) {
            return await throwWithCleanupErrors(error, reporterDisposal.disposeOnce);
        } finally {
            prepared.asyncLeakMonitor.stop();
            prepared.globalErrorObserver.stop();
        }
    };
}
