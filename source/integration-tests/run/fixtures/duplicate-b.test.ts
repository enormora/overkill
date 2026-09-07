import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { column: null, file: '', line: null } ],
    children: [
        createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
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
