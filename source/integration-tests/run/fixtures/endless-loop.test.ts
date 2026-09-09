import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
    body(scope) {
        while (Date.now() >= 0) {
            if (process.pid < 0) {
                break;
            }
        }

        return scope.assert.collect();
    },
    annotations: {},
    controls: {},
    title: 'loops'
});
