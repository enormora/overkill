import { createDefaultWorkId, type AttemptId, type CaseId, type WorkId } from '../engine/identity.ts';
import { observedGrowthBytesPerSecond } from '../engine/process-usage-growth.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type { ProcessUsageSnapshot } from '../engine/process-usage.ts';
import type { ProcessBudgets } from '../config/types.ts';
import type { SupervisedRunState } from './supervised-run-state.ts';

type ProcessBudgetMetric = keyof ProcessBudgets;

export type ProcessBudgetBreach = {
    readonly budget: number;
    readonly metric: ProcessBudgetMetric;
    readonly observed: number;
    readonly sample: ProcessUsageSnapshot;
};

type BudgetValueReader = (
    sample: ProcessUsageSnapshot,
    previousSample: ProcessUsageSnapshot | null
) => number;

const processBudgetMetrics: readonly ProcessBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

const budgetValueReaders: Readonly<Record<ProcessBudgetMetric, BudgetValueReader>> = {
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
    metric: ProcessBudgetMetric,
    sample: ProcessUsageSnapshot,
    previousSample: ProcessUsageSnapshot | null
): number {
    return budgetValueReaders[metric](sample, previousSample);
}

export function findProcessBudgetBreach(
    budgets: ProcessBudgets,
    sample: ProcessUsageSnapshot,
    previousSample: ProcessUsageSnapshot | null
): ProcessBudgetBreach | null {
    for (const metric of processBudgetMetrics) {
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

export function processExhaustionError(breach: ProcessBudgetBreach, state: SupervisedRunState): RunnerError {
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
        message: `Process budget exceeded: ${breach.metric} observed ${breach.observed}, budget ${breach.budget}.`,
        subtype: 'process-exhaustion'
    };
}

type CrashCause = {
    readonly activeCases: ReturnType<typeof activeCaseIds>;
    readonly activeWork: ReturnType<typeof activeWorkIds>;
    readonly activeAttempts: ReturnType<typeof activeAttemptEvidence>;
    readonly reason: string;
};

export function crashError(state: SupervisedRunState, reason: string): RunnerError & { readonly cause: CrashCause; } {
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

export function hardTimeoutError(state: SupervisedRunState, timeoutMilliseconds: number): RunnerError {
    const error = crashError(state, 'Supervised child exceeded hard timeout.');
    return {
        ...error,
        cause: {
            ...error.cause,
            termination: 'hard-timeout',
            timeoutMilliseconds
        }
    };
}
