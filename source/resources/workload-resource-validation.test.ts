import { suite, test } from '../packages/test/test.entry-point.ts';
import { workload } from '../packages/bench/bench.entry-point.ts';
import { snapshotWorkloadInput } from '../engine/workload-input.ts';
import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { defineResource, startResources, ResourceLifecycleError } from '../packages/resources/resources.entry-point.ts';
import { defineLocalServiceResource } from './local-service-resource.ts';

async function rejectedResourceAcquisition(acquire: () => Promise<unknown>): Promise<unknown> {
    try {
        return await acquire();
    } catch (error: unknown) {
        return error;
    }
}

export const testNode = suite('workload resource validation', [
    test('retains readiness and cleanup failures with the same workload context', async function (scope: TestScope) {
        const failures = { ready: new Error('readiness failed'), cleanup: new Error('cleanup failed') };
        const inputs: unknown[] = [];
        const fixture = defineLocalServiceResource({
            name: 'service',
            scope: 'per-case',
            requirements: [],
            dependencies: {},
            address: { kind: 'loopback', port: 0 },
            workload(parameters) {
                return parameters;
            },
            start({ workload: input }) {
                inputs.push(input);
                return { count: input.parameters.count };
            },
            ready() {
                throw failures.ready;
            },
            dispose(_owner, { workload: input }) {
                inputs.push(input);
                throw failures.cleanup;
            }
        });
        const result = await rejectedResourceAcquisition(async function () {
            return startResources({
                resources: { fixture },
                signal: scope.signal,
                workload: workload('input', { count: 2 })
            });
        });
        scope.require.instanceOf(result, ResourceLifecycleError);
        scope.require.instanceOf(result.cause, AggregateError);
        scope.assert.deepEqual(result.cause.errors, [ failures.ready, failures.cleanup ]);
        scope.assert.equal(inputs[0], inputs[1]);
        scope.assert.partialDeepEqual({ count: inputs.length, workload: inputs[0] }, {
            count: 2,
            workload: { parameters: { count: 2 } }
        });
        return scope.assert.collect();
    }),
    test('rejects malformed identity records before binding resources', function (scope) {
        for (const id of [ null, { name: 'fixture', params: null } ]) {
            scope.assert.throws(function () {
                Reflect.apply(snapshotWorkloadInput, undefined, [ { id, parameters: {} } ]);
            }, { message: /Workload identities require/v });
        }
        return scope.assert.collect();
    }),
    test('rejects a noncallable workload parser at definition time', function (scope) {
        scope.assert.throws(function () {
            Reflect.apply(defineResource, undefined, [ {
                name: 'fixture',
                scope: 'per-case',
                requirements: [],
                acquire() {
                    return 1;
                },
                dispose: null,
                workload: 'invalid'
            } ]);
        }, { message: 'Resource workload requires a synchronous parameter parser.' });
        return scope.assert.collect();
    }),
    test('preserves non-error parser failures without acquiring resources', async function (scope: TestScope) {
        const failure: unknown = { reason: 'unsupported parameters' };
        let acquisitions = 0;
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            workload() {
                throw failure;
            },
            acquire() {
                acquisitions += 1;
                return 1;
            }
        });
        const result = await rejectedResourceAcquisition(async function () {
            return startResources({
                resources: { fixture },
                signal: scope.signal,
                workload: workload('input', {})
            });
        });
        scope.require.instanceOf(result, ResourceLifecycleError);
        scope.assert.equal(result.cause, failure);
        scope.assert.true(result.message.includes('Invalid workload input.'));
        scope.assert.equal(acquisitions, 0);
        return scope.assert.collect();
    })
]);
