import { AsyncResource } from 'node:async_hooks';
import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import { observationCase, observationError } from '../test-support/observation-lifetime.ts';
import { registerExecutionDisposal } from '../execution-ownership.ts';
import type { RunnerError } from './run-result.ts';
import { createExecutionObservation, withExecutionObservation } from './execution-observation.ts';

async function rejectedObservationValue(operation: Promise<unknown>): Promise<unknown> {
    try {
        await operation;
        return null;
    } catch (error: unknown) {
        return error;
    }
}

export const testNode: TestNode = suite('execution observation lifetime policy', [
    test(
        'retains origin attribution for callbacks observed after their attempt closes',
        async function (scope) {
            const observation = createExecutionObservation();
            const caseNode = observationCase();
            let inspect = function (): RunnerError {
                return observation.attribute(observationError());
            };
            await observation.runAttempt(caseNode, { index: 0 }, async function () {
                const capture = AsyncResource.bind(function () {
                    return observation.attribute(observationError());
                });
                inspect = capture;
            });
            const error = inspect();
            scope.assert.equal(error.subtype, 'attribution-drift');
            scope.assert.equal(error.attributedTo, null);
            scope.assert.partialDeepEqual<unknown, unknown>(error.cause, {
                kind: 'late-observation',
                origin: { case: caseNode.id, attempt: { index: 0 } }
            });
            observation.stop();
            return scope.assert.collect();
        }
    ),
    test('unregisters observation disposers before closure', function (scope) {
        const observation = createExecutionObservation();
        let disposed = false;
        const remove = observation.register(function () {
            disposed = true;
        });
        remove();
        observation.stop();
        scope.assert.false(disposed);
        scope.assert.false(observation.open());
        return scope.assert.collect();
    }),
    test('preserves operation failures when observation shutdown succeeds', async function (scope) {
        const failure = new Error('Operation failed.');
        await scope.assert.rejects(async function () {
            await withExecutionObservation(async function () {
                throw failure;
            });
        }, { exact: failure });
        return scope.assert.collect();
    }),
    test('preserves operation and observation shutdown failures', async function (scope: TestScope) {
        const operationError = new Error('operation sentinel');
        const shutdownError = new Error('shutdown sentinel');
        const operation = withExecutionObservation(async function failedOperation() {
            registerExecutionDisposal(function failedShutdown() {
                throw shutdownError;
            });
            throw operationError;
        });
        const error = await rejectedObservationValue(operation);
        scope.require.instanceOf(error, AggregateError);
        scope.assert.equal(error.errors[0], operationError);
        const shutdown: unknown = error.errors[1];
        scope.require.instanceOf(shutdown, AggregateError);
        scope.assert.deepEqual(shutdown.errors, [ shutdownError ]);
        return scope.assert.collect();
    }),
    test('attempts every disposer and immediately disposes registrations after stop', function (scope) {
        const observation = createExecutionObservation();
        const stopped: string[] = [];
        observation.register(function failingDisposal() {
            stopped.push('first');
            throw new Error('disposal sentinel');
        });
        observation.register(function independentDisposal() {
            stopped.push('second');
        });
        scope.assert.throws(observation.stop, { message: 'Execution observation shutdown failed.' });
        observation.register(function lateDisposal() {
            stopped.push('late');
        });
        observation.stop();
        scope.assert.deepEqual(stopped, [ 'first', 'second', 'late' ]);
        return scope.assert.collect();
    })
]);
