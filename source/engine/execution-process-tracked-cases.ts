import {
    startProcessBudgetTracking,
    type ProcessBudgetTracking
} from './execution-process-budget-tracking.ts';
import type { ExecuteProcessBudgets } from './execution-process-budget-breach.ts';
import type { ExecutionSupervision, ExecutionSupervisionDependencies } from './execution-supervision.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import { reportRunnerErrors } from './runner-error-reporting.ts';
import type { RunResult, RunnerError } from './run-result.ts';
import type { RunProcessUsageTracker } from './process-usage.ts';

type ExecutedTestPlan = {
    readonly reporterErrors: readonly RunnerError[];
};

type ProcessUsageCaseInput = {
    readonly context: {
        readonly dependencies: ExecutionSupervisionDependencies;
        readonly reporterDelivery: ReporterDelivery;
    };
    readonly options: {
        readonly processBudgets?: ExecuteProcessBudgets | null;
        readonly processUsageTracker?: RunProcessUsageTracker | null;
    };
    readonly supervision: ExecutionSupervision;
};

export type ProcessUsageCaseResult<Executed extends ExecutedTestPlan> = {
    readonly executedTestPlan: Executed;
    readonly processUsage: RunResult['processUsage'];
};

type ProcessUsageCaseExecutor<
    Input extends ProcessUsageCaseInput,
    Executed extends ExecutedTestPlan
> = (input: Input) => Promise<Executed>;

async function executeCasesWithProcessUsage<
    Input extends ProcessUsageCaseInput,
    Executed extends ExecutedTestPlan
>(
    input: Input,
    executeCases: ProcessUsageCaseExecutor<Input, Executed>,
    processBudgetTracking: ProcessBudgetTracking
): Promise<ProcessUsageCaseResult<Executed>> {
    const executedTestPlan = await executeCases(input);
    const processBudgetResult = processBudgetTracking.finish();
    const runnerErrors = await reportRunnerErrors(
        input.context.reporterDelivery,
        processBudgetResult.runnerErrors
    );

    return {
        executedTestPlan: {
            ...executedTestPlan,
            reporterErrors: [
                ...executedTestPlan.reporterErrors,
                ...runnerErrors
            ]
        },
        processUsage: processBudgetResult.processUsage
    };
}

export async function executeCasesAndMeasureProcessUsage<
    Input extends ProcessUsageCaseInput,
    Executed extends ExecutedTestPlan
>(
    input: Input,
    executeCases: ProcessUsageCaseExecutor<Input, Executed>
): Promise<ProcessUsageCaseResult<Executed>> {
    const { processUsageTracker } = input.options;

    if (processUsageTracker === null || processUsageTracker === undefined) {
        return {
            executedTestPlan: await executeCases(input),
            processUsage: null
        };
    }

    const processBudgetTracking = startProcessBudgetTracking({
        dependencies: input.context.dependencies,
        processBudgets: input.options.processBudgets ?? null,
        processUsageTracker,
        supervision: input.supervision
    });

    try {
        return await executeCasesWithProcessUsage(input, executeCases, processBudgetTracking);
    } catch (error: unknown) {
        processBudgetTracking.stop();

        throw error;
    }
}
