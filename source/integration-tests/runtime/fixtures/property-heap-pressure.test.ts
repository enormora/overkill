import { createTestCase } from '../../../packages/engine/engine.entry-point.ts';

export const testNode = createTestCase({
    title: 'grows heap',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    async body(scope) {
        const retained: number[][] = [];
        while (!scope.signal.aborted) {
            retained.push(new Array<number>(1_000_000).fill(42));
            await scope.yieldToNextTurn();
        }
        scope.assert.true(retained.length > 0);
        return scope.assert.collect();
    }
});
