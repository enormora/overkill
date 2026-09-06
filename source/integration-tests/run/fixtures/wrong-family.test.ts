import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'passes' });
                return scope.assert.collect();
            },
            metadata: { kind: 'integration' },
            title: 'wrong family'
        })
    ],
    metadata: {},
    title: 'wrong family fixture'
});
