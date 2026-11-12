import {
    defaultRunTimingSpanLimit,
    defaultRunTimingSlowestSpanLimit,
    type RunTimings,
    type RunTimingSpan,
    type RunTimingAggregate,
    type RunPreciseTimingReport
} from '../engine/run-timings.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { MergeSource } from './merge-results-input.ts';

type TimingSource = { readonly id: string; readonly report: RunPreciseTimingReport; };
function qualifiedSpan(span: RunTimingSpan, id: string): RunTimingSpan {
    return {
        ...span,
        label: `${id}: ${span.label ?? span.kind}`,
        startOffsetMicroseconds: null,
        processId: `${id}/${span.processId ?? 'coordinator'}`,
        workerId: span.workerId === null ? null : `${id}/${span.workerId}`
    };
}
function mergedSummary(sources: readonly MergeSource[]): RunTimings['summary'] {
    return sources.reduce(function sum(summary, source) {
        const timing = source.record.result.timings.summary;
        return {
            runnerOverheadWallTimeMicroseconds: summary.runnerOverheadWallTimeMicroseconds + timing
                .runnerOverheadWallTimeMicroseconds,
            testExecutionWallTimeMicroseconds: summary.testExecutionWallTimeMicroseconds +
                timing.testExecutionWallTimeMicroseconds,
            totalWallTimeMicroseconds: summary.totalWallTimeMicroseconds + timing.totalWallTimeMicroseconds
        };
    }, { runnerOverheadWallTimeMicroseconds: 0, testExecutionWallTimeMicroseconds: 0, totalWallTimeMicroseconds: 0 });
}
function mergedAggregates(sources: readonly TimingSource[]): readonly RunTimingAggregate[] {
    const aggregates = new Map<string, RunTimingAggregate>();
    for (const { report } of sources) {
        for (const aggregate of report.aggregates) {
            const previous = aggregates.get(aggregate.kind) ?? { count: 0, durationMicroseconds: 0 };
            aggregates.set(aggregate.kind, {
                ...aggregate,
                count: aggregate.count + previous.count,
                durationMicroseconds: aggregate.durationMicroseconds + previous.durationMicroseconds
            });
        }
    }
    return Array.from(aggregates.values());
}
function mergedOverhead(sources: readonly TimingSource[]): RunPreciseTimingReport['overhead'] {
    return sources.reduce(function sum(total, { report }) {
        return {
            aggregationMicroseconds: total.aggregationMicroseconds + report.overhead.aggregationMicroseconds,
            recordingMicroseconds: total.recordingMicroseconds + report.overhead.recordingMicroseconds,
            renderingMicroseconds: total.renderingMicroseconds + report.overhead.renderingMicroseconds,
            serializationMicroseconds: total.serializationMicroseconds + report.overhead.serializationMicroseconds
        };
    }, {
        aggregationMicroseconds: 0,
        recordingMicroseconds: 0,
        renderingMicroseconds: 0,
        serializationMicroseconds: 0
    });
}
function observationWindow(sources: readonly TimingSource[]): RunPreciseTimingReport['observationWindow'] {
    const start = Math.min(...sources.map(function startTime({ report }) {
        return report.observationWindow.startTimeUnixMicroseconds;
    }));
    const end = Math.max(...sources.map(function endTime({ report }) {
        return report.observationWindow.startTimeUnixMicroseconds + report.observationWindow.durationMicroseconds;
    }));
    return { startTimeUnixMicroseconds: start, durationMicroseconds: end - start };
}
function mergedPrecision(sources: readonly TimingSource[]): RunTimings['precise'] {
    if (sources.length === 0) {
        return null;
    }
    const spans = sources
        .flatMap(function retainedSpans({ id, report }) {
            return report.spans.map(function qualify(span) {
                return qualifiedSpan(span, id);
            });
        })
        .toSorted(function chronological(left, right) {
            return left.startTimeUnixMicroseconds - right.startTimeUnixMicroseconds;
        });
    const slowest = sources
        .flatMap(function slowestSpans({ id, report }) {
            return report.slowestSpans.map(function qualify(span) {
                return qualifiedSpan(span, id);
            });
        })
        .toSorted(function duration(left, right) {
            return right.durationMicroseconds - left.durationMicroseconds;
        });
    const extra = Math.max(0, spans.length - defaultRunTimingSpanLimit);
    return {
        aggregates: mergedAggregates(sources),
        overhead: mergedOverhead(sources),
        ambientNoise: 'unknown',
        observationWindow: observationWindow(sources),
        spans: spans.slice(0, defaultRunTimingSpanLimit),
        spanLimit: defaultRunTimingSpanLimit,
        slowestSpans: slowest.slice(0, defaultRunTimingSlowestSpanLimit),
        slowestSpanLimit: defaultRunTimingSlowestSpanLimit,
        droppedSpanCount: sources.reduce(function sum(total, { report }) {
            return total + report.droppedSpanCount;
        }, extra),
        truncated: extra > 0 || sources.some(function truncated({ report }) {
            return report.truncated;
        })
    };
}
export function mergedRunTimings(sources: NonEmptyReadonlyArray<MergeSource>): RunTimings {
    const precise = sources.flatMap(function preciseSource({ record }) {
        const report = record.result.timings.precise;
        return report === null ? [] : [ { id: record.id, report } ];
    });
    return { summary: mergedSummary(sources), precise: mergedPrecision(precise) };
}
