import assert from 'node:assert/strict';
import sinon, { type SinonSpy } from 'sinon';
import kleur from 'kleur';
import figures from 'figures';
import { registerTest } from '../test-support/register-test.ts';
import type { RealTimeReporter } from '../engine/reporter.ts';
import { createLineReporter, type LineReporterDependencies } from './line-reporter.ts';

type Overrides = {
    readonly log?: SinonSpy;
};

function lineReporterFactory(overrides: Overrides = {}): RealTimeReporter {
    const { log = sinon.fake() } = overrides;

    const fakeDependencies = { stdoutConsole: { log } } as unknown as LineReporterDependencies;

    return createLineReporter(fakeDependencies);
}

const infoSymbol = kleur.cyan(figures.info);
const successSymbol = kleur.green(figures.tick);
const errorSymbol = kleur.red(figures.cross);

registerTest('reports the start', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });
    const session = reporter.createSession(42);

    await session.start({
        progress: 'pending',
        summary: {
            failedCount: 0,
            successCount: 0,
            totalCount: 123,
            completedCount: 0,
            pendingCount: 0
        },
        testCaseResults: []
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Test run started (0 / 123)' ]);
});

registerTest('prints a line when the test run progresses with a failed test', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });
    const session = reporter.createSession(42);

    await session.progress(
        {
            progress: 'pending',
            summary: {
                failedCount: 0,
                successCount: 0,
                totalCount: 123,
                completedCount: 0,
                pendingCount: 0
            },
            testCaseResults: []
        },
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'bar' },
            result: { status: 'failure', reason: 'the-reason', duration: 100 }
        }
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ `${errorSymbol} foo` ]);
});

registerTest('prints a line when the test run progresses with a succeeded test', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });
    const session = reporter.createSession(42);

    await session.progress(
        {
            progress: 'pending',
            summary: {
                failedCount: 0,
                successCount: 0,
                totalCount: 123,
                completedCount: 0,
                pendingCount: 0
            },
            testCaseResults: []
        },
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'bar' },
            result: { status: 'success', duration: 100 }
        }
    );

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ `${successSymbol} foo` ]);
});

registerTest('prints a three-line summary once the test run finishes', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });
    const session = reporter.createSession(42);

    await session.done({
        progress: 'completed',
        summary: {
            failedCount: 1,
            successCount: 2,
            totalCount: 3,
            completedCount: 3,
            pendingCount: 0
        },
        testCaseResults: []
    });

    assert.strictEqual(log.callCount, 3);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Total: 3' ]);
    assert.deepStrictEqual(log.secondCall.args, [ successSymbol, 'Succeeded: 2' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ errorSymbol, 'Failed: 1' ]);
});
