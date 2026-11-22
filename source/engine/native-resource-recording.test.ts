import { table, type TestScope, suite, test } from '@overkill-dev/test';

import { withRunnerInfrastructure } from '../execution-ownership.ts';

import {
    recordNativeResource,
    forgetNativeResource,
    observeNativeResources,
    completeNativeWriteRequest,
    sameNativeResourceType
} from './native-resource-observation.ts';

const allocation = -9100;
function release(cleanup: TestScope['cleanup']): void {
    cleanup(function () {
        forgetNativeResource(allocation);
    });
}
function complete(): void {
    return undefined;
}
export const testNode = suite('native resource observation records', [
    table({
        title: 'recognizes write completion ownership',
        cases: [ { async: true, handle: {}, active: true }, { async: false, handle: {}, active: false }, {
            async: false,
            handle: null,
            active: true
        } ] as const,
        caseTitle(scenario) {
            return `${scenario.async}, ${
                scenario.handle === null
                    ? 'closed'
                    : 'open'
            }`;
        },
        test(scope) {
            const scenario = scope.parameters;

            release(scope.cleanup);
            const snapshot = observeNativeResources();
            withRunnerInfrastructure(function () {
                recordNativeResource(allocation, 'WRITEWRAP', { ...scenario, oncomplete: complete });
            });
            scope.assert.deepEqual(snapshot().active, scenario.active ? [ 'SimpleWriteWrap' ] : []);
            completeNativeWriteRequest(allocation);
            scope.assert.deepEqual(snapshot().active, []);
            return scope.assert.collect();
        }
    }),
    test('ignores completed writes without a completion callback', function (scope) {
        release(scope.cleanup);
        const snapshot = observeNativeResources();
        withRunnerInfrastructure(function () {
            recordNativeResource(allocation, 'WRITEWRAP', { async: true, oncomplete: null });
        });
        scope.assert.deepEqual(snapshot().active, []);
        return scope.assert.collect();
    }),
    test('reads current timer reference state without retaining the timer', function (scope) {
        release(scope.cleanup);
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
    test('retains unconfirmed infrastructure allocations as uncertain', function (scope) {
        release(scope.cleanup);
        const snapshot = observeNativeResources();
        withRunnerInfrastructure(function () {
            recordNativeResource(allocation, 'UnitNativeHandle', {});
        });
        completeNativeWriteRequest(allocation);
        scope.assert.deepEqual(snapshot().uncertain, [ 'UnitNativeHandle' ]);
        return scope.assert.collect();
    }),
    table({
        title: 'ignores unreferenced native-resource records',
        cases: [ 'PROMISE', 'TickObject', 'Microtask' ] as const,
        caseTitle(type) {
            return type;
        },
        test(scope) {
            const type = scope.parameters;

            release(scope.cleanup);
            const snapshot = observeNativeResources();
            recordNativeResource(allocation, type, {});
            scope.assert.deepEqual(snapshot(), { active: [], uncertain: [] });
            return scope.assert.collect();
        }
    }),
    test('matches socket and provider names independent of case', function (scope) {
        scope.assert.true(sameNativeResourceType('TCPSocketWrap', 'TCPWRAP'));
        scope.assert.true(sameNativeResourceType('PipeWrap', 'PIPEWRAP'));
        scope.assert.false(sameNativeResourceType('Timeout', 'TCPWRAP'));
        return scope.assert.collect();
    })
]);
