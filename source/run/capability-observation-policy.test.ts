import { runIfMain } from '#test-runner';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { capabilityObservation } from '../test-support/capability-observation.ts';
import { observationCase } from '../test-support/observation-lifetime.ts';

export const testNode = suite('injected capability observation', [
    test('ignores explicit violations after observation closes', function (scope: TestScope) {
        const fixture = capabilityObservation();
        fixture.policy.recordViolation('net', 'connection denied', 'blocked');
        scope.assert.partialDeepEqual(fixture.policy.takeRunErrors(), [ { message: 'connection denied' } ]);
        fixture.policy.recordViolation('net', 'late connection denied', 'blocked');
        scope.assert.deepEqual(fixture.policy.takeRunErrors(), []);
        return scope.assert.collect();
    }),
    test('retains process execution and IPC errors during collection', async function (scope: TestScope) {
        const fixture = capabilityObservation();
        scope.cleanup(function () {
            fixture.policy.takeRunErrors();
        });
        await fixture.policy.runLoad(async function () {
            fixture.processExit('process blocked');
            fixture.ipc('IPC blocked');
        });
        const errors = fixture.policy.takePendingRunErrors();
        scope.assert.partialDeepEqual(errors, [ {
            message: 'process blocked',
            attributedTo: null,
            cause: { capability: 'process-execute', phase: 'load' }
        }, { message: 'IPC blocked', attributedTo: null, cause: { capability: 'child-process', phase: 'load' } } ]);
        return scope.assert.collect();
    }),
    test('attributes injected process violations to the active attempt', async function (scope: TestScope) {
        const fixture = capabilityObservation();
        scope.cleanup(function () {
            fixture.policy.takeRunErrors();
        });
        const testCase = observationCase();
        await fixture.policy.runAttempt(testCase, { index: 2 }, async function () {
            fixture.processExit('process blocked');
            fixture.ipc('IPC blocked');
        });
        const errors = fixture.policy.takeAttemptErrors(testCase, { index: 2 });
        scope.assert.equal(errors.length, 2);
        for (const error of errors) {
            scope.assert.partialDeepEqual(error, {
                attributedTo: testCase.id,
                attributedToAttempt: { index: 2 },
                cause: { phase: 'body' }
            });
        }
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
