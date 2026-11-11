import { test } from '../../../packages/test/test.entry-point.ts';
export const testNode = test('crashing debug case', async (scope) => {
    scope.assert.equal(1, 1);
    await scope.yieldToNextTurn();
    process.exit(17);
});
