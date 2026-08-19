import figures from 'figures';
import colors from 'yoctocolors';
import { doubleUsage, testDouble, type TestDouble } from '@overkill-dev/doubles';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { CaseId } from '../engine/identity.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type LogFunction = (...values: readonly unknown[]) => void;
type Log = TestDouble<LogFunction>;

function lineReporterWithLog(log: Log): RealTimeReporter {
    const fakeDependencies = { stdoutConsole: { log } } as unknown as LineReporterDependencies;

    return createLineReporter(fakeDependencies);
}

const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);
const successSymbol = colors.green(figures.tick);
const failingCaseId: CaseId = { file: null, name: 'fails', params: null, suite: [] };
const passingCaseId: CaseId = { file: null, name: 'passes', params: null, suite: [] };
const skippedCaseId: CaseId = { file: null, name: 'skips', params: null, suite: [] };
const inconclusiveCaseId: CaseId = { file: null, name: 'inconclusive', params: null, suite: [] };

async function reportNestedSuiteRun(reporter: RealTimeReporter): Promise<void> {
    await reporter.onEvent({ kind: 'suite-start', suitePath: [ 'rows' ] });
    await reporter.onEvent({
        attempt: 0,
        case: { file: null, name: 'row 1', params: 'value=1', suite: [ 'rows' ] },
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 7
    });
    await reporter.onEvent({ kind: 'suite-end', suitePath: [ 'rows' ] });
    await reporter.onEvent({
        attempt: 0,
        case: passingCaseId,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 2
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/reporters/line-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'line reporter reports the start event',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    facts: {},
                    kind: 'run-start',
                    root: { metadata: {}, name: 'file:///source/reporters/line-reporter.test.ts' },
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    infoSymbol,
                    'Test run started: file:///source/reporters/line-reporter.test.ts'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints assertion failure details for a failed test-end event',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    kind: 'test-end',
                    outcome: {
                        failures: [
                            {
                                checks: [
                                    {
                                        actual: { kind: 'number', value: 1 },
                                        diff: {
                                            actual: { kind: 'number', value: 1 },
                                            expected: { kind: 'number', value: 2 },
                                            kind: 'value'
                                        },
                                        expected: { kind: 'number', value: 2 },
                                        id: '1',
                                        kind: 'leaf',
                                        location: { column: null, file: '', line: null },
                                        path: [],
                                        source: 'assert',
                                        summary: 'numbers differ'
                                    }
                                ],
                                kind: 'assertion'
                            }
                        ],
                        kind: 'fail'
                    },
                    verdict: 'fail',
                    wallTimeMs: 12
                });

                scope.assert(doubleUsage.callCount, log, 4);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ errorSymbol, 'fails (12 ms)' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  numbers differ' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  expected: 2' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 3, [ '  actual: 1' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints unicode string mismatch hints',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);
                const [ composedName, decomposedName ] = [ 'Ad\u{00E4}le', 'Ada\u{0308}le' ];

                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    kind: 'test-end',
                    outcome: {
                        failures: [
                            {
                                checks: [
                                    {
                                        actual: { kind: 'string', truncation: null, value: decomposedName },
                                        diff: {
                                            actual: decomposedName,
                                            expected: composedName,
                                            hunks: [
                                                {
                                                    actualStart: 1,
                                                    added: [ decomposedName ],
                                                    expectedStart: 1,
                                                    removed: [ composedName ]
                                                }
                                            ],
                                            kind: 'string'
                                        },
                                        expected: { kind: 'string', truncation: null, value: composedName },
                                        id: '1',
                                        kind: 'leaf',
                                        location: { column: 5, file: 'source/users.test.ts', line: 10 },
                                        path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ],
                                        source: 'assert',
                                        summary: 'names differ'
                                    }
                                ],
                                kind: 'assertion'
                            }
                        ],
                        kind: 'fail'
                    },
                    verdict: 'fail',
                    wallTimeMs: 12
                });

                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ errorSymbol, 'fails (12 ms)' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  names differ' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  path: .name' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 3, [ '  location: source/users.test.ts:10:5' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 4, [ '  string hunk expected 1, actual 1' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints body error failures with a dimmed stack',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    kind: 'test-end',
                    outcome: {
                        failures: [
                            {
                                error: {
                                    message: 'boom',
                                    name: 'Error',
                                    stack: 'Error: boom\n    at source/users.test.ts:10:5',
                                    thrown: new Error('boom')
                                },
                                kind: 'body-error'
                            }
                        ],
                        kind: 'fail'
                    },
                    verdict: 'fail',
                    wallTimeMs: 12
                });

                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ errorSymbol, 'fails (12 ms)' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ '  Error: boom' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ `  ${colors.dim('Error: boom')}` ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints test-contract failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    kind: 'test-end',
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
                    verdict: 'fail',
                    wallTimeMs: 12
                });

                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ errorSymbol, 'fails (12 ms)' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [
                    '  Expected at least one assertion. (no-assertions)'
                ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ '  expected: at least one assertion' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 3, [ '  actual: 0' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints object identity hints',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    case: failingCaseId,
                    kind: 'test-end',
                    outcome: {
                        failures: [
                            {
                                checks: [
                                    {
                                        actual: {
                                            constructorName: 'Object',
                                            entries: [],
                                            kind: 'object',
                                            truncation: null
                                        },
                                        diff: {
                                            kind: 'object',
                                            operations: [
                                                {
                                                    from: { kind: 'string', truncation: null, value: 'Ada' },
                                                    operation: 'replace',
                                                    path: [ {
                                                        key: { kind: 'string', value: 'name' },
                                                        kind: 'property'
                                                    } ],
                                                    to: { kind: 'string', truncation: null, value: 'Grace' }
                                                }
                                            ]
                                        },
                                        expected: {
                                            constructorName: 'Object',
                                            entries: [],
                                            kind: 'object',
                                            truncation: null
                                        },
                                        id: '1',
                                        kind: 'leaf',
                                        location: { column: null, file: '', line: null },
                                        path: [],
                                        source: 'assert',
                                        summary: 'objects differ'
                                    }
                                ],
                                kind: 'assertion'
                            }
                        ],
                        kind: 'fail'
                    },
                    verdict: 'fail',
                    wallTimeMs: 12
                });

                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [
                    '  replace .name: expected "Ada", actual "Grace"'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints a passed test-end event',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    case: passingCaseId,
                    kind: 'test-end',
                    outcome: { kind: 'pass' },
                    verdict: 'pass',
                    wallTimeMs: 3
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ successSymbol, 'passes (3 ms)' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints neutral test-end events with outcome reasons',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    attempt: 0,
                    case: skippedCaseId,
                    kind: 'test-end',
                    outcome: { kind: 'skip', reason: 'not supported' },
                    verdict: 'skip',
                    wallTimeMs: 4
                });
                await reporter.onEvent({
                    attempt: 1,
                    case: inconclusiveCaseId,
                    kind: 'test-end',
                    outcome: { kind: 'inconclusive', reason: 'missing signal' },
                    verdict: 'inconclusive',
                    wallTimeMs: 5
                });

                scope.assert(doubleUsage.callCount, log, 2);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ infoSymbol, 'skips: not supported (4 ms)' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [
                    infoSymbol,
                    'inconclusive: missing signal (5 ms)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints nested suites and indents test results',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reportNestedSuiteRun(reporter);

                scope.assert(doubleUsage.callCount, log, 3);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [ infoSymbol, 'rows' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ successSymbol, '  row 1 [value=1] (7 ms)' ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 2, [ successSymbol, 'passes (2 ms)' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints runner errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                await reporter.onEvent({
                    error: {
                        attributedTo: null,
                        cause: new Error('cannot render'),
                        message: 'line: cannot render',
                        subtype: 'reporter'
                    },
                    kind: 'runner-error'
                });

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    errorSymbol,
                    'Runner error: line: cannot render'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints the run count summary once the run finishes',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                const runResult: RunResult = runResultFactory.build({
                    summary: {
                        defined: 3,
                        discovered: 3,
                        failed: 1,
                        inconclusive: 0,
                        passed: 2,
                        planned: 3,
                        skipped: 0
                    },
                    wallTimeMs: 10
                });
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected line reporter to expose onFinish.');
                }

                await onFinish(runResult);

                scope.assert(doubleUsage.callCount, log, 1);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    infoSymbol,
                    '3 discovered, 3 planned, 3 executed (2 pass, 1 fail, 0 skip) in 10 ms'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints nonzero inconclusive and crash counts in the run summary',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                const runResult: RunResult = runResultFactory.build({
                    summary: {
                        crashed: 1,
                        discovered: 4,
                        failed: 1,
                        inconclusive: 1,
                        passed: 1,
                        planned: 4,
                        skipped: 1
                    },
                    wallTimeMs: 15
                });
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected line reporter to expose onFinish.');
                }

                await onFinish(runResult);

                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    infoSymbol,
                    '4 discovered, 4 planned, 5 executed (1 pass, 1 fail, 1 skip, 1 inconclusive, 1 crash) in 15 ms'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line reporter prints orphan details once the run finishes',
            metadata: {},
            async body(scope: OverkillScope) {
                const log = testDouble<LogFunction>();
                const reporter = lineReporterWithLog(log);

                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected line reporter to expose onFinish.');
                }

                await onFinish(runResultFactory.build({
                    orphans: [
                        {
                            file: null,
                            kind: 'test',
                            name: 'unused'
                        }
                    ],
                    summary: {
                        discovered: 0,
                        planned: 0
                    }
                }));

                scope.assert(doubleUsage.callCount, log, 2);
                scope.assert(doubleUsage.nthCallWithExactly, log, 0, [
                    infoSymbol,
                    '0 discovered, 0 planned, 0 executed (0 pass, 0 fail, 0 skip), 1 orphaned in 0 ms'
                ]);
                scope.assert(doubleUsage.nthCallWithExactly, log, 1, [ infoSymbol, 'test: unused (<unknown>)' ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
