import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                scope.assert.true(true, { message: 'b' });
                return scope.assert.collect();
            },
            metadata: {},
            title: 'same case'
        })
    ],
    metadata: {},
    title: 'same suite'
});
