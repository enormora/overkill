import {
    createSuite,
    createTestCase
} from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
    children: [
        createTestCase({
            body(scope) {
                scope.assert.true(true);

                return scope.assert.collect();
            },
            definitionLocations: [ { kind: 'unknown' as const } ],
            annotations: {},
            controls: {},
            title: 'passes'
        })
    ],
    definitionLocations: [ { kind: 'unknown' as const } ],
    annotations: {},
    controls: { capture: 'live' },
    title: 'fixture'
});
