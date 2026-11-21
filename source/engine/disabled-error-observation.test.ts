import { suite, test } from '@overkill-dev/test';

import { managedCase } from '../test-support/managed-resource-acquisition.ts';
import { createDisabledExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';

export const testNode = suite('disabled global error observation', [
    test('preserves boundary, case, and phase results without observing hooks', async function (scope) {
        const observer = createDisabledExecutionGlobalErrorObserver();
        const values = await observer.runBoundary(async function () {
            return await observer.runCase(managedCase(), { index: 0 }, async function () {
                return await observer.runPhase('body', async function () {
                    return 42;
                });
            });
        });
        scope.assert.equal(values, 42);
        scope.assert.false(observer.hasFatalError());
        scope.assert.deepEqual(observer.takeErrors(), []);
        observer.stop();
        return scope.assert.collect();
    }),
    test('preserves failures and permits removing unused fatal handlers', async function (scope) {
        const observer = createDisabledExecutionGlobalErrorObserver();
        const error = new Error('body failed');
        const remove = observer.onFatalError(function () {
            throw new Error('disabled observer must not dispatch');
        });
        remove();
        await scope.assert.rejects(async function () {
            await observer.runBoundary(async function () {
                throw error;
            });
        }, { exact: error });
        observer.stop();
        scope.assert.deepEqual(observer.takeErrors(), []);
        return scope.assert.collect();
    })
]);
