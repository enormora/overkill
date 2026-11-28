import { suite, test } from '@overkill-dev/test';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    defineResource,
    defineLocalServiceResource,
    type WorkloadParameters,
    type ResourceProjectionPayload,
    type ResourceProjectionContext,
    type ResourceHandle
} from './resources.entry-point.ts';

const packageCount = 5;

type PackageParameters = { readonly packages: number; };

function parsePackages(parameters: WorkloadParameters): PackageParameters {
    if (typeof parameters.packages !== 'number') {
        throw new TypeError('Expected a package count.');
    }
    return { packages: parameters.packages };
}

export const testNode = suite('Resource workload inputs and runtime bindings', [
    test('infers workload parameters alongside dependency handles', function (scope) {
        const dependency = defineResource({
            name: 'registry',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            acquire() {
                return 'registry';
            }
        });
        const resource = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            dependencies: { dependency },
            workload: parsePackages,
            acquire({ workload, dependencies }) {
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
                scope.assert(sameType.withActual<string>(), dependencies.dependency);
                return workload.parameters.packages;
            },
            dispose(handle, { workload }) {
                scope.assert(sameType.withActual<number>(), handle);
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
            }
        });
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<(parameters: WorkloadParameters) => PackageParameters>()(resource.workload)
        );
        return scope.assert.collect();
    }),
    test('infers workload parameters in local service callbacks', function (scope) {
        defineLocalServiceResource({
            name: 'registry',
            scope: 'per-case',
            requirements: [],
            dependencies: {},
            workload: parsePackages,
            address: { kind: 'loopback', port: 0 },
            start({ workload }) {
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
                return workload.parameters.packages;
            },
            ready(handle, { workload }) {
                scope.assert(sameType.withActual<number>(), handle);
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
                return { url: 'http://localhost', packages: handle };
            },
            dispose(handle, { workload }) {
                scope.assert(sameType.withActual<number>(), handle);
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
            }
        });
        return scope.assert.collect();
    }),
    test('independent resources expose a null workload', function (scope) {
        defineResource({
            name: 'registry',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            acquire({ workload }) {
                scope.assert(sameType.withActual<null>(), workload);
                return 'registry';
            }
        });
        return scope.assert.collect();
    }),
    test('infers workload parameters with projections and acquisition scenarios', function (scope) {
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-run',
            requirements: [],
            workload: parsePackages,
            scenarios: { registry: { default: 'ready', timing: 'acquire', values: [ 'ready', 'failure' ] } },
            acquire({ workload, scenarios }) {
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
                scope.assert(sameType.withActual<'failure' | 'ready'>(), scenarios.registry);
                return workload.parameters.packages;
            },
            dispose(handle, { workload, scenarios }) {
                scope.assert(sameType.withActual<number>(), handle);
                scope.assert(sameType.withActual<true>(), isEqualTo<PackageParameters>()(workload.parameters));
                scope.assert(sameType.withActual<'failure' | 'ready'>(), scenarios.registry);
            },
            serializeHandle(handle) {
                return { packages: handle };
            },
            deserializeHandle(payload: PackageParameters) {
                return String(payload.packages);
            }
        });
        scope.assert(sameType<ResourceHandle<typeof fixture>, string>());
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<
                ((payload: ResourceProjectionPayload, context: ResourceProjectionContext) => string) | undefined
            >()(fixture.deserializeHandle)
        );
        return scope.assert.collect();
    }),
    test('rejects asynchronous workload parsers', function (scope) {
        scope.assert(rejectsCall('no-matching-overload'), function () {
            return defineResource({
                name: 'fixture',
                scope: 'per-case',
                requirements: [],
                dispose: null,
                async workload() {
                    return { packages: packageCount };
                },
                acquire() {
                    return packageCount;
                }
            });
        });
        return scope.assert.collect();
    })
]);
