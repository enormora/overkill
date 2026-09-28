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
import { createOverkillClock, type OverkillClock } from '../clock/overkill-clock.ts';

type TimingCollectionMode = 'precise' | 'summary';
type TimingResolvedRun = {
    readonly facts: {
        readonly execution: {
            readonly timingCollection: TimingCollectionMode;
        };
    };
};

export type RunTimingSpanMetadata = Pick<RunTimingSpan, 'label' | 'processId' | 'resource' | 'workerId'>;

export type RunTimingSpanObservation = {
    readonly completedAtMicroseconds: number;
    readonly kind: RunTimingSpanKind;
    readonly metadata: RunTimingSpanMetadata;
    readonly startedAtMicroseconds: number;
    readonly status: TimingSpanStatus;
};

export type RunTimingInstantObservationInput = {
    readonly kind: RunTimingSpanKind;
    readonly metadata: RunTimingSpanMetadata;
    readonly observedAtMicroseconds: number;
    readonly status: TimingSpanStatus;
};

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
    readonly record: (observation: RunTimingSpanObservation) => void;
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

    record();

    return spanDuration(startedAtMicroseconds, clock.currentMonotonicMicroseconds);
}

function timingSpan(
    originMicroseconds: number,
    observation: RunTimingSpanObservation
): RunTimingSpan {
    return {
        durationMicroseconds: spanDuration(observation.startedAtMicroseconds, observation.completedAtMicroseconds),
        kind: observation.kind,
        label: observation.metadata.label,
        processId: observation.metadata.processId,
        resource: observation.metadata.resource,
        startOffsetMicroseconds: nonNegativeMicroseconds(observation.startedAtMicroseconds - originMicroseconds),
        status: observation.status,
        workerId: observation.metadata.workerId
    };
}

export function instantTimingSpanObservation(input: RunTimingInstantObservationInput): RunTimingSpanObservation {
    return {
        completedAtMicroseconds: input.observedAtMicroseconds,
        kind: input.kind,
        metadata: input.metadata,
        startedAtMicroseconds: input.observedAtMicroseconds,
        status: input.status
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

    function record(observation: RunTimingSpanObservation): void {
        addSpan(timingSpan(originMicroseconds, observation));
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
            record({
                completedAtMicroseconds: clock.currentMonotonicMicroseconds,
                kind,
                metadata,
                startedAtMicroseconds,
                status: 'success'
            });

            return value;
        } catch (error: unknown) {
            record({
                completedAtMicroseconds: clock.currentMonotonicMicroseconds,
                kind,
                metadata,
                startedAtMicroseconds,
                status: 'failure'
            });
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
            record({
                completedAtMicroseconds: clock.currentMonotonicMicroseconds,
                kind,
                metadata,
                startedAtMicroseconds,
                status: 'success'
            });

            return value;
        } catch (error: unknown) {
            record({
                completedAtMicroseconds: clock.currentMonotonicMicroseconds,
                kind,
                metadata,
                startedAtMicroseconds,
                status: 'failure'
            });
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

export function createSystemRunTimingMeasurement(): RunTimingMeasurement {
    return createRunTimingMeasurement(createOverkillClock());
}

function preciseReportFromMeasurement(
    timing: RunTimingMeasurement | null
): NonNullable<RunResult['timings']['precise']> {
    return timing?.report() ?? preciseTimingReport({
        aggregationMicroseconds: 0,
        recordingMicroseconds: 0,
        slowestSpanLimit: defaultRunTimingSlowestSpanLimit,
        spanLimit: defaultRunTimingSpanLimit,
        spans: []
    });
}

function observedWallTimeMicroseconds(precise: NonNullable<RunResult['timings']['precise']>): number {
    return precise.spans.reduce(function latestCompletedAt(latest, span) {
        return Math.max(latest, (span.startOffsetMicroseconds ?? 0) + span.durationMicroseconds);
    }, 0);
}

function summaryWithObservedWallTime(
    result: RunResult,
    precise: NonNullable<RunResult['timings']['precise']>
): RunResult['timings']['summary'] {
    const observedWallTime = observedWallTimeMicroseconds(precise);

    return result.timings.summary.totalWallTimeMicroseconds > 0 || observedWallTime === 0
        ? result.timings.summary
        : runTimingSummary({
            testExecutionWallTimeMicroseconds: result.timings.summary.testExecutionWallTimeMicroseconds,
            totalWallTimeMicroseconds: observedWallTime
        });
}

export function resultWithTimingCollection(
    timingCollection: TimingCollectionMode,
    result: RunResult,
    timing: RunTimingMeasurement | null = null
): RunResult {
    if (timingCollection !== 'precise') {
        return result;
    }

    if (result.timings.precise !== null) {
        return result;
    }

    const precise = preciseReportFromMeasurement(timing);

    return {
        ...result,
        timings: {
            ...result.timings,
            precise,
            summary: summaryWithObservedWallTime(result, precise)
        }
    };
}

export function resultWithResolvedTimingCollection(
    resolvedRun: TimingResolvedRun,
    result: RunResult,
    timing: RunTimingMeasurement | null = null
): RunResult {
    return resultWithTimingCollection(resolvedRun.facts.execution.timingCollection, result, timing);
}
