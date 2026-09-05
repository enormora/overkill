import { createSuite, createTestCase } from '../../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'slow' });
                return scope.assert.collect();
            },
            metadata: {},
            title: 'slow passes'
        })
    ],
    metadata: {},
    title: 'discovery'
});
