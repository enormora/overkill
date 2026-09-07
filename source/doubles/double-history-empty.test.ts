import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { testDouble } from './test-double.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/doubles/double-history-empty.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'empty history boundary accessors return null snapshots',
            metadata: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.returns('value');

                scope.assert.equal(loadValue.firstCall, null);
                scope.assert.equal(loadValue.firstConstruction, null);
                scope.assert.equal(loadValue.firstInteraction, null);
                scope.assert.equal(loadValue.firstResult, null);
                scope.assert.equal(loadValue.lastCall, null);
                scope.assert.equal(loadValue.lastConstruction, null);
                scope.assert.equal(loadValue.lastInteraction, null);
                scope.assert.equal(loadValue.lastResult, null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { column: null, file: '', line: null } ],
            title: 'invalid history indexes return null snapshots',
            metadata: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.returns('value');

                scope.assert.equal(loadValue.nthCall(-1), null);
                scope.assert.equal(loadValue.nthCall(0.5), null);
                scope.assert.equal(loadValue.nthConstruction(-1), null);
                scope.assert.equal(loadValue.nthConstruction(0.5), null);
                scope.assert.equal(loadValue.nthInteraction(-1), null);
                scope.assert.equal(loadValue.nthInteraction(0.5), null);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
