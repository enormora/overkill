import { type TestNode, suite, test } from '@overkill-dev/test';

import { assertionSources } from './assertion-node-shape.ts';

export const testNode: TestNode = suite('Assertion node shape', [
    test('assertionSources declares the built-in assertion origins', function (scope) {
        scope.assert.deepEqual(assertionSources, [ 'assert', 'require' ]);

        return scope.assert.collect();
    })
]);
