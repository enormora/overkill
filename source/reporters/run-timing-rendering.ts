import type { RunResult } from '../engine/run-result.ts';
import type { RunTimingSpan } from '../engine/run-timings.ts';

const microsecondsPerMillisecond = 1000;
const slowTimingThresholdMicroseconds = 500_000;
const slowTimingLimit = 5;

function milliseconds(microseconds: number): number {
    return Math.round(microseconds / microsecondsPerMillisecond);
}

function readableKind(kind: RunTimingSpan['kind']): string {
    return kind.replaceAll(/[.-]/gu, ' ');
}

function timingSubject(span: RunTimingSpan): string {
    const subject = span.label ?? span.resource?.name;

    return subject === undefined ? '' : ` for ${subject}`;
}

function identifiedDetail(prefix: string, value: string | null): readonly string[] {
    return value === null ? [] : [ `${prefix} ${value}` ];
}

function resourceDetails(span: RunTimingSpan): readonly string[] {
    if (span.resource === null) {
        return [];
    }

    return [
        ...span.label === null ? [] : [ `resource ${span.resource.name}` ],
        span.resource.scope
    ];
}

function timingDetails(span: RunTimingSpan): readonly string[] {
    return [
        ...resourceDetails(span),
        ...identifiedDetail('process', span.processId),
        ...identifiedDetail('worker', span.workerId),
        ...span.status === 'success' ? [] : [ span.status ]
    ];
}

function formatTimingOffender(span: RunTimingSpan): string {
    const details = timingDetails(span);
    const detailText = details.length === 0 ? '' : ` (${details.join(', ')})`;

    return `  ${readableKind(span.kind)}${timingSubject(span)}${detailText}: ${
        milliseconds(
            span.durationMicroseconds
        )
    } ms`;
}

function slowTimingSpans(result: RunResult): readonly RunTimingSpan[] {
    return result
        .timings
        .precise
        ?.slowestSpans
        .filter(function aboveDisplayThreshold(span) {
            return span.durationMicroseconds > slowTimingThresholdMicroseconds;
        })
        .slice(0, slowTimingLimit) ?? [];
}

export function formatTimingOffenderLines(result: RunResult): readonly string[] {
    const spans = slowTimingSpans(result);

    return spans.length === 0
        ? []
        : [ 'Slow runner overhead:', ...spans.map(formatTimingOffender) ];
}

export function formatTimingSummary(result: RunResult): string {
    const { summary } = result.timings;

    return `total ${milliseconds(summary.totalWallTimeMicroseconds)} ms, ` +
        `execution ${milliseconds(summary.testExecutionWallTimeMicroseconds)} ms, ` +
        `overhead ${milliseconds(summary.runnerOverheadWallTimeMicroseconds)} ms`;
}
