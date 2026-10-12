import type { ProcessUsageSnapshot } from './process-usage.ts';
import { observedGrowthBytesPerSecond } from './process-usage-growth.ts';

export type ExecuteProcessBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

type ProcessBudgetMetric = keyof ExecuteProcessBudgets;

export type ProcessBudgetBreach = {
    readonly budget: number;
    readonly metric: ProcessBudgetMetric;
    readonly observed: number;
    readonly sample: ProcessUsageSnapshot;
};

const processBudgetMetrics: readonly ProcessBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

function observedBudgetValue(
    metric: ProcessBudgetMetric,
    sample: ProcessUsageSnapshot,
    previousSample: ProcessUsageSnapshot | null
): number {
    const observedValues = {
        activeResourceCount: sample.activeResourceCount,
        javaScriptEngineHeapBytes: sample.javaScriptEngineHeapBytes,
        residentSetBytes: sample.residentSetBytes,
        residentSetGrowthBytesPerSecond: observedGrowthBytesPerSecond(sample, previousSample)
    };

    return observedValues[metric];
}

export function findProcessBudgetBreach(
    budgets: ExecuteProcessBudgets | null | undefined,
    sample: ProcessUsageSnapshot,
    previousSample: ProcessUsageSnapshot | null
): ProcessBudgetBreach | null {
    if (budgets === null || budgets === undefined) {
        return null;
    }

    for (const metric of processBudgetMetrics) {
        const budget = budgets[metric];
        const observed = observedBudgetValue(metric, sample, previousSample);

        if (budget !== null && observed > budget) {
            return { budget, metric, observed, sample };
        }
    }

    return null;
}
