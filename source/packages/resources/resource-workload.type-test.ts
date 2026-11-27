import { suite, test } from '@overkill-dev/test-type-authoring';
import { rejectsCall, sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('resource workload', [
    test('infers workload parameters alongside dependency handles', function (typeScope) {
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
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
                typeScope.assert(sameType.withActual<string>(), dependencies.dependency);
                return workload.parameters.packages;
            },
            dispose(handle, { workload }) {
                typeScope.assert(sameType.withActual<number>(), handle);
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
            }
        });
        typeScope.assert(
            sameType.withActual<(parameters: WorkloadParameters) => PackageParameters>(),
            resource.workload
        );
        return typeScope.assert.collect();
    }),
    test('infers workload parameters in local service callbacks', function (typeScope) {
        defineLocalServiceResource({
            name: 'registry',
            scope: 'per-case',
            requirements: [],
            dependencies: {},
            workload: parsePackages,
            address: { kind: 'loopback', port: 0 },
            start({ workload }) {
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
                return workload.parameters.packages;
            },
            ready(handle, { workload }) {
                typeScope.assert(sameType.withActual<number>(), handle);
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
                return { url: 'http://localhost', packages: handle };
            },
            dispose(handle, { workload }) {
                typeScope.assert(sameType.withActual<number>(), handle);
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
            }
        });
        return typeScope.assert.collect();
    }),
    test('independent resources expose a null workload', function (typeScope) {
        defineResource({
            name: 'registry',
            scope: 'per-case',
            requirements: [],
            dispose: null,
            acquire({ workload }) {
                typeScope.assert(sameType.withActual<null>(), workload);
                return 'registry';
            }
        });
        return typeScope.assert.collect();
    }),
    test('infers workload parameters with projections and acquisition scenarios', function (typeScope) {
        const fixture = defineResource({
            name: 'fixture',
            scope: 'per-run',
            requirements: [],
            workload: parsePackages,
            scenarios: { registry: { default: 'ready', timing: 'acquire', values: [ 'ready', 'failure' ] } },
            acquire({ workload, scenarios }) {
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
                typeScope.assert(sameType.withActual<'failure' | 'ready'>(), scenarios.registry);
                return workload.parameters.packages;
            },
            dispose(handle, { workload, scenarios }) {
                typeScope.assert(sameType.withActual<number>(), handle);
                typeScope.assert(sameType.withActual<PackageParameters>(), workload.parameters);
                typeScope.assert(sameType.withActual<'failure' | 'ready'>(), scenarios.registry);
            },
            serializeHandle(handle) {
                return { packages: handle };
            },
            deserializeHandle(payload: PackageParameters) {
                return String(payload.packages);
            }
        });
        typeScope.assert(sameType<ResourceHandle<typeof fixture>, string>());
        typeScope.assert(
            sameType.withActual<
                ((payload: ResourceProjectionPayload, context: ResourceProjectionContext) => string) | undefined
            >(),
            fixture.deserializeHandle
        );
        return typeScope.assert.collect();
    }),
    test('rejects asynchronous workload parsers', function (typeScope) {
        typeScope.assert(rejectsCall('no-matching-overload'), () =>
            defineResource({
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
            }));
        return typeScope.assert.collect();
    })
]);
