import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { projectedPreparation } from '../test-support/projected-resource-preparation.ts';

export const testNode: TestNode = suite('remote resource failure preparation', [
    test(
        'skips remote preparation when no external resources are projected',
        async function (scope) {
            const fixture = projectedPreparation('empty');
            scope.cleanup(fixture.dispose);
            await fixture.policy.prepareAttempt(fixture.testCase, { index: 0 });
            scope.assert.deepEqual(fixture.sent, []);
            scope.assert.deepEqual(fixture.policy.takeAttemptErrors(fixture.testCase, { index: 0 }), []);
            return scope.assert.collect();
        }
    ),
    table({
        title: 'matches replies and drains preparation evidence once',
        cases: [ 'success', 'error' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const fixture = projectedPreparation(scope.parameters);
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
                scope.parameters === 'error' ? [ 'owner failed' ] : []
            );
            scope.assert.deepEqual(fixture.policy.takeAttemptErrors(fixture.testCase, { index: 2 }), []);
            scope.assert.equal(fixture.listeners(), 0);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'attributes transport failures and releases listeners',
        cases: [ 'closed', 'throw' ] as const,
        caseTitle(scenario) {
            return scenario;
        },
        async test(scope) {
            const scenario = scope.parameters;

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
    })
]);
