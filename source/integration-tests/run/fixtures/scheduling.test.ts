import { setTimeout as sleep } from 'node:timers/promises';
import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

const delayMilliseconds = 25;

export const testNode = createSuite({
                definitionLocations: [ { kind: 'unknown' } ],
    children: [
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            async body(scope) {
                await sleep(delayMilliseconds);
                scope.assert.true(true, { message: 'delayed pass' });

                return scope.assert.collect();
            },
            metadata: {},
            title: 'delayed'
        }),
        createTestCase({
                definitionLocations: [ { kind: 'unknown' } ],
            body(scope) {
                scope.assert.true(true, { message: 'immediate pass' });

                return scope.assert.collect();
            },
            metadata: {},
            title: 'immediate'
        })
    ],
    metadata: {},
    title: 'scheduling fixture'
});
