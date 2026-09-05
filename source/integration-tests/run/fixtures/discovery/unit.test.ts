import { createSuite, createTestCase } from '../../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
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
