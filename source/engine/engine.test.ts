import { suite, test, doubleUsage, rule, testDouble } from '@overkill-dev/test';

import { createDeterministicClock } from '@enormora/clock';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createEngine } from './engine.ts';

import type { ExecutionDriver, ExecuteOptions } from './execution.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import type { RunResult } from './run-result.ts';

export const testNode = suite('Engine planning and execution', [
    test('engine.execute() invokes the injected execute dependency', async function (scope) {
        const expectedResult = runResultFactory.build({ totalWallTimeMicroseconds: 42 });
        const execute = testDouble<ExecutionDriver>({
            fallback: rule.calls(async function executeInjectedPlan(): Promise<RunResult> {
                return expectedResult;
            })
        });
        const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
        const engine = createEngine({
            execute,
            wallClock
        });
        const testPlan = engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body(testScope) {
                            testScope.assert.true(true, { message: 'passes' });
                            return testScope.assert.collect();
                        },
                        annotations: {},
                        controls: {},
                        title: 'passes'
                    })
                ],
                annotations: {},
                controls: {},
                title: 'root'
            })
        );
        const options: ExecuteOptions = {
            debug: { mode: 'off' },
            retryPolicy: null,
            execution: { mode: 'serial-in-process' },
            outputRenderer: createPlainOutputRenderer(),
            reporters: [],
            runFacts: { seed: 1 },
            startedAt: '2026-07-15T00:00:00.000Z'
        };

        const result = await engine.execute(testPlan, options);

        scope.assert.equal(result, expectedResult);
        scope.assert(doubleUsage.calledOnceWithExactly, execute, [ testPlan, options ]);

        return scope.assert.collect();
    })
]);
