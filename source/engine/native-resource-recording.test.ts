import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { testNode as leakPolicy } from './async-leak-policy.test.ts';
import {
    recordNativeResource,
    forgetNativeResource,
    observeNativeResources,
    completeNativeWriteRequest,
    sameNativeResourceType
} from './native-resource-observation.ts';

const allocation = -9100;
function release(scope: TestScope): void {
    scope.cleanup(function () {
        forgetNativeResource(allocation);
    });
}
function complete(): void {
    return undefined;
}
export const testNode = authoredSuite('native resource observation records', [
    leakPolicy,
    ...([ { async: true, handle: {}, active: true }, { async: false, handle: {}, active: false }, {
        async: false,
        handle: null,
        active: true
    } ] as const)
        .map(function (scenario) {
            return authoredTest(
                `recognizes write completion ownership with asynchronous ${scenario.async} and handle ${
                    scenario.handle === null
                        ? 'closed'
                        : 'open'
                }`,
                function (scope: TestScope) {
                    release(scope);
                    const snapshot = observeNativeResources();
                    withRunnerInfrastructure(function () {
                        recordNativeResource(allocation, 'WRITEWRAP', { ...scenario, oncomplete: complete });
                    });
                    scope.assert.deepEqual(snapshot().active, scenario.active ? [ 'SimpleWriteWrap' ] : []);
                    completeNativeWriteRequest(allocation);
                    scope.assert.deepEqual(snapshot().active, []);
                    return scope.assert.collect();
                }
            );
        }),
    authoredTest('ignores completed writes without a completion callback', function (scope: TestScope) {
        release(scope);
        const snapshot = observeNativeResources();
        withRunnerInfrastructure(function () {
            recordNativeResource(allocation, 'WRITEWRAP', { async: true, oncomplete: null });
        });
        scope.assert.deepEqual(snapshot().active, []);
        return scope.assert.collect();
    }),
    authoredTest('reads current timer reference state without retaining the timer', function (scope: TestScope) {
        release(scope);
        const snapshot = observeNativeResources();
        let referenced = true;
        const timer = {
            hasRef() {
                return referenced;
            }
        };
        withRunnerInfrastructure(function () {
            recordNativeResource(allocation, 'Timeout', timer);
        });
        scope.assert.deepEqual(snapshot().active, [ 'Timeout' ]);
        referenced = false;
        scope.assert.deepEqual(snapshot().active, []);
        return scope.assert.collect();
    }),
    authoredTest('retains unconfirmed infrastructure allocations as uncertain', function (scope: TestScope) {
        release(scope);
        const snapshot = observeNativeResources();
        withRunnerInfrastructure(function () {
            recordNativeResource(allocation, 'UnitNativeHandle', {});
        });
        completeNativeWriteRequest(allocation);
        scope.assert.deepEqual(snapshot().uncertain, [ 'UnitNativeHandle' ]);
        return scope.assert.collect();
    }),
    ...([ 'PROMISE', 'TickObject', 'Microtask' ] as const).map(function (type) {
        return authoredTest(`ignores unreferenced ${type} records`, function (scope: TestScope) {
            release(scope);
            const snapshot = observeNativeResources();
            recordNativeResource(allocation, type, {});
            scope.assert.deepEqual(snapshot(), { active: [], uncertain: [] });
            return scope.assert.collect();
        });
    }),
    authoredTest('matches socket and provider names independent of case', function (scope: TestScope) {
        scope.assert.true(sameNativeResourceType('TCPSocketWrap', 'TCPWRAP'));
        scope.assert.true(sameNativeResourceType('PipeWrap', 'PIPEWRAP'));
        scope.assert.false(sameNativeResourceType('Timeout', 'TCPWRAP'));
        return scope.assert.collect();
    })
]);
