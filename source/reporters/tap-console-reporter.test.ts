import assert from 'node:assert/strict';
import sinon, { type SinonSpy } from 'sinon';
import type { FinalResultReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
import { createTapConsoleReporter, type TapConsoleReporterDependencies } from './tap-console-reporter.ts';

type Overrides = {
    readonly log?: SinonSpy;
};

function tapConsoleReporterFactory(overrides: Overrides = {}): FinalResultReporter {
    const { log = sinon.fake() } = overrides;
    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleReporter(fakeDependencies);
}

function createRunResult(overrides: Pick<RunResult, 'perTest' | 'summary'>): RunResult {
    return {
        artifacts: [],
        bySuite: {},
        orphans: [],
        perTest: overrides.perTest,
        runnerErrors: [],
        summary: overrides.summary,
        wallTimeMs: 0
    };
}

registerTest('reports the final result without any test cases formatted as TAP', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });

    await reporter.onResult(
        createRunResult({
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
        createRunResult({
            perTest: [
                { id: 'root > foo', outcome: { checks: [], kind: 'pass', reason: null }, verdict: 'pass' },
                {
                    id: 'root > bar',
                    outcome: {
                        checks: [
                            {
                                actual: 2,
                                expected: 1,
                                id: '1',
                                location: { column: null, file: '', line: null },
                                path: [],
                                summary: 'the-reason'
                            }
                        ],
                        kind: 'fail',
                        reason: null
                    },
                    verdict: 'fail'
                }
            ],
            summary: { defined: 2, discovered: 2, failed: 1, inconclusive: 0, passed: 1, skipped: 0 }
        })
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [
        'TAP version 14\n1..2\nok 1 - root > foo\nnot ok 2 - root > bar\n  ---\n  reason: the-reason\n  ...\n'
    ]);
});
