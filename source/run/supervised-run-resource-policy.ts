import { createDefaultWorkId, type AttemptId, type CaseId, type WorkId } from '../engine/identity.ts';
import { observedGrowthBytesPerSecond } from '../engine/resource-usage-growth.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { ResourceUsageSnapshot } from '../engine/resource-usage.ts';
import type { ResourceBudgets } from '../config/types.ts';
import type { SupervisedRunState } from './supervised-run-state.ts';

type ResourceBudgetMetric = keyof ResourceBudgets;

export type ResourceBudgetBreach = {
    readonly budget: number;
    readonly metric: ResourceBudgetMetric;
    readonly observed: number;
    readonly sample: ResourceUsageSnapshot;
};

type BudgetValueReader = (
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
) => number;

const resourceBudgetMetrics: readonly ResourceBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

const budgetValueReaders: Readonly<Record<ResourceBudgetMetric, BudgetValueReader>> = {
    activeResourceCount(sample) {
        return sample.activeResourceCount;
    },
    javaScriptEngineHeapBytes(sample) {
        return sample.javaScriptEngineHeapBytes;
    },
    residentSetBytes(sample) {
        return sample.residentSetBytes;
    },
    residentSetGrowthBytesPerSecond: observedGrowthBytesPerSecond
};

function observedBudgetValue(
    metric: ResourceBudgetMetric,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    return budgetValueReaders[metric](sample, previousSample);
}

export function findResourceBudgetBreach(
    budgets: ResourceBudgets,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): ResourceBudgetBreach | null {
    for (const metric of resourceBudgetMetrics) {
        const budget = budgets[metric];

        if (budget !== null) {
            const observed = observedBudgetValue(metric, sample, previousSample);

            if (observed > budget) {
                return { budget, metric, observed, sample };
            }
        }
    }

    return null;
}

function activeCaseIds(state: SupervisedRunState): readonly CaseId[] {
    return Array.from(state.activeCases.values(), function toCaseId(testCase) {
        return testCase.id;
    });
}

function activeWorkIds(state: SupervisedRunState): readonly WorkId[] {
    return Array.from(state.activeCases.values(), function toWorkId(testCase) {
        return testCase.workId ?? createDefaultWorkId(testCase.id);
    });
}

function soleActiveAttempt(state: SupervisedRunState): AttemptId | null {
    return state.activeCases.size === 1 ? Array.from(state.activeCases.values())[0]?.attempt ?? null : null;
}

function activeAttemptEvidence(
    state: SupervisedRunState
): readonly { readonly work: WorkId; readonly attempt: AttemptId; }[] {
    return Array.from(state.activeCases.values(), function attemptEvidence(active) {
        return { work: active.workId ?? createDefaultWorkId(active.id), attempt: active.attempt };
    });
}

export function resourceExhaustionError(breach: ResourceBudgetBreach, state: SupervisedRunState): RunnerError {
    const activeCases = activeCaseIds(state);
    const activeWork = activeWorkIds(state);
    const [ activeCase = null ] = activeCases;
    const [ activeWorkItem = null ] = activeWork;

    return {
        attributedToAttempt: soleActiveAttempt(state),
        attributedTo: activeCases.length === 1 ? activeCase : null,
        attributedToWork: activeWork.length === 1 ? activeWorkItem : null,
        cause: {
            ...breach,
            activeCases,
            activeWork,
            activeAttempts: activeAttemptEvidence(state),
            enforcement: activeCases.length === 0 ? 'post-test-diagnostic' : 'sampled'
        },
        diagnostics: [
            { label: 'metric', value: breach.metric },
            { label: 'observed', value: String(breach.observed) },
            { label: 'budget', value: String(breach.budget) }
        ],
        message: `Resource budget exceeded: ${breach.metric} observed ${breach.observed}, budget ${breach.budget}.`,
        subtype: 'resource-exhaustion'
    };
}

export function crashError(state: SupervisedRunState, reason: string): RunnerError {
    const activeCases = activeCaseIds(state);
    const activeWork = activeWorkIds(state);
    const [ activeCase = null ] = activeCases;
    const [ activeWorkItem = null ] = activeWork;

    return {
        attributedToAttempt: soleActiveAttempt(state),
        attributedTo: activeCases.length === 1 ? activeCase : null,
        attributedToWork: activeWork.length === 1 ? activeWorkItem : null,
        cause: { activeCases, activeWork, activeAttempts: activeAttemptEvidence(state), reason },
        diagnostics: [ { label: 'reason', value: reason } ],
        message: reason,
        subtype: 'crash'
    };
}
