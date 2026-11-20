import { test } from '@overkill-dev/test';

export const testNode = test('fails before baseline observation', () => {
    throw new Error('Fixture execution failed.');
});
