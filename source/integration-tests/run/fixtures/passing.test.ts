import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'passes' });
                return scope.assert.collect();
            },
            metadata: { tags: [ 'fast' ] },
            name: 'passes'
        })
    ],
    metadata: { extra: { file: 'passing' } },
    name: 'fixture'
});
