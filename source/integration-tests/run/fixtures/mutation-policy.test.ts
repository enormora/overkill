import { suite, test } from '../../../packages/test/test.entry-point.ts';

let activeCases = 0;

export const testNode = suite('serial mutation policy', [
    ...[ '1 passes', '2 fails', '3 follows failure' ].map(function serialCase(title) {
        return test(title, async (scope) => {
            scope.assert.equal(activeCases, 0);
            activeCases += 1;
            scope.cleanup(async function completeCase() {
                await scope.yieldToNextTurn();
                activeCases -= 1;
            });
            await scope.yieldToNextTurn();
            scope.assert.notEqual(title, '2 fails');
            return scope.assert.collect();
        });
    }),
    test('4 forbidden console', function (scope) {
        console.log('Mutation execution retains console restrictions.');
        scope.assert.true(true);
        return scope.assert.collect();
    })
]);
