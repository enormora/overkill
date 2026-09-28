import type { RunResult } from '../engine/run-result.ts';
import {
    defaultRunTimingSlowestSpanLimit,
    defaultRunTimingSpanLimit,
    preciseTimingReport,
    runTimingSummary,
    type RunTimingSpan,
    type RunTimingSpanKind,
    type TimingSpanStatus
} from '../engine/run-timings.ts';
import type { OverkillClock } from '../clock/overkill-clock.ts';
import type { ResolvedRun, TimingCollectionMode } from './run-types.ts';

export type RunTimingSpanMetadata = Pick<RunTimingSpan, 'label' | 'processId' | 'resource' | 'workerId'>;

export type RunTimingMeasurement = {
    readonly measure: <Value>(
        kind: RunTimingSpanKind,
        metadata: RunTimingSpanMetadata,
        work: () => Value
    ) => Value;
    readonly measureAsync: <Value>(
        kind: RunTimingSpanKind,
        metadata: RunTimingSpanMetadata,
        work: () => Promise<Value>
    ) => Promise<Value>;
    readonly record: (
        kind: RunTimingSpanKind,
        status: TimingSpanStatus,
        startedAtMicroseconds: number,
        completedAtMicroseconds: number,
        metadata: RunTimingSpanMetadata
    ) => void;
    readonly recordLocal: (span: RunTimingSpan) => void;
    readonly report: () => NonNullable<RunResult['timings']['precise']>;
};

export type RunInvocationTimingOptions = {
    readonly timing: RunTimingMeasurement | null;
};

const emptyRunTimingSpanMetadata: RunTimingSpanMetadata = Object.freeze({
    label: null,
    processId: null,
    resource: null,
    workerId: null
});

export function emptyTimingSpanMetadata(): RunTimingSpanMetadata {
    return emptyRunTimingSpanMetadata;
}

function nonNegativeMicroseconds(value: number): number {
    return Math.max(0, Math.trunc(value));
}

function spanDuration(startedAtMicroseconds: number, completedAtMicroseconds: number): number {
    return nonNegativeMicroseconds(completedAtMicroseconds - startedAtMicroseconds);
}

function recordingOverhead(
    clock: OverkillClock,
    record: () => void
): number {
    const startedAtMicroseconds = clock.currentMonotonicMicroseconds;

    try {
        record();
    } finally {
        return spanDuration(startedAtMicroseconds, clock.currentMonotonicMicroseconds);
    }
}

function timingSpan(
    originMicroseconds: number,
    kind: RunTimingSpanKind,
    status: TimingSpanStatus,
    startedAtMicroseconds: number,
    completedAtMicroseconds: number,
    metadata: RunTimingSpanMetadata
): RunTimingSpan {
    return {
        durationMicroseconds: spanDuration(startedAtMicroseconds, completedAtMicroseconds),
        kind,
        label: metadata.label,
        processId: metadata.processId,
        resource: metadata.resource,
        startOffsetMicroseconds: nonNegativeMicroseconds(startedAtMicroseconds - originMicroseconds),
        status,
        workerId: metadata.workerId
    };
}

function localTimingSpan(span: RunTimingSpan): RunTimingSpan {
    return {
        durationMicroseconds: nonNegativeMicroseconds(span.durationMicroseconds),
        kind: span.kind,
        label: span.label,
        processId: span.processId,
        resource: span.resource,
        startOffsetMicroseconds: null,
        status: span.status,
        workerId: span.workerId
    };
}

export function createRunTimingMeasurement(clock: OverkillClock): RunTimingMeasurement {
    const originMicroseconds = clock.currentMonotonicMicroseconds;
    const spans: RunTimingSpan[] = [];
    let recordingMicroseconds = 0;

    function addSpan(span: RunTimingSpan): void {
        recordingMicroseconds += recordingOverhead(clock, function pushSpan() {
            spans.push(span);
        });
    }

    function record(
        kind: RunTimingSpanKind,
        status: TimingSpanStatus,
        startedAtMicroseconds: number,
        completedAtMicroseconds: number,
        metadata: RunTimingSpanMetadata
    ): void {
        addSpan(timingSpan(originMicroseconds, kind, status, startedAtMicroseconds, completedAtMicroseconds, metadata));
    }

    function recordLocal(span: RunTimingSpan): void {
        addSpan(localTimingSpan(span));
    }

    function measure<Value>(
        kind: RunTimingSpanKind,
        metadata: RunTimingSpanMetadata,
        work: () => Value
    ): Value {
        const startedAtMicroseconds = clock.currentMonotonicMicroseconds;

        try {
            const value = work();
            record(kind, 'success', startedAtMicroseconds, clock.currentMonotonicMicroseconds, metadata);

            return value;
        } catch (error: unknown) {
            record(kind, 'failure', startedAtMicroseconds, clock.currentMonotonicMicroseconds, metadata);
            throw error;
        }
    }

    async function measureAsync<Value>(
        kind: RunTimingSpanKind,
        metadata: RunTimingSpanMetadata,
        work: () => Promise<Value>
    ): Promise<Value> {
        const startedAtMicroseconds = clock.currentMonotonicMicroseconds;

        try {
            const value = await work();
            record(kind, 'success', startedAtMicroseconds, clock.currentMonotonicMicroseconds, metadata);

            return value;
        } catch (error: unknown) {
            record(kind, 'failure', startedAtMicroseconds, clock.currentMonotonicMicroseconds, metadata);
            throw error;
        }
    }

    function report(): NonNullable<RunResult['timings']['precise']> {
        const aggregationStartedAtMicroseconds = clock.currentMonotonicMicroseconds;
        const reportValue = preciseTimingReport({
            aggregationMicroseconds: 0,
            recordingMicroseconds,
            slowestSpanLimit: defaultRunTimingSlowestSpanLimit,
            spanLimit: defaultRunTimingSpanLimit,
            spans
        });
        const aggregationMicroseconds = spanDuration(
            aggregationStartedAtMicroseconds,
            clock.currentMonotonicMicroseconds
        );

        return {
            ...reportValue,
            overhead: {
                ...reportValue.overhead,
                aggregationMicroseconds
            }
        };
    }

    return {
        measure,
        measureAsync,
        record,
        recordLocal,
        report
    };
}

export function resultWithTimingCollection(
    timingCollection: TimingCollectionMode,
    result: RunResult,
    timing: RunTimingMeasurement | null = null
): RunResult {
    if (timingCollection !== 'precise' || result.timings.precise !== null) {
        return result;
    }

    const precise = timing?.report() ?? preciseTimingReport({
        aggregationMicroseconds: 0,
        recordingMicroseconds: 0,
        slowestSpanLimit: defaultRunTimingSlowestSpanLimit,
        spanLimit: defaultRunTimingSpanLimit,
        spans: []
    });
    const observedWallTimeMicroseconds = precise.spans.reduce(function latestCompletedAt(latest, span) {
        return Math.max(latest, (span.startOffsetMicroseconds ?? 0) + span.durationMicroseconds);
    }, 0);
    const summary = result.timings.summary.totalWallTimeMicroseconds > 0 || observedWallTimeMicroseconds === 0
        ? result.timings.summary
        : runTimingSummary({
            testExecutionWallTimeMicroseconds: result.timings.summary.testExecutionWallTimeMicroseconds,
            totalWallTimeMicroseconds: observedWallTimeMicroseconds
        });

    return {
        ...result,
        timings: {
            ...result.timings,
            precise,
            summary
        }
    };
}

export function resultWithResolvedTimingCollection(
    resolvedRun: ResolvedRun,
    result: RunResult,
    timing: RunTimingMeasurement | null = null
): RunResult {
    return resultWithTimingCollection(resolvedRun.facts.execution.timingCollection, result, timing);
}
