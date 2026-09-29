import {
    ROOT_CONTEXT,
    SpanStatusCode,
    trace,
    type Attributes,
    type Context,
    type Span,
    type SpanContext,
    type SpanOptions,
    type SpanStatus,
    type TimeInput,
    type Tracer
} from '@opentelemetry/api';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import type { RunResult } from '../engine/run-result.ts';
import { preciseTimingReport } from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createOpenTelemetryReporter } from './opentelemetry-reporter.ts';

type RecordedSpan = {
    readonly attributes: Readonly<Attributes>;
    readonly endTime: () => TimeInput | null;
    readonly name: string;
    readonly options: Readonly<SpanOptions>;
    readonly parentPresent: boolean;
    readonly status: () => SpanStatus | null;
};

type RecordingTracer = {
    readonly records: readonly RecordedSpan[];
    readonly tracer: Pick<Tracer, 'startSpan'>;
};

type RecordingSpanInput = {
    readonly context: Context;
    readonly name: string;
    readonly options: Readonly<SpanOptions>;
};

function staticSpanContext(): SpanContext {
    return {
        spanId: '0000000000000001',
        traceFlags: 1,
        traceId: '00000000000000000000000000000001'
    };
}

function recordingSpan(recordSpan: (record: RecordedSpan) => void, input: RecordingSpanInput): Span {
    let endTime: TimeInput | null = null;
    let status: SpanStatus | null = null;
    const span: Span = {
        addEvent() {
            return span;
        },
        addLink() {
            return span;
        },
        addLinks() {
            return span;
        },
        end(value: TimeInput = 0) {
            endTime = value;
        },
        isRecording() {
            return endTime === null;
        },
        recordException() {
            return undefined;
        },
        setAttribute() {
            return span;
        },
        setAttributes() {
            return span;
        },
        setStatus(value) {
            status = value;
            return span;
        },
        spanContext: staticSpanContext,
        updateName() {
            return span;
        }
    };
    recordSpan({
        attributes: { ...input.options.attributes },
        endTime: function readEndTime() {
            return endTime;
        },
        name: input.name,
        options: input.options,
        parentPresent: trace.getSpan(input.context) !== undefined,
        status: function readStatus() {
            return status;
        }
    });
    return span;
}

function createRecordingTracer(): RecordingTracer {
    const records: RecordedSpan[] = [];

    return {
        records,
        tracer: {
            startSpan(name: string, options: SpanOptions = {}, context: Context = ROOT_CONTEXT): Span {
                return recordingSpan(function recordSpan(record) {
                    records.push(record);
                }, { context, name, options });
            }
        }
    };
}

function preciseResult(): RunResult {
    return runResultFactory.build({
        status: 'failed',
        summary: { failed: 1 },
        timings: {
            precise: preciseTimingReport({
                aggregationMicroseconds: 7,
                observationWindow: {
                    durationMicroseconds: 50,
                    startTimeUnixMicroseconds: 1_700_000_000_000_000
                },
                recordingMicroseconds: 5,
                slowestSpanLimit: 50,
                spanLimit: 5000,
                spans: [ {
                    durationMicroseconds: 20,
                    kind: 'resource.acquire',
                    label: 'setup',
                    processId: '42',
                    resource: { name: 'database', scope: 'per-run' },
                    startOffsetMicroseconds: null,
                    startTimeUnixMicroseconds: 1_700_000_000_000_010,
                    status: 'timeout',
                    workerId: 'lane-1'
                } ]
            }),
            summary: {
                runnerOverheadWallTimeMicroseconds: 30,
                testExecutionWallTimeMicroseconds: 20,
                totalWallTimeMicroseconds: 50
            }
        }
    });
}

function requiredSpan(records: readonly RecordedSpan[], index: number): RecordedSpan {
    const record = records[index];

    if (record === undefined) {
        throw new Error(`Expected recorded span at index ${index}.`);
    }

    return record;
}

function assertRootSpan(scope: OverkillScope, record: RecordedSpan): void {
    scope.assert.equal(record.name, 'overkill.run');
    scope.assert.equal(JSON.stringify(record.options.startTime), '[1700000000,0]');
    scope.assert.equal(JSON.stringify(record.endTime()), '[1700000000,50000]');
    scope.assert.equal(record.status()?.code, SpanStatusCode.ERROR);
    scope.assert.equal(record.attributes['overkill.run.summary.failed'], 1);
    scope.assert.equal(record.attributes['overkill.timing.aggregate.resource.acquire.count'], 1);
}

function assertChildSpan(scope: OverkillScope, record: RecordedSpan): void {
    scope.assert.equal(record.name, 'overkill.timing.resource.acquire');
    scope.assert.equal(JSON.stringify(record.options.startTime), '[1700000000,10000]');
    scope.assert.equal(JSON.stringify(record.endTime()), '[1700000000,30000]');
    scope.assert.equal(record.parentPresent, true);
    scope.assert.equal(record.status()?.code, SpanStatusCode.ERROR);
    scope.assert.equal(record.attributes['overkill.resource.name'], 'database');
}

const reportingContext = createReportingContext({ projectRoot: null });

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/opentelemetry-reporter.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'exports a run span and retained timing spans with absolute timestamps',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const recording = createRecordingTracer();
                const reporter = createOpenTelemetryReporter({ tracer: recording.tracer });

                const result = reporter(reportingContext).onResult(preciseResult());
                scope.assert.equal(result, undefined);
                scope.assert.equal(recording.records.length, 2);
                assertRootSpan(scope, requiredSpan(recording.records, 0));
                assertChildSpan(scope, requiredSpan(recording.records, 1));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'rejects results without precise timings',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const recording = createRecordingTracer();
                const reporter = createOpenTelemetryReporter({ tracer: recording.tracer });

                scope.assert.throws(function exportSummaryTimings(): Promise<void> | void {
                    return reporter(reportingContext).onResult(runResultFactory.build());
                }, {
                    message:
                        'OpenTelemetry reporter requires precise run timings. Enable timings.collection as "precise" or use --timings.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
