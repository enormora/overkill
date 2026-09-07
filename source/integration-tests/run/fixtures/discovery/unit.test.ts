import { createSuite, createTestCase } from '../../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { column: null, file: '', line: null } ],
    children: [
        createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
            body(scope) {
                scope.assert.true(true, { message: 'unit' });
                return scope.assert.collect();
            },
            metadata: {},
            title: 'unit passes'
        })
    ],
    metadata: {},
    title: 'discovery'
});
