import assert from 'node:assert/strict';
import figures from 'figures';
import kleur from 'kleur';
import sinon, { type SinonSpy } from 'sinon';
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

const errorSymbol = kleur.red(figures.cross);
const infoSymbol = kleur.cyan(figures.info);
const successSymbol = kleur.green(figures.tick);
const failingCaseId: CaseId = { file: null, name: 'fails', params: null, suite: [ 'root' ] };
const passingCaseId: CaseId = { file: null, name: 'passes', params: null, suite: [ 'root' ] };
const skippedCaseId: CaseId = { file: null, name: 'skips', params: null, suite: [ 'root' ] };
const inconclusiveCaseId: CaseId = { file: null, name: 'inconclusive', params: null, suite: [ 'root' ] };

function assertSummaryLog(log: SinonSpy): void {
    assert.strictEqual(log.callCount, 7);
    assert.deepStrictEqual(log.firstCall.args, [ infoSymbol, 'Discovered: 3' ]);
    assert.deepStrictEqual(log.secondCall.args, [ infoSymbol, 'Planned: 3' ]);
    assert.deepStrictEqual(log.thirdCall.args, [ infoSymbol, 'Executed: 0' ]);
    assert.deepStrictEqual(log.getCall(3).args, [ successSymbol, 'Passed: 2' ]);
    assert.deepStrictEqual(log.getCall(4).args, [ errorSymbol, 'Failed: 1' ]);
    assert.deepStrictEqual(log.getCall(5).args, [ infoSymbol, 'Skipped: 0' ]);
    assert.deepStrictEqual(log.getCall(6).args, [ infoSymbol, 'Inconclusive: 0' ]);
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

registerTest('line reporter prints a failed test-end event', async function () {
    const log = sinon.fake();
    const reporter = lineReporterFactory({ log });

    await reporter.onEvent({
        attempt: 0,
        case: failingCaseId,
        kind: 'test-end',
        outcome: { checks: [], kind: 'fail' },
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
        case: passingCaseId,
        kind: 'test-end',
        outcome: { kind: 'pass' },
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
        case: skippedCaseId,
        kind: 'test-end',
        outcome: { kind: 'skip', reason: 'not supported' },
        verdict: 'skip',
        wallTimeMs: 1
    });
    await reporter.onEvent({
        attempt: 1,
        case: inconclusiveCaseId,
        kind: 'test-end',
        outcome: { kind: 'inconclusive', reason: 'missing signal' },
        verdict: 'inconclusive',
        wallTimeMs: 1
    });

    assert.strictEqual(log.callCount, 2);
    assert.deepStrictEqual(log.firstCall.args, [ `${infoSymbol} root > skips` ]);
    assert.deepStrictEqual(log.secondCall.args, [ `${infoSymbol} root > inconclusive` ]);
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

    assert.strictEqual(log.callCount, 9);
    assert.deepStrictEqual(log.getCall(7).args, [ infoSymbol, 'Orphans: 1' ]);
    assert.deepStrictEqual(log.getCall(8).args, [ infoSymbol, 'test: unused (<unknown>)' ]);
});
