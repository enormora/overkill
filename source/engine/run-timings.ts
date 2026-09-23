export const resourceScopes = [
    'per-case',
    'per-file',
    'per-run',
    'per-suite',
    'shared-per-worker'
] as const;

export type ResourceScope = typeof resourceScopes[number];

export type AmbientNoiseEstimate = 'high' | 'low' | 'medium' | 'unknown';

export type TimingSpanStatus = 'cancelled' | 'failure' | 'success' | 'timeout';

export const runTimingSpanKinds = [
    'cleanup',
    'collection.import',
    'collection.resolve',
    'command.parse',
    'config.load',
    'config.validate',
    'file.discovery',
    'filter.apply',
    'host.entry-startup',
    'order.apply',
    'placement.plan',
    'profile.resolve',
    'reporter.deliver',
    'reporter.finish',
    'reporter.resolve',
    'resolution.freeze',
    'resource.acquire',
    'resource.dispose',
    'resource.lower',
    'runtime.expand',
    'shard.apply',
    'supervised-process.exit',
    'supervised-process.ready',
    'supervised-process.spawn',
    'supervised-process.teardown',
    'test-data.propagate',
    'work-unit.construct',
    'worker-pool.ready',
    'worker-pool.shutdown',
    'worker-pool.start',
    'worker.assign-work',
    'worker.create',
    'worker.import-startup',
    'worker.ready',
    'worker.teardown'
] as const;

export type RunTimingSpanKind = typeof runTimingSpanKinds[number];

export type RunTimingSummary = {
    readonly runnerOverheadWallTimeMicroseconds: number;
    readonly testExecutionWallTimeMicroseconds: number;
    readonly totalWallTimeMicroseconds: number;
};

export type RunTimingSpan = {
    readonly durationMicroseconds: number;
    readonly kind: RunTimingSpanKind;
    readonly label: string | null;
    readonly processId: string | null;
    readonly resource: {
        readonly name: string;
        readonly scope: ResourceScope;
    } | null;
    readonly startOffsetMicroseconds: number | null;
    readonly status: TimingSpanStatus;
    readonly workerId: string | null;
};

export type RunTimingAggregate = {
    readonly count: number;
    readonly durationMicroseconds: number;
    readonly kind: RunTimingSpanKind;
};

export type TimingCollectionOverhead = {
    readonly aggregationMicroseconds: number;
    readonly recordingMicroseconds: number;
    readonly renderingMicroseconds: number;
    readonly serializationMicroseconds: number;
};

export type RunPreciseTimingReport = {
    readonly aggregates: readonly RunTimingAggregate[];
    readonly ambientNoise: AmbientNoiseEstimate;
    readonly droppedSpanCount: number;
    readonly overhead: TimingCollectionOverhead;
    readonly slowestSpans: readonly RunTimingSpan[];
    readonly slowestSpanLimit: number;
    readonly spanLimit: number;
    readonly spans: readonly RunTimingSpan[];
    readonly truncated: boolean;
};

export type RunTimings = {
    readonly precise: RunPreciseTimingReport | null;
    readonly summary: RunTimingSummary;
};

export type RunTimingSummaryInput = {
    readonly testExecutionWallTimeMicroseconds: number;
    readonly totalWallTimeMicroseconds: number;
};

export type PreciseTimingReportInput = {
    readonly aggregationMicroseconds: number;
    readonly recordingMicroseconds: number;
    readonly slowestSpanLimit: number;
    readonly spanLimit: number;
    readonly spans: readonly RunTimingSpan[];
};

export const defaultRunTimingSpanLimit = 5000;
export const defaultRunTimingSlowestSpanLimit = 50;

export const zeroTimingCollectionOverhead: TimingCollectionOverhead = Object.freeze({
    aggregationMicroseconds: 0,
    recordingMicroseconds: 0,
    renderingMicroseconds: 0,
    serializationMicroseconds: 0
});

export function runTimingSummary(input: RunTimingSummaryInput): RunTimingSummary {
    const totalWallTimeMicroseconds = Math.max(0, Math.trunc(input.totalWallTimeMicroseconds));
    const testExecutionWallTimeMicroseconds = Math.max(
        0,
        Math.min(totalWallTimeMicroseconds, Math.trunc(input.testExecutionWallTimeMicroseconds))
    );

    return {
        runnerOverheadWallTimeMicroseconds: totalWallTimeMicroseconds - testExecutionWallTimeMicroseconds,
        testExecutionWallTimeMicroseconds,
        totalWallTimeMicroseconds
    };
}

export function summaryRunTimings(input: RunTimingSummaryInput): RunTimings {
    return {
        precise: null,
        summary: runTimingSummary(input)
    };
}

function aggregateKey(span: RunTimingSpan): RunTimingSpanKind {
    return span.kind;
}

function timingAggregates(spans: readonly RunTimingSpan[]): readonly RunTimingAggregate[] {
    const aggregates = new Map<RunTimingSpanKind, RunTimingAggregate>();

    for (const span of spans) {
        const key = aggregateKey(span);
        const aggregate = aggregates.get(key);
        aggregates.set(key, {
            count: (aggregate?.count ?? 0) + 1,
            durationMicroseconds: (aggregate?.durationMicroseconds ?? 0) + span.durationMicroseconds,
            kind: key
        });
    }

    return Array.from(aggregates.values());
}

function slowestTimingSpans(
    spans: readonly RunTimingSpan[],
    slowestSpanLimit: number
): readonly RunTimingSpan[] {
    return spans
        .toSorted(function byDurationThenStart(left, right) {
            const durationDifference = right.durationMicroseconds - left.durationMicroseconds;

            if (durationDifference !== 0) {
                return durationDifference;
            }

            return (left.startOffsetMicroseconds ?? Number.MAX_SAFE_INTEGER) -
                (right.startOffsetMicroseconds ?? Number.MAX_SAFE_INTEGER);
        })
        .slice(0, slowestSpanLimit);
}

export function preciseTimingReport(input: PreciseTimingReportInput): RunPreciseTimingReport {
    const { slowestSpanLimit, spanLimit } = input;
    const retainedSpans = input.spans.slice(0, spanLimit);

    return {
        aggregates: timingAggregates(input.spans),
        ambientNoise: 'unknown',
        droppedSpanCount: Math.max(0, input.spans.length - retainedSpans.length),
        overhead: {
            aggregationMicroseconds: input.aggregationMicroseconds,
            recordingMicroseconds: input.recordingMicroseconds,
            renderingMicroseconds: 0,
            serializationMicroseconds: 0
        },
        slowestSpans: slowestTimingSpans(input.spans, slowestSpanLimit),
        slowestSpanLimit,
        spanLimit,
        spans: retainedSpans,
        truncated: retainedSpans.length < input.spans.length
    };
}
