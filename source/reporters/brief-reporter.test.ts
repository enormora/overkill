import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { resolveRootMetadata } from '../engine/metadata.ts';
import type { OutputLineIntent, ReporterOutput } from '../engine/reporter-output.ts';
import type { ReporterEvent } from '../engine/reporter.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createBriefReporter } from './brief-reporter.ts';

const caseId = {
    file: 'source/users.test.ts',
    title: 'creates profile',
    params: null,
    suite: [ 'users' ]
} as const;

async function readOutput(output: unknown): Promise<readonly OutputLineIntent[]> {
    const resolvedOutput = await output;

    return resolvedOutput === undefined ? [] : resolvedOutput as ReporterOutput;
}

function passEvent(): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    return {
        attempt: 0,
        case: caseId,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 1
    };
}

function failEvent(): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    return {
        attempt: 0,
        case: caseId,
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
                            location: { column: 5, file: 'source/users.test.ts', line: 10 },
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
        verdict: 'fail',
        wallTimeMs: 1
    };
}

function assertFailureAnnotations(scope: OverkillScope, failureOutput: readonly OutputLineIntent[]): void {
    const locatedAnnotation = failureOutput[0]?.annotation;
    const unlocatedAnnotation = failureOutput[1]?.annotation;

    scope.require.defined(locatedAnnotation);
    scope.require.defined(unlocatedAnnotation);
    scope.require.notNull(locatedAnnotation.location);
    const location: SourceLocation = locatedAnnotation.location;

    scope.assert.deepEqual(location, {
        column: 5,
        file: 'source/users.test.ts',
        line: 10
    });
    scope.assert.equal(unlocatedAnnotation.location, null);
}

function runnerErrorEvent(): Extract<ReporterEvent, { readonly kind: 'runner-error'; }> {
    return {
        error: {
            attributedTo: null,
            cause: new Error('cannot collect tests'),
            message: 'cannot collect tests',
            subtype: 'crash'
        },
        kind: 'runner-error'
    };
}

function assertRunnerErrorOutput(scope: OverkillScope, errorOutput: readonly OutputLineIntent[]): void {
    scope.assert.deepEqual(
        errorOutput.map(function toText(intent) {
            return intent.text;
        }),
        [ 'runner-error cannot collect tests' ]
    );
    scope.require.defined(errorOutput[0]);
    const runnerErrorIntent = errorOutput[0];
    scope.require.notNull(runnerErrorIntent.annotation);
    const { annotation } = runnerErrorIntent;

    scope.assert.equal(annotation.location, null);
    scope.assert.equal(annotation.severity, 'error');
    scope.assert.equal(annotation.title, 'Runner error');
}

export const testSuite = createOverkillSuite({
    title: 'source/reporters/brief-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'brief reporter declares managed primary stdout',
            metadata: {},
            body(scope: OverkillScope) {
                const reporter = createBriefReporter();

                scope.assert.deepEqual(reporter.sinks, [ { kind: 'stdout-managed-primary' } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'brief reporter prints run start and omits passing test lines',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();
                const startOutput = await readOutput(reporter.onEvent({
                    facts: { cases: [ { id: caseId, metadata: {} } ] },
                    kind: 'run-start',
                    root: { metadata: resolveRootMetadata({}), title: 'source' },
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
            }
        }),
        createOverkillTestCase({
            title: 'brief reporter prints progress every one hundred completed tests',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();

                await reporter.onEvent({
                    facts: { cases: Array.from({ length: 250 }) },
                    kind: 'run-start',
                    root: { metadata: resolveRootMetadata({}), title: 'source' },
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
            }
        }),
        createOverkillTestCase({
            title: 'brief reporter uses an unknown progress denominator without run facts',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();

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
        }),
        createOverkillTestCase({
            title: 'brief reporter suppresses final progress at the planned count',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();

                await reporter.onEvent({
                    facts: { cases: Array.from({ length: 100 }) },
                    kind: 'run-start',
                    root: { metadata: resolveRootMetadata({}), title: 'source' },
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                for (let index = 0; index < 99; index += 1) {
                    await reporter.onEvent(passEvent());
                }

                const finalPassOutput = await readOutput(reporter.onEvent(passEvent()));

                scope.assert.deepEqual(finalPassOutput, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'brief reporter prints one diagnostic line per failure cause',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();
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
                assertFailureAnnotations(scope, failureOutput);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'brief reporter prints runner errors and ignores suite events',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();
                const suiteOutput = await readOutput(reporter.onEvent({
                    kind: 'suite-start',
                    suitePath: [ 'source' ]
                }));
                const errorOutput = await readOutput(reporter.onEvent(runnerErrorEvent()));

                scope.assert.deepEqual(suiteOutput, []);
                assertRunnerErrorOutput(scope, errorOutput);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'brief reporter prints final counts',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createBriefReporter();
                scope.require.notNull(reporter.onFinish);

                const finishOutput = await readOutput(reporter.onFinish(runResultFactory.build({
                    summary: {
                        discovered: 5,
                        failed: 1,
                        inconclusive: 1,
                        passed: 2,
                        planned: 5,
                        skipped: 1
                    },
                    wallTimeMs: 42
                })));

                scope.assert.deepEqual(
                    finishOutput.map(function toText(intent) {
                        return intent.text;
                    }),
                    [
                        'done discovered=5 planned=5 executed=5 passed=2 failed=1 skipped=1 inconclusive=1 resourceExhausted=0 crashed=0 ms=42'
                    ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
