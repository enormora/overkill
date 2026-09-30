import { setTimeout as sleep } from 'node:timers/promises';
import { createSuite, createTestCase } from '../../../packages/engine/engine.entry-point.ts';

function delayedCase(title: string, delayMilliseconds: number) {
    return createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        async body(scope) {
            await sleep(delayMilliseconds);
            scope.assert.true(true);

            return scope.assert.collect();
        },
        annotations: {},
        controls: {},
        title
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        delayedCase('first-long', 600),
        delayedCase('second-short', 300),
        delayedCase('third-long', 800)
    ],
    annotations: {},
    controls: {},
    title: 'staggered timeout fixture'
});
