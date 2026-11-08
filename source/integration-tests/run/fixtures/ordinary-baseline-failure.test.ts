import { test } from '../../../packages/test/test.entry-point.ts';

export const testNode = test('fails before baseline observation', () => {
    throw new Error('Fixture execution failed.');
});
