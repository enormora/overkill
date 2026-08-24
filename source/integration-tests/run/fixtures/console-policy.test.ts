import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                console.log('capability policy console output');

                return scope.assert.collect();
            },
            metadata: {},
            name: 'writes console output'
        })
    ],
    metadata: {},
    name: 'fixture'
});
