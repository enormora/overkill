import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { projectedPreparation } from '../test-support/projected-resource-preparation.ts';

export const testNode = suite('remote resource failure preparation', [
    test('skips remote preparation when no external resources are projected', async function (scope: TestScope) {
        const fixture = projectedPreparation('empty');
        scope.cleanup(fixture.dispose);
        await fixture.policy.prepareAttempt(fixture.testCase, { index: 0 });
        scope.assert.deepEqual(fixture.sent, []);
        scope.assert.deepEqual(fixture.policy.takeAttemptErrors(fixture.testCase, { index: 0 }), []);
        return scope.assert.collect();
    }),
    ...([ 'success', 'error' ] as const).map(function (scenario) {
        return test(
            `matches replies and drains ${scenario} preparation evidence once`,
            async function (scope: TestScope) {
                const fixture = projectedPreparation(scenario);
                scope.cleanup(fixture.dispose);
                await fixture.policy.prepareAttempt(fixture.testCase, { index: 2 });
                scope.assert.partialDeepEqual(fixture.sent, [ {
                    kind: 'prepare-resource-artifacts',
                    work: fixture.testCase.workId,
                    attempt: { index: 2 }
                } ]);
                scope.assert.deepEqual(fixture.policy.takeAttemptErrors(fixture.testCase, { index: 1 }), []);
                const errors = fixture.policy.takeAttemptErrors(fixture.testCase, { index: 2 });
                scope.assert.deepEqual(
                    errors.map(function (error) {
                        return error.message;
                    }),
                    scenario === 'error' ? [ 'owner failed' ] : []
                );
                scope.assert.deepEqual(fixture.policy.takeAttemptErrors(fixture.testCase, { index: 2 }), []);
                scope.assert.equal(fixture.listeners(), 0);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'closed', 'throw' ] as const).map(function (scenario) {
        return test(
            `attributes ${scenario} transport failures and releases both listeners`,
            async function (scope: TestScope) {
                const fixture = projectedPreparation(scenario);
                scope.cleanup(fixture.dispose);
                await fixture.policy.prepareAttempt(fixture.testCase, { index: 2 });
                const errors = fixture.policy.takeAttemptErrors(fixture.testCase, { index: 2 });
                scope.assert.partialDeepEqual(errors, [ {
                    message: 'Failure artifact preparation failed.',
                    subtype: 'artifact',
                    attributedToAttempt: { index: 2 },
                    attributedToWork: fixture.testCase.workId
                } ]);
                scope.assert.equal(fixture.listeners(), 0);
                scope.assert.deepEqual(fixture.policy.takeAttemptErrors(fixture.testCase, { index: 2 }), []);
                return scope.assert.collect();
            }
        );
    })
]);
await runIfMain(import.meta, testNode);
