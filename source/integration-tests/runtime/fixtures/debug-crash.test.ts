import { test } from '@overkill-dev/test';

export const testNode = test('crashing debug case', async (scope) => {
    scope.assert.equal(1, 1);
    await scope.yieldToNextTurn();
    process.exit(17);
});
