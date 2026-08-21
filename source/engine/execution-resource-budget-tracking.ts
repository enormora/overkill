import type {
    ResourceUsageSnapshot,
    RunResourceUsageTracker,
    RunResult,
    RunnerError
} from './run-result.ts';
import {
    recordResourceUsageSample,
    type ExecuteResourceBudgets,
    type ExecutionSupervision,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';

type ResourceBudgetTrackingInput = {
    readonly dependencies: ExecutionSupervisionDependencies;
    readonly resourceBudgets: ExecuteResourceBudgets | null;
    readonly resourceUsageTracker: RunResourceUsageTracker;
    readonly supervision: ExecutionSupervision;
};

type FinishedResourceBudgetTracking = {
    readonly resourceUsage: RunResult['resourceUsage'];
    readonly runnerErrors: readonly RunnerError[];
};

export type ResourceBudgetTracking = {
    readonly finish: () => FinishedResourceBudgetTracking;
    readonly stop: () => void;
};

export function startResourceBudgetTracking(input: ResourceBudgetTrackingInput): ResourceBudgetTracking {
    let previousSample: ResourceUsageSnapshot | null = null;
    let breached = false;

    function recordSample(sample: ResourceUsageSnapshot): void {
        if (!breached) {
            breached = recordResourceUsageSample({
                budgets: input.resourceBudgets,
                dependencies: input.dependencies,
                previousSample,
                sample,
                supervision: input.supervision
            });
        }

        previousSample = sample;
    }

    input.resourceUsageTracker.start(recordSample);

    return {
        finish() {
            const runnerErrorCount = input.supervision.runnerErrors.length;
            const resourceUsage = input.resourceUsageTracker.finish();
            recordSample(resourceUsage.end);

            return {
                resourceUsage,
                runnerErrors: input.supervision.runnerErrors.slice(runnerErrorCount)
            };
        },
        stop() {
            input.resourceUsageTracker.finish();
        }
    };
}
