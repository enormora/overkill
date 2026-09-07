import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { column: null, file: '', line: null } ],
    children: [
        createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
            body(scope) {
                process.exit(0);

                return scope.assert.collect();
            },
            metadata: {},
            title: 'exits process'
        })
    ],
    metadata: {},
    title: 'fixture'
});
