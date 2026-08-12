import { doubleUsage, testDouble, type TestDouble } from '@overkill-dev/doubles';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { serializedValueDiff } from '../compare/comparison.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import type { CaseId } from '../engine/identity.ts';
import type { FinalResultReporter, RealTimeReporter } from '../engine/reporter.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createTapConsoleRealTimeReporter,
    createTapConsoleReporter,
    type TapConsoleReporterDependencies
} from './tap-console-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

function tapConsoleReporterWithLog(log: Log): FinalResultReporter {
    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleReporter(fakeDependencies);
}

function tapConsoleRealTimeReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleRealTimeReporter(fakeDependencies);
}

const failingCaseId: CaseId = { file: null, name: 'bar', params: null, suite: [ 'root' ] };
const passingCaseId: CaseId = { file: null, name: 'foo', params: null, suite: [ 'root' ] };
const fallbackCaseId: CaseId = { file: null, name: 'fails', params: null, suite: [ 'root' ] };
const inconclusiveCaseId: CaseId = { file: null, name: 'unknown', params: null, suite: [ 'root' ] };
const skippedCaseId: CaseId = { file: null, name: 'skip me', params: null, suite: [ 'root' ] };

async function reportRealTimeTapRun(reporter: RealTimeReporter): Promise<void> {
    await reporter.onEvent({
        facts: {},
        kind: 'run-start',
        root: { metadata: {}, name: 'root' },
        startedAt: '2026-07-15T00:00:00.000Z'
    });
    await reporter.onEvent({
        attempt: 0,
        case: passingCaseId,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 1
    });
    await reporter.onEvent({
        attempt: 0,
        case: failingCaseId,
        kind: 'test-end',
        outcome: {
            failures: [
                {
                    checks: [
                        {
                            actual: serializeValue(1),
                            diff: serializedValueDiff(1, 2),
                            expected: serializeValue(2),
                            id: '1',
                            kind: 'leaf',
                            location: { column: null, file: '', line: null },
                            path: [],
                            source: 'assert',
                            summary: 'the-reason'
                        }
                    ],
                    kind: 'assertion'
                }
            ],
            kind: 'fail'
        },
        verdict: 'fail',
        wallTimeMs: 1
    });
    await reporter.onEvent({ kind: 'run-end', result: runResultFactory.build({ summary: { planned: 2 } }) });
}

export const testSuite = createOverkillSuite({
    name: 'source/reporters/tap-console-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'reports the final result without any test cases formatted as TAP',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = tapConsoleReporterWithLog(log);

                await reporter.onResult(
                    runResultFactory.build({
                        perTest: [],
                        summary: {
                            defined: 0,
                            discovered: 0,
                            failed: 0,
                            inconclusive: 0,
                            passed: 0,
                            planned: 0,
                            skipped: 0
                        }
                    })
                );

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ 'TAP version 14\n1..0\n\n' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reports the final result with passed and failed test cases formatted as TAP',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = tapConsoleReporterWithLog(log);

                await reporter.onResult(
                    runResultFactory.build({
                        perTest: [
                            {
                                id: failingCaseId,
                                outcome: {
                                    failures: [ { checks: [ { summary: 'the-reason' } ], kind: 'assertion' } ],
                                    kind: 'fail'
                                },
                                verdict: 'fail'
                            },
                            {
                                id: passingCaseId,
                                verdict: 'pass'
                            }
                        ],
                        summary: {
                            defined: 2,
                            discovered: 4,
                            failed: 1,
                            inconclusive: 0,
                            passed: 1,
                            planned: 2,
                            skipped: 0
                        }
                    })
                );

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    'TAP version 14\n1..2\nnot ok 1 - root > bar\n  ---\n  reason: the-reason\n  ...\nok 2 - root > foo\n'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reports a failed TAP test point with a fallback diagnostic reason',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = tapConsoleReporterWithLog(log);

                await reporter.onResult(
                    runResultFactory.build({
                        perTest: [
                            {
                                id: fallbackCaseId,
                                outcome: {
                                    failures: [
                                        {
                                            actual: 0,
                                            code: 'no-assertions',
                                            expected: 'at least one assertion',
                                            kind: 'test-contract',
                                            summary: 'Expected at least one assertion.'
                                        }
                                    ],
                                    kind: 'fail'
                                },
                                verdict: 'fail'
                            }
                        ],
                        summary: {
                            defined: 1,
                            discovered: 1,
                            failed: 1,
                            inconclusive: 0,
                            passed: 0,
                            planned: 1,
                            skipped: 0
                        }
                    })
                );

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    'TAP version 14\n1..1\nnot ok 1 - root > fails\n  ---\n  reason: Expected at least one assertion.\n  ...\n'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'reports skip and inconclusive outcomes as TAP directives and diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = tapConsoleReporterWithLog(log);

                await reporter.onResult(
                    runResultFactory.build({
                        perTest: [
                            {
                                id: skippedCaseId,
                                outcome: { kind: 'skip', reason: 'not selected' },
                                verdict: 'skip'
                            },
                            {
                                id: inconclusiveCaseId,
                                outcome: { kind: 'inconclusive', reason: 'lost signal' },
                                verdict: 'inconclusive'
                            }
                        ],
                        summary: {
                            defined: 2,
                            discovered: 2,
                            failed: 0,
                            inconclusive: 1,
                            passed: 0,
                            planned: 2,
                            skipped: 1
                        }
                    })
                );

                const expectedOutput = [
                    'TAP version 14',
                    '1..2',
                    'ok 1 - root > skip me # SKIP not selected',
                    'not ok 2 - root > unknown',
                    '  ---',
                    '  reason: lost signal',
                    '  ...',
                    ''
                ]
                    .join('\n');

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ expectedOutput ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'real-time TAP reporter streams test points before the final plan',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = tapConsoleRealTimeReporterWithLog(log);

                await reportRealTimeTapRun(reporter);

                scope.assert(doubleUsage.callCount, log, 4);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ 'TAP version 14' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ 'ok 1 - root > foo' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [
                    'not ok 2 - root > bar\n  ---\n  reason: the-reason\n  ...'
                ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 3, [ '1..2' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'real-time TAP reporter writes runner errors as comments',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = tapConsoleRealTimeReporterWithLog(log);

                await reporter.onEvent({
                    error: {
                        attributedTo: null,
                        cause: new Error('reporter broke'),
                        message: 'line: reporter broke',
                        subtype: 'reporter'
                    },
                    kind: 'runner-error'
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ '# runner error: line: reporter broke' ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
