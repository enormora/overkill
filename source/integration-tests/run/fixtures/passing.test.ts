import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                scope.assert.true(true, { message: 'passes' });
                return scope.assert.collect();
            },
            annotations: { tags: [ 'fast' ] },
            controls: {},
            title: 'passes'
        })
    ],
    annotations: {},
    controls: {},
    title: 'fixture'
});
