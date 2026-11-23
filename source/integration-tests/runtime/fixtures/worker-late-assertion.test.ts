import { suite, test } from '../../../packages/test/test.entry-point.ts';

let escaped: (() => void) | null = null;

export const testNode = suite('worker assignment lifetime', [
    test('a saves the scope', function (scope) {
        escaped = function recordLateAssertion() {
            scope.assert.true(true);
        };
        scope.assert.true(true);
        return scope.assert.collect();
    }),
    test('b calls the saved scope', function (scope) {
        const previous = escaped;
        if (previous === null) {
            throw new Error('The previous worker assignment did not save its assertion scope.');
        }
        let rejected = false;
        try {
            previous();
        } catch {
            rejected = true;
        }
        scope.assert.true(rejected);
        return scope.assert.collect();
    })
]);
