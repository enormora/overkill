import { startResourceBudgetTracking } from './execution-resource-budget-tracking.ts';
import type {
    ExecuteResourceBudgets,
    ExecutionSupervision,
    ExecutionSupervisionDependencies
} from './execution-supervision.ts';
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

export async function executeResourceTrackedCases<
    Input extends ResourceTrackedCaseInput,
    Executed extends ExecutedTestPlan
>(
    input: Input,
    executeCases: (input: Input) => Promise<Executed>
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
        const executedTestPlan = await executeCases(input);
        const resourceBudgetResult = resourceBudgetTracking.finish();

        return {
            executedTestPlan: {
                ...executedTestPlan,
                reporterErrors: [
                    ...executedTestPlan.reporterErrors,
                    ...resourceBudgetResult.runnerErrors
                ]
            },
            resourceUsage: resourceBudgetResult.resourceUsage
        };
    } catch (error: unknown) {
        resourceBudgetTracking.stop();

        throw error;
    }
}
