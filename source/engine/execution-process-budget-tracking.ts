import type { RunResult, RunnerError } from './run-result.ts';
import type { ProcessUsageSnapshot, RunProcessUsageTracker } from './process-usage.ts';
import {
    recordProcessUsageSample,
    type ExecutionSupervision,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import type { ExecuteProcessBudgets } from './execution-process-budget-breach.ts';

type ProcessBudgetTrackingInput = {
    readonly dependencies: ExecutionSupervisionDependencies;
    readonly processBudgets: ExecuteProcessBudgets | null;
    readonly processUsageTracker: RunProcessUsageTracker;
    readonly supervision: ExecutionSupervision;
};

type FinishedProcessBudgetTracking = {
    readonly processUsage: RunResult['processUsage'];
    readonly runnerErrors: readonly RunnerError[];
};

export type ProcessBudgetTracking = {
    readonly finish: () => FinishedProcessBudgetTracking;
    readonly stop: () => void;
};

export function startProcessBudgetTracking(input: ProcessBudgetTrackingInput): ProcessBudgetTracking {
    let previousSample: ProcessUsageSnapshot | null = null;
    let breached = false;

    function recordSample(sample: ProcessUsageSnapshot): void {
        if (!breached) {
            breached = recordProcessUsageSample({
                budgets: input.processBudgets,
                dependencies: input.dependencies,
                previousSample,
                sample,
                supervision: input.supervision
            });
        }

        previousSample = sample;
    }

    input.processUsageTracker.start(recordSample);

    return {
        finish() {
            const runnerErrorCount = input.supervision.runnerErrors.length;
            const processUsage = input.processUsageTracker.finish();
            recordSample(processUsage.end);

            return {
                processUsage,
                runnerErrors: input.supervision.runnerErrors.slice(runnerErrorCount)
            };
        },
        stop() {
            input.processUsageTracker.finish();
        }
    };
}
