import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createTestCase({
    title: 'waits for abort',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    async body(scope) {
        while (!scope.signal.aborted) {
            await scope.yieldToNextTurn();
        }
        scope.assert.true(scope.signal.aborted);
        return scope.assert.collect();
    }
});
