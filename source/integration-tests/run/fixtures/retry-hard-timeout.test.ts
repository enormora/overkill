import { test } from '../../../packages/test/test.entry-point.ts';

let attempts = 0;

export const testNode = test('retry before hard timeout', async function (scope) {
    attempts += 1;
    console.log(`hard-timeout attempt ${attempts}`);
    await scope.yieldToNextTurn();
    if (attempts > 1) {
        for (;;) {
            Math.sqrt(attempts);
        }
    }
    scope.assert.fail();
    return scope.assert.collect();
});
