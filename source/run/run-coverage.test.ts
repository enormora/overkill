import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { coverageExecutionCompleted } from './run-coverage.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-coverage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'coverageExecutionCompleted() rejects interrupted runs',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.true(coverageExecutionCompleted(runResultFactory.build()));
                scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
                    summary: { crashed: 1 }
                })));
                scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
                    summary: { resourceExhausted: 1 }
                })));
                scope.assert.false(coverageExecutionCompleted(runResultFactory.build({
                    runnerErrors: [ { subtype: 'crash' } ]
                })));
                scope.assert.true(coverageExecutionCompleted(runResultFactory.build({
                    runnerErrors: [ { subtype: 'runtime-state' } ]
                })));

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
