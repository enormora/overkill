import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { globalErrorObservation } from '../test-support/global-error-observation.ts';
import { observeCollection } from '../engine/execution-global-error-observer.ts';
import { createCollectedPlan, workerPoolResolvedRun } from '../test-support/worker-pool-execution-state.ts';

export const testNode: TestNode = suite('collection error observation', [
    test('returns the collected plan and removes process hook ownership', async function (scope) {
        const fixture = globalErrorObservation();
        const expected = workerPoolResolvedRun(createCollectedPlan());
        const result = await observeCollection(async function () {
            return expected;
        }, fixture.observer);
        scope.assert.equal(result, expected);
        scope.assert.equal(fixture.events.listenerCount('unhandledRejection'), 0);
        return scope.assert.collect();
    }),
    test('preserves collection failures and removes process hook ownership', async function (scope) {
        const fixture = globalErrorObservation();
        const failure = new Error('Collection failed.');
        await scope.assert.rejects(async function () {
            await observeCollection(async function () {
                throw failure;
            }, fixture.observer);
        }, { exact: failure });
        scope.assert.equal(fixture.events.listenerCount('unhandledRejection'), 0);
        return scope.assert.collect();
    }),
    table({
        title: 'rejects process hook failures after draining diagnostics',
        cases: [ false, true ],
        caseTitle(drained) {
            return `${drained}`;
        },
        async test(scope) {
            const drained = scope.parameters;

            const fixture = globalErrorObservation();
            await scope.assert.rejects(async function () {
                await observeCollection(async function () {
                    fixture.events.emit('unhandledRejection', new Error('Background collection failed.'));
                    if (drained) {
                        fixture.observer.takeErrors();
                    }
                    return workerPoolResolvedRun(createCollectedPlan());
                }, fixture.observer);
            }, {
                name: 'AggregateError',
                message: drained
                    ? 'Test collection failed after a process-level runtime error.'
                    : 'Unhandled rejection: Background collection failed.'
            });
            scope.assert.equal(fixture.events.listenerCount('unhandledRejection'), 0);
            return scope.assert.collect();
        }
    })
]);
