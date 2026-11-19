import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { ResourceLifecycleError } from '../resources/resource-lifecycle-error.ts';
import { projectFailure } from './config-errors.ts';

class ConfigBackendError extends Error {
    public constructor() {
        super('Failure in /project/source.js');
        this.name = 'ConfigBackendError';
        this.stack = 'Error: Failure in /project/source.js\n    at /project/source.js:1:1';
    }
}

export const testNode = authoredSuite('ESLint config failure propagation', [
    test('normalizes project paths in error messages and preserved stacks', function (scope: TestScope) {
        const original = new ConfigBackendError();
        const failure = projectFailure(original, '/project', scope.signal);
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.name, 'ConfigExecutionError');
        scope.assert.equal(failure.message, 'Failure in <project>/source.js');
        scope.assert.equal(failure.stack, 'Error: Failure in <project>/source.js\n    at <project>/source.js:1:1');
        return scope.assert.collect();
    }),
    test('retains non-Error thrown values', function (scope: TestScope) {
        const failure = { reason: 'parser failed' };
        scope.assert.equal(projectFailure(failure, '/project', scope.signal), failure);
        scope.assert.equal(projectFailure(42, '/project', scope.signal), 42);
        return scope.assert.collect();
    }),
    test('propagates owner cancellation before normalizing an execution failure', function (scope: TestScope) {
        const reason = new Error('Cancelled.');
        scope.assert.throws(function () {
            projectFailure(new Error('Execution failed.'), '/project', AbortSignal.abort(reason));
        }, { exact: reason });
        return scope.assert.collect();
    }),
    test('preserves permission denials nested in Error causes', function (scope: TestScope) {
        const denied = Object.assign(new Error('Permission denied.'), { code: 'ERR_ACCESS_DENIED' });
        scope.assert.throws(function () {
            projectFailure(new Error('Wrapper.', { cause: denied }), '/project', scope.signal);
        }, { exact: denied });
        return scope.assert.collect();
    }),
    test('preserves control failures inside resource lifecycle aggregates', function (scope: TestScope) {
        const denied = Object.assign(new Error('Permission denied.'), { code: 'ERR_ACCESS_DENIED' });
        const error = new ResourceLifecycleError('Acquisition failed.', {
            cause: null,
            failures: [ { cause: denied, phase: 'acquire', resourceName: 'service' } ]
        });
        scope.assert.throws(function () {
            projectFailure(error, '/project', scope.signal);
        }, { exact: denied });
        return scope.assert.collect();
    }),
    test('terminates cause traversal when errors contain cycles', function (scope: TestScope) {
        const original = new Error('Failure.');
        Reflect.set(original, 'cause', original);
        const failure = projectFailure(original, '/project', scope.signal);
        scope.require.instanceOf(failure, Error);
        scope.assert.equal(failure.message, original.message);
        return scope.assert.collect();
    })
]);
