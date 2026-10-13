import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import { failedPerformanceBaselineCheck, type BenchmarkCaseEnd } from './performance-check.ts';
import type {
    ComparableCalibration,
    PerformanceBaselineAdapter,
    PerformanceBaselineValue,
    PerformanceComparison
} from './performance-adapter.ts';
import type { BaselineChange, BaselineUpdateMode, StoredPerformanceBaseline } from './performance-baseline.ts';
import type { PerformanceObservationEvidence } from './performance-presentation.ts';
import { proposePerformanceBaseline } from './performance-plan.ts';

export type PerformanceEvaluation = {
    readonly change: BaselineChange | null;
    readonly checks: readonly FailedCheck[];
    readonly participates: boolean;
    readonly observation: PerformanceObservationEvidence;
};

type PerformanceEvaluationInput = {
    readonly adapter: PerformanceBaselineAdapter;
    readonly calibration: ComparableCalibration;
    readonly event: BenchmarkCaseEnd;
    readonly existing: StoredPerformanceBaseline | null;
    readonly maxBytes: number;
    readonly mode: BaselineUpdateMode;
    readonly profile: string;
};

function comparisonChecks(
    input: PerformanceEvaluationInput,
    comparison: PerformanceComparison
): readonly FailedCheck[] {
    if (comparison.kind === 'match') {
        return [];
    }
    if (comparison.diagnostics.length === 0) {
        throw new Error('Performance comparison mismatch requires diagnostics.');
    }
    return comparison.diagnostics.map(function diagnosticCheck(diagnostic, index) {
        return failedPerformanceBaselineCheck({
            ...diagnostic,
            event: input.event,
            id: `performance-baseline:${input.adapter.id}:${index.toString()}`
        });
    });
}

type BaselineChecks = { readonly checks: readonly FailedCheck[]; readonly comparison: PerformanceComparison | null; };
function baselineChecks(input: PerformanceEvaluationInput, actual: PerformanceBaselineValue): BaselineChecks {
    const compare = input.mode === 'none' || input.mode === 'bootstrap' && input.existing !== null;
    if (!compare) {
        return { checks: [], comparison: null };
    }
    if (input.existing !== null) {
        const comparison = input.adapter.compare({ actual, expected: input.existing.expected });
        return { checks: comparisonChecks(input, comparison), comparison };
    }
    return {
        comparison: null,
        checks: [ failedPerformanceBaselineCheck({
            actual: actual.value,
            event: input.event,
            expected: null,
            id: `performance-baseline:${input.adapter.id}:missing`,
            summary: `Missing performance baseline for adapter "${input.adapter.id}".`
        }) ]
    };
}

function snapshotObservation(value: unknown, input: PerformanceEvaluationInput): PerformanceBaselineValue {
    const snapshot = snapshotJson(value, input.maxBytes);
    if (snapshot === null) {
        throw new Error('Performance observation exceeds the configured artifact byte limit.');
    }
    return { calibration: input.calibration, value: snapshot.value };
}

export function evaluatePerformanceBaseline(input: PerformanceEvaluationInput): PerformanceEvaluation {
    const work = input.event.workId ?? createDefaultWorkId(input.event.case);
    const observation = input.adapter.observe({
        artifacts: input.event.artifacts,
        calibration: input.calibration,
        work
    });
    if (observation.kind === 'not-applicable') {
        return { change: null, checks: [], participates: false, observation: { kind: 'not-applicable' } };
    }
    if (observation.kind === 'missing') {
        throw new Error(observation.reason);
    }
    const actual = snapshotObservation(observation.value, input);
    const change = proposePerformanceBaseline({ ...input, actual, work });
    const checked = baselineChecks(input, actual);
    return {
        change,
        checks: checked.checks,
        participates: true,
        observation: {
            kind: 'observed',
            actual,
            expected: input.existing?.expected ?? null,
            comparison: checked.comparison
        }
    };
}

export function performanceBaselineError(error: unknown, event: BenchmarkCaseEnd | null): RunnerError {
    return {
        attributedTo: event === null ? null : event.case,
        attributedToAttempt: event === null ? null : { index: event.attempt },
        attributedToWork: event === null ? null : event.workId ?? createDefaultWorkId(event.case),
        cause: error,
        diagnostics: [],
        message: error instanceof Error ? error.message : String(error),
        subtype: 'artifact'
    };
}
