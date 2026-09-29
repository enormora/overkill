import {
    ROOT_CONTEXT,
    SpanKind,
    SpanStatusCode,
    trace,
    type Attributes,
    type HrTime,
    type Span,
    type Tracer
} from '@opentelemetry/api';
import { defineReporter, type DefinedReporter, type FinalResultReporter } from '../engine/reporter.ts';
import type { RunResult, RunSummary } from '../engine/run-result.ts';
import type {
    RunPreciseTimingReport,
    RunTimingSpan,
    RunTimingSummary
} from '../engine/run-timings.ts';

export type OpenTelemetryReporterDependencies = {
    readonly tracer: Pick<Tracer, 'startSpan'>;
};

const preciseTimingRequiredMessage =
    'OpenTelemetry reporter requires precise run timings. Enable timings.collection as "precise" or use --timings.';
const microsecondsPerSecond = 1_000_000;
const nanosecondsPerMicrosecond = 1000;

function hrTime(unixMicroseconds: number): HrTime {
    const seconds = Math.floor(unixMicroseconds / microsecondsPerSecond);
    const microseconds = unixMicroseconds - seconds * microsecondsPerSecond;

    return [ seconds, microseconds * nanosecondsPerMicrosecond ];
}

function runSummaryAttributes(summary: RunSummary): Attributes {
    return {
        'overkill.run.summary.crashed': summary.crashed,
        'overkill.run.summary.defined': summary.defined,
        'overkill.run.summary.discovered': summary.discovered,
        'overkill.run.summary.failed': summary.failed,
        'overkill.run.summary.inconclusive': summary.inconclusive,
        'overkill.run.summary.passed': summary.passed,
        'overkill.run.summary.planned': summary.planned,
        'overkill.run.summary.resource_exhausted': summary.resourceExhausted,
        'overkill.run.summary.runtime_policy': summary.runtimePolicy,
        'overkill.run.summary.skipped': summary.skipped
    };
}

function timingSummaryAttributes(summary: RunTimingSummary): Attributes {
    return {
        'overkill.timing.summary.runner_overhead_wall_time_us': summary.runnerOverheadWallTimeMicroseconds,
        'overkill.timing.summary.test_execution_wall_time_us': summary.testExecutionWallTimeMicroseconds,
        'overkill.timing.summary.total_wall_time_us': summary.totalWallTimeMicroseconds
    };
}

function preciseTimingAttributes(precise: RunPreciseTimingReport): Attributes {
    const attributes: Attributes = {
        'overkill.timing.ambient_noise': precise.ambientNoise,
        'overkill.timing.dropped_span_count': precise.droppedSpanCount,
        'overkill.timing.overhead.aggregation_us': precise.overhead.aggregationMicroseconds,
        'overkill.timing.overhead.recording_us': precise.overhead.recordingMicroseconds,
        'overkill.timing.overhead.rendering_us': precise.overhead.renderingMicroseconds,
        'overkill.timing.overhead.serialization_us': precise.overhead.serializationMicroseconds,
        'overkill.timing.precise': true,
        'overkill.timing.slowest_span_limit': precise.slowestSpanLimit,
        'overkill.timing.span_limit': precise.spanLimit,
        'overkill.timing.truncated': precise.truncated
    };

    for (const aggregate of precise.aggregates) {
        const prefix = `overkill.timing.aggregate.${aggregate.kind}`;
        attributes[`${prefix}.count`] = aggregate.count;
        attributes[`${prefix}.duration_us`] = aggregate.durationMicroseconds;
    }

    return attributes;
}

function optionalAttribute(key: string, value: string | null): Attributes {
    return value === null ? {} : { [key]: value };
}

function childSpanAttributes(span: RunTimingSpan): Attributes {
    return {
        'overkill.timing.kind': span.kind,
        'overkill.timing.status': span.status,
        ...optionalAttribute('overkill.timing.label', span.label),
        ...optionalAttribute('overkill.process.id', span.processId),
        ...optionalAttribute('overkill.worker.id', span.workerId),
        ...optionalAttribute('overkill.resource.name', span.resource?.name ?? null),
        ...optionalAttribute('overkill.resource.scope', span.resource?.scope ?? null)
    };
}

function markFailedSpan(span: Span): void {
    span.setStatus({ code: SpanStatusCode.ERROR });
}

function exportTimingSpan(tracer: Pick<Tracer, 'startSpan'>, rootSpan: Span, timingSpan: RunTimingSpan): void {
    const span = tracer.startSpan(
        `overkill.timing.${timingSpan.kind}`,
        {
            attributes: childSpanAttributes(timingSpan),
            kind: SpanKind.INTERNAL,
            startTime: hrTime(timingSpan.startTimeUnixMicroseconds)
        },
        trace.setSpan(ROOT_CONTEXT, rootSpan)
    );

    if (timingSpan.status !== 'success') {
        markFailedSpan(span);
    }

    span.end(hrTime(timingSpan.startTimeUnixMicroseconds + timingSpan.durationMicroseconds));
}

function exportRunResult(tracer: Pick<Tracer, 'startSpan'>, result: RunResult): void {
    const { precise } = result.timings;

    if (precise === null) {
        throw new Error(preciseTimingRequiredMessage);
    }

    const startTime = precise.observationWindow.startTimeUnixMicroseconds;
    const rootSpan = tracer.startSpan('overkill.run', {
        attributes: {
            'overkill.run.plan_status': result.planStatus,
            'overkill.run.status': result.status,
            ...runSummaryAttributes(result.summary),
            ...timingSummaryAttributes(result.timings.summary),
            ...preciseTimingAttributes(precise)
        },
        kind: SpanKind.INTERNAL,
        root: true,
        startTime: hrTime(startTime)
    });

    if (result.status === 'failed') {
        markFailedSpan(rootSpan);
    }

    for (const span of precise.spans) {
        exportTimingSpan(tracer, rootSpan, span);
    }

    rootSpan.end(hrTime(startTime + precise.observationWindow.durationMicroseconds));
}

export function createOpenTelemetryReporter(
    dependencies: OpenTelemetryReporterDependencies
): DefinedReporter<FinalResultReporter> {
    return defineReporter(function createOpenTelemetryRuntimeReporter() {
        return {
            dispose: null,
            kind: 'final-result',
            name: 'opentelemetry',
            sinks: [],
            onResult(result) {
                exportRunResult(dependencies.tracer, result);
            }
        };
    });
}
