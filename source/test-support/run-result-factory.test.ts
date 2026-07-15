import assert from 'node:assert/strict';
import { registerTest } from './register-test.ts';
import { runResultFactory } from './run-result-factory.ts';

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
    assert.equal(outcome.checks[0]?.summary, 'custom failure');
    assert.equal(runResult.runnerErrors[0]?.message, 'custom runner error');
});
