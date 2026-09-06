import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                process.env.OVERKILL_CASE_POLICY_FIXTURE = 'changed';

                return scope.assert.collect();
            },
            metadata: {},
            title: 'mutates env'
        })
    ],
    metadata: {},
    title: 'fixture'
});
