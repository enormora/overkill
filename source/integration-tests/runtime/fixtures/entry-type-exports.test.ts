import { test } from '@overkill-dev/test';
import { expected, title } from './entry-export-support.test.ts';

export type { Label } from './entry-export-support.test.ts';
export type Expected = typeof expected;

export const testNode = test(title, function (scope) {
    scope.assert.equal(expected, 42);
    return scope.assert.collect();
});
