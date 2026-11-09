import { suite, test } from '../../../packages/test/test.entry-point.ts';
import { snapshot } from '../../../packages/test/baselines.entry-point.ts';

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
