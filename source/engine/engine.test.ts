import { createDeterministicWallClock } from '@enormora/wall-clock';
import { doubleUsage, rule, testDouble } from '@overkill-dev/doubles';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { createEngine } from './engine.ts';
import type { Execute, ExecuteOptions } from './execution.ts';
import { createPlainOutputRenderer } from './reporter-output.ts';
import type { RunResult } from './run-result.ts';

export const testSuite = createOverkillSuite({
    name: 'source/engine/engine.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'engine.execute() invokes the injected execute dependency',
            metadata: {},
            async body(scope: OverkillScope) {
                const expectedResult = runResultFactory.build({ wallTimeMs: 42 });
                const execute = testDouble<Execute>({
                    fallback: rule.calls(async function executeInjectedPlan(): Promise<RunResult> {
                        return expectedResult;
                    })
                });
                const wallClock = createDeterministicWallClock();
                const engine = createEngine({
                    execute,
                    nodeVersion: '26.0.0',
                    readExitCode() {
                        return undefined;
                    },
                    wallClock,
                    writeExitCode() {
                        return undefined;
                    }
                });
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true, { message: 'passes' });
                                    return testScope.assert.collect();
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
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
