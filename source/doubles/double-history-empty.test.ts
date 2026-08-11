import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { testDouble } from './test-double.ts';

export const testSuite = createOverkillSuite({
    name: 'source/doubles/double-history-empty.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'empty history boundary accessors return null snapshots',
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
            name: 'invalid history indexes return null snapshots',
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
