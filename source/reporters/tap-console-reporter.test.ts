import { test } from 'uvu';
import * as assert from 'uvu/assert';
import type { SinonSpy } from 'sinon';
import sinon from 'sinon';
import type { FinalResultReporter } from '../engine/reporter.js';
import type { TapConsoleReporterDependencies } from './tap-console-reporter.js';
import { createTapConsoleReporter } from './tap-console-reporter.js';

type Overrides = {
    readonly log?: SinonSpy;
};

function tapConsoleReporterFactory(overrides: Overrides = {}): FinalResultReporter {
    const { log = sinon.fake() } = overrides;

    const fakeDependencies = { stdoutConsole: { log } } as unknown as TapConsoleReporterDependencies;

    return createTapConsoleReporter(fakeDependencies);
}

test('reports the final result without any test cases formatted as TAP', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });
    const session = reporter.createSession(42);

    await session.report({
        progress: 'completed',
        summary: {
            failedCount: 0,
            successCount: 0,
            totalCount: 0,
            completedCount: 0,
            pendingCount: 0
        },
        testCaseResults: []
    });

    assert.is(log.callCount, 1);
    assert.equal(log.firstCall.args, [ 'TAP version 14\n1..0\n\n' ]);
});

test('reports the final result with succeeded and failed test cases formatted as TAP', async function () {
    const log = sinon.fake();
    const reporter = tapConsoleReporterFactory({ log });
    const session = reporter.createSession(42);

    await session.report({
        progress: 'completed',
        summary: {
            failedCount: 1,
            successCount: 1,
            totalCount: 2,
            completedCount: 2,
            pendingCount: 0
        },
        testCaseResults: [
            {
                testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'the-suite' },
                result: { status: 'success', duration: 10 }
            },
            {
                testCaseDetails: { title: 'bar', index: 1, suiteTitle: 'the-suite' },
                result: { status: 'failure', reason: 'the-reason', duration: 20 }
            }
        ]
    });

    assert.is(log.callCount, 1);
    assert.equal(log.firstCall.args, [
        'TAP version 14\n1..2\nok 1 - foo\nnot ok 2 - bar\n  ---\n  reason: the-reason\n  ...\n'
    ]);
});

test.run();
