import type { WallClock } from '@enormora/wall-clock';
import {
    createExecutionAsyncLeakMonitor,
    type AsyncLeakDependencies,
    type AsyncLeakDiagnostics
} from './execution-async-leak-policy.ts';
import {
    executeOptionsWithDefaults,
    type ExecuteExecution as ExecuteExecutionDefinition,
    type ExecuteOptions as ExecuteOptionsDefinition,
    type NormalizedExecuteOptions
} from './execution-options.ts';
import { appendRunnerErrors, createRunResult, throwWithCleanupErrors } from './execution-result.ts';
import type { ExecutionSupervisionDependencies } from './execution-supervision.ts';
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
    readonly wallClock: WallClock;
};

type ExecuteRunInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reporterDisposal: ReporterDisposal;
    readonly testPlan: TestPlan;
};

type ExecutionDependencies = AsyncLeakDependencies & {
    readonly runtimePolicy: RuntimePolicy | null;
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: WallClock;
};

type RuntimePolicy = NonNullable<ExecutionSupervisionDependencies['runtimePolicy']>;

type ExecutionReportingContext = {
    readonly dependencies: ExecutionDependencies;
    readonly reporterDelivery: ReporterDelivery;
};

async function createRunResultBeforeRunEnd(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    reporterDelivery: ReporterDelivery
): Promise<RunResult> {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
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
    const reporterErrors = [
        ...startErrors,
        ...loadRuntimePolicyErrors,
        ...executedTestPlan.reporterErrors,
        ...finalRuntimePolicyErrors
    ];

    return createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        planStatus: 'planned',
        resourceUsage,
        startedAtMs,
        wallClock: dependencies.wallClock
    });
}

async function executeRun(input: ExecuteRunInput): Promise<RunResult> {
    const result = await createRunResultBeforeRunEnd(
        input.testPlan,
        input.options,
        input.context.dependencies,
        input.context.reporterDelivery
    );
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

export function createExecute(dependencies: ExecuteDependencies): Execute {
    return async function execute(testPlan, options) {
        const executeOptions = executeOptionsWithDefaults(options);
        const asyncLeakMonitor = createExecutionAsyncLeakMonitor(dependencies.asyncLeakDiagnostics);
        const executionDependencies: ExecutionDependencies = {
            asyncLeakMonitor,
            ...dependencies,
            runtimePolicy: executeOptions.runtimePolicy
        };
        const reporterDelivery = await dependencies.reporterDispatcher.createDelivery(
            executeOptions.reporters,
            executeOptions.outputRenderer
        );
        const reporterDisposal = createReporterDisposal(reporterDelivery.disposeReporters);

        try {
            return await executeRun({
                context: {
                    dependencies: executionDependencies,
                    reporterDelivery
                },
                options: executeOptions,
                reporterDisposal,
                testPlan
            });
        } catch (error: unknown) {
            return await throwWithCleanupErrors(error, reporterDisposal.disposeOnce);
        } finally {
            asyncLeakMonitor.stop();
        }
    };
}
