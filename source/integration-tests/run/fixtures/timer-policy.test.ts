import { setTimeout as setNodeTimeout } from 'node:timers';
import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                setNodeTimeout(function ignoredTimer() {
                    return undefined;
                }, 1);

                return scope.assert.collect();
            },
            annotations: {},
            controls: {},
            title: 'creates a timer'
        })
    ],
    annotations: {},
    controls: {},
    title: 'fixture'
});
