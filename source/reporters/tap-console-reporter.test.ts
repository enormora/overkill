import assert from 'node:assert/strict';
import sinon, { type SinonSpy } from 'sinon';
import type { CaseId } from '../engine/identity.ts';
import type { FinalResultReporter, RealTimeReporter } from '../engine/reporter.ts';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    createTapConsoleRealTimeReporter,
    createTapConsoleReporter,
    type TapConsoleReporterDependencies
} from './tap-console-reporter.ts';

type Overrides = {
    readonly log?: SinonSpy;
};

function tapConsoleReporterFactory(overrides: Overrides = {}): FinalResultReporter {
    const { log = sinon.fake() } = overrides;
    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleReporter(fakeDependencies);
}

function tapConsoleRealTimeReporterFactory(overrides: Overrides = {}): RealTimeReporter {
    const { log = sinon.fake() } = overrides;
    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleRealTimeReporter(fakeDependencies);
}

const failingCaseId: CaseId = { file: null, name: 'bar', params: null, suite: [ 'root' ] };
const passingCaseId: CaseId = { file: null, name: 'foo', params: null, suite: [ 'root' ] };
const fallbackCaseId: CaseId = { file: null, name: 'fails', params: null, suite: [ 'root' ] };
const inconclusiveCaseId: CaseId = { file: null, name: 'unknown', params: null, suite: [ 'root' ] };
const skippedCaseId: CaseId = { file: null, name: 'skip me', params: null, suite: [ 'root' ] };

async function reportRealTimeTapRun(reporter: RealTimeReporter): Promise<void> {
    await reporter.onEvent({ facts: {}, kind: 'run-start', startedAt: '2026-07-15T00:00:00.000Z' });
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
            checks: [
                {
                    actual: 1,
                    expected: 2,
                    id: '1',
                    location: { column: null, file: '', line: null },
                    path: [],
                    summary: 'the-reason'
                }
            ],
            kind: 'fail'
        },
        verdict: 'fail',
        wallTimeMs: 1
    });
    await reporter.onEvent({ kind: 'run-end', result: runResultFactory.build({ summary: { planned: 2 } }) });
}

registerTest('reports the final result without any test cases formatted as TAP', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });

    await reporter.onResult(
        runResultFactory.build({
            perTest: [],
            summary: { defined: 0, discovered: 0, failed: 0, inconclusive: 0, passed: 0, planned: 0, skipped: 0 }
        })
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ 'TAP version 14\n1..0\n\n' ]);
});

registerTest('reports the final result with passed and failed test cases formatted as TAP', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });

    await reporter.onResult(
        runResultFactory.build({
            perTest: [
                {
                    id: failingCaseId,
                    outcome: {
                        checks: [ { summary: 'the-reason' } ],
                        kind: 'fail'
                    },
                    verdict: 'fail'
                },
                {
                    id: passingCaseId,
                    verdict: 'pass'
                }
            ],
            summary: { defined: 2, discovered: 4, failed: 1, inconclusive: 0, passed: 1, planned: 2, skipped: 0 }
        })
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [
        'TAP version 14\n1..2\nnot ok 1 - root > bar\n  ---\n  reason: the-reason\n  ...\nok 2 - root > foo\n'
    ]);
});

registerTest('reports a failed TAP test point with a fallback diagnostic reason', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });

    await reporter.onResult(
        runResultFactory.build({
            perTest: [
                {
                    id: fallbackCaseId,
                    outcome: {
                        checks: [],
                        kind: 'fail'
                    },
                    verdict: 'fail'
                }
            ],
            summary: { defined: 1, discovered: 1, failed: 1, inconclusive: 0, passed: 0, planned: 1, skipped: 0 }
        })
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [
        'TAP version 14\n1..1\nnot ok 1 - root > fails\n  ---\n  reason: failed\n  ...\n'
    ]);
});

registerTest('reports skip and inconclusive outcomes as TAP directives and diagnostics', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });

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
            summary: { defined: 2, discovered: 2, failed: 0, inconclusive: 1, passed: 0, planned: 2, skipped: 1 }
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

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ expectedOutput ]);
});

registerTest('real-time TAP reporter streams test points before the final plan', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleRealTimeReporterFactory({ log });

    await reportRealTimeTapRun(reporter);

    assert.strictEqual(log.callCount, 4);
    assert.deepStrictEqual(log.firstCall.args, [ 'TAP version 14' ]);
    assert.deepStrictEqual(log.secondCall.args, [ 'ok 1 - root > foo' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ 'not ok 2 - root > bar\n  ---\n  reason: the-reason\n  ...' ]);
    assert.deepStrictEqual(log.getCall(3).args, [ '1..2' ]);
});

registerTest('real-time TAP reporter writes runner errors as comments', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleRealTimeReporterFactory({ log });

    await reporter.onEvent({
        error: {
            attributedTo: null,
            cause: new Error('reporter broke'),
            message: 'line: reporter broke',
            subtype: 'reporter'
        },
        kind: 'runner-error'
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ '# runner error: line: reporter broke' ]);
});
