import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'passes' });
                return scope.assert.collect();
            },
            definitionLocations: [ { column: null, file: '', line: null } ],
            metadata: { kind: 'integration' },
            title: 'wrong family'
        })
    ],
    definitionLocations: [ { column: null, file: '', line: null } ],
    metadata: {},
    title: 'wrong family fixture'
});
