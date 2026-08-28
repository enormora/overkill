import { createSuite, createTestCase } from '../../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'integration' });
                return scope.assert.collect();
            },
            metadata: {},
            name: 'integration passes'
        })
    ],
    metadata: {},
    name: 'discovery'
});
