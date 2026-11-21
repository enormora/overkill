import { type TestScope, suite, test } from '@overkill-dev/test';

import { moduleLoadingRuntime } from './test-support/module-loading-runtime.ts';
import { createModuleLoading, type DeliveredModule } from './module-delivery.ts';

const entry = 'file:///project/main.ts';
const dependency = 'file:///project/dependency.ts';
const modules: readonly DeliveredModule[] = [
    {
        url: entry,
        format: 'module-typescript',
        source: 'export const value = true;',
        dependencies: { './dependency': dependency, 'node:path': 'node:path' }
    },
    { url: dependency, format: 'json', source: '{"value":true}', dependencies: {} }
];
const delivery = { build: 'build', modules, builtins: [ 'node:path' ] };
const builtEntry = `${entry}?overkill-build=build%3A0`;
const builtDependency = `${dependency}?overkill-build=build%3A0`;

export const testNode = suite('frozen module delivery', [
    test('returns the native namespace through a generated facade', async function (scope) {
        const fixture = moduleLoadingRuntime();
        const loading = createModuleLoading(fixture.runtime);
        const result = await loading.withModuleDelivery(delivery, async function (load) {
            return await load(entry);
        });
        scope.assert.equal(result.namespace, fixture.namespace);
        scope.assert.deepEqual(fixture.imports, [ `${builtEntry}&overkill-namespace=1` ]);
        scope.assert.equal(fixture.registrations.length, 1);
        return scope.assert.collect();
    }),
    test('resolves declared dependencies and allows declared builtins', async function (scope) {
        const fixture = moduleLoadingRuntime();
        await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function () {
            scope.assert.equal(fixture.resolve('./dependency', builtEntry).url, builtDependency);
            scope.assert.equal(fixture.resolve('node:path', builtEntry).url, 'node:path');
            scope.assert.equal(fixture.resolve('file:///unrelated.ts', undefined).url, 'file:///unrelated.ts');
        });
        return scope.assert.collect();
    }),
    test('uses parent-aware native resolution for undeclared graph edges', async function (scope) {
        const fixture = moduleLoadingRuntime();
        await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function () {
            scope.assert.equal(fixture.resolve('./dependency.ts', builtEntry).url, builtDependency);
        });
        scope.assert.equal(fixture.registrations.length, 1);
        return scope.assert.collect();
    }),
    test('serves frozen source and JSON namespace attributes', async function (scope) {
        const fixture = moduleLoadingRuntime();
        await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function () {
            scope.assert.deepEqual(fixture.load(builtEntry), {
                source: modules[0]?.source,
                format: 'module-typescript',
                shortCircuit: true
            });
            const { source } = fixture.load(`${builtDependency}&overkill-namespace=1`);
            if (typeof source !== 'string') {
                throw new TypeError('Expected namespace source.');
            }
            scope.assert.includes(source, 'with {type: "json"}');
            scope.assert.equal(fixture.load('file:///outside.ts').source, 'native source');
        });
        return scope.assert.collect();
    }),
    test('recognizes only imports from an active delivery', async function (scope) {
        const fixture = moduleLoadingRuntime();
        const loading = createModuleLoading(fixture.runtime);
        scope.assert.false(loading.isDeliveredModuleImport({ parentURL: builtEntry }));
        await loading.withModuleDelivery(delivery, async function () {
            scope.assert.true(loading.isDeliveredModuleImport({ parentURL: builtEntry }));
            scope.assert.false(loading.isDeliveredModuleImport(null));
            scope.assert.false(loading.isDeliveredModuleImport('value'));
            scope.assert.false(loading.isDeliveredModuleImport({ parentURL: entry }));
        });
        scope.assert.false(loading.isDeliveredModuleImport({ parentURL: builtEntry }));
        return scope.assert.collect();
    }),
    test('rejects imports through a closed delivery', async function (scope) {
        const fixture = moduleLoadingRuntime();
        await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function () {
            return undefined;
        });
        scope.assert.throws(function () {
            fixture.resolve('./dependency.ts', builtEntry);
        }, { message: 'Implementation delivery is closed.' });
        scope.assert.throws(function () {
            fixture.load(builtEntry);
        }, { message: 'Implementation delivery is closed.' });
        return scope.assert.collect();
    }),
    test('rejects entry modules outside the frozen graph', async function (scope: TestScope) {
        const fixture = moduleLoadingRuntime();
        let failure: unknown = null;
        try {
            await createModuleLoading(fixture.runtime).withModuleDelivery(delivery, async function (load) {
                return await load('file:///outside.ts');
            });
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, TypeError);
        scope.assert.equal(failure.message, 'Implementation entry is outside the frozen graph.');
        scope.assert.equal(fixture.registrations.length, 1);
        return scope.assert.collect();
    }),
    test('shares one registry across loading instances', async function (scope) {
        const fixture = moduleLoadingRuntime();
        const first = createModuleLoading(fixture.runtime);
        const second = createModuleLoading(fixture.runtime);
        await first.withModuleDelivery(delivery, async function () {
            await second.withModuleDelivery(delivery, async function () {
                scope.assert.true(second.isDeliveredModuleImport({ parentURL: builtEntry }));
            });
            scope.assert.true(first.isDeliveredModuleImport({ parentURL: builtEntry }));
        });
        scope.assert.equal(fixture.registrations.length, 1);
        return scope.assert.collect();
    }),
    test('removes scoped hooks when the operation rejects', async function (scope) {
        const fixture = moduleLoadingRuntime();
        const failure = new Error('operation failed');
        let caught: unknown = null;
        try {
            await createModuleLoading(fixture.runtime).withModuleLoadingScope({
                load(_url, next) {
                    return next();
                },
                resolve(_specifier, _parentURL, next) {
                    return next();
                }
            }, async function () {
                throw failure;
            });
        } catch (error: unknown) {
            caught = error;
        }
        scope.assert.equal(caught, failure);
        scope.assert.equal(fixture.registrations.length, 0);
        return scope.assert.collect();
    })
]);
