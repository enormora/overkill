import figures from 'figures';
import colors from 'yoctocolors';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { CaseId } from '../engine/identity.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createDotReporter, type DotReporterDependencies } from './dot-reporter.ts';
import type { TerminalOutput } from './terminal.ts';

type FakeTerminal = {
    readonly listenerCount: () => number;
    readonly output: TerminalOutput;
    readonly text: () => string;
};
type DotReporterOptions = DotReporterDependencies;

const failingCaseId: CaseId = { file: null, title: 'fails', params: null, suite: [ 'root' ] };
const inconclusiveCaseId: CaseId = { file: null, title: 'maybe', params: null, suite: [ 'root' ] };
const passingCaseId: CaseId = { file: null, title: 'passes', params: null, suite: [ 'root' ] };
const skippedCaseId: CaseId = { file: null, title: 'skips', params: null, suite: [ 'root' ] };
const definitionLocation = { kind: 'unknown' as const };

function suitePathFromTitles(
    titles: readonly string[]
): readonly { readonly definitionLocations: readonly [typeof definitionLocation]; readonly title: string; }[] {
    return titles.map(function toSuitePathEntry(title) {
        return { definitionLocations: [ definitionLocation ], title };
    });
}

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

function createDotRuntimeReporter(options: DotReporterOptions): RealTimeReporter {
    return createDotReporter(options)({
        relativizeLocationPath(location) {
            return location.file;
        }
    });
}

async function reportTestEnd(
    reporter: RealTimeReporter,
    id: CaseId,
    outcome: RunResult['perTest'][number]['outcome']
): Promise<void> {
    await reporter.onEvent({
        attempt: 0,
        case: id,
        definitionLocations: [ definitionLocation ],
        artifacts: [],
        kind: 'test-end',
        outcome,
        suitePath: suitePathFromTitles(id.suite),
        verdict: outcome?.kind ?? 'crashed',
        durationMicroseconds: 1
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/reporters/dot-reporter.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter declares raw stdout',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotRuntimeReporter({
                    interactive: false,
                    stdout: terminal.output
                });

                scope.assert.deepEqual(reporter.sinks, [ { kind: 'stdout-raw' } ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter maps outcomes and runner errors to compact marks',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotRuntimeReporter({
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
                                    path: [],
                                    source: 'assert',
                                    sourceLocations: [ definitionLocation ],
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
                        diagnostics: [],
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter wraps progress marks by terminal width',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(2);
                const reporter = createDotRuntimeReporter({
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints summary and short details on finish',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotRuntimeReporter({
                    interactive: false,
                    stdout: terminal.output
                });
                const result = runResultFactory.build({
                    perTest: [
                        { id: passingCaseId, outcome: { kind: 'pass' } },
                        {
                            id: failingCaseId,
                            outcome: {
                                checks: [
                                    {
                                        sourceLocations: [ definitionLocation ],
                                        summary: 'numbers differ'
                                    }
                                ],
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
                    totalWallTimeMicroseconds: 12_000
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
                        `${colors.red(figures.cross)} 3 discovered, 3 planned, 3 executed ` +
                        '(1 pass, 1 fail, 0 skip, 1 inconclusive) in 12 ms ' +
                        '(total 12 ms, execution 0 ms, overhead 12 ms)',
                        'Problems',
                        '  root > fails (source/example.test.ts)',
                        '    numbers differ',
                        '    expected: null',
                        '    actual: null',
                        '  root > maybe (source/example.test.ts)',
                        '    missing signal',
                        '  Runner error: loader failed',
                        '  type: loader',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints assertion failure source locations on finish',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotReporter({
                    interactive: false,
                    stdout: terminal.output
                })({
                    relativizeLocationPath(location) {
                        return location.file === '/workspace/source/users.test.ts'
                            ? 'source/users.test.ts'
                            : location.file;
                    }
                });
                const fileOnlyCaseId: CaseId = { file: null, title: 'file only', params: null, suite: [ 'root' ] };
                const result = runResultFactory.build({
                    perTest: [
                        {
                            id: failingCaseId,
                            outcome: {
                                checks: [
                                    {
                                        sourceLocations: [
                                            {
                                                column: 5,
                                                file: '/workspace/source/users.test.ts',
                                                kind: 'known',
                                                line: 10
                                            }
                                        ],
                                        summary: 'numbers differ'
                                    }
                                ],
                                kind: 'fail'
                            }
                        },
                        {
                            id: fileOnlyCaseId,
                            outcome: {
                                checks: [
                                    {
                                        sourceLocations: [
                                            {
                                                column: null,
                                                file: 'source/profile.test.ts',
                                                kind: 'known',
                                                line: null
                                            }
                                        ],
                                        summary: 'missing field'
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
                    },
                    totalWallTimeMicroseconds: 7000
                });
                const { onFinish } = reporter;

                if (onFinish === null) {
                    throw new TypeError('Expected dot reporter to expose onFinish.');
                }

                await onFinish(result);

                scope.assert.equal(
                    terminal.text(),
                    [
                        `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
                        '(0 pass, 2 fail, 0 skip) in 7 ms ' +
                        '(total 7 ms, execution 0 ms, overhead 7 ms)',
                        'Problems',
                        '  root > fails (source/example.test.ts)',
                        '    numbers differ',
                        '    source: source/users.test.ts:10:5',
                        '    expected: null',
                        '    actual: null',
                        '  root > file only (source/example.test.ts)',
                        '    missing field',
                        '    source: source/profile.test.ts',
                        '    expected: null',
                        '    actual: null',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints body-error and contract failure details',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotRuntimeReporter({
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
                        `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
                        '(0 pass, 2 fail, 0 skip), 1 orphaned in 0 ms ' +
                        '(total 0 ms, execution 0 ms, overhead 0 ms)',
                        'Problems',
                        '  root > throws (source/example.test.ts)',
                        '    Error: boom',
                        '  root > empty (source/example.test.ts)',
                        '    Expected at least one assertion. (no-assertions)',
                        '    expected: at least one assertion',
                        '    actual: 0',
                        `${colors.red(figures.cross)} 2 discovered, 2 planned, 2 executed ` +
                        '(0 pass, 2 fail, 0 skip), 1 orphaned in 0 ms ' +
                        '(total 0 ms, execution 0 ms, overhead 0 ms)',
                        'Problems',
                        '  root > throws (source/example.test.ts)',
                        '    Error: boom',
                        '  root > empty (source/example.test.ts)',
                        '    Expected at least one assertion. (no-assertions)',
                        '    expected: at least one assertion',
                        '    actual: 0',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'dot reporter prints post-finish runner errors below the summary',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const terminal = createFakeTerminal(80);
                const reporter = createDotRuntimeReporter({
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
                        diagnostics: [],
                        message: 'final reporter failed',
                        subtype: 'reporter'
                    },
                    kind: 'runner-error'
                });

                scope.assert.equal(
                    terminal.text(),
                    [
                        `${colors.red(figures.cross)} 0 discovered, 0 planned, 0 executed ` +
                        '(0 pass, 0 fail, 0 skip) in 0 ms (total 0 ms, execution 0 ms, overhead 0 ms)',
                        'Runner error: final reporter failed',
                        ''
                    ]
                        .join('\n')
                );

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
