import assert from 'node:assert/strict';
import { registerTest } from './register-test.ts';
import { runResultFactory } from './run-result-factory.ts';

function defaultFailure(): unknown {
    return {
        actual: null,
        expected: null,
        id: 'check',
        location: {
            column: null,
            file: 'source/example.test.ts',
            line: null
        },
        path: [],
        summary: 'Check failed'
    };
}

registerTest('runResultFactory builds nested result data', function () {
    const runResult = runResultFactory.build({
        orphans: [ {} ],
        perTest: [
            {
                outcome: {
                    checks: [ { summary: 'custom failure' } ],
                    kind: 'fail'
                },
                verdict: 'fail'
            }
        ],
        runnerErrors: [ { message: 'custom runner error' } ]
    });

    assert.equal(runResult.orphans[0]?.name, 'orphaned test');
    const outcome = runResult.perTest[0]?.outcome;
    assert.equal(outcome?.kind, 'fail');
    const failure = outcome.failures[0];
    assert.equal(failure.kind, 'assertion');
    assert.equal(failure.checks[0].summary, 'custom failure');
    assert.equal(runResult.runnerErrors[0]?.message, 'custom runner error');
});

registerTest('runResultFactory builds non-failing outcome variants', function () {
    const runResult = runResultFactory.build({
        perTest: [
            { outcome: { kind: 'pass' } },
            { outcome: { kind: 'skip' } },
            { outcome: { kind: 'inconclusive' } }
        ]
    });

    assert.deepStrictEqual(
        runResult.perTest.map(function toOutcome(testResult) {
            return testResult.outcome;
        }),
        [
            { kind: 'pass' },
            { kind: 'skip', reason: 'Skipped' },
            { kind: 'inconclusive', reason: 'Inconclusive' }
        ]
    );
});

registerTest('runResultFactory builds default and empty failure fallbacks', function () {
    const runResult = runResultFactory.build({
        perTest: [
            { outcome: { kind: 'fail' } },
            { outcome: { failures: [], kind: 'fail' } },
            { outcome: { checks: [], kind: 'fail' } }
        ]
    });

    assert.deepStrictEqual(
        runResult.perTest.map(function toOutcome(testResult) {
            return testResult.outcome;
        }),
        [
            {
                failures: [ { checks: [ defaultFailure() ], kind: 'assertion' } ],
                kind: 'fail'
            },
            {
                failures: [ { checks: [ defaultFailure() ], kind: 'assertion' } ],
                kind: 'fail'
            },
            {
                failures: [ { checks: [ defaultFailure() ], kind: 'assertion' } ],
                kind: 'fail'
            }
        ]
    );
});

registerTest('runResultFactory builds body-error and default contract failures', function () {
    const runResult = runResultFactory.build({
        perTest: [
            { outcome: { failures: [ { kind: 'body-error' } ], kind: 'fail' } },
            { outcome: { failures: [ { kind: 'test-contract' } ], kind: 'fail' } }
        ]
    });

    assert.equal(runResult.perTest[0]?.outcome.kind, 'fail');
    assert.equal(runResult.perTest[1]?.outcome.kind, 'fail');
});
