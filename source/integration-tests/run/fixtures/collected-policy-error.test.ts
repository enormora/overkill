import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createTestCase({
    annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ], title: 'uncollected',
    body(scope) {
        scope.assert.equal(1, 1);
        return scope.assert.collect();
    }
});

console.log('collection policy violation before import failure');
throw new Error('fixture collection failed');
