import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createNullReporter } from './null-reporter.ts';

registerTest('null reporter accepts a final result without producing output', async function () {
    const reporter = createNullReporter();

    assert.equal(reporter.kind, 'final-result');
    assert.equal(reporter.name, 'null');
    assert.deepStrictEqual(reporter.sinks, []);

    await reporter.onResult(runResultFactory.build());
});
