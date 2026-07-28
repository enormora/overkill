import assert from 'node:assert/strict';
import figures from 'figures';
import sinon, { type SinonSpy } from 'sinon';
import colors from 'yoctocolors';
import type { CaseId } from '../engine/identity.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type Overrides = {
    readonly log?: SinonSpy;
};

function lineReporterFactory(overrides: Overrides = {}): RealTimeReporter {
    const { log = sinon.fake() } = overrides;
    const fakeDependencies = { stdoutConsole: { log } } as unknown as LineReporterDependencies;

    return createLineReporter(fakeDependencies);
}

const errorSymbol = colors.red(figures.cross);
const infoSymbol = colors.cyan(figures.info);
const successSymbol = colors.green(figures.tick);
const failingCaseId: CaseId = { file: null, name: 'fails', params: null, suite: [ 'root' ] };
const passingCaseId: CaseId = { file: null, name: 'passes', params: null, suite: [ 'root' ] };
const skippedCaseId: CaseId = { file: null, name: 'skips', params: null, suite: [ 'root' ] };
const inconclusiveCaseId: CaseId = { file: null, name: 'inconclusive', params: null, suite: [ 'root' ] };

function assertSummaryLog(log: SinonSpy): void {
    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [
        infoSymbol,
        '3 discovered, 3 planned, 3 executed (2 pass, 1 fail, 0 skip) in 10 ms'
    ]);
}

async function reportNestedSuiteRun(reporter: RealTimeReporter): Promise<void> {
    await reporter.onEvent({ kind: 'suite-start', suitePath: [ 'root' ] });
    await reporter.onEvent({ kind: 'suite-start', suitePath: [ 'root', 'rows' ] });
    await reporter.onEvent({
        attempt: 0,
        case: { file: null, name: 'row 1', params: 'value=1', suite: [ 'root', 'rows' ] },
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 7
    });
    await reporter.onEvent({ kind: 'suite-end', suitePath: [ 'root', 'rows' ] });
    await reporter.onEvent({
        attempt: 0,
        case: passingCaseId,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 2
    });
    await reporter.onEvent({ kind: 'suite-end', suitePath: [ 'root' ] });
}

registerTest('line reporter reports the start event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        facts: {},
        kind: 'run-start',
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Test run started' ]);
});

registerTest('line reporter prints assertion failure details for a failed test-end event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: failingCaseId,
        kind: 'test-end',
        outcome: {
            failures: [
                {
                    checks: [
                        {
                            actual: 1,
                            expected: 2,
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

    assert.strictEqual(log.callCount, 4);
    assert.deepStrictEqual(log.firstCall.args, [ errorSymbol, 'fails (12 ms)' ]);
    assert.deepStrictEqual(log.secondCall.args, [ '  numbers differ' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ '  expected: 2' ]);
    assert.deepStrictEqual(log.getCall(3).args, [ '  actual: 1' ]);
});

registerTest('line reporter prints unicode string mismatch hints', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });
    const composedName = 'Ad\u{00E4}le';
    const decomposedName = 'Ada\u{0308}le';

    await reporter.onEvent({
        attempt: 0,
        case: failingCaseId,
        kind: 'test-end',
        outcome: {
            failures: [
                {
                    checks: [
                        {
                            actual: decomposedName,
                            expected: composedName,
                            id: '1',
                            kind: 'leaf',
                            location: { column: 5, file: 'source/users.test.ts', line: 10 },
                            path: [ 'name' ],
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

    assert.deepStrictEqual(log.firstCall.args, [ errorSymbol, 'fails (12 ms)' ]);
    assert.deepStrictEqual(log.secondCall.args, [ '  names differ' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ '  path: .name' ]);
    assert.deepStrictEqual(log.getCall(3).args, [ '  location: source/users.test.ts:10:5' ]);
    assert.deepStrictEqual(log.getCall(5).args, [ '  note: strings are equal after canonical Unicode normalization' ]);
});

registerTest('line reporter prints body error failures with a dimmed stack', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

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

    assert.deepStrictEqual(log.firstCall.args, [ errorSymbol, 'fails (12 ms)' ]);
    assert.deepStrictEqual(log.secondCall.args, [ '  Error: boom' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ `  ${colors.dim('Error: boom')}` ]);
});

registerTest('line reporter prints test-contract failures', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

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

    assert.deepStrictEqual(log.firstCall.args, [ errorSymbol, 'fails (12 ms)' ]);
    assert.deepStrictEqual(log.secondCall.args, [ '  Expected at least one assertion. (no-assertions)' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ '  expected: at least one assertion' ]);
    assert.deepStrictEqual(log.getCall(3).args, [ '  actual: 0' ]);
});

registerTest('line reporter prints object identity hints', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: failingCaseId,
        kind: 'test-end',
        outcome: {
            failures: [
                {
                    checks: [
                        {
                            actual: { id: 1, name: 'Grace' },
                            expected: { id: 1, name: 'Ada' },
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

    assert.deepStrictEqual(log.getCall(2).args, [ '  reference differs; shallow differences: changed name' ]);
});

registerTest('line reporter prints a passed test-end event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: passingCaseId,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        verdict: 'pass',
        wallTimeMs: 3
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ successSymbol, 'passes (3 ms)' ]);
});

registerTest('line reporter prints neutral test-end events with outcome reasons', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

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

    assert.strictEqual(log.callCount, 2);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'skips: not supported (4 ms)' ]);
    assert.deepStrictEqual(log.secondCall.args, [ infoSymbol, 'inconclusive: missing signal (5 ms)' ]);
});

registerTest('line reporter prints nested suites and indents test results', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reportNestedSuiteRun(reporter);

    assert.strictEqual(log.callCount, 4);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'root' ]);
    assert.deepStrictEqual(log.secondCall.args, [ infoSymbol, '  rows' ]);
    assert.deepStrictEqual(log.getCall(2).args, [ successSymbol, '    row 1 [value=1] (7 ms)' ]);
    assert.deepStrictEqual(log.getCall(3).args, [ successSymbol, '  passes (2 ms)' ]);
});

registerTest('line reporter prints runner errors', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        error: {
            attributedTo: null,
            cause: new Error('cannot render'),
            message: 'line: cannot render',
            subtype: 'reporter'
        },
        kind: 'runner-error'
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ errorSymbol, 'Runner error: line: cannot render' ]);
});

registerTest('line reporter prints the run count summary once the run finishes', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

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

    assertSummaryLog(log);
});

registerTest('line reporter prints nonzero inconclusive and crash counts in the run summary', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    const runResult: RunResult = runResultFactory.build({
        runnerErrors: [ { subtype: 'crash' } ],
        summary: {
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

    assert.deepStrictEqual(log.firstCall.args, [
        infoSymbol,
        '4 discovered, 4 planned, 5 executed (1 pass, 1 fail, 1 skip, 1 inconclusive, 1 crash) in 15 ms'
    ]);
});

registerTest('line reporter prints orphan details once the run finishes', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    const runResult: RunResult = runResultFactory.build({
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
    });
    const { onFinish } = reporter;

    if (onFinish === null) {
        throw new TypeError('Expected line reporter to expose onFinish.');
    }

    await onFinish(runResult);

    assert.strictEqual(log.callCount, 2);
    assert.deepStrictEqual(log.firstCall.args, [
        infoSymbol,
        '0 discovered, 0 planned, 0 executed (0 pass, 0 fail, 0 skip), 1 orphaned in 0 ms'
    ]);
    assert.deepStrictEqual(log.secondCall.args, [ infoSymbol, 'test: unused (<unknown>)' ]);
});
