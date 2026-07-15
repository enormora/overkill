import assert from 'node:assert/strict';
import figures from 'figures';
import kleur from 'kleur';
import sinon, { type SinonSpy } from 'sinon';
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

const errorSymbol = kleur.red(figures.cross);
const infoSymbol = kleur.cyan(figures.info);
const successSymbol = kleur.green(figures.tick);

registerTest('line reporter reports the start event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: null,
        case: null,
        facts: {},
        kind: 'run-start',
        outcome: null,
        result: null,
        startedAt: '2026-07-15T00:00:00.000Z',
        verdict: null,
        wallTimeMs: null
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Test run started' ]);
});

registerTest('line reporter prints a failed test-end event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: 'root > fails',
        facts: null,
        kind: 'test-end',
        outcome: { checks: [], kind: 'fail' },
        result: null,
        startedAt: null,
        verdict: 'fail',
        wallTimeMs: 1
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ `${errorSymbol} root > fails` ]);
});

registerTest('line reporter prints a passed test-end event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: 'root > passes',
        facts: null,
        kind: 'test-end',
        outcome: { kind: 'pass' },
        result: null,
        startedAt: null,
        verdict: 'pass',
        wallTimeMs: 1
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ `${successSymbol} root > passes` ]);
});

registerTest('line reporter prints neutral test-end events for skip and inconclusive outcomes', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: 'root > skips',
        facts: null,
        kind: 'test-end',
        outcome: { kind: 'skip', reason: 'not supported' },
        result: null,
        startedAt: null,
        verdict: 'skip',
        wallTimeMs: 1
    });
    await reporter.onEvent({
        attempt: 1,
        case: 'root > inconclusive',
        facts: null,
        kind: 'test-end',
        outcome: { kind: 'inconclusive', reason: 'missing signal' },
        result: null,
        startedAt: null,
        verdict: 'inconclusive',
        wallTimeMs: 1
    });

    assert.strictEqual(log.callCount, 2);
    assert.deepStrictEqual(log.firstCall.args, [ `${infoSymbol} root > skips` ]);
    assert.deepStrictEqual(log.secondCall.args, [ `${infoSymbol} root > inconclusive` ]);
});

registerTest('line reporter prints a three-line summary once the run finishes', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    const runResult: RunResult = runResultFactory.build({
        summary: {
            defined: 3,
            discovered: 3,
            failed: 1,
            inconclusive: 0,
            passed: 2,
            skipped: 0
        },
        wallTimeMs: 10
    });

    await reporter.onFinish(runResult);

    assert.strictEqual(log.callCount, 3);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Discovered: 3' ]);
    assert.deepStrictEqual(log.secondCall.args, [ successSymbol, 'Passed: 2' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ errorSymbol, 'Failed: 1' ]);
});
