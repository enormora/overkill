import type {
    ExecuteExecution as ExecuteExecutionDefinition,
    ExecuteOptions as ExecuteOptionsDefinition,
    NormalizedExecuteOptions
} from './execution-options.ts';
import { appendRunnerErrors, createRunResult, throwWithCleanupErrors } from './execution-result.ts';
import { executeTestPlanCasesAndMeasureProcessUsage } from './execution-test-plan-process-usage.ts';
import {
    createReporterDisposal,
    type ReporterDelivery,
    type ReporterDisposal
} from './reporter-dispatcher.ts';
import { reportRunnerErrors } from './runner-error-reporting.ts';
import type { RunResult } from './run-result.ts';
import type { TestPlan } from './test-plan.ts';
import {
    withPreparedExecution,
    type ExecuteDependencies as PreparationDependencies,
    type PreparedExecution
} from './execution-preparation.ts';

export type ExecuteDependencies = PreparationDependencies;

export type ExecuteExecution = ExecuteExecutionDefinition;
export type ExecuteOptions = ExecuteOptionsDefinition;

type ExecuteRunInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reporterDisposal: ReporterDisposal;
    readonly testPlan: TestPlan;
};

type ExecutionReportingContext = {
    readonly dependencies: PreparedExecution['dependencies'];
    readonly reporterDelivery: ReporterDelivery;
};

async function createRunResultBeforeRunEnd(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: PreparedExecution['dependencies'],
    reporterDelivery: ReporterDelivery
): Promise<RunResult> {
    const startedAtMicroseconds = Number(dependencies.wallClock.currentMonotonicMicroseconds);
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
    const { executedTestPlan, processUsage } = await executeTestPlanCasesAndMeasureProcessUsage(
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
        completedAtMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds),
        planStatus: 'planned',
        processUsage,
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
    input.context.dependencies.asyncLeakMonitor.stop();

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

async function executeWithReporterDelivery(prepared: PreparedExecution, testPlan: TestPlan): Promise<RunResult> {
    const reporterDelivery = await prepared.dependencies.reporterDispatcher.createDelivery(
        prepared.options.reporters,
        prepared.options.outputRenderer
    );
    const reporterDisposal = createReporterDisposal(reporterDelivery.disposeReporters);
    try {
        return await prepared.globalErrorObserver.runBoundary(async function runObservedExecution() {
            return await executeRun({
                context: { dependencies: prepared.dependencies, reporterDelivery },
                options: prepared.options,
                reporterDisposal,
                testPlan
            });
        });
    } catch (error: unknown) {
        return await throwWithCleanupErrors(error, reporterDisposal.disposeOnce);
    }
}

export function createExecute(dependencies: ExecuteDependencies): Execute {
    return async function execute(testPlan, options) {
        return await withPreparedExecution(dependencies, options, testPlan, async function executePrepared(prepared) {
            return await executeWithReporterDelivery(prepared, testPlan);
        });
    };
}
