import type { AttemptId, CaseId, WorkId } from './identity.ts';
import type { RunnerError } from './run-result.ts';
import type { ExecuteProcessBudgets, ProcessUsageSnapshot } from './process-usage.ts';
import { observedGrowthBytesPerSecond } from './process-usage-growth.ts';

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

export type ProcessExhaustionCause = ProcessBudgetBreach & {
    readonly activeAttempts: readonly AttemptId[];
    readonly activeCases: readonly CaseId[];
    readonly activeWork: readonly WorkId[];
    readonly enforcement: 'post-test-diagnostic' | 'sampled';
};

function soleBoundaryOwner<Identity>(identities: readonly Identity[]): Identity | null {
    return identities.length === 1 ? identities[0] ?? null : null;
}

export function processExhaustionError(cause: ProcessExhaustionCause): RunnerError {
    return {
        attributedToAttempt: soleBoundaryOwner(cause.activeAttempts),
        attributedTo: soleBoundaryOwner(cause.activeCases),
        attributedToWork: soleBoundaryOwner(cause.activeWork),
        cause,
        diagnostics: [
            { label: 'metric', value: cause.metric },
            { label: 'observed', value: String(cause.observed) },
            { label: 'budget', value: String(cause.budget) }
        ],
        message: `Process budget exceeded: ${cause.metric} observed ${cause.observed}, budget ${cause.budget}.`,
        subtype: 'process-exhaustion'
    };
}
