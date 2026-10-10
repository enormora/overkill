import { caseIdentityKey, createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { runStatusFromPlan, type PerTestResult, type RunResult, type RunnerError } from '../engine/run-result.ts';
import type { ComparableCalibration } from '../packages/run/benchmark-calibration.entry-point.ts';
import type { PerformanceBaselineAdapter } from './performance-adapter.ts';
import {
    performanceBaselineIdentity,
    type BaselineChange,
    type BaselineUpdateMode,
    type StoredPerformanceBaseline
} from './performance-baseline.ts';
import {
    evaluatePerformanceBaseline,
    performanceBaselineError,
    type BenchmarkCaseEnd
} from './performance-evaluation.ts';
import {
    createPerformanceBaselineStore,
    performanceBaselineKey,
    type PerformanceBaselineStore
} from './performance-store.ts';

export type PerformanceWorkflowInput = {
    readonly adapters: readonly PerformanceBaselineAdapter[];
    readonly calibration: ComparableCalibration;
    readonly directory: string;
    readonly maxBytes: number;
    readonly mode: BaselineUpdateMode;
    readonly profile: string;
    readonly projectRoot: string;
};
export type PerformanceWorkflow = {
    readonly changes: readonly BaselineChange[];
    readonly evaluate: (event: BenchmarkCaseEnd) => PerformanceCaseEvaluation;
    readonly finish: (result: RunResult, completeInventory: boolean) => PerformanceCompletion;
    readonly store: PerformanceBaselineStore;
};
type PerformanceCaseEvaluation = {
    readonly errors: readonly RunnerError[];
    readonly event: BenchmarkCaseEnd;
};
type PerformanceCompletion = {
    readonly errors: readonly RunnerError[];
    readonly result: RunResult;
};
type WorkflowState = {
    readonly changes: readonly BaselineChange[];
    readonly evaluated: ReadonlyMap<string, BenchmarkCaseEnd>;
    readonly existing: ReadonlyMap<string, StoredPerformanceBaseline>;
    readonly participating: ReadonlySet<string>;
    readonly addChange: (change: BaselineChange) => void;
    readonly participate: (key: string) => void;
    readonly remember: (key: string, event: BenchmarkCaseEnd) => void;
};

function createWorkflowState(existing: ReadonlyMap<string, StoredPerformanceBaseline>): WorkflowState {
    const changes: BaselineChange[] = [];
    const evaluated = new Map<string, BenchmarkCaseEnd>();
    const participating = new Set<string>();
    return {
        changes,
        evaluated,
        existing,
        participating,
        addChange(change) {
            changes.push(change);
        },
        participate(key) {
            participating.add(key);
        },
        remember(key, event) {
            evaluated.set(key, event);
        }
    };
}

function baselineCaseResult(
    testResult: PerTestResult,
    evaluated: ReadonlyMap<string, BenchmarkCaseEnd>
): PerTestResult {
    const event = evaluated.get(workIdentityKey(testResult.workId));
    if (event === undefined || event.verdict === 'pass' || testResult.verdict !== 'pass') {
        return testResult;
    }
    return {
        ...testResult,
        attempts: [
            { ...testResult.attempts[0], outcome: event.outcome, verdict: event.verdict },
            ...testResult.attempts.slice(1)
        ],
        outcome: event.outcome,
        verdict: event.verdict
    };
}

function resultWithBaselineVerdicts(result: RunResult, state: WorkflowState): RunResult {
    const perTest = result.perTest.map(function baselineResult(testResult) {
        return baselineCaseResult(testResult, state.evaluated);
    });
    const summary = {
        ...result.summary,
        failed: perTest
            .filter(function failed(testResult) {
                return testResult.verdict === 'fail';
            })
            .length,
        passed: perTest
            .filter(function passed(testResult) {
                return testResult.verdict === 'pass';
            })
            .length
    };
    return { ...result, perTest, status: runStatusFromPlan(summary, result.runnerErrors, result.planStatus), summary };
}

function completedCase(testResult: PerTestResult): boolean {
    return testResult.verdict === 'pass' || testResult.verdict === 'skip';
}

export function successfulPerformanceRun(result: RunResult): boolean {
    return result.status === 'passed' && result.planStatus === 'planned' && result.runnerErrors.length === 0 &&
        result.perTest.length === result.summary.planned && result.perTest.every(completedCase);
}

function staleBaselines(result: RunResult, state: WorkflowState): readonly StoredPerformanceBaseline[] {
    const skipped = new Set(
        result
            .perTest
            .filter(function skippedCase(testResult) {
                return testResult.verdict === 'skip';
            })
            .map(function skippedIdentity(testResult) {
                return caseIdentityKey(testResult.workId.case);
            })
    );
    return Array
        .from(state.existing)
        .filter(function stale([ key, baseline ]) {
            return !state.participating.has(key) && !skipped.has(caseIdentityKey(baseline.work.case));
        })
        .map(function staleBaseline([ , baseline ]) {
            return baseline;
        });
}

function reconcileInventory(
    input: PerformanceWorkflowInput,
    result: RunResult,
    state: WorkflowState
): readonly RunnerError[] {
    const stale = staleBaselines(result, state);
    if (input.mode === 'apply' || input.mode === 'diff') {
        for (const baseline of stale) {
            state.addChange({ baseline, kind: 'remove' });
        }
        return [];
    }
    return stale.length === 0 ? [] : [ performanceBaselineError(
        new Error(`Found ${stale.length.toString()} stale performance baselines. Use "overkill bench baseline apply".`),
        null
    ) ];
}

function evaluateAdapter(
    input: PerformanceWorkflowInput,
    state: WorkflowState,
    event: BenchmarkCaseEnd,
    adapter: PerformanceBaselineAdapter
): readonly FailedCheck[] {
    const work = event.workId ?? createDefaultWorkId(event.case);
    const key = performanceBaselineKey({
        adapter: adapter.id,
        machineClass: input.calibration.machineClass,
        profile: input.profile,
        work
    });
    const evaluation = evaluatePerformanceBaseline({
        adapter,
        calibration: input.calibration,
        event,
        existing: state.existing.get(key) ?? null,
        maxBytes: input.maxBytes,
        mode: input.mode,
        profile: input.profile
    });
    if (evaluation.participates) {
        state.participate(key);
    }
    if (evaluation.change !== null) {
        state.addChange(evaluation.change);
    }
    return evaluation.checks;
}

function evaluateAdapters(
    input: PerformanceWorkflowInput,
    state: WorkflowState,
    event: BenchmarkCaseEnd
): PerformanceCaseEvaluation {
    const checks: FailedCheck[] = [];
    const errors: RunnerError[] = [];
    for (const adapter of input.adapters) {
        try {
            checks.push(...evaluateAdapter(input, state, event, adapter));
        } catch (error: unknown) {
            errors.push(performanceBaselineError(error, event));
        }
    }
    const [ first, ...rest ] = checks;
    return {
        errors,
        event: first === undefined ? event : {
            ...event,
            outcome: { failures: [ { checks: [ first, ...rest ], kind: 'assertion' } ], kind: 'fail' },
            verdict: 'fail'
        }
    };
}

function evaluateCase(
    input: PerformanceWorkflowInput,
    state: WorkflowState,
    event: BenchmarkCaseEnd
): PerformanceCaseEvaluation {
    if (event.completion !== 'final' || event.verdict !== 'pass') {
        return { errors: [], event };
    }
    const key = workIdentityKey(event.workId ?? createDefaultWorkId(event.case));
    const cached = state.evaluated.get(key);
    if (cached !== undefined) {
        return { errors: [], event: cached };
    }
    const evaluation = evaluateAdapters(input, state, event);
    state.remember(key, evaluation.event);
    return evaluation;
}

export async function createPerformanceWorkflow(input: PerformanceWorkflowInput): Promise<PerformanceWorkflow> {
    const store = await createPerformanceBaselineStore(input);
    const entries = await store.list();
    const state = createWorkflowState(
        new Map(
            entries
                .filter(function belongsToRun(entry) {
                    return entry.baseline.profile.normalize('NFC') === input.profile.normalize('NFC') &&
                        entry.baseline.expected.calibration.machineClass === input.calibration.machineClass;
                })
                .map(function baselineEntry(entry) {
                    return [ performanceBaselineKey(performanceBaselineIdentity(entry.baseline)), entry.baseline ];
                })
        )
    );

    return {
        changes: state.changes,
        store,
        evaluate(event) {
            return evaluateCase(input, state, event);
        },
        finish(result, completeInventory) {
            const evaluated = resultWithBaselineVerdicts(result, state);
            const errors = completeInventory && successfulPerformanceRun(evaluated)
                ? reconcileInventory(input, evaluated, state)
                : [];
            return { errors, result: evaluated };
        }
    };
}
