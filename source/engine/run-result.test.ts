import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { FailedCheck, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { CaseRunnerError, isCaseRunnerError, verdictFromOutcome, type TestOutcome } from './run-result.ts';
import {
    defaultRunTimingSlowestSpanLimit,
    defaultRunTimingSpanLimit,
    preciseTimingReport,
    resourceScopes,
    runTimingSpanKinds,
    runTimingSummary,
    zeroTimingCollectionOverhead,
    type PreciseTimingReportInput,
    type RunTimingSpan
} from './run-timings.ts';

type FailedCheckFixture = {
    readonly actual: FailedCheck['actual'];
    readonly diff: null;
    readonly expected: FailedCheck['expected'];
    readonly id: FailedCheck['id'];
    readonly kind: 'leaf';
    readonly path: FailedCheck['path'];
    readonly source: FailedCheck['source'];
    readonly sourceLocations: readonly [SourceLocation];
    readonly summary: FailedCheck['summary'];
};

function createFailedCheck(): FailedCheckFixture {
    return {
        actual: serializeValue(null),
        diff: null,
        expected: serializeValue(null),
        id: 'check',
        kind: 'leaf',
        path: [],
        source: 'assert',
        sourceLocations: [ { column: null, file: 'source/example.test.ts', kind: 'known' as const, line: null } ],
        summary: 'Check failed'
    };
}

function assertCaseRunnerErrorPredicates(scope: OverkillScope): void {
    const branded = new CaseRunnerError('Fixture failed.', {
        cause: new Error('fixture'),
        subtype: 'fixture'
    });
    const foreignBrand = Symbol.for('@overkill-dev/engine/CaseRunnerError');
    const invalidForeign = Object.freeze({
        [foreignBrand]: true,
        runnerError: null
    });

    scope.assert.equal(isCaseRunnerError(null), false);
    scope.assert.equal(isCaseRunnerError('fixture'), false);
    scope.assert.equal(isCaseRunnerError(invalidForeign), false);
    scope.assert.equal(isCaseRunnerError(branded), true);
}

const timingSpan = function timingSpan(
    kind: RunTimingSpan['kind'],
    durationMicroseconds: number,
    startOffsetMicroseconds: number
): RunTimingSpan {
    return {
        durationMicroseconds,
        kind,
        label: null,
        processId: null,
        resource: null,
        startOffsetMicroseconds,
        status: 'success',
        workerId: null
    };
};

function assertDefaultTimingModelValues(scope: OverkillScope): void {
    scope.assert.equal(defaultRunTimingSpanLimit, 5000);
    scope.assert.equal(defaultRunTimingSlowestSpanLimit, 50);
    scope.assert.deepEqual(zeroTimingCollectionOverhead, {
        aggregationMicroseconds: 0,
        recordingMicroseconds: 0,
        renderingMicroseconds: 0,
        serializationMicroseconds: 0
    });
    scope.assert.equal(resourceScopes.includes('per-case'), true);
    scope.assert.equal(runTimingSpanKinds.includes('config.load'), true);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/run-result.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'verdictFromOutcome() returns the outcome kind as the verdict',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const outcome: TestOutcome = {
                    failures: [ { checks: [ createFailedCheck() ], kind: 'assertion' } ],
                    kind: 'fail'
                };

                scope.assert.equal(verdictFromOutcome(outcome), 'fail');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'isCaseRunnerError() accepts only branded runner errors',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                assertCaseRunnerErrorPredicates(scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'runTimingSummary() clamps execution time to total wall time',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.deepEqual(
                    runTimingSummary({
                        testExecutionWallTimeMicroseconds: 15,
                        totalWallTimeMicroseconds: 10
                    }),
                    {
                        runnerOverheadWallTimeMicroseconds: 0,
                        testExecutionWallTimeMicroseconds: 10,
                        totalWallTimeMicroseconds: 10
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'preciseTimingReport() bounds spans, aggregates totals, and records slowest spans',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const configLoadStart = timingSpan('config.load', 3, 0);
                const reporterDelivery = timingSpan('reporter.deliver', 20, 3);
                const configLoadEnd = timingSpan('config.load', 10, 23);
                const input: PreciseTimingReportInput = {
                    aggregationMicroseconds: 3,
                    recordingMicroseconds: 2,
                    slowestSpanLimit: 2,
                    spanLimit: 2,
                    spans: [ configLoadStart, reporterDelivery, configLoadEnd ]
                };

                scope.assert.deepEqual(preciseTimingReport(input), {
                    aggregates: [
                        { count: 2, durationMicroseconds: 13, kind: 'config.load' },
                        { count: 1, durationMicroseconds: 20, kind: 'reporter.deliver' }
                    ],
                    ambientNoise: 'unknown',
                    droppedSpanCount: 1,
                    overhead: {
                        aggregationMicroseconds: 3,
                        recordingMicroseconds: 2,
                        renderingMicroseconds: 0,
                        serializationMicroseconds: 0
                    },
                    slowestSpanLimit: 2,
                    slowestSpans: [ reporterDelivery, configLoadEnd ],
                    spanLimit: 2,
                    spans: [ configLoadStart, reporterDelivery ],
                    truncated: true
                });
                assertDefaultTimingModelValues(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
