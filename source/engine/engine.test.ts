import assert from 'node:assert/strict';
import sinon from 'sinon';
import { registerTest } from '../test-support/register-test.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createEngine } from './engine.ts';
import type { Execute, ExecuteOptions } from './execution.ts';
import type { RunResult } from './run-result.ts';

registerTest('engine.execute() invokes the injected execute dependency', async function () {
    const expectedResult = runResultFactory.build({ wallTimeMs: 42 });
    const execute = sinon.fake<Parameters<Execute>, ReturnType<Execute>>(
        async function executeInjectedPlan(): Promise<RunResult> {
            return expectedResult;
        }
    );
    const engine = createEngine({ execute });
    const testPlan = engine.createTestPlan(
        engine.createSuite({
            children: [
                engine.createTestCase({
                    body(testContext) {
                        testContext.assert.true(true, { message: 'passes' });
                        return testContext.assert.done();
                    },
                    metadata: {},
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );
    const options: ExecuteOptions = {
        reporters: [],
        runFacts: { seed: 1 },
        startedAt: '2026-07-15T00:00:00.000Z'
    };

    const result = await engine.execute(testPlan, options);

    assert.equal(result, expectedResult);
    assert.equal(execute.callCount, 1);
    assert.deepStrictEqual(execute.firstCall.args, [ testPlan, options ]);
});
