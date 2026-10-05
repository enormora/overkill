import { test } from '../../../packages/test/test.entry-point.ts';

let attempts = 0;

export const testNode = test('recovers on the third attempt', async (scope) => {
    attempts += 1;
    console.log(`retry evidence ${attempts}`);
    await scope.yieldToNextTurn();
    scope.assert.equal(attempts, 3);
    return scope.assert.collect();
});
