import { test } from '../../../packages/test/test.entry-point.ts';

let escaped: (() => void) | null = null;

export const testNode = test('recovers despite a late assertion from the first attempt', function (scope) {
    const previous = escaped;
    if (previous === null) {
        escaped = function recordLateAssertion() {
            scope.assert.true(true);
        };
    } else {
        try {
            previous();
        } catch {
        }
    }
    scope.assert.notNull(previous);
    return scope.assert.collect();
});
