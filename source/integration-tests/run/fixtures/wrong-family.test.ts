import {
    createSuite,
    createTestCase,
    stampTestNodeFamily
} from '../../../packages/engine/engine.entry-point.ts';

const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true, { message: 'passes' });
                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' } ],
            annotations: {},
            controls: {},
            title: 'wrong family'
        })
    ],
    definitionLocations: [ { kind: 'unknown' } ],
    annotations: {},
    controls: {},
    title: 'wrong family fixture'
});

stampTestNodeFamily(testNode, 'integration');

export { testNode };
