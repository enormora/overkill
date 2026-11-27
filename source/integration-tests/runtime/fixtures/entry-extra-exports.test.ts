import { test } from '@overkill-dev/test';

export { expected as alias } from './entry-export-support.test.ts';
export * from './entry-export-support.test.ts';
export default null;

export const testNode = test('entry with extra exports', function (scope) {
    scope.assert.fail({ message: 'Discovery should reject this entry before execution.' });
    return scope.assert.collect();
});
