import { createTestCase } from './custom-engine.ts';

export const testNode = createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
    body(scope) {
        scope.assert.true(true, { message: 'custom engine pass' });

        return scope.assert.collect();
    },
annotations: {},
controls: {},
    title: 'custom engine passes'
});
