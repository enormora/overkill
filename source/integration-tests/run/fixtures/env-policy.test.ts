import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                process.env.OVERKILL_CASE_POLICY_FIXTURE = 'changed';

                return scope.assert.collect();
            },
            annotations: {},
            controls: {},
            title: 'mutates env'
        })
    ],
    annotations: {},
    controls: {},
    title: 'fixture'
});
