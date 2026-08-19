import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'passes' });
                return scope.assert.collect();
            },
            metadata: { tag: 'fast' },
            name: 'passes'
        })
    ],
    metadata: { file: 'passing' },
    name: 'fixture'
});
