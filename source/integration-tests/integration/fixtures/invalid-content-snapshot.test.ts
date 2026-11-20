import { suite, test } from '@overkill-dev/test';

import { snapshot } from '@overkill-dev/test/baselines';

export const testNode = suite('snapshot publication', [
    test('valid snapshot proposal', async function (scope) {
        await scope.assert(snapshot.text, 'proposal', 'pending');
        return scope.assert.collect();
    }),
    test('duplicate snapshot names', async function (scope) {
        await scope.assert(snapshot.text, 'response', 'first');
        await scope.assert(snapshot.text, 'response', 'second').catch(function caughtDuplicate(error: unknown) {
            scope.assert.instanceOf(error, Error);
        });
        return scope.assert.collect();
    })
]);
