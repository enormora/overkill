import { defineReporter, type DefinedReporter, type FinalResultReporter } from '../engine/reporter.ts';
import type { RunResult, RunSummary } from '../engine/run-result.ts';
import type {
    RunPreciseTimingReport,
    RunTimingSpan,
    RunTimingSummary
} from '../engine/run-timings.ts';

export type OpenTelemetryReporterDependencies = {
    readonly createSpanId: () => string;
    readonly createTraceId: () => string;
    readonly writeFile: (path: string, content: string) => Promise<void>;
};

export type OpenTelemetryReporterOptions = {
    readonly outputFile: string;
};

type AttributeValue = boolean | number | string;
type Attributes = Readonly<Record<string, AttributeValue>>;
type OtlpAnyValueTypes = readonly [
    { readonly boolValue: boolean; },
    { readonly doubleValue: number; },
    { readonly intValue: string; },
    { readonly stringValue: string; }
];
type OtlpAnyValue = OtlpAnyValueTypes[number];
type OtlpStatusTypes = readonly [Readonly<Record<string, never>>, { readonly code: number; }];
type OtlpStatus = OtlpStatusTypes[number];
type OtlpKeyValue = {
    readonly key: string;
    readonly value: OtlpAnyValue;
};
type OtlpSpan = {
    readonly attributes: readonly OtlpKeyValue[];
    readonly endTimeUnixNano: string;
    readonly flags: number;
    readonly kind: number;
    readonly name: string;
    readonly parentSpanId: string;
    readonly spanId: string;
    readonly startTimeUnixNano: string;
    readonly status: OtlpStatus;
    readonly traceId: string;
};

const preciseTimingRequiredMessage =
    'OpenTelemetry reporter requires precise run timings. Enable timings.collection as "precise" or use --timings.';
const nanosecondsPerMicrosecond = 1000n;
const internalSpanKind = 1;
const errorStatusCode = 2;
const sampledTraceFlags = 1;

function unixNanoseconds(unixMicroseconds: number): string {
    return (BigInt(unixMicroseconds) * nanosecondsPerMicrosecond).toString();
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
    const attributes: Record<string, AttributeValue> = {
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

function otlpAnyValue(value: AttributeValue): OtlpAnyValue {
    if (typeof value === 'boolean') {
        return { boolValue: value };
    }
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) ? { intValue: value.toString() } : { doubleValue: value };
    }

    return { stringValue: value };
}

function otlpAttributes(attributes: Attributes): readonly OtlpKeyValue[] {
    return Object.entries(attributes).map(function toOtlpAttribute([ key, value ]) {
        return { key, value: otlpAnyValue(value) };
    });
}

function spanStatus(failed: boolean): OtlpStatus {
    return failed ? { code: errorStatusCode } : {};
}

function childSpan(
    dependencies: OpenTelemetryReporterDependencies,
    traceId: string,
    parentSpanId: string,
    timingSpan: RunTimingSpan
): OtlpSpan {
    return {
        attributes: otlpAttributes(childSpanAttributes(timingSpan)),
        endTimeUnixNano: unixNanoseconds(
            timingSpan.startTimeUnixMicroseconds + timingSpan.durationMicroseconds
        ),
        flags: sampledTraceFlags,
        kind: internalSpanKind,
        name: `overkill.timing.${timingSpan.kind}`,
        parentSpanId,
        spanId: dependencies.createSpanId(),
        startTimeUnixNano: unixNanoseconds(timingSpan.startTimeUnixMicroseconds),
        status: spanStatus(timingSpan.status !== 'success'),
        traceId
    };
}

function traceData(dependencies: OpenTelemetryReporterDependencies, result: RunResult): unknown {
    const { precise } = result.timings;

    if (precise === null) {
        throw new Error(preciseTimingRequiredMessage);
    }

    const traceId = dependencies.createTraceId();
    const rootSpanId = dependencies.createSpanId();
    const startTime = precise.observationWindow.startTimeUnixMicroseconds;
    const rootSpan: OtlpSpan = {
        attributes: otlpAttributes({
            'overkill.run.plan_status': result.planStatus,
            'overkill.run.status': result.status,
            ...runSummaryAttributes(result.summary),
            ...timingSummaryAttributes(result.timings.summary),
            ...preciseTimingAttributes(precise)
        }),
        endTimeUnixNano: unixNanoseconds(startTime + precise.observationWindow.durationMicroseconds),
        flags: sampledTraceFlags,
        kind: internalSpanKind,
        name: 'overkill.run',
        parentSpanId: '',
        spanId: rootSpanId,
        startTimeUnixNano: unixNanoseconds(startTime),
        status: spanStatus(result.status === 'failed'),
        traceId
    };
    const spans = [
        rootSpan,
        ...precise.spans.map(function toChildSpan(timingSpan) {
            return childSpan(dependencies, traceId, rootSpanId, timingSpan);
        })
    ];

    return {
        resourceSpans: [ {
            resource: {
                attributes: otlpAttributes({ 'service.name': 'overkill' })
            },
            scopeSpans: [ {
                scope: { name: '@overkill-dev/reporter-opentelemetry' },
                spans
            } ]
        } ]
    };
}

export function createOpenTelemetryReporter(
    dependencies: OpenTelemetryReporterDependencies,
    options: OpenTelemetryReporterOptions
): DefinedReporter<FinalResultReporter> {
    return defineReporter(function createOpenTelemetryRuntimeReporter() {
        return {
            dispose: null,
            kind: 'final-result',
            name: 'opentelemetry',
            sinks: [ { kind: 'file', path: options.outputFile } ],
            async onResult(result) {
                const content = `${JSON.stringify(traceData(dependencies, result))}\n`;
                await dependencies.writeFile(options.outputFile, content);
            }
        };
    });
}
