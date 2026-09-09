import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

const environment: unknown = Reflect.get(process, 'env');

if (typeof environment === 'object' && environment !== null) {
    Reflect.set(environment, 'OVERKILL_LOAD_POLICY_FIXTURE', 'changed');
}

export const testNode = createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
    body(scope) {
        scope.assert.true(true);

        return scope.assert.collect();
    },
    annotations: {},
    controls: {},
    title: 'mutates env while loading'
});
