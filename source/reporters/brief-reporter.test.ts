import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { resolveRootTestAnnotations } from '../engine/test-data.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import type { OutputLineIntent, ReporterOutput } from '../engine/reporter-output.ts';
import type { RealTimeReporter, ReporterEvent, RunFacts } from '../engine/reporter.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createBriefReporter, type BriefReporterSinks } from '../packages/reporter-brief/reporter-brief.entry-point.ts';
import { formatRunFactSummary } from './run-summary-rendering.ts';

const caseId = {
    file: 'source/users.test.ts',
    title: 'creates profile',
    params: null,
    suite: [ 'users' ]
} as const;
const definitionLocation = { column: null, file: 'source/users.test.ts', kind: 'known' as const, line: null };
const suitePath = [ { definitionLocations: [ definitionLocation ], title: 'users' } ] as const;
const reportingContext = createReportingContext({ projectRoot: null });

function runFacts(execution: unknown, reproducibility: unknown): RunFacts {
    return {
        execution,
        reproducibility
    };
}

function createBriefRuntimeReporter(): RealTimeReporter<BriefReporterSinks> {
    return createBriefReporter()(reportingContext);
}

async function readOutput(output: unknown): Promise<readonly OutputLineIntent[]> {
    const resolvedOutput = await output;

    return resolvedOutput === undefined ? [] : resolvedOutput as ReporterOutput;
}

function passEvent(): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    return {
        property: null,
        benchmark: null,
        completion: 'final',
        attempt: 0,
        case: caseId,
        workId: { familyVariant: null, case: caseId, runtimes: [], workload: null },
        definitionLocations: [ definitionLocation ],
        artifacts: [],
        kind: 'test-end',
        outcome: { kind: 'pass' },
        suitePath,
        verdict: 'pass',
        durationMicroseconds: 1
    };
}

function failEvent(): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    return {
        property: null,
        benchmark: null,
        completion: 'final',
        attempt: 0,
        case: caseId,
        workId: { familyVariant: null, case: caseId, runtimes: [], workload: null },
        definitionLocations: [ definitionLocation ],
        artifacts: [],
        kind: 'test-end',
        outcome: {
            failures: [
                {
                    checks: [
                        {
                            actual: { kind: 'boolean', value: false },
                            diff: null,
                            expected: { kind: 'boolean', value: true },
                            id: '1',
                            kind: 'leaf',
                            sourceLocations: [ {
                                column: 5,
                                file: 'source/users.test.ts',
                                kind: 'known' as const,
                                line: 10
                            } ],
                            path: [],
                            source: 'assert',
                            summary: 'expected true, actual false'
                        }
                    ],
                    kind: 'assertion'
                },
                {
                    error: {
                        message: 'boom',
                        name: 'Error',
                        stack: 'Error: boom\n    at source/users.test.ts:12:5',
                        thrown: new Error('boom')
                    },
                    kind: 'body-error'
                }
            ],
            kind: 'fail'
        },
        suitePath,
        verdict: 'fail',
        durationMicroseconds: 1
    };
}

const assertFailureAnnotations = defineCompositeAssertion({
    name: 'failure annotations',
    assert(check, failureOutput: readonly OutputLineIntent[]) {
        return check.group([
            check.partialDeepEqual(failureOutput[0]?.annotation ?? {}, {
                location: { column: 5, file: 'source/users.test.ts', kind: 'known', line: 10 }
            }),
            check.partialDeepEqual(failureOutput[1]?.annotation ?? {}, { location: null })
        ]);
    }
});

function runnerErrorEvent(): Extract<ReporterEvent, { readonly kind: 'runner-error'; }> {
    return {
        error: {
            attributedToAttempt: null,
            attributedTo: null,
            cause: new Error('cannot collect tests'),
            diagnostics: [],
            message: 'cannot collect tests',
            subtype: 'crash'
        },
        kind: 'runner-error'
    };
}

const assertRunnerErrorOutput = defineCompositeAssertion({
    name: 'runner error output',
    assert(check, errorOutput: readonly OutputLineIntent[]) {
        const initialChecks = check.deepEqual(
            errorOutput.map(function toText(intent) {
                return intent.text;
            }),
            [ 'runner-error cannot collect tests' ]
        );
        if (errorOutput[0] === undefined) {
            return check.group([ initialChecks, check.defined(errorOutput[0]) ]);
        }

        const runnerErrorIntent = errorOutput[0];
        if (runnerErrorIntent.annotation === null) {
            return check.group([ initialChecks, check.notNull(runnerErrorIntent.annotation) ]);
        }
        const laterChecks = check.notNull(runnerErrorIntent.annotation);
        const { annotation } = runnerErrorIntent;
        return check.group([
            initialChecks,
            laterChecks,
            check.equal(annotation.location, null),
            check.equal(annotation.severity, 'error'),
            check.equal(annotation.title, 'Runner error')
        ]);
    }
});

export const testNode = suite('Brief reporter', [
    test(
        'retry failures do not create annotations or increment completion counts',
        async function (scope) {
            const reporter = createBriefRuntimeReporter();
            const output = await readOutput(reporter.onEvent({ ...failEvent(), completion: 'retry' }));
            scope.assert.equal(output[0]?.annotation, null);
            scope.assert.deepEqual(
                output.map(function text(intent) {
                    return intent.text;
                }),
                [ 'retry 1: creates profile' ]
            );
            for (let index = 0; index < 99; index += 1) {
                await reporter.onEvent(passEvent());
            }
            const final = await readOutput(reporter.onEvent({ ...passEvent(), attempt: 1 }));
            scope.assert.deepEqual(
                final.map(function text(intent) {
                    return intent.text;
                }),
                [ 'progress 100/? failed=0' ]
            );
            return scope.assert.collect();
        }
    ),
    test('declares managed primary stdout', function (scope) {
        const reporter = createBriefRuntimeReporter();

        scope.assert.deepEqual(reporter.sinks, [ { kind: 'stdout-managed-primary' } ]);

        return scope.assert.collect();
    }),
    test('prints run start and omits passing test lines', async function (scope) {
        const reporter = createBriefRuntimeReporter();
        const startOutput = await readOutput(reporter.onEvent({
            facts: { cases: [ { annotations: {}, controls: {}, id: caseId } ] },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        }));
        const passOutput = await readOutput(reporter.onEvent(passEvent()));

        scope.assert.deepEqual(
            startOutput.map(function toText(intent) {
                return intent.text;
            }),
            [ 'run source' ]
        );
        scope.assert.deepEqual(passOutput, []);

        return scope.assert.collect();
    }),
    test('includes order and seed on run start', async function (scope) {
        const reporter = createBriefRuntimeReporter();
        const startOutput = await readOutput(reporter.onEvent({
            facts: {
                cases: [ { annotations: {}, controls: {}, id: caseId } ],
                execution: { order: 'seeded' },
                reproducibility: { seed: '123' }
            },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        }));

        scope.assert.deepEqual(
            startOutput.map(function toText(intent) {
                return intent.text;
            }),
            [ 'run source order=seeded seed=123' ]
        );

        return scope.assert.collect();
    }),
    test('ignores incomplete ordering facts', async function (scope) {
        const reporter = createBriefRuntimeReporter();
        const missingSeed = await readOutput(reporter.onEvent({
            facts: {
                cases: [ { annotations: {}, controls: {}, id: caseId } ],
                execution: { order: 'seeded' }
            },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        }));
        const missingOrder = await readOutput(reporter.onEvent({
            facts: {
                cases: [ { annotations: {}, controls: {}, id: caseId } ],
                reproducibility: { seed: '123' }
            },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        }));
        const missingOrderingFacts = await readOutput(reporter.onEvent({
            facts: {
                cases: [ { annotations: {}, controls: {}, id: caseId } ]
            },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        }));

        scope.assert.deepEqual(
            missingSeed.map(function toText(intent) {
                return intent.text;
            }),
            [ 'run source' ]
        );
        scope.assert.deepEqual(
            missingOrder.map(function toText(intent) {
                return intent.text;
            }),
            [ 'run source' ]
        );
        scope.assert.deepEqual(
            missingOrderingFacts.map(function toText(intent) {
                return intent.text;
            }),
            [ 'run source' ]
        );

        return scope.assert.collect();
    }),
    test('brief run fact summary rejects malformed ordering facts', function (scope) {
        scope.assert.equal(formatRunFactSummary(runFacts(null, { seed: '123' })), null);
        scope.assert.equal(formatRunFactSummary(runFacts({ order: 'seeded' }, null)), null);
        scope.assert.equal(formatRunFactSummary(runFacts({}, { seed: '123' })), null);
        scope.assert.equal(formatRunFactSummary(runFacts({ order: 'seeded' }, {})), null);

        return scope.assert.collect();
    }),
    test('prints progress every one hundred completed tests', async function (scope) {
        const reporter = createBriefRuntimeReporter();

        await reporter.onEvent({
            facts: { cases: Array.from({ length: 250 }) },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        });

        for (let index = 0; index < 99; index += 1) {
            scope.assert.deepEqual(await readOutput(reporter.onEvent(passEvent())), []);
        }

        const progressOutput = await readOutput(reporter.onEvent(passEvent()));

        scope.assert.deepEqual(
            progressOutput.map(function toText(intent) {
                return intent.text;
            }),
            [ 'progress 100/250 failed=0' ]
        );

        return scope.assert.collect();
    }),
    test(
        'uses an unknown progress denominator without run facts',
        async function (scope) {
            const reporter = createBriefRuntimeReporter();

            for (let index = 0; index < 99; index += 1) {
                await reporter.onEvent(passEvent());
            }

            const progressOutput = await readOutput(reporter.onEvent(passEvent()));

            scope.assert.deepEqual(
                progressOutput.map(function toText(intent) {
                    return intent.text;
                }),
                [ 'progress 100/? failed=0' ]
            );

            return scope.assert.collect();
        }
    ),
    test('suppresses final progress at the planned count', async function (scope) {
        const reporter = createBriefRuntimeReporter();

        await reporter.onEvent({
            facts: { cases: Array.from({ length: 100 }) },
            kind: 'run-start',
            root: { annotations: resolveRootTestAnnotations({}), title: 'source' },
            startedAt: '2026-07-15T00:00:00.000Z'
        });

        for (let index = 0; index < 99; index += 1) {
            await reporter.onEvent(passEvent());
        }

        const finalPassOutput = await readOutput(reporter.onEvent(passEvent()));

        scope.assert.deepEqual(finalPassOutput, []);

        return scope.assert.collect();
    }),
    test('prints one diagnostic line per failure cause', async function (scope) {
        const reporter = createBriefRuntimeReporter();
        const failureOutput = await readOutput(reporter.onEvent(failEvent()));

        scope.assert.deepEqual(
            failureOutput.map(function toText(intent) {
                return intent.text;
            }),
            [
                'fail source/users.test.ts:10:5 source/users.test.ts: users > creates profile: expected true, actual false',
                'fail source/users.test.ts: users > creates profile: boom'
            ]
        );
        scope.assert(assertFailureAnnotations, failureOutput);

        return scope.assert.collect();
    }),
    test('prints runner errors and ignores suite events', async function (scope) {
        const reporter = createBriefRuntimeReporter();
        const suiteOutput = await readOutput(reporter.onEvent({
            kind: 'suite-start',
            suitePath: [ { definitionLocations: [ definitionLocation ], title: 'source' } ]
        }));
        const errorOutput = await readOutput(reporter.onEvent(runnerErrorEvent()));

        scope.assert.deepEqual(suiteOutput, []);
        scope.assert(assertRunnerErrorOutput, errorOutput);

        return scope.assert.collect();
    }),
    test('emits slow runner overhead as managed output', async function (scope: TestScope) {
        const reporter = createBriefRuntimeReporter();
        scope.require.notNull(reporter.onFinish);
        const finishOutput = await readOutput(reporter.onFinish({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResultFactory.build({
                timings: {
                    precise: {
                        aggregates: [ { count: 1, durationMicroseconds: 750_000, kind: 'config.load' } ],
                        ambientNoise: 'unknown',
                        droppedSpanCount: 0,
                        overhead: {
                            aggregationMicroseconds: 0,
                            recordingMicroseconds: 0,
                            renderingMicroseconds: 0,
                            serializationMicroseconds: 0
                        },
                        observationWindow: { durationMicroseconds: 750_000, startTimeUnixMicroseconds: 0 },
                        slowestSpanLimit: 50,
                        slowestSpans: [ {
                            durationMicroseconds: 750_000,
                            kind: 'config.load',
                            label: null,
                            processId: null,
                            resource: null,
                            startOffsetMicroseconds: 0,
                            startTimeUnixMicroseconds: 0,
                            status: 'success',
                            workerId: null
                        } ],
                        spanLimit: 5000,
                        spans: [ {
                            durationMicroseconds: 750_000,
                            kind: 'config.load',
                            label: null,
                            processId: null,
                            resource: null,
                            startOffsetMicroseconds: 0,
                            startTimeUnixMicroseconds: 0,
                            status: 'success',
                            workerId: null
                        } ],
                        truncated: false
                    },
                    summary: {
                        runnerOverheadWallTimeMicroseconds: 1_000_000,
                        testExecutionWallTimeMicroseconds: 1_000_000,
                        totalWallTimeMicroseconds: 2_000_000
                    }
                }
            })
        }));

        scope.assert.deepEqual(
            finishOutput.slice(1).map(function toText(intent) {
                return intent.text;
            }),
            [ 'Slow runner overhead:', '  config load: 750 ms' ]
        );

        return scope.assert.collect();
    }),
    test('prints final counts', async function (scope: TestScope) {
        const reporter = createBriefRuntimeReporter();
        scope.require.notNull(reporter.onFinish);

        const finishOutput = await readOutput(reporter.onFinish({
            context: {
                id: null,
                startedAt: null,
                facts: null
            },
            result: runResultFactory.build({
                summary: {
                    discovered: 5,
                    failed: 1,
                    inconclusive: 1,
                    passed: 2,
                    planned: 5,
                    skipped: 1
                },
                totalWallTimeMicroseconds: 1_042_000
            })
        }));

        scope.assert.deepEqual(
            finishOutput.map(function toText(intent) {
                return intent.text;
            }),
            [
                'done status=failed discovered=5 planned=5 executed=5 passed=2 failed=1 skipped=1 inconclusive=1 processExhausted=0 runtimePolicy=0 crashed=0 ms=1042 timing="total 1.04 s, execution 0 ms, overhead 1.04 s"'
            ]
        );

        return scope.assert.collect();
    })
]);
