import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { column: null, file: '', line: null } ],
    children: [
        createTestCase({
                definitionLocations: [ { column: null, file: '', line: null } ],
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
