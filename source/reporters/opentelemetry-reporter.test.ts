import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import type { RunResult } from '../engine/run-result.ts';
import { preciseTimingReport } from '../engine/run-timings.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createOpenTelemetryReporter,
    type OpenTelemetryReporterDependencies
} from './opentelemetry-reporter.ts';

type FileWrite = {
    readonly content: string;
    readonly path: string;
};

type RecordingDependencies = {
    readonly dependencies: OpenTelemetryReporterDependencies;
    readonly writes: readonly FileWrite[];
};

function createRecordingDependencies(): RecordingDependencies {
    const spanIds = [ '0000000000000001', '0000000000000002' ];
    let spanIdIndex = 0;
    const writes: FileWrite[] = [];

    return {
        dependencies: {
            createSpanId() {
                const spanId = spanIds[spanIdIndex];
                spanIdIndex += 1;

                if (spanId === undefined) {
                    throw new Error('Unexpected span ID request.');
                }

                return spanId;
            },
            createTraceId() {
                return '00000000000000000000000000000001';
            },
            async writeFile(path, content) {
                writes.push({ content, path });
            }
        },
        writes
    };
}

function preciseResult(runStatus: 'failed' | 'passed', timingStatus: 'success' | 'timeout'): RunResult {
    return runResultFactory.build({
        status: runStatus,
        summary: runStatus === 'failed' ? { failed: 1 } : { passed: 1 },
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
                    label: runStatus === 'failed' ? 'setup' : null,
                    processId: runStatus === 'failed' ? '42' : null,
                    resource: runStatus === 'failed' ? { name: 'database', scope: 'per-run' } : null,
                    startOffsetMicroseconds: null,
                    startTimeUnixMicroseconds: 1_700_000_000_000_010,
                    status: timingStatus,
                    workerId: runStatus === 'failed' ? 'lane-1' : null
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) {
        throw new Error(`Expected ${label} to be an object.`);
    }

    return value;
}

function array(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`Expected ${label} to be an array.`);
    }

    return value;
}

function entry(values: readonly unknown[], index: number, label: string): Readonly<Record<string, unknown>> {
    return record(values[index], label);
}

function nestedArray(parent: Readonly<Record<string, unknown>>, key: string): readonly unknown[] {
    return array(parent[key], key);
}

function attributeValue(span: Readonly<Record<string, unknown>>, key: string): unknown {
    const attributes = nestedArray(span, 'attributes');
    const attribute = attributes
        .map(function toRecord(value, index) {
            return record(value, `attribute ${index}`);
        })
        .find(function hasKey(value) {
            return value.key === key;
        });

    if (attribute === undefined) {
        throw new Error(`Expected attribute "${key}".`);
    }

    return attribute.value;
}

function exportedSpans(content: string): readonly Readonly<Record<string, unknown>>[] {
    const traceData = record(JSON.parse(content) as unknown, 'trace data');
    const resourceSpan = entry(nestedArray(traceData, 'resourceSpans'), 0, 'resource span');
    const scopeSpan = entry(nestedArray(resourceSpan, 'scopeSpans'), 0, 'scope span');

    return nestedArray(scopeSpan, 'spans').map(function toSpan(value, index) {
        return record(value, `span ${index}`);
    });
}

function assertRootSpan(scope: OverkillScope, span: Readonly<Record<string, unknown>>): void {
    scope.assert.equal(span.name, 'overkill.run');
    scope.assert.equal(span.traceId, '00000000000000000000000000000001');
    scope.assert.equal(span.spanId, '0000000000000001');
    scope.assert.equal(span.parentSpanId, '');
    scope.assert.equal(span.startTimeUnixNano, '1700000000000000000');
    scope.assert.equal(span.endTimeUnixNano, '1700000000000050000');
    scope.assert.deepEqual(span.status, { code: 2 });
    scope.assert.deepEqual(attributeValue(span, 'overkill.run.summary.failed'), { intValue: '1' });
    scope.assert.deepEqual(attributeValue(span, 'overkill.timing.aggregate.resource.acquire.count'), {
        intValue: '1'
    });
}

function assertChildSpan(scope: OverkillScope, span: Readonly<Record<string, unknown>>): void {
    scope.assert.equal(span.name, 'overkill.timing.resource.acquire');
    scope.assert.equal(span.traceId, '00000000000000000000000000000001');
    scope.assert.equal(span.spanId, '0000000000000002');
    scope.assert.equal(span.parentSpanId, '0000000000000001');
    scope.assert.equal(span.startTimeUnixNano, '1700000000000010000');
    scope.assert.equal(span.endTimeUnixNano, '1700000000000030000');
    scope.assert.deepEqual(span.status, { code: 2 });
    scope.assert.deepEqual(attributeValue(span, 'overkill.resource.name'), { stringValue: 'database' });
}

const reportingContext = createReportingContext({ projectRoot: null });

async function writePreciseResult(recording: RecordingDependencies): Promise<{
    readonly reporterSinks: readonly unknown[];
    readonly write: FileWrite;
}> {
    const reporter = createOpenTelemetryReporter(recording.dependencies, {
        outputFile: 'reports/traces.jsonl'
    })(reportingContext);
    await reporter.onResult(preciseResult('failed', 'timeout'));
    const write = recording.writes[0];

    if (write === undefined) {
        throw new Error('Expected an OTLP file write.');
    }

    return { reporterSinks: reporter.sinks, write };
}

function assertWrittenTrace(scope: OverkillScope, recording: RecordingDependencies, write: FileWrite): void {
    scope.assert.equal(recording.writes.length, 1);
    scope.assert.equal(write.path, 'reports/traces.jsonl');
    scope.assert.equal(write.content.endsWith('\n'), true);
    const spans = exportedSpans(write.content);
    scope.assert.equal(spans.length, 2);
    assertRootSpan(scope, entry(spans, 0, 'root span'));
    assertChildSpan(scope, entry(spans, 1, 'child span'));
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/opentelemetry-reporter.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'writes an OTLP JSON trace with absolute timestamps',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const recording = createRecordingDependencies();
                const { reporterSinks, write } = await writePreciseResult(recording);
                scope.assert.deepEqual(reporterSinks, [ { kind: 'file', path: 'reports/traces.jsonl' } ]);
                assertWrittenTrace(scope, recording, write);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'writes unset OTLP statuses for a successful run and timing span',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const recording = createRecordingDependencies();
                const reporter = createOpenTelemetryReporter(recording.dependencies, {
                    outputFile: 'traces.jsonl'
                })(reportingContext);
                await reporter.onResult(preciseResult('passed', 'success'));
                const write = recording.writes[0];

                if (write === undefined) {
                    throw new Error('Expected an OTLP file write.');
                }

                const spans = exportedSpans(write.content);
                scope.assert.deepEqual(entry(spans, 0, 'root span').status, {});
                scope.assert.deepEqual(entry(spans, 1, 'child span').status, {});

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'rejects results without precise timings before writing a file',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const recording = createRecordingDependencies();
                const reporter = createOpenTelemetryReporter(recording.dependencies, {
                    outputFile: 'traces.jsonl'
                })(reportingContext);

                await scope.assert.rejects(async function exportSummaryTimings(): Promise<void> {
                    await reporter.onResult(runResultFactory.build());
                }, {
                    message:
                        'OpenTelemetry reporter requires precise run timings. Enable timings.collection as "precise" or use --timings.'
                });
                scope.assert.deepEqual(recording.writes, []);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
