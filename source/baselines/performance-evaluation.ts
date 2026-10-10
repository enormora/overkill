import { resolveSourceLocation } from '../assertion-protocol/source-location.ts';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { compareDeepValues } from '../compare/comparison.ts';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import { createDefaultWorkId } from '../engine/identity.ts';
import type { RunnerError } from '../engine/run-result.ts';
import type {
    ComparableCalibration,
    PerformanceBaselineAdapter,
    PerformanceBaselineValue
} from './performance-adapter.ts';
import type { BaselineChange, BaselineUpdateMode, StoredPerformanceBaseline } from './performance-baseline.ts';
import { proposePerformanceBaseline } from './performance-plan.ts';

export type BenchmarkCaseEnd = Extract<ReporterEvent, { readonly kind: 'test-end'; }>;
export type PerformanceEvaluation = {
    readonly change: BaselineChange | null;
    readonly checks: readonly FailedCheck[];
    readonly participates: boolean;
};

type BaselineFailureInput = {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly event: BenchmarkCaseEnd;
    readonly id: string;
    readonly summary: string;
};

function failedBaselineCheck(input: BaselineFailureInput): FailedCheck {
    const [ first, ...rest ] = input.event.definitionLocations;
    const comparison = compareDeepValues(input.actual, input.expected);
    return {
        actual: comparison.actual,
        diff: comparison.diff,
        expected: comparison.expected,
        id: input.id,
        kind: 'leaf',
        path: comparison.path,
        source: 'assert',
        sourceLocations: [ resolveSourceLocation(first), ...rest.map(resolveSourceLocation) ],
        summary: input.summary
    };
}

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
    actual: PerformanceBaselineValue,
    existing: StoredPerformanceBaseline
): readonly FailedCheck[] {
    const comparison = input.adapter.compare({ actual, expected: existing.expected });
    if (comparison.kind === 'match') {
        return [];
    }
    if (comparison.diagnostics.length === 0) {
        throw new Error('Performance comparison mismatch requires diagnostics.');
    }
    return comparison.diagnostics.map(function diagnosticCheck(diagnostic, index) {
        return failedBaselineCheck({
            ...diagnostic,
            event: input.event,
            id: `performance-baseline:${input.adapter.id}:${index.toString()}`
        });
    });
}

function baselineChecks(input: PerformanceEvaluationInput, actual: PerformanceBaselineValue): readonly FailedCheck[] {
    const compare = input.mode === 'none' || input.mode === 'bootstrap' && input.existing !== null;
    if (!compare) {
        return [];
    }
    if (input.existing !== null) {
        return comparisonChecks(input, actual, input.existing);
    }
    return [ failedBaselineCheck({
        actual: actual.value,
        event: input.event,
        expected: null,
        id: `performance-baseline:${input.adapter.id}:missing`,
        summary: `Missing performance baseline for adapter "${input.adapter.id}".`
    }) ];
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
        return { change: null, checks: [], participates: false };
    }
    if (observation.kind === 'missing') {
        throw new Error(observation.reason);
    }
    const actual = snapshotObservation(observation.value, input);
    const change = proposePerformanceBaseline({ ...input, actual, work });
    return { change, checks: baselineChecks(input, actual), participates: true };
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
