import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

process.env.OVERKILL_LOAD_POLICY_FIXTURE = 'changed';

export const testNode = createTestCase({
    body(scope) {
        scope.assert.true(true);

        return scope.assert.collect();
    },
    metadata: {},
    name: 'mutates env while loading'
});
