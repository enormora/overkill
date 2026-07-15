import assert from 'node:assert/strict';
import sinon, { type SinonSpy } from 'sinon';
import type { FinalResultReporter } from '../engine/reporter.ts';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createTapConsoleReporter, type TapConsoleReporterDependencies } from './tap-console-reporter.ts';

type Overrides = {
    readonly log?: SinonSpy;
};

function tapConsoleReporterFactory(overrides: Overrides = {}): FinalResultReporter {
    const { log = sinon.fake() } = overrides;
    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleReporter(fakeDependencies);
}

registerTest('reports the final result without any test cases formatted as TAP', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });

    await reporter.onResult(
        runResultFactory.build({
            perTest: [],
            summary: { defined: 0, discovered: 0, failed: 0, inconclusive: 0, passed: 0, skipped: 0 }
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
                    id: 'root > bar',
                    outcome: {
                        checks: [ { summary: 'the-reason' } ],
                        kind: 'fail'
                    },
                    verdict: 'fail'
                },
                {
                    id: 'root > foo',
                    verdict: 'pass'
                }
            ],
            summary: { defined: 2, discovered: 2, failed: 1, inconclusive: 0, passed: 1, skipped: 0 }
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
                    id: 'root > fails',
                    outcome: {
                        checks: [],
                        kind: 'fail'
                    },
                    verdict: 'fail'
                }
            ],
            summary: { defined: 1, discovered: 1, failed: 1, inconclusive: 0, passed: 0, skipped: 0 }
        })
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [
        'TAP version 14\n1..1\nnot ok 1 - root > fails\n  ---\n  reason: failed\n  ...\n'
    ]);
});
