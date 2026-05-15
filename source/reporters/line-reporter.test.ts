import { test } from 'uvu';
import * as assert from 'uvu/assert';
import type { SinonSpy } from 'sinon';
import sinon from 'sinon';
import kleur from 'kleur';
import figures from 'figures';
import type { LineReporterDependencies } from './line-reporter.js';
import { createLineReporter } from './line-reporter.js';
import type { RealTimeReporter } from '../engine/reporter.js';

interface Overrides {
    readonly log?: SinonSpy;
}

function lineReporterFactory(overrides: Overrides = {}): RealTimeReporter {
    const { log = sinon.fake() } = overrides;

    const fakeDependencies = { stdoutConsole: { log } } as unknown as LineReporterDependencies;

    return createLineReporter(fakeDependencies);
}

const infoSymbol = kleur.cyan(figures.info);
const successSymbol = kleur.green(figures.tick);
const errorSymbol = kleur.red(figures.cross);

test('reports the start', async () => {
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
            pendingCount: 0,
        },
        testCaseResults: [],
    });

    assert.is(log.callCount, 1);
    assert.equal(log.firstCall.args, [infoSymbol, 'Test run started (0 / 123)']);
});

test('prints a line when the test run progresses with a failed test', async () => {
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
                pendingCount: 0,
            },
            testCaseResults: [],
        },
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'bar' },
            result: { status: 'failure', reason: 'the-reason', duration: 100 },
        },
    );

    assert.is(log.callCount, 1);
    assert.equal(log.firstCall.args, [`${errorSymbol} foo`]);
});

test('prints a line when the test run progresses with a succeeded test', async () => {
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
                pendingCount: 0,
            },
            testCaseResults: [],
        },
        {
            testCaseDetails: { title: 'foo', index: 0, suiteTitle: 'bar' },
            result: { status: 'success', duration: 100 },
        },
    );

    assert.is(log.callCount, 1);
    assert.equal(log.firstCall.args, [`${successSymbol} foo`]);
});

test('prints a three-line summary once the test run finishes', async () => {
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
            pendingCount: 0,
        },
        testCaseResults: [],
    });

    assert.is(log.callCount, 3);
    assert.equal(log.firstCall.args, [infoSymbol, 'Total: 3']);
    assert.equal(log.secondCall.args, [successSymbol, 'Succeeded: 2']);
    assert.equal(log.thirdCall.args, [errorSymbol, 'Failed: 1']);
});

test.run();
