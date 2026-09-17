import type { ResourceUsageSnapshot } from './run-result.ts';
import { observedGrowthBytesPerSecond } from './resource-usage-growth.ts';

export type ExecuteResourceBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

type ResourceBudgetMetric = keyof ExecuteResourceBudgets;

export type ResourceBudgetBreach = {
    readonly budget: number;
    readonly metric: ResourceBudgetMetric;
    readonly observed: number;
    readonly sample: ResourceUsageSnapshot;
};

const resourceBudgetMetrics: readonly ResourceBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

function observedBudgetValue(
    metric: ResourceBudgetMetric,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    const observedValues = {
        activeResourceCount: sample.activeResourceCount,
        javaScriptEngineHeapBytes: sample.javaScriptEngineHeapBytes,
        residentSetBytes: sample.residentSetBytes,
        residentSetGrowthBytesPerSecond: observedGrowthBytesPerSecond(sample, previousSample)
    };

    return observedValues[metric];
}

export function findResourceBudgetBreach(
    budgets: ExecuteResourceBudgets | null | undefined,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): ResourceBudgetBreach | null {
    if (budgets === null || budgets === undefined) {
        return null;
    }

    for (const metric of resourceBudgetMetrics) {
        const budget = budgets[metric];
        const observed = observedBudgetValue(metric, sample, previousSample);

        if (budget !== null && observed > budget) {
            return { budget, metric, observed, sample };
        }
    }

    return null;
}
