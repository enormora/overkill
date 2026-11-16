import { expect, test } from 'tstyche';
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

test('infers workload parameters alongside dependency handles', function () {
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
            expect(workload.parameters).type.toBe<PackageParameters>();
            expect(dependencies.dependency).type.toBe<string>();
            return workload.parameters.packages;
        },
        dispose(handle, { workload }) {
            expect(handle).type.toBe<number>();
            expect(workload.parameters).type.toBe<PackageParameters>();
        }
    });
    expect(resource.workload).type.toBe<(parameters: WorkloadParameters) => PackageParameters>();
});

test('infers workload parameters in local service callbacks', function () {
    defineLocalServiceResource({
        name: 'registry',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        workload: parsePackages,
        address: { kind: 'loopback', port: 0 },
        start({ workload }) {
            expect(workload.parameters).type.toBe<PackageParameters>();
            return workload.parameters.packages;
        },
        ready(handle, { workload }) {
            expect(handle).type.toBe<number>();
            expect(workload.parameters).type.toBe<PackageParameters>();
            return { url: 'http://localhost', packages: handle };
        },
        dispose(handle, { workload }) {
            expect(handle).type.toBe<number>();
            expect(workload.parameters).type.toBe<PackageParameters>();
        }
    });
});

test('independent resources expose a null workload', function () {
    defineResource({
        name: 'registry',
        scope: 'per-case',
        requirements: [],
        dispose: null,
        acquire({ workload }) {
            expect(workload).type.toBe<null>();
            return 'registry';
        }
    });
});

test('infers workload parameters with projections and acquisition scenarios', function () {
    const fixture = defineResource({
        name: 'fixture',
        scope: 'per-run',
        requirements: [],
        workload: parsePackages,
        scenarios: { registry: { default: 'ready', timing: 'acquire', values: [ 'ready', 'failure' ] } },
        acquire({ workload, scenarios }) {
            expect(workload.parameters).type.toBe<PackageParameters>();
            expect(scenarios.registry).type.toBe<'failure' | 'ready'>();
            return workload.parameters.packages;
        },
        dispose(handle, { workload, scenarios }) {
            expect(handle).type.toBe<number>();
            expect(workload.parameters).type.toBe<PackageParameters>();
            expect(scenarios.registry).type.toBe<'failure' | 'ready'>();
        },
        serializeHandle(handle) {
            return { packages: handle };
        },
        deserializeHandle(payload: PackageParameters) {
            return String(payload.packages);
        }
    });
    expect<ResourceHandle<typeof fixture>>().type.toBe<string>();
    expect(fixture.deserializeHandle).type.toBe<
        ((payload: ResourceProjectionPayload, context: ResourceProjectionContext) => string) | undefined
    >();
});

test('rejects asynchronous workload parsers', function () {
    expect(defineResource).type.not.toBeCallableWith({
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
