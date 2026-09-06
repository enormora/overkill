import figures from 'figures';
import colors from 'yoctocolors';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { CaseId } from '../engine/identity.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDotReporter } from './dot-reporter.ts';
import type { TerminalOutput } from './terminal.ts';

type FakeTerminal = {
    readonly listenerCount: () => number;
    readonly output: TerminalOutput;
    readonly text: () => string;
};

const failingCaseId: CaseId = { file: null, title: 'fails', params: null, suite: [ 'root' ] };
const inconclusiveCaseId: CaseId = { file: null, title: 'maybe', params: null, suite: [ 'root' ] };
const passingCaseId: CaseId = { file: null, title: 'passes', params: null, suite: [ 'root' ] };
const skippedCaseId: CaseId = { file: null, title: 'skips', params: null, suite: [ 'root' ] };

function createFakeTerminal(columns: number): FakeTerminal {
    let text = '';
    let resizeListeners: readonly (() => void)[] = [];

    return {
        listenerCount() {
            return resizeListeners.length;
        },
        output: {
            columns,
            off(_event, listener) {
                resizeListeners = resizeListeners.filter(function keepRegistered(candidate) {
                    return candidate !== listener;
                });
            },
            on(_event, listener) {
                resizeListeners = [ ...resizeListeners, listener ];
            },
            write(value) {
                text = `${text}${value}`;
            }
        },
        text() {
            return text;
        }
    };
}

async function reportTestEnd(
    reporter: RealTimeReporter,
    id: CaseId,
    outcome: RunResult['perTest'][number]['outcome']
): Promise<void> {
    await reporter.onEvent({
        attempt: 0,
        case: id,
        kind: 'test-end',
        outcome,
        verdict: outcome?.kind ?? 'crashed',
        wallTimeMs: 1
    });
}

function createFailureDetailResult(): RunResult {
    const contractCaseId: CaseId = { file: null, title: 'empty', params: null, suite: [ 'root' ] };
    const bodyErrorCaseId: CaseId = { file: null, title: 'throws', params: null, suite: [ 'root' ] };

    return runResultFactory.build({
        orphans: [
            {
                file: null,
                kind: 'test',
                title: 'unused'
            }
        ],
        perTest: [
            {
                id: bodyErrorCaseId,
                outcome: {
                    failures: [
                        {
                            error: {
                                message: 'boom',
                                name: 'Error',
                                stack: null,
                                thrown: new Error('boom')
                            },
                            kind: 'body-error'
                        }
                    ],
                    kind: 'fail'
                }
            },
            {
                id: contractCaseId,
                outcome: {
                    failures: [
                        {
                            code: 'no-assertions',
                            summary: 'Expected at least one assertion.',
                            kind: 'test-contract'
                        }
                    ],
                    kind: 'fail'
                }
            }
        ],
        summary: {
            discovered: 2,
            failed: 2,
            planned: 2
        }
    });
}

export const testSuite = createOverkillSuite({
    title: 'source/reporters/dot-reporter.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'dot reporter declares raw stdout',
            metadata: {},
            body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                });

                scope.assert.deepEqual(reporter.sinks, [ { kind: 'stdout-raw' } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'dot reporter maps outcomes and runner errors to compact marks',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                });

                await reportTestEnd(reporter, passingCaseId, { kind: 'pass' });
                await reportTestEnd(reporter, failingCaseId, {
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
                                    id: 'check',
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
                });
                await reportTestEnd(reporter, skippedCaseId, { kind: 'skip', reason: 'not here' });
                await reportTestEnd(reporter, inconclusiveCaseId, { kind: 'inconclusive', reason: 'unknown' });
                await reporter.onEvent({
                    error: {
                        attributedTo: null,
                        cause: new Error('boom'),
                        message: 'runner exploded',
                        subtype: 'crash'
                    },
                    kind: 'runner-error'
                });

                scope.assert.equal(
                    terminal.text(),
                    [
                        colors.green(figures.tick),
                        colors.red(figures.cross),
                        colors.cyan('°'),
                        colors.cyan('?'),
                        colors.red(figures.warning)
                    ]
                        .join('')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'dot reporter wraps progress marks by terminal width',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(2);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                });

                await reportTestEnd(reporter, passingCaseId, { kind: 'pass' });
                await reportTestEnd(reporter, passingCaseId, { kind: 'pass' });
                await reportTestEnd(reporter, passingCaseId, { kind: 'pass' });

                scope.assert.equal(
                    terminal.text(),
                    `${colors.green(figures.tick)}${colors.green(figures.tick)}\n${colors.green(figures.tick)}`
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'dot reporter prints summary and short details on finish',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                });
                const result = runResultFactory.build({
                    perTest: [
                        { id: passingCaseId, outcome: { kind: 'pass' } },
                        {
                            id: failingCaseId,
                            outcome: {
                                checks: [ { summary: 'numbers differ' } ],
                                kind: 'fail'
                            }
                        },
                        {
                            id: inconclusiveCaseId,
                            outcome: { kind: 'inconclusive', reason: 'missing signal' }
                        }
                    ],
                    runnerErrors: [
                        {
                            message: 'loader failed',
                            subtype: 'loader'
                        }
                    ],
                    summary: {
                        discovered: 3,
                        failed: 1,
                        inconclusive: 1,
                        passed: 1,
                        planned: 3,
                        skipped: 0
                    },
                    wallTimeMs: 12
                });
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected dot reporter to expose onFinish.');
                }

                await reportTestEnd(reporter, passingCaseId, { kind: 'pass' });
                await onFinish(result);

                scope.assert.equal(
                    terminal.text(),
                    [
                        colors.green(figures.tick),
                        '3 discovered, 3 planned, 3 executed (1 pass, 1 fail, 0 skip, 1 inconclusive) in 12 ms',
                        'Failed: root > fails: numbers differ',
                        'Inconclusive: root > maybe: missing signal',
                        'Runner error: loader failed',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'dot reporter prints body-error and contract failure details',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                });
                const result = createFailureDetailResult();
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected dot reporter to expose onFinish.');
                }

                await onFinish(result);
                await onFinish(result);

                scope.assert.equal(
                    terminal.text(),
                    [
                        '2 discovered, 2 planned, 2 executed (0 pass, 2 fail, 0 skip), 1 orphaned in 0 ms',
                        'Failed: root > throws: boom',
                        'Failed: root > empty: Expected at least one assertion.',
                        '2 discovered, 2 planned, 2 executed (0 pass, 2 fail, 0 skip), 1 orphaned in 0 ms',
                        'Failed: root > throws: boom',
                        'Failed: root > empty: Expected at least one assertion.',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'dot reporter prints post-finish runner errors below the summary',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                });
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected dot reporter to expose onFinish.');
                }

                await onFinish(runResultFactory.build());
                await reporter.onEvent({
                    error: {
                        attributedTo: null,
                        cause: new Error('late'),
                        message: 'final reporter failed',
                        subtype: 'reporter'
                    },
                    kind: 'runner-error'
                });

                scope.assert.equal(
                    terminal.text(),
                    [
                        '0 discovered, 0 planned, 0 executed (0 pass, 0 fail, 0 skip) in 0 ms',
                        'Runner error: final reporter failed',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'dot reporter disposes its resize listener',
            metadata: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: true,
                    stdout: terminal.output
                });

                scope.assert.equal(terminal.listenerCount(), 1);
                const { dispose } = reporter;

                if (dispose === null) {
                    throw new TypeError('Expected dot reporter to expose dispose.');
                }

                await dispose();

                scope.assert.equal(terminal.listenerCount(), 0);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
