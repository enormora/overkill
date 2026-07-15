import assert from 'node:assert/strict';
import figures from 'figures';
import kleur from 'kleur';
import sinon, { type SinonSpy } from 'sinon';
import type { RealTimeReporter } from '../engine/reporter.ts';
import type { RunResult } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
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

const runResult: RunResult = {
    artifacts: [],
    bySuite: {},
    orphans: [],
    perTest: [],
    runnerErrors: [],
    summary: { defined: 3, discovered: 3, failed: 1, inconclusive: 0, passed: 2, skipped: 0 },
    wallTimeMs: 10
};

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
        outcome: { checks: [], kind: 'fail', reason: null },
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
        outcome: { checks: [], kind: 'pass', reason: null },
        result: null,
        startedAt: null,
        verdict: 'pass',
        wallTimeMs: 1
    });

    assert.strictEqual(log.callCount, 1);
    assert.deepStrictEqual(log.firstCall.args, [ `${successSymbol} root > passes` ]);
});

registerTest('line reporter prints a three-line summary once the run finishes', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onFinish(runResult);

    assert.strictEqual(log.callCount, 3);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Discovered: 3' ]);
    assert.deepStrictEqual(log.secondCall.args, [ successSymbol, 'Passed: 2' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ errorSymbol, 'Failed: 1' ]);
});
