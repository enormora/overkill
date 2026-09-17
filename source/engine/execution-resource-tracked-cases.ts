import {
    startResourceBudgetTracking,
    type ResourceBudgetTracking
} from './execution-resource-budget-tracking.ts';
import type { ExecuteResourceBudgets } from './execution-resource-budget-breach.ts';
import type { ExecutionSupervision, ExecutionSupervisionDependencies } from './execution-supervision.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';
import { reportRunnerErrors } from './runner-error-reporting.ts';
import type {
    RunResourceUsageTracker,
    RunResult,
    RunnerError
} from './run-result.ts';

type ExecutedTestPlan = {
    readonly reporterErrors: readonly RunnerError[];
};

type ResourceTrackedCaseInput = {
    readonly context: {
        readonly dependencies: ExecutionSupervisionDependencies;
        readonly reporterDelivery: ReporterDelivery;
    };
    readonly options: {
        readonly resourceBudgets?: ExecuteResourceBudgets | null;
        readonly resourceUsageTracker?: RunResourceUsageTracker | null;
    };
    readonly supervision: ExecutionSupervision;
};

export type ResourceTrackedCaseResult<Executed extends ExecutedTestPlan> = {
    readonly executedTestPlan: Executed;
    readonly resourceUsage: RunResult['resourceUsage'];
};

type ExecuteResourceTrackedCasesFunction<
    Input extends ResourceTrackedCaseInput,
    Executed extends ExecutedTestPlan
> = (input: Input) => Promise<Executed>;

async function executeCasesWithResourceUsage<
    Input extends ResourceTrackedCaseInput,
    Executed extends ExecutedTestPlan
>(
    input: Input,
    executeCases: ExecuteResourceTrackedCasesFunction<Input, Executed>,
    resourceBudgetTracking: ResourceBudgetTracking
): Promise<ResourceTrackedCaseResult<Executed>> {
    const executedTestPlan = await executeCases(input);
    const resourceBudgetResult = resourceBudgetTracking.finish();
    const runnerErrors = await reportRunnerErrors(
        input.context.reporterDelivery,
        resourceBudgetResult.runnerErrors
    );

    return {
        executedTestPlan: {
            ...executedTestPlan,
            reporterErrors: [
                ...executedTestPlan.reporterErrors,
                ...runnerErrors
            ]
        },
        resourceUsage: resourceBudgetResult.resourceUsage
    };
}

export async function executeResourceTrackedCases<
    Input extends ResourceTrackedCaseInput,
    Executed extends ExecutedTestPlan
>(
    input: Input,
    executeCases: ExecuteResourceTrackedCasesFunction<Input, Executed>
): Promise<ResourceTrackedCaseResult<Executed>> {
    const { resourceUsageTracker } = input.options;

    if (resourceUsageTracker === null || resourceUsageTracker === undefined) {
        return {
            executedTestPlan: await executeCases(input),
            resourceUsage: null
        };
    }

    const resourceBudgetTracking = startResourceBudgetTracking({
        dependencies: input.context.dependencies,
        resourceBudgets: input.options.resourceBudgets ?? null,
        resourceUsageTracker,
        supervision: input.supervision
    });

    try {
        return await executeCasesWithResourceUsage(input, executeCases, resourceBudgetTracking);
    } catch (error: unknown) {
        resourceBudgetTracking.stop();

        throw error;
    }
}
