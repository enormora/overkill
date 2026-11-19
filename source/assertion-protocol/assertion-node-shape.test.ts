import { type TestScope as OverkillScope, suite, test } from '@overkill-dev/test';

import { assertionSources } from './assertion-node-shape.ts';

export const testNode = suite('source/assertion-protocol/assertion-node-shape.test.ts', [
    test('assertionSources declares the built-in assertion origins', function (scope: OverkillScope) {
        scope.assert.deepEqual(assertionSources, [ 'assert', 'require' ]);

        return scope.assert.collect();
    })
]);
