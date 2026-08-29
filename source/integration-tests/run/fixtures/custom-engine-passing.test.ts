import { createTestCase } from './custom-engine.ts';

export const testNode = createTestCase({
    body(scope) {
        scope.assert.true(true, { message: 'custom engine pass' });

        return scope.assert.collect();
    },
    metadata: { extra: { engine: 'custom' } },
    name: 'custom engine passes'
});
